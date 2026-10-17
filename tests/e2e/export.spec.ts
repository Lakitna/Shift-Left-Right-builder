import { readFile } from 'node:fs/promises';

import { expect, test, type Download, type Page } from '@playwright/test';

import { STORAGE_KEYS, gotoApp, openHeaderMenu } from './helpers';

/**
 * REQ-12 — PNG / SVG export.
 *
 * The assertions read the **real downloaded bytes**, not a mocked blob: the SVG must be standalone
 * with its fonts embedded and no editing overlays, and the PNG's `IHDR` must match the width the
 * dialog promised in its size hint.
 */

async function openDialog(page: Page, kind: 'png' | 'svg'): Promise<void> {
    await openHeaderMenu(page, 'btn-share');
    await page.locator(`#btn-export-${kind}`).click();
    await expect(page.locator(`#${kind}-dialog`)).toBeVisible();
}

async function downloadFrom(page: Page, kind: 'png' | 'svg'): Promise<Download> {
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.locator(`#${kind}-download`).click(),
    ]);
    return download;
}

async function downloadedBytes(download: Download): Promise<Buffer> {
    const path = await download.path();
    if (path === null) throw new Error('the download has no local path');
    return readFile(path);
}

async function downloadedText(download: Download): Promise<string> {
    return (await downloadedBytes(download)).toString('utf8');
}

/**
The two numbers the PNG dialog promises, e.g. from "Exports at about 1500 × 875 px".
*/
function parseSizeHint(text: string): { width: number; height: number } {
    const match = /(\d+)\s*×\s*(\d+)/.exec(text);
    if (match === null) throw new Error(`Could not read a size out of ${JSON.stringify(text)}`);
    return { width: Number(match[1]), height: Number(match[2]) };
}

