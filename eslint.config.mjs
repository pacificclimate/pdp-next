import js from '@eslint/js';

export default [
  js.configs.recommended,
  {
    files: ['viewer/js/**/*.js', 'viewer/js/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        // Browser globals
        window: 'readonly',
        document: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        DOMParser: 'readonly',
        Event: 'readonly',
        alert: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        // CDN globals (ol and proj4 loaded via script tags)
        ol: 'readonly',
        proj4: 'readonly',
        // Browser performance API
        performance: 'readonly'
      }
    },
    rules: {
      // Errors
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
      'no-implicit-coercion': ['error', { allow: ['!!', '+'] }],

      // Warnings
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-alert': 'warn',

      'no-prototype-builtins': 'off'
    }
  }
];