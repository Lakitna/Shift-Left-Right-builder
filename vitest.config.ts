import { defineConfig } from 'vitest/config';

/**
 * Component tests. They target this repo's *pure-logic* modules only (model, presets,
 * history, url-state encode/decode, the style registry + WCAG contrast math, the settings
 * validators and the `ui` string helpers), so the plain `node` environment is enough and no
 * jsdom/happy-dom dependency is needed. DOM-driven behavior is covered by the Playwright
 * GUI suite in `tests/e2e` instead.
 *
 * `globals: false` keeps every spec importing explicitly from 'vitest', which matches the
 * repo's `"types": []` tsconfig philosophy.
 */
export default defineConfig({
    test: {
        environment: 'node',
        include: ['tests/unit/**/*.test.ts'],
        globals: false,
        restoreMocks: true,
        reporters: ['default'],
        // Randomise file *and* test order on every run. A test that only passes because another
        // one ran first is coupled, not isolated; shuffling makes that visible instead of hiding
        // it behind a stable order. Set `sequence.seed` to reproduce a previous run.
        sequence: { shuffle: { files: true, tests: true } },
    },
});
