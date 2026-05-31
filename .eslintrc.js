module.exports = {
  env: { node: true, browser: true, es2022: true, jest: true },
  extends: ['eslint:recommended'],
  parserOptions: { ecmaVersion: 2022, sourceType: 'script' },
  rules: {
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    'no-console': 'off',
    'semi': ['error', 'never'],
    'quotes': ['error', 'single']
  },
  globals: { chrome: 'readonly', HTMLVideoElement: 'readonly', fetch: 'readonly' }
}
