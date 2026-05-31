module.exports = [
  {
    files: ['**/*.js'],
    ignores: ['node_modules/**', 'models/**', 'evaluation/*.json', 'docs/screenshots/**'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        // Node.js
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        fetch: 'readonly',
        require: 'readonly',
        module: 'readonly',
        exports: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        global: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        crypto: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        Promise: 'readonly',
        JSON: 'readonly',
        Math: 'readonly',
        Date: 'readonly',
        RegExp: 'readonly',
        Set: 'readonly',
        Map: 'readonly',
        // Browser / Extension
        window: 'readonly',
        document: 'readonly',
        location: 'readonly',
        history: 'readonly',
        chrome: 'readonly',
        HTMLVideoElement: 'readonly',
        getComputedStyle: 'readonly',
        MutationObserver: 'readonly',
        IntersectionObserver: 'readonly',
        NodeFilter: 'readonly',
        // Jest
        jest: 'readonly',
        describe: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly'
      }
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'off',
      'no-undef': 'error'
    }
  }
]
