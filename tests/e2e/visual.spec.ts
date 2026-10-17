import { expect, test } from '@playwright/test';

import { STORAGE_KEYS, applyPreset, gotoApp } from './helpers';

/**
 * REQ-14 — visual regression baseline.
 *
 * These snapshots describe **the build as it exists today**: they are a characterization baseline,
 * not a statement of desired behaviour. When the upcoming refactor intentionally changes rendering,
 * re-seed them deliberately with `npm run test:e2e:update` — do not "fix" them by hand.
 *
 * The theme and style are seeded into localStorage rather than clicked, so a snapshot never depends
 * on menu interaction or on the timing of an asynchronous font load.
 */

// Tall enough for the plot *and* the legend, so no snapshot depends on scroll position or on what
// happens to sit below the fold in the default 720px viewport.
test.use({ viewport: { width: 1400, height: 1200 } });

const CANVAS = '#graph-container';

const PRESETS = ['Schematic', 'Detailed', 'Empty'] as const;

/** Menu label paired with the public style id — the id is what travels in URLs and localStorage. */
const STYLES = [
    { id: 'classic', name: 'Classic' },
    { id: 'draftsman', name: 'Draftsman' },
    { id: 'contrast', name: 'High contrast' },
    { id: 'toon', name: 'Cartoon' },
    { id: 'de-stijl', name: 'De Stijl' },
    { id: 'unicorn', name: 'Unicorn' },
    { id: 'bartosz', name: 'Bartosz' },
] as const;

test.describe('REQ-14 visual baseline: the three presets', () => {
    for (const preset of PRESETS) {
        for (const theme of ['light', 'dark'] as const) {
            test(`preset ${preset} in ${theme}`, async ({ page }) => {
                await gotoApp(page, { storage: { [STORAGE_KEYS.theme]: theme } });
                await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

                await applyPreset(page, preset);

                await expect(page.locator(CANVAS)).toHaveScreenshot(
                    `preset-${preset.toLowerCase()}-${theme}.png`
                );
            });
        }
    }
});

test.describe('REQ-14 visual baseline: the seven styles', () => {
    for (const style of STYLES) {
        for (const theme of ['light', 'dark'] as const) {
            test(`style ${style.name} in ${theme}`, async ({ page }) => {
                await gotoApp(page, {
                    storage: { [STORAGE_KEYS.style]: style.id, [STORAGE_KEYS.theme]: theme },
                });
                await expect(page.locator('html')).toHaveAttribute('data-style', style.id);
                await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

                await expect(page.locator(CANVAS)).toHaveScreenshot(
                    `style-${style.id}-${theme}.png`
                );
            });
        }
    }
});
