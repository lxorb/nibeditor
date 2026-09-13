// Type-aware linting across the workspace. The rule sets are the strict ones
// on purpose: a rule that only fires on real mistakes earns its place, and the
// few that fight the code's style are turned down below, each with its reason.
import js from '@eslint/js'
import svelte from 'eslint-plugin-svelte'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      // The other half of a before-and-after measurement, built beside the first;
      // see apps/desktop/test/e2e/first-paint.py.
      '**/dist-before/**',
      // And the build with the names left in it, which is what a profile is read
      // from; see apps/desktop/test/e2e/speed.py.
      '**/dist-profile/**',
      '**/dist-even/**',
      '**/target/**',
      // What running the Worker locally leaves behind: a bundle it made, and the
      // state of the databases it ran against. Neither is anybody's source.
      '**/.wrangler/**',
      '.claude/**',
      'packaging/**',
      'apps/desktop/src-tauri/gen/**',
      'docs/**',
      // A proof, not a product: `spike/` holds throwaway crates and the fixtures
      // they load, built only by the workflow that measures them. The JavaScript
      // in there is an unpacked extension loaded by a Chromium under test, so it
      // is in no tsconfig project for the type-aware rules to read and its
      // globals are an extension's rather than a page's. Prettier still formats
      // it. See docs/browser.md.
      'spike/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  ...svelte.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.svelte'],
      },
    },
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
    languageOptions: {
      parserOptions: { parser: tseslint.parser },
    },
  },
  {
    rules: {
      // A promise that nobody awaits or catches is a bug that surfaces as a
      // silent failure; `void promise` says the drop is meant.
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }],
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
      // Every case of a union handled, or the compiler says which is missing.
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      // Numbers in template strings read fine; objects and arrays do not.
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
      '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
      // `catch (error) { ... }` with an unused binding is fine; `_` marks intent.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      // The codebase explains itself in prose; a non-null assertion is allowed
      // where the line before makes it obvious, and reviewed by eye.
      '@typescript-eslint/no-non-null-assertion': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-var': 'error',
      'object-shorthand': 'error',
    },
  },
  {
    files: ['**/*.svelte'],
    rules: {
      // `{@render snippet()}` is a statement in the markup, but the parser hands
      // it over as an expression, so the rule reads every one of them as a void
      // call in the wrong place. Nothing a component can be written differently
      // to avoid, and the rule still holds for every `.ts` file.
      '@typescript-eslint/no-confusing-void-expression': 'off',
    },
  },
  {
    // Build and tool configuration sits outside every tsconfig, so the rules
    // that need type information cannot see it; the plain rules still apply.
    // `apps/cli` is there for the same reason: it is a Node script rather than a
    // package that is compiled, and nothing imports it.
    files: ['**/*.config.{js,ts,mjs}', 'scripts/**/*.{js,mjs,ts}', 'apps/cli/**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    // Command-line scripts talk through the console; that is their output.
    files: ['scripts/**/*.{js,mjs,ts}', 'apps/cli/**/*.mjs'],
    rules: { 'no-console': 'off' },
  },
  {
    // The asset worker is a page of its own: a classic script served from the
    // root of the site rather than a module in the app's graph, so no tsconfig
    // covers it and the rules that need types cannot see it. The plain rules
    // still apply. See apps/desktop/public/sw.js for why it is written that way.
    files: ['apps/desktop/public/*.js'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ['**/*.test.ts', '**/test/**/*.ts'],
    rules: {
      // A stub standing in for a promise-returning API is written `async`
      // because that is what it answers, not because it waits for anything.
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },
)
