import { expect, test } from '@playwright/test';

import { gotoApp, mouseClick } from './helpers';

/**
 * REQ-09 — every editable text on the canvas is edited in place.
 *
 * A click opens an overlay (`input.inline-editor`, or a `textarea` for multi-line fields). Enter
 * commits a single-line field, Ctrl/Cmd+Enter commits a multi-line one, Escape cancels, and losing
 * focus commits.
 */
test.describe('REQ-09 inline WYSIWYG text editing', () => {
    test('edits the chart title', async ({ page }) => {
        await gotoApp(page);
        await mouseClick(page, '[data-edit-field="title"]');

        const editor = page.locator('.inline-editor');
        await expect(editor).toBeVisible();
        await expect(editor).toHaveValue('Shift-Left / Shift-Right');

        await editor.fill('Delivery quality model');
        await editor.press('Enter');

        await expect(page.locator('.inline-editor')).toHaveCount(0);
        await expect(page.locator('#graph-container svg')).toContainText('Delivery quality model');
    });

    test('edits the y-axis title', async ({ page }) => {
        await gotoApp(page);
        await mouseClick(page, '[data-edit-field="yaxis"]');

        const editor = page.locator('.inline-editor');
        await expect(editor).toBeVisible();
        await editor.fill('Effort');
        await editor.press('Enter');

        await expect(page.locator('#graph-container svg')).toContainText('Effort');
    });

    test('edits a curve label on the canvas', async ({ page }) => {
        await gotoApp(page);
        await mouseClick(page, 'text[data-edit-field="curve-label"]');

        const editor = page.locator('.inline-editor');
        await expect(editor).toBeVisible();
        await editor.fill('Quality first');
        await editor.press('Enter');

        await expect(page.locator('#graph-container svg')).toContainText('Quality first');
    });

    test('edits a curve note through its legend row', async ({ page }) => {
        await gotoApp(page);
        await mouseClick(page, '.legend-block[data-curve-index="0"]');

        const editor = page.locator('.inline-editor');
        await expect(editor).toBeVisible();
        // A legend row is multi-line: line one is the label, the remainder is the note.
        await editor.fill('Shift-left\nEarlier feedback loops');
        await editor.press('Control+Enter');

        await expect(
            page.locator('.legend-block').filter({ hasText: 'Earlier feedback loops' })
        ).toHaveCount(1);
    });

    test('commits on Enter, cancels on Escape, and commits on blur', async ({ page }) => {
        await gotoApp(page);

        // Escape leaves the model untouched.
        await mouseClick(page, '[data-edit-field="title"]');
        await page.locator('.inline-editor').fill('Discarded');
        await page.locator('.inline-editor').press('Escape');
        await expect(page.locator('#graph-container svg')).not.toContainText('Discarded');

        // Losing focus commits instead of discarding.
        await mouseClick(page, '[data-edit-field="title"]');
        await page.locator('.inline-editor').fill('Committed by blur');
        await page.locator('footer').click();
        await expect(page.locator('#graph-container svg')).toContainText('Committed by blur');
    });

    test('requires Ctrl+Enter to commit a multi-line field', async ({ page }) => {
        await gotoApp(page);
        await mouseClick(page, '.legend-block[data-curve-index="0"]');

        const editor = page.locator('.inline-editor');
        await expect(editor).toBeVisible();

        // A plain Enter is a newline, not a commit.
        await editor.press('Enter');
        await expect(editor).toBeVisible();

        await editor.press('Control+Enter');
        await expect(page.locator('.inline-editor')).toHaveCount(0);
    });
});
