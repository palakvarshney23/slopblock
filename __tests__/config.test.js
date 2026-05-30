const config = require('../config');

describe('config.js', () => {
  const mockUserData = require('os').tmpdir();

  beforeAll(() => {
    config.init(mockUserData);
  });

  test('get returns default for unknown key', () => {
    expect(config.get('nonexistentKey')).toBeUndefined();
  });

  test('get returns correct default values', () => {
    expect(config.get('textThreshold')).toBe(0.55);
    expect(config.get('textMinLength')).toBe(30);
    expect(config.get('textModelWeight')).toBe(0.75);
    expect(config.get('imageThresholdPhoto')).toBe(0.70);
    expect(config.get('imageThresholdArt')).toBe(0.75);
    expect(config.get('videoWarnThreshold')).toBe(0.55);
    expect(config.get('videoBlockThreshold')).toBe(0.65);
  });

  test('set clamps video thresholds to 10–95%', () => {
    const originalWarn = config.get('videoWarnThreshold');
    const originalBlock = config.get('videoBlockThreshold');
    expect(config.set('videoWarnThreshold', 0.05)).toBe(true);
    expect(config.get('videoWarnThreshold')).toBe(0.10);
    expect(config.set('videoWarnThreshold', 1.5)).toBe(true);
    expect(config.get('videoWarnThreshold')).toBe(0.95);
    config.set('videoWarnThreshold', originalWarn);
    config.set('videoBlockThreshold', originalBlock);
  });

  test('set updates a known key', () => {
    const original = config.get('textThreshold');
    expect(config.set('textThreshold', 0.45)).toBe(true);
    expect(config.get('textThreshold')).toBe(0.45);
    // restore
    config.set('textThreshold', original);
  });

  test('set returns false for unknown key', () => {
    expect(config.set('unknownKey', 123)).toBe(false);
  });

  test('all() returns full config object', () => {
    const all = config.all();
    expect(all.textThreshold).toBe(0.55);
    expect(all.textMinLength).toBe(30);
    expect(typeof all).toBe('object');
  });

  test('DEFAULTS are exported', () => {
    expect(config.DEFAULTS).toBeDefined();
    expect(config.DEFAULTS.textThreshold).toBe(0.55);
  });
});
