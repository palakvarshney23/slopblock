const path = require('path');
const fs = require('fs');
const { verifyModels, checkFile, isGitLfsPointer, MODEL_DIR } = require('../scripts/verify-models');
const { isImageModelBundleReady } = require('../classifier');

describe('verify-models.js', () => {
  test('bundled image model includes config.json and ONNX', () => {
    expect(fs.existsSync(path.join(MODEL_DIR, 'config.json'))).toBe(true);
    const onnx = checkFile({ rel: 'onnx/model_quantized.onnx', minBytes: 1_000_000 });
    expect(onnx.ok).toBe(true);
  });

  test('isImageModelBundleReady matches verifyModels', async () => {
    expect(isImageModelBundleReady(MODEL_DIR)).toBe(true);
    const { ok } = await verifyModels({ warn: true });
    expect(ok).toBe(true);
  });

  test('detects Git LFS pointer files', () => {
    const tmp = path.join(__dirname, '_lfs-pointer-test.txt');
    fs.writeFileSync(tmp, 'version https://git-lfs.github.com/spec/v1\n');
    expect(isGitLfsPointer(tmp)).toBe(true);
    fs.unlinkSync(tmp);
  });
});
