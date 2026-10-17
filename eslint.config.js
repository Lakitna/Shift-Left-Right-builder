import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import unicorn from 'eslint-plugin-unicorn';
import tseslint from 'typescript-eslint';

/**
 * Strict, type-aware linting.
 *
 * Three layers:
 *  - `@eslint/js` recommended, for the plain-JavaScript files;
 *  - `eslint-plugin-unicorn` recommended, for the consistency rules it is good at;
 *  - `typescript-eslint`'s **strictTypeChecked** + **stylisticTypeChecked** presets, which need full
 *    type information. `projectService` finds the right tsconfig per file automatically: the root
 *    tsconfig for `src/`, and `tests/tsconfig.json` for `tests/`.
 *
 * The root `*.config.ts` files belong to no tsconfig, so they are parsed but not type-checked.
 *
 * Both presets are used as published: no rule from either one is switched off, and the code is
 * expected to conform rather than the config to bend.
 */
export default defineConfig(
    {
        ignores: [
            'dist/**',
            'node_modules/**',
            'test-results/**',
            'playwright-report/**',
            'blob-report/**',
            'tests/e2e/__screenshots__/**',
        ],
    },

    js.configs.recommended,
    unicorn.configs.recommended,

    // JSDoc blocks are written with an asterisk prefix and shared indentation throughout this repo.
    {
        files: ['**/*.{js,ts}'],
        rules: {
            'unicorn/no-asterisk-prefix-in-documentation-comments': 'off',
        },
    },

    // Every TypeScript file needs the TS parser before any preset can read it.
    {
        files: ['**/*.ts'],
        languageOptions: { parser: tseslint.parser },
        rules: {
            // TypeScript resolves identifiers, and it knows about types, so `no-undef` only produces
            // false positives on type-only and ambient names.
            'no-undef': 'off',
        },
    },

    // Type-checked rules, where a tsconfig actually exists.
    {
        files: ['src/**/*.ts', 'tests/**/*.ts'],
        extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },

    // The Node build scripts. ESLint deliberately assumes nothing about runtime globals, and between
    // them these two scripts use exactly three — so they are listed explicitly rather than pulling in
    // a dependency (or a whole environment) that would enable hundreds of globals we never touch. If
    // a script reaches for another one, `no-undef` will say so and it gets added here.
    {
        files: ['scripts/**/*.{js,mjs}'],
        languageOptions: {
            globals: {
                console: 'readonly',
                process: 'readonly',
                URL: 'readonly',
            },
        },
    },

    // Playwright `page.evaluate` callbacks are serialised and executed *in the browser*, so the
    // browser globals they reference genuinely exist at runtime. Declaring them tells
    // `unicorn/isolated-functions` the truth about that scope instead of it guessing.
    {
        files: ['tests/e2e/**'],
        languageOptions: {
            globals: {
                document: 'readonly',
                getComputedStyle: 'readonly',
                navigator: 'readonly',
                window: 'readonly',
            },
        },
    },
);
