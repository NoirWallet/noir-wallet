import globals from 'globals'
import tseslint from 'typescript-eslint'

/**
 * Popup only: keep warning/error diagnostics; types and unused bindings are handled by tsc.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/dist-dev/**',
      '**/e2e-dist/**',
      '**/node_modules/**',
      'packages/extension/src/lib/wasm-pkg/**',
      '**/*.d.ts',
      'eslint.config.mjs'
    ]
  },
  {
    files: ['packages/extension/src/popup/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true }
      },
      globals: {
        ...globals.browser,
        chrome: 'readonly'
      }
    },
    rules: {
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-undef': 'off'
    }
  }
)
