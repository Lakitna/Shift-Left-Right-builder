import { expect, test } from '@playwright/test';

import { STORAGE_KEYS, currentHash, gotoApp, openHeaderMenu, waitForGraph } from './helpers';

/**
Visible menu labels, in registry order. Style ids are public API and must never be renamed.
*/
const STYLE_NAMES = [
    'Classic',
    'Draftsman',
    'High contrast',
    'Cartoon',
    'De Stijl',
    'Unicorn',
    'Bartosz',
];

test.describe('REQ-02 light/dark theme', () => {
    test('toggles between light and dark', async ({ page }) => {
        await gotoApp(page);
        const root = page.locator('html');

        const before = await root.getAttribute('data-theme');
        expect(['light', 'dark']).toContain(before);

        await page.locator('#btn-theme').click();

        await expect(root).toHaveAttribute('data-theme', before === 'dark' ? 'light' : 'dark');
    });

    test('remembers the theme across a reload and keeps it out of the URL', async ({ page }) => {
        await gotoApp(page);
        await page.locator('#btn-theme').click();
        const chosen = await page.locator('html').getAttribute('data-theme');

        await page.reload();
        await waitForGraph(page);

        await expect(page.locator('html')).toHaveAttribute('data-theme', chosen!);
        // Theme is chrome, not model data: it must never appear in the hash.
        expect(await currentHash(page)).not.toContain('theme');
    });
});

test.describe('REQ-03 visual style system', () => {
    test('offers all seven styles in the header menu', async ({ page }) => {
        await gotoApp(page);
        await openHeaderMenu(page, 'btn-style');

        const entries = page.locator('#style-menu button');
        await expect(entries).toHaveCount(STYLE_NAMES.length);
        await expect(entries).toHaveText(STYLE_NAMES);
    });

    test('repaints the graph when a style is chosen', async ({ page }) => {
        await gotoApp(page);
        await openHeaderMenu(page, 'btn-style');
        await page.locator('#style-menu button', { hasText: 'Draftsman' }).click();

        await expect(page.locator('html')).toHaveAttribute('data-style', 'draftsman');
        await expect(page.locator('#btn-style')).toContainText('Draftsman');
    });

    test('travels in the URL, and is omitted for Classic', async ({ page }) => {
        await gotoApp(page);
        await openHeaderMenu(page, 'btn-style');
        await page.locator('#style-menu button', { hasText: 'Cartoon' }).click();

        await expect.poll(async () => (await currentHash(page)).includes('s=toon')).toBe(true);

        await openHeaderMenu(page, 'btn-style');
        await page.locator('#style-menu button', { hasText: 'Classic' }).click();

        await expect.poll(async () => (await currentHash(page)).includes('s=')).toBe(false);
    });

    test('a style in the URL wins over the stored preference', async ({ page }) => {
        await gotoApp(page, {
            hash: '#s=contrast',
            storage: { [STORAGE_KEYS.style]: 'toon' },
        });

        await expect(page.locator('html')).toHaveAttribute('data-style', 'contrast');
    });

    test('remembers the chosen style for the next visit', async ({ page }) => {
        await gotoApp(page);
        await openHeaderMenu(page, 'btn-style');
        await page.locator('#style-menu button', { hasText: 'Unicorn' }).click();

        await expect
            .poll(() => page.evaluate((key) => localStorage.getItem(key), STORAGE_KEYS.style))
            .toBe('unicorn');

        await page.reload();
        await waitForGraph(page);
        await expect(page.locator('html')).toHaveAttribute('data-style', 'unicorn');
    });
});
