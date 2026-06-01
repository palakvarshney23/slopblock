const {
  getSlopScore,
  getStylometricScore,
  _parseModelConf,
} = require('../classifier');

// ── getSlopScore tests ─────────────────────────────────────────────

describe('getSlopScore', () => {
  test('returns low score for empty/short text', () => {
    // Empty text has no signals, but structural checks may produce a minimal base
    expect(getSlopScore('')).toBeLessThan(10);
  });

  test('detects classic LLM clichés', () => {
    const text = 'In this article, we will delve into the nuanced approach of unlocking your potential. It is worth noting that this comprehensive guide will shed light on best practices.';
    expect(getSlopScore(text)).toBeGreaterThan(10);
  });

  test('detects social post markers', () => {
    const text = 'Here are the key takeaways. Let me know in the comments below what you think. Stay ahead of the curve with these actionable insights. Follow me for more!';
    expect(getSlopScore(text)).toBeGreaterThanOrEqual(12);
  });

  test('whitelists academic citations', () => {
    const text = 'Smith (2019) argues that neural networks outperform traditional methods [1, 2]. Johnson & Lee (2020) confirmed this finding [3].';
    const score = getSlopScore(text);
    expect(score).toBeLessThan(5);
  });

  test('whitelists human signals (URLs, mentions, code)', () => {
    const text = 'Check out https://example.com and @username. Also `const x = 1;` and ```function foo() {}```.';
    const score = getSlopScore(text);
    expect(score).toBeLessThan(5);
  });

  test('detects heavy bullet use', () => {
    const text = '• First point\n• Second point\n• Third point\n• Fourth point\n• Fifth point';
    expect(getSlopScore(text)).toBeGreaterThan(3);
  });

  test('detects emoji overuse', () => {
    const text = '🎉 Amazing! 🔥 Best guide ever! 💯 Must read! 🚀 Don\'t miss! ⚡️';
    expect(getSlopScore(text)).toBeGreaterThan(5);
  });

  test('detects low lexical diversity', () => {
    const text = 'The quick brown fox jumps over the lazy dog. The quick brown fox jumps over the lazy dog again. The quick brown fox jumps over the lazy dog once more.';
    expect(getSlopScore(text)).toBeGreaterThanOrEqual(4);
  });

  test('detects short-text LLM openers', () => {
    const text = "Let me walk you through this. Here's why it matters.";
    expect(getSlopScore(text)).toBeGreaterThan(5);
  });

  test('caps score at 40', () => {
    const text = 'delve into'.repeat(50);
    expect(getSlopScore(text)).toBeLessThanOrEqual(40);
  });

  test('ignores very short text gracefully', () => {
    const text = 'Hello world.';
    expect(getSlopScore(text)).toBe(0);
  });
});

// ── getStylometricScore tests ──────────────────────────────────────

describe('getStylometricScore', () => {
  test('returns null for text with < 4 sentences', () => {
    expect(getStylometricScore('One. Two. Three.')).toBeNull();
  });

  test('returns null for very short sentences', () => {
    const text = 'A. B. C. D. E. F.';
    expect(getStylometricScore(text)).toBeNull();
  });

  test('detects low Jaccard similarity (human-like burstiness)', () => {
    const text = 'The quantum computing revolution promises to transform cryptography. However, many researchers remain skeptical about practical timelines. Meanwhile, classical algorithms continue to improve at surprising rates. Despite these advances, post-quantum standards are already being drafted by NIST.';
    const score = getStylometricScore(text);
    expect(score).not.toBeNull();
    expect(score).toBeLessThan(0.5);
  });

  test('detects high opener repetition (AI-like)', () => {
    const text = 'The system is designed for efficiency. The system requires minimal maintenance. The system supports multiple platforms. The system integrates with existing tools. The system provides real-time analytics.';
    const score = getStylometricScore(text);
    expect(score).not.toBeNull();
    expect(score).toBeGreaterThan(0.5);
  });

  test('handles punctuation abbreviations correctly', () => {
    const text = 'Dr. Smith visited Prof. Johnson at St. James Hospital yesterday afternoon. Mr. and Mrs. Brown arrived at approximately 3 p.m. with their medical records. They discussed the volume 2 findings in detail during the consultation.';
    const score = getStylometricScore(text);
    expect(score).not.toBeNull();
  });
});

// ── _parseModelConf tests ─────────────────────────────────────────

