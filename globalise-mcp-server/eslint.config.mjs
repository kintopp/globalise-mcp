// Flat-config ESLint (family parity: iconclass's recommended base + rijksmuseum's
// targeted extras). Coverage deliberately includes scripts/**/*.ts: those run via
// tsx (transpile-only) OUTSIDE the tsconfig project, so — as CLAUDE.md documents —
// their type errors surface only at runtime; lint is the one static gate they get.
// apps/document-viewer has its own tsc gate (test:viewer-typecheck) and browser
// globals; scripts/cli.mjs is covered by test:cli-typecheck (tsconfig.cli.json).
import tseslint from 'typescript-eslint';

export default [
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'scripts/**/*.{ts,js}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'warn',
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      // `^_` opt-out idiom; ignoreRestSiblings covers the
      // `const { DROP_ME, ...env } = process.env` env-scrubbing pattern.
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
        ignoreRestSiblings: true,
      }],
      // Always-true/false expressions: `x ?? y || z`, `"" + value ?? fallback`
      'no-constant-binary-expression': 'error',
      // == instead of === — "smart" allows `== null` (idiomatic null+undefined check)
      'eqeqeq': ['warn', 'smart'],
    },
  },
  {
    ignores: [
      'dist/',
      'node_modules/',
      'mcpb-build/',
      'apps/',
      'data/',
      'scripts/cli.mjs',
      '*.mjs',
    ],
  },
];
