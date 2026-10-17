import { expect, test } from '@playwright/test';

import { applyPreset, gotoApp, handleY, mouseClick, openHeaderMenu, selectCurve } from './helpers';

test.describe('REQ-10 keyboard shortcuts', () => {
    test('undoes and redoes with Ctrl+Z and Ctrl+Y', async ({ page }) => {
        await gotoApp(page);
        await applyPreset(page, 'Detailed');
        await expect(page.locator('.phase-label')).toHaveCount(6);

        await page.keyboard.press('Control+z');
        await expect(page.locator('.phase-label')).toHaveCount(4);

        await page.keyboard.press('Control+y');
        await expect(page.locator('.phase-label')).toHaveCount(6);

        // Both redo bindings are checked, each from an undone state — at the tip of the history
        // redo is legitimately a no-op.
        await page.keyboard.press('Control+z');
        await expect(page.locator('.phase-label')).toHaveCount(4);
        await page.keyboard.press('Control+Shift+z');
        await expect(page.locator('.phase-label')).toHaveCount(6);
    });

    test('nudges the selected point with the arrow keys', async ({ page }) => {
        await gotoApp(page);
        await selectCurve(page);
        // A point must be selected, not just the curve.
        await mouseClick(page, '.point-handle[data-handle-index="1"]');

        const before = await handleY(page, 1);
        await page.keyboard.press('ArrowUp');
        const after = await handleY(page, 1);

        // Arrow up raises effort, which moves the handle up the screen.
        expect(after).toBeLessThan(before);
    });

    test('nudges five units at a time with Shift', async ({ page }) => {
        await gotoApp(page);
        await selectCurve(page);
        await mouseClick(page, '.point-handle[data-handle-index="1"]');

        const start = await handleY(page, 1);
        await page.keyboard.press('ArrowUp');
        const single = await handleY(page, 1);
        await page.keyboard.press('Shift+ArrowUp');
        const five = await handleY(page, 1);

        const oneStep = single - start;
        const fiveSteps = five - single;
        expect(oneStep).toBeLessThan(0);
        expect(Math.abs(fiveSteps - oneStep * 5)).toBeLessThan(1.5);
    });

    test('deletes the selected point, then the selected curve', async ({ page }) => {
        await gotoApp(page);
        await selectCurve(page);
        await expect(page.locator('.point-handle')).toHaveCount(7);

        await mouseClick(page, '.point-handle[data-handle-index="1"]');
        await page.keyboard.press('Delete');
        await expect(page.locator('.point-handle')).toHaveCount(6);

        // With no point selected any more, Delete removes the whole curve.
        await page.keyboard.press('Delete');
        await expect(page.locator('#graph-container .curve-fill')).toHaveCount(2);
        await expect(page.locator('.point-handle')).toHaveCount(0);
    });

    test('Escape closes menus before it clears the selection', async ({ page }) => {
        await gotoApp(page);
        await selectCurve(page);
        await expect(page.locator('.point-handle')).toHaveCount(7);

        await openHeaderMenu(page, 'btn-style');
        await expect(page.locator('#style-menu')).toBeVisible();

        await page.keyboard.press('Escape');
        await expect(page.locator('#style-menu')).toBeHidden();
        // The first Escape only dismissed the menu; the selection is untouched.
        await expect(page.locator('.point-handle')).toHaveCount(7);

        await page.keyboard.press('Escape');
        await expect(page.locator('.point-handle')).toHaveCount(0);
    });

    test('does nothing while an export dialog is open', async ({ page }) => {
        await gotoApp(page);
        await applyPreset(page, 'Detailed');
        await expect(page.locator('.phase-label')).toHaveCount(6);

        await openHeaderMenu(page, 'btn-share');
        await page.locator('#btn-export-svg').click();
        await expect(page.locator('#svg-dialog')).toBeVisible();

        await page.keyboard.press('Control+z');

        await expect(page.locator('.phase-label')).toHaveCount(6);
    });
});