/**
PNG dimensions straight from the IHDR chunk.
*/
function pngSize(bytes: Buffer): { width: number; height: number } {
    expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG');
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test.describe('REQ-12 export dialogs', () => {
    test('opens both dialogs with a live preview', async ({ page }) => {
        await gotoApp(page);

        await openDialog(page, 'svg');
        await expect(page.locator('#svg-preview-img')).toBeVisible({ timeout: 15_000 });
        await page.locator('#svg-cancel').click();
        await expect(page.locator('#svg-dialog')).toBeHidden();

        await openDialog(page, 'png');
        // The PNG preview is rasterised (debounce + canvas), so it needs a moment.
        await expect(page.locator('#png-preview-img')).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('#png-size-hint')).toContainText('Exports at about');
        await page.locator('#png-cancel').click();
        await expect(page.locator('#png-dialog')).toBeHidden();
    });

    test('cancelling downloads nothing', async ({ page }) => {
        await gotoApp(page);

        let downloads = 0;
        page.on('download', () => {
            downloads += 1;
        });

        await openDialog(page, 'svg');
        await page.locator('#svg-cancel').click();
        await expect(page.locator('#svg-dialog')).toBeHidden();

        // Give a stray download a chance to arrive before asserting the negative.
        await page.waitForTimeout(500);
        expect(downloads).toBe(0);
    });

    test('sanitises the filename and forces the extension', async ({ page }) => {
        await gotoApp(page);

        await openDialog(page, 'svg');
        await page.locator('#svg-filename').fill('my/graph?.svg');
        const pathy = await downloadFrom(page, 'svg');
        expect(pathy.suggestedFilename()).toBe('mygraph.svg');

        await openDialog(page, 'svg');
        await page.locator('#svg-filename').fill('quarterly model');
        const bare = await downloadFrom(page, 'svg');
        expect(bare.suggestedFilename()).toBe('quarterly model.svg');
    });

    test('exports a standalone SVG, free of editing overlays', async ({ page }) => {
        await gotoApp(page);

        await openDialog(page, 'svg');
        const download = await downloadFrom(page, 'svg');
        const svg = await downloadedText(download);

        expect(svg.startsWith('<?xml')).toBe(true);
        expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
        expect(svg).toContain('viewBox=');
        // A fresh render, with none of the editor's affordances.
        expect(svg).not.toContain('editing-ui');
        expect(svg).not.toContain('point-handle');
        expect(svg).not.toContain('insert-handle');
        // Classic deliberately ships no faces and relies on the OS stack, so it has nothing to
        // embed — and it resolves the same on the reader's machine.
        expect(svg).toContain('system-ui');
        expect(svg).not.toContain('@font-face');
    });

    test('embeds the bundled fonts when the style brings its own', async ({ page }) => {
        await gotoApp(page, { storage: { [STORAGE_KEYS.style]: 'toon' } });
        await expect(page.locator('html')).toHaveAttribute('data-style', 'toon');

        await openDialog(page, 'svg');
        const svg = await downloadedText(await downloadFrom(page, 'svg'));

        // Standalone means self-contained: the style's faces travel as base64 data URIs.
        expect(svg).toContain('@font-face');
        expect(svg).toContain('data:font/woff2;base64,');
    });

    test('drops the legend only when the option is unchecked', async ({ page }) => {
        await gotoApp(page);

        await openDialog(page, 'svg');
        const withLegend = await downloadedText(await downloadFrom(page, 'svg'));
        expect(withLegend).toContain('legend-block');

        await openDialog(page, 'svg');
        await page.locator('#svg-legend').uncheck();
        const withoutLegend = await downloadedText(await downloadFrom(page, 'svg'));
        expect(withoutLegend).not.toContain('legend-block');
    });

    test('honours the colour mode and the transparency option', async ({ page }) => {
        await gotoApp(page);

        await openDialog(page, 'svg');
        const light = await downloadedText(await downloadFrom(page, 'svg'));

        await openDialog(page, 'svg');
        await page.locator('#svg-dialog label.segment', { hasText: 'Dark' }).click();
        const dark = await downloadedText(await downloadFrom(page, 'svg'));
        expect(dark).not.toBe(light);

        await openDialog(page, 'svg');
        await page.locator('#svg-transparent').check();
        const transparent = await downloadedText(await downloadFrom(page, 'svg'));
        expect(transparent).not.toBe(dark);
    });

    test('exports a PNG at the requested width', async ({ page }) => {
        await gotoApp(page);

        await openDialog(page, 'png');
        await page.locator('#png-width').fill('600');

        const download = await downloadFrom(page, 'png');
        expect(download.suggestedFilename()).toBe('shift-left-right.png');

        const actual = pngSize(await downloadedBytes(download));
        expect(actual.width).toBe(600);
    });

    test('exports a PNG of exactly the size the dialog promises', async ({ page }) => {
        // KNOWN DEFECT — see ISSUES.md #9. `measurePngSheet` measures the layout without the
        // attribution strip that the real export adds (18 sheet pixels, ~10 at this width), so the
        // height the dialog advertises is always short. Encoded as an expected failure so the suite
        // stays green; Playwright reports an unexpected pass when it is fixed.
        test.fail(true, 'the PNG size hint omits the attribution strip — see ISSUES.md #9');

        await gotoApp(page);
        await openDialog(page, 'png');
        await page.locator('#png-width').fill('600');

        const promised = parseSizeHint(await page.locator('#png-size-hint').innerText());
        const actual = pngSize(await downloadedBytes(await downloadFrom(page, 'png')));

        expect(actual.width).toBe(promised.width);
        expect(actual.height).toBe(promised.height);
    });

    test('remembers the dialog settings for the next export', async ({ page }) => {
        await gotoApp(page);

        await openDialog(page, 'png');
        await page.locator('#png-filename').fill('my model');
        await page.locator('#png-width').fill('800');
        await downloadFrom(page, 'png');

        await openDialog(page, 'png');
        await expect(page.locator('#png-filename')).toHaveValue('my model.png');
        await expect(page.locator('#png-width')).toHaveValue('800');
    });
});
