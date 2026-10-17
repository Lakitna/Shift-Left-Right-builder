import { expect, test } from '@playwright/test';

import {
    RENDER_TIMEOUT_MS,
    applyPreset,
    currentHash,
    gotoApp,
    openHeaderMenu,
    spyOnClipboardWrites,
    waitForHashChange,
    waitForHashContaining,
} from './helpers';

const INVALID_HASH_MESSAGE =
    'The model data in the URL is invalid or from an incompatible version. The default model was loaded instead.';

test.describe('REQ-01 boot, default model and URL restore', () => {
    test('loads the Schematic preset with no hash', async ({ page }) => {
        await gotoApp(page);

        await expect(page.locator('#warning')).toBeHidden();
        await expect(page.locator('#graph-container .curve-fill')).toHaveCount(3);
        await expect(page.locator('.legend-block')).toHaveCount(3);
        await expect(page.locator('text[data-phase-index="0"]')).toHaveText('Pre-merge');
        await expect(page.locator('text[data-event-index="0"]')).toHaveText('Release');
        await expect(page.locator('#editor-toolbar select')).toHaveValue('');
    });

    test('restores a shared model from #p=', async ({ page }) => {
        await gotoApp(page);
        // Let the write for the freshly loaded default model land first, so the value captured
        // below cannot be that one.
        await waitForHashContaining(page, '#p=');
        const before = await currentHash(page);

        await applyPreset(page, 'Detailed');
        const hash = await waitForHashChange(page, before);
        expect(hash).toContain('#p=');

        await gotoApp(page, { hash });

        await expect(page.locator('.phase-label')).toHaveCount(6);
        await expect(page.locator('text[data-phase-index="0"]')).toHaveText('Plan');
        await expect(page.locator('#warning')).toBeHidden();
    });

    test('shows the banner and the default model for an invalid hash', async ({ page }) => {
        await gotoApp(page, { hash: '#p=this-is-not-a-valid-payload' });

        await expect(page.locator('#warning')).toBeVisible();
        await expect(page.locator('#warning')).toHaveText(INVALID_HASH_MESSAGE);
        // Never a partially applied model: the default one is loaded instead.
        await expect(page.locator('text[data-phase-index="0"]')).toHaveText('Pre-merge');
        await expect(page.locator('.curve-fill')).toHaveCount(3);
    });

    test('shows no banner when the hash carries no model', async ({ page }) => {
        await gotoApp(page, { hash: '#s=toon' });
        await expect(page.locator('#warning')).toBeHidden();
    });

    test('reloads the model when the hash changes without a page reload', async ({ page }) => {
        await gotoApp(page);
        await waitForHashContaining(page, '#p=');
        const before = await currentHash(page);

        await applyPreset(page, 'Detailed');
        const detailedHash = await waitForHashChange(page, before);

        await page.evaluate(() => {
            globalThis.location.hash = '';
        });
        // A hash change triggers a full model load + re-render, gated on font loading — allow for
        // that under load rather than the default assertion budget.
        await expect(page.locator('.phase-label')).toHaveCount(4, { timeout: RENDER_TIMEOUT_MS });
        // Let the sync for the default model land, so it cannot be written on top of the hash this
        // test is about to set.
        await waitForHashContaining(page, '#p=');

        await page.evaluate((value) => {
            globalThis.location.hash = value;
        }, detailedHash);
        await expect(page.locator('.phase-label')).toHaveCount(6, { timeout: RENDER_TIMEOUT_MS });
    });

    test('applies a shared style from #s=', async ({ page }) => {
        await gotoApp(page, { hash: '#s=toon' });
        await expect(page.locator('html')).toHaveAttribute('data-style', 'toon');
        await expect(page.locator('#btn-style')).toContainText('Cartoon');
    });
});

test.describe('REQ-11 sharing via URL', () => {
    test('tracks the model in the URL as it is edited', async ({ page }) => {
        await gotoApp(page);
        await applyPreset(page, 'Empty');
        await waitForHashContaining(page, '#p=');

        const hash = await currentHash(page);
        // The model travels deflated, so even this small model stays a short hash.
        expect(hash.startsWith('#p=')).toBe(true);
        expect(hash.length).toBeLessThan(1500);
    });

    test('copy link confirms the copy', async ({ page }) => {
        await gotoApp(page);
        await applyPreset(page, 'Detailed');

        await openHeaderMenu(page, 'btn-share');
        await page.locator('#btn-copy-link').click();

        await expect(page.locator('#btn-copy-link')).toHaveText('Copied!');
    });

    test('copy link reproduces the current model', async ({ page, browserName }) => {
        // Capture what the app writes, so this check works where clipboard *read* cannot be granted.
        const readClipboardWrites = await spyOnClipboardWrites(page);

        await gotoApp(page);
        await applyPreset(page, 'Detailed');
        await waitForHashContaining(page, '#p=');

        await openHeaderMenu(page, 'btn-share');
        await page.locator('#btn-copy-link').click();
        await expect(page.locator('#btn-copy-link')).toHaveText('Copied!');

        // Chromium can read the real clipboard back; Firefox cannot be granted `clipboard-read`, so
        // there it is what the app handed to the clipboard API.
        const copied =
            browserName === 'chromium'
                ? await page.evaluate(() => navigator.clipboard.readText())
                : (await readClipboardWrites())[0];

        expect(copied, 'copy link wrote nothing to the clipboard').toBeDefined();
        expect(copied).toContain('#p=');

        await gotoApp(page, { hash: new URL(copied).hash });
        await expect(page.locator('.phase-label')).toHaveCount(6);
        await expect(page.locator('text[data-phase-index="0"]')).toHaveText('Plan');
    });
});
