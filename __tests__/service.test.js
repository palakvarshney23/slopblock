const http = require('http')

jest.mock('../logger', () => ({ debugLog: () => {}, logError: () => {} }))
jest.mock('../counts', () => ({ schedule: () => {} }))

process.env.SLOPBLOCK_PORT = '18083'

const state = {
  FILTER_ENABLED: true,
  AD_BLOCKING_ENABLED: true,
  IMAGE_DETECTION_ENABLED: true,
  VIDEO_DETECTION_ENABLED: true,
  YOUTUBE_FILTER_ENABLED: true,
  adsBlocked: 0,
  filteredCount: 0,
  imagesBlocked: 0,
  youtubeBlocked: 0,
  reviewsAnalyzed: 0,
  reviewsFlagged: 0,
  TRUSTED_PATTERNS: []
}

jest.mock('../state', () => state)

const config = require('../config')
config.init(require('os').tmpdir())

const { start, stop, PORT, getServiceToken } = require('../service')

function request(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: PORT, ...options }, res => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }))
    })
    req.on('error', reject)
    if (body !== undefined) req.write(body)
    req.end()
  })
}

describe('service.js', () => {
  beforeAll(async () => { await start(() => {}); })
  afterAll(() => stop())

  test('GET /status returns service state and bootstrap token', async () => {
    const res = await request({ path: '/status', method: 'GET' })
    expect(res.status).toBe(200)
    const data = JSON.parse(res.body)
    expect(data.enabled).toBe(true)
    expect(data.token).toBeDefined()
    expect(data.token.length).toBe(64)
    expect(data.config.textThreshold).toBe(0.55)
    expect(data.videoWarnThreshold).toBe(Math.round(config.get('videoWarnThreshold') * 100))
    expect(data.videoBlockThreshold).toBe(Math.round(config.get('videoBlockThreshold') * 100))
    expect(data.videoDetectionEnabled).toBe(true)
  })

  test('POST /classify without token returns 401', async () => {
    const res = await request({ path: '/classify', method: 'POST' }, 'some text longer than one hundred characters so it passes the min length check')
    expect(res.status).toBe(401)
  })

  test('POST /classify with wrong token returns 401', async () => {
    const res = await request({
      path: '/classify',
      method: 'POST',
      headers: { 'X-SlopFilter-Token': 'invalid-token' }
    }, 'some text longer than one hundred characters so it passes the min length check')
    expect(res.status).toBe(401)
  })

  test('POST /classify with correct token and short text returns not slop', async () => {
    const statusRes = await request({ path: '/status', method: 'GET' })
    const token = JSON.parse(statusRes.body).token
    const res = await request({
      path: '/classify',
      method: 'POST',
      headers: { 'X-SlopFilter-Token': token, 'Content-Type': 'text/plain' }
    }, 'hi')
    expect(res.status).toBe(200)
    const data = JSON.parse(res.body)
    expect(data.isSlop).toBe(false)
    expect(data.confidence).toBe(0)
  })

  test('POST /classify with obvious AI text returns slop', async () => {
    const statusRes = await request({ path: '/status', method: 'GET' })
    const token = JSON.parse(statusRes.body).token
    const res = await request({
      path: '/classify',
      method: 'POST',
      headers: { 'X-SlopFilter-Token': token, 'Content-Type': 'text/plain' }
    }, "In today's digital landscape, let me walk you through a comprehensive guide to unlock your full potential. Whether you are a beginner or expert, this is why you need to delve into these best practices and game-changing strategies.")
    expect(res.status).toBe(200)
    const data = JSON.parse(res.body)
    expect(data.isSlop).toBe(true)
    expect(data.confidence).toBeGreaterThanOrEqual(80)
    expect(data.method).toContain('heuristic')
  })

  test('POST /classify with human text returns not slop', async () => {
    const statusRes = await request({ path: '/status', method: 'GET' })
    const token = JSON.parse(statusRes.body).token
    const res = await request({
      path: '/classify',
      method: 'POST',
      headers: { 'X-SlopFilter-Token': token, 'Content-Type': 'text/plain' }
    }, 'Dude check out this repo I found https://github.com/foo/bar — @alice and I were debugging it last night lol. Here is the stack trace: Error cannot find module')
    expect(res.status).toBe(200)
    const data = JSON.parse(res.body)
    expect(data.isSlop).toBe(false)
    expect(data.confidence).toBeLessThan(50)
  })

  test('POST /classify-review returns reasons array', async () => {
    const statusRes = await request({ path: '/status', method: 'GET' })
    const token = JSON.parse(statusRes.body).token
    const payload = JSON.stringify({
      text: 'Amazing product! Five stars! Highly recommend! Game changer! Must-have!',
      context: { stars: 5, productTitle: 'Wireless Mouse MX', siblingReviewTexts: [] },
    });
    const res = await request({
      path: '/classify-review',
      method: 'POST',
      headers: { 'X-SlopFilter-Token': token, 'Content-Type': 'application/json' },
    }, payload);
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(Array.isArray(data.reasons)).toBe(true);
    expect(typeof data.confidence).toBe('number');
    expect(typeof data.isSlop).toBe('boolean');
    expect(data.method).toContain('review');
  });

  test('POST /classify-image without token returns 401', async () => {
    const res = await request({ path: '/classify-image', method: 'POST' }, 'http://example.com/img.jpg')
    expect(res.status).toBe(401)
  })

  test('POST /classify-image with regular url returns not AI when fetch fails', async () => {
    const statusRes = await request({ path: '/status', method: 'GET' })
    const token = JSON.parse(statusRes.body).token
    const res = await request({
      path: '/classify-image',
      method: 'POST',
      headers: { 'X-SlopFilter-Token': token, 'Content-Type': 'text/plain' }
    }, 'http://example.com/img.jpg')
    expect(res.status).toBe(200)
    const data = JSON.parse(res.body)
    expect(data.isAiImage).toBe(false)
    expect(data.confidence).toBe(0)
  })

  test('POST /classify-image with AI CDN url detects AI via URL forensics', async () => {
    const statusRes = await request({ path: '/status', method: 'GET' })
    const token = JSON.parse(statusRes.body).token
    const res = await request({
      path: '/classify-image',
      method: 'POST',
      headers: { 'X-SlopFilter-Token': token, 'Content-Type': 'text/plain' }
    }, 'https://cdn.midjourney.com/example.png')
    expect(res.status).toBe(200)
    const data = JSON.parse(res.body)
    expect(data.isAiImage).toBe(true)
    expect(data.confidence).toBe(100)
  })

  test('CORS blocks non-extension origin', async () => {
    const res = await request({
      path: '/status',
      method: 'GET',
      headers: { 'Origin': 'https://evil.com' }
    })
    expect(res.status).toBe(403)
  })

  test('CORS allows chrome-extension origin', async () => {
    const res = await request({
      path: '/status',
      method: 'GET',
      headers: { 'Origin': 'chrome-extension://nfbpghkbijdkkfbceienbgbjkeobglib' }
    })
    expect(res.status).toBe(200)
  })

  test('CORS allows moz-extension origin (Firefox)', async () => {
    const res = await request({
      path: '/status',
      method: 'GET',
      headers: { 'Origin': 'moz-extension://slopblock@localhost' }
    })
    expect(res.status).toBe(200)
  })

  test('OPTIONS request returns 204', async () => {
    const res = await request({ path: '/classify', method: 'OPTIONS' })
    expect(res.status).toBe(204)
  })

  test('rate limiting eventually blocks excessive classify requests', async () => {
    const statusRes = await request({ path: '/status', method: 'GET' })
    const token = JSON.parse(statusRes.body).token
    const promises = []
    for (let i = 0; i < 30; i++) {
      promises.push(request({
        path: '/classify',
        method: 'POST',
        headers: { 'X-SlopFilter-Token': token, 'Content-Type': 'text/plain' }
      }, 'some text longer than one hundred characters so it passes the min length check and index ' + i))
    }
    const results = await Promise.all(promises)
    const okCount = results.filter(r => r.status === 200).length
    const rateLimited = results.filter(r => r.status === 429).length
    expect(rateLimited).toBeGreaterThan(0)
    expect(okCount).toBeGreaterThan(0)
    expect(okCount + rateLimited).toBe(30)
  })

  test('POST /youtube-block without token returns 401', async () => {
    const res = await request({ path: '/youtube-block', method: 'POST' })
    expect(res.status).toBe(401)
  })

  test('POST /youtube-block with token returns 204', async () => {
    const statusRes = await request({ path: '/status', method: 'GET' })
    const token = JSON.parse(statusRes.body).token
    const res = await request({
      path: '/youtube-block',
      method: 'POST',
      headers: { 'X-SlopFilter-Token': token }
    })
    expect(res.status).toBe(204)
  })

  test('POST /ad-count-report with token returns 404 (endpoint not implemented)', async () => {
    const statusRes = await request({ path: '/status', method: 'GET' })
    const token = JSON.parse(statusRes.body).token
    const res = await request({
      path: '/ad-count-report',
      method: 'POST',
      headers: { 'X-SlopFilter-Token': token, 'Content-Type': 'application/json' }
    }, JSON.stringify({ delta: 3, hosts: ['doubleclick.net'] }))
    expect(res.status).toBe(404)
  })

  test('POST /classify-frame without token returns 401', async () => {
    const res = await request({
      path: '/classify-frame',
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' }
    }, 'data:image/jpeg;base64,/9j/4AAQ')
    expect(res.status).toBe(401)
  })

  test('POST /classify-frame with invalid body returns 400', async () => {
    const statusRes = await request({ path: '/status', method: 'GET' })
    const token = JSON.parse(statusRes.body).token
    const res = await request({
      path: '/classify-frame',
      method: 'POST',
      headers: { 'X-SlopFilter-Token': token, 'Content-Type': 'text/plain' }
    }, 'not-a-data-uri')
    expect(res.status).toBe(400)
  })

  test('POST /classify-video without token returns 401', async () => {
    const res = await request({
      path: '/classify-video',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, JSON.stringify({ frames: ['data:image/jpeg;base64,/9j/4AAQ'] }))
    expect(res.status).toBe(401)
  })

  test('POST /classify-video with invalid body returns 400', async () => {
    const statusRes = await request({ path: '/status', method: 'GET' })
    const token = JSON.parse(statusRes.body).token
    const res = await request({
      path: '/classify-video',
      method: 'POST',
      headers: { 'X-SlopFilter-Token': token, 'Content-Type': 'application/json' }
    }, JSON.stringify({ notFrames: [] }))
    expect(res.status).toBe(400)
  })

  test('unknown route returns 404', async () => {
    const res = await request({ path: '/unknown', method: 'GET' })
    expect(res.status).toBe(404)
  })

  test('idempotent start does not crash', () => {
    expect(() => start(() => {})).not.toThrow()
  })
})
