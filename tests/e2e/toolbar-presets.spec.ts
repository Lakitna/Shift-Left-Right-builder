import { expect, test } from '@playwright/test';

import { applyPreset, gotoApp, selectCurve, toolbarButton, toolbarCheck } from './helpers';

test.describe('REQ-04 toolbar, presets and history', () => {
    test('applies each preset in one step and resets the picker', async ({ page }) => {
        await gotoApp(page);
        const picker = page.locator('#editor-toolbar select');

        await picker.selectOption({ label: 'Detailed' });
        await expect(page.locator('.phase-label')).toHaveCount(6);
        await expect(page.locator('#graph-container .curve-fill')).toHaveCount(3);

        await picker.selectOption({ label: 'Empty' });
        await expect(page.locator('.phase-label')).toHaveCount(2);
        await expect(page.locator('#graph-container .curve-fill')).toHaveCount(1);

        await picker.selectOption({ label: 'Schematic' });
        await expect(page.locator('.phase-label')).toHaveCount(4);

        await expect(picker).toHaveValue('');
    });

    test('applying a preset clears the selection', async ({ page }) => {
        await gotoApp(page);
        await selectCurve(page);
        await expect(page.locator('.point-handle').first()).toBeAttached();

        await applyPreset(page, 'Detailed');

        await expect(page.locator('.point-handle')).toHaveCount(0);
    });

    test('undo and redo reflect what is available', async ({ page }) => {
        await gotoApp(page);
        const undo = toolbarButton(page, 'Undo (Ctrl+Z)');
        const redo = toolbarButton(page, 'Redo (Ctrl+Y)');

        // A freshly loaded model is the only state in the history.
        await expect(undo).toBeDisabled();
        await expect(redo).toBeDisabled();

        await applyPreset(page, 'Detailed');
        await expect(undo).toBeEnabled();
        await expect(redo).toBeDisabled();

        await undo.click();
        await expect(page.locator('.phase-label')).toHaveCount(4);
        await expect(redo).toBeEnabled();

        await redo.click();
        await expect(page.locator('.phase-label')).toHaveCount(6);
        await expect(redo).toBeDisabled();
    });

    test('the snap-to-phases toggle is available and toggles', async ({ page }) => {
        await gotoApp(page);
        const snap = toolbarCheck(page, 'Snap to phases');

        await expect(snap).not.toBeChecked();
        await snap.check();
        await expect(snap).toBeChecked();
    });

    test('the numeric axis toggle adds gridlines', async ({ page }) => {
        await gotoApp(page);
        const grid = page.locator('#graph-container g.grid > *');
        const before = await grid.count();

        await toolbarCheck(page, 'Numeric axis').check();

        await expect.poll(() => grid.count()).toBeGreaterThan(before);
    });
});
