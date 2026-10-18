import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

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
const THEMES = ['light', 'dark'] as const;
const MAX_CROSS_BROWSER_DIFF_RATIO = 0.03;
const PIXEL_CHANNEL_THRESHOLD = 24;

/**
Menu label paired with the public style id — the id is what travels in URLs and localStorage.
*/
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

const SCREENSHOT_NAMES = [
    ...PRESETS.flatMap((preset) =>
        THEMES.map((theme) => `preset-${preset.toLowerCase()}-${theme}.png`)
    ),
    ...STYLES.flatMap((style) => THEMES.map((theme) => `style-${style.id}-${theme}.png`)),
];

test.describe('REQ-14 cross-browser visual comparison', () => {
    for (const screenshotName of SCREENSHOT_NAMES) {
        test(`chromium and firefox: ${screenshotName}`, async ({ browserName, page }) => {
            test.skip(
                browserName !== 'chromium',
                'Cross-browser comparisons run once in Chromium.'
            );

            const [chromiumPng, firefoxPng] = await Promise.all([
                readFile(
                    new URL(
                        `__screenshots__/chromium/visual.spec.ts/${screenshotName}`,
                        import.meta.url
                    )
                ),
                readFile(
                    new URL(
                        `__screenshots__/firefox/visual.spec.ts/${screenshotName}`,
                        import.meta.url
                    )
                ),
            ]);
            const result = await page.evaluate(
                async ({ chromiumImage, firefoxImage, channelThreshold }) => {
                    const loadImage = async (source: string): Promise<HTMLImageElement> => {
                        const image = document.createElement('img');
                        image.src = `data:image/png;base64,${source}`;
                        await image.decode();
                        return image;
                    };
                    const [chromium, firefox] = await Promise.all([
                        loadImage(chromiumImage),
                        loadImage(firefoxImage),
                    ]);

                    if (chromium.width !== firefox.width || chromium.height !== firefox.height) {
                        return { dimensionsMatch: false, ratio: 1 };
                    }

                    const canvas = document.createElement('canvas');
                    canvas.width = chromium.width;
                    canvas.height = chromium.height;
                    const context = canvas.getContext('2d');
                    if (context === null) throw new Error('Canvas 2D context is unavailable.');
                    context.drawImage(chromium, 0, 0);
                    const chromiumPixels = context.getImageData(
                        0,
                        0,
                        canvas.width,
                        canvas.height
                    ).data;
                    context.clearRect(0, 0, canvas.width, canvas.height);
                    context.drawImage(firefox, 0, 0);
                    const firefoxPixels = context.getImageData(
                        0,
                        0,
                        canvas.width,
                        canvas.height
                    ).data;

                    let differentPixels = 0;
                    for (let offset = 0; offset < chromiumPixels.length; offset += 4) {
                        const isDifferent = [0, 1, 2].some(
                            (channel) =>
                                Math.abs(
                                    chromiumPixels[offset + channel] -
                                        firefoxPixels[offset + channel]
                                ) > channelThreshold
                        );
                        if (isDifferent) differentPixels += 1;
                    }

                    return {
                        dimensionsMatch: true,
                        ratio: differentPixels / (canvas.width * canvas.height),
                    };
                },
                {
                    chromiumImage: chromiumPng.toString('base64'),
                    firefoxImage: firefoxPng.toString('base64'),
                    channelThreshold: PIXEL_CHANNEL_THRESHOLD,
                }
            );

            expect(
                result.dimensionsMatch,
                `${screenshotName}: screenshot dimensions must match`
            ).toBe(true);
            expect(
                result.ratio,
                `${screenshotName}: ${(result.ratio * 100).toFixed(2)}% of pixels differ by more than ${String(PIXEL_CHANNEL_THRESHOLD)} per channel`
            ).toBeLessThanOrEqual(MAX_CROSS_BROWSER_DIFF_RATIO);
        });
    }
});