describe('_parseModelConf', () => {
  test('parses AI-first label (LABEL_1)', () => {
    const result = _parseModelConf([{ label: 'LABEL_1', score: 0.92 }]);
    expect(result).toBe(0.92);
  });

  test('parses Real-first label (LABEL_0) and inverts', () => {
    const result = _parseModelConf([{ label: 'LABEL_0', score: 0.85 }]);
    expect(result).toBeCloseTo(0.15, 5);
  });

  test('handles "fake" label', () => {
    const result = _parseModelConf([{ label: 'fake', score: 0.77 }]);
    expect(result).toBe(0.77);
  });

  test('handles "real" label inversion', () => {
    const result = _parseModelConf([{ label: 'real', score: 0.91 }]);
    expect(result).toBeCloseTo(0.09, 5);
  });

  test('handles "AI" label', () => {
    const result = _parseModelConf([{ label: 'AI', score: 0.88 }]);
    expect(result).toBe(0.88);
  });

  test('handles "human" label inversion', () => {
    const result = _parseModelConf([{ label: 'human', score: 0.95 }]);
    expect(result).toBeCloseTo(0.05, 5);
  });

  test('handles empty/null input', () => {
    expect(_parseModelConf(null)).toBeNull();
    expect(_parseModelConf([])).toBeNull();
    expect(_parseModelConf(undefined)).toBeNull();
  });

  test('falls back to first label inversion when no known label', () => {
    const result = _parseModelConf([{ label: 'positive', score: 0.80 }]);
    expect(result).toBeCloseTo(0.20, 5);
  });
});

// ── Ensemble integration smoke tests ─────────────────────────────

describe('Integration: ensemble scoring', () => {
  test('heuristic alone flags obvious AI slop', () => {
    const text = 'In this comprehensive guide, we will delve into the nuanced approach of unlocking your potential. It is worth noting that best practices are paramount. Let me know in the comments below!';
    const heuristic = getSlopScore(text);
    expect(heuristic).toBeGreaterThanOrEqual(12);
  });

  test('heuristic passes clearly human text', () => {
    const text = "Dude, check out this repo I found https://github.com/foo/bar — @alice and I were debugging it last night and it's totally broken. `npm install` fails on M1 Macs lol. Here's the stack trace: ```Error: cannot find module```";
    const heuristic = getSlopScore(text);
    expect(heuristic).toBeLessThan(5);
  });

  test('stylometric flags uniform AI prose', () => {
    const aiText = 'This approach offers a robust framework. This method provides seamless integration. This solution delivers cutting-edge performance. This technology enables transformative impact. This platform supports best practices.';
    expect(getStylometricScore(aiText)).toBeGreaterThan(0.3);
  });

  test('stylometric passes burstier human prose', () => {
    const humanText = "The rusted hatch groaned open. Three years since anyone had been down here. Cobwebs clung to the exposed wiring like grey lace. Somewhere in the dark, water dripped. A rat scurried behind the breaker panel.";
    expect(getStylometricScore(humanText)).toBeLessThan(0.5);
  });
});

// ── Exported classifier API tests (model-offline paths) ─────────────

const { isAiSlop, isAiImage, isImageModelReady, isTextModel2Ready } = require('../classifier');

describe('isAiSlop offline paths', () => {
  test('returns zero confidence for text below min length', async () => {
    const result = await isAiSlop('hi');
    expect(result.confidence).toBe(0);
    expect(result.method).toBe('heuristic');
  });

  test('returns heuristic-only confidence when models are not loaded', async () => {
    const text = 'In this comprehensive guide, we will delve into the nuanced approach of unlocking your potential. It is worth noting that best practices are paramount. Let me know in the comments below!';
    const result = await isAiSlop(text);
    expect(result.confidence).toBeGreaterThan(0.5);
    expect(result.method).toBe('heuristic');
  });

  test('caches repeated identical texts', async () => {
    const text = 'This is a test sentence for cache verification purposes only';
    const r1 = await isAiSlop(text);
    const r2 = await isAiSlop(text);
    expect(r1.confidence).toBe(r2.confidence);
    expect(r1.method).toBe(r2.method);
  });

  test('does not conflate texts that share only a long prefix', async () => {
    const prefix = 'A'.repeat(520);
    const a = prefix + ' human ending with url https://example.com/foo';
    const b = prefix + ' delve into comprehensive guide unlock your potential';
    const rA = await isAiSlop(a);
    const rB = await isAiSlop(b);
    expect(rB.confidence).toBeGreaterThan(rA.confidence);
  });
});

describe('isAiImage offline paths', () => {
  test('returns zero score when image model is not loaded', async () => {
    const result = await isAiImage('https://example.com/photo.jpg');
    expect(result.score).toBe(0);
    expect(result.style).toBe('unknown');
  });
});

describe('readiness getters', () => {
  test('isImageModelReady returns false before loading', () => {
    expect(isImageModelReady()).toBe(false);
  });

  test('isTextModel2Ready returns false before loading', () => {
    expect(isTextModel2Ready()).toBe(false);
  });
});
