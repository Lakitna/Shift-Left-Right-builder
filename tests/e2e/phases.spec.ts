import { expect, test } from '@playwright/test';

import { applyPreset, clickRevealedBadge, dragElement, gotoApp, mouseClick } from './helpers';

test.describe('REQ-06 phase editing', () => {
    test('adds a phase at the end of the axis', async ({ page }) => {
        await gotoApp(page);
        await expect(page.locator('.phase-label')).toHaveCount(4);

        await mouseClick(page, '[data-phase-add]');

        await expect(page.locator('.phase-label')).toHaveCount(5);
    });

    test('removes a phase from its hover badge', async ({ page }) => {
        await gotoApp(page);
        await clickRevealedBadge(page, '.phase-label', '[data-phase-remove="0"]');
        await expect(page.locator('.phase-label')).toHaveCount(3);
    });

    test('never removes the last phase', async ({ page }) => {
        await gotoApp(page);
        await applyPreset(page, 'Empty');
        await expect(page.locator('.phase-label')).toHaveCount(2);

        await clickRevealedBadge(page, '.phase-label', '[data-phase-remove="0"]');
        await expect(page.locator('.phase-label')).toHaveCount(1);

        // Whatever remains must not be removable.
        if ((await page.locator('[data-phase-remove]').count()) > 0) {
            await clickRevealedBadge(page, '.phase-label', '[data-phase-remove="0"]');
        }
        await expect(page.locator('.phase-label')).toHaveCount(1);
    });

    test('renames a phase in place', async ({ page }) => {
        await gotoApp(page);
        await mouseClick(page, 'text[data-phase-index="0"]');

        const editor = page.locator('.inline-editor');
        await expect(editor).toBeVisible();
        await editor.fill('Discovery');
        await editor.press('Enter');

        await expect(page.locator('text[data-phase-index="0"]')).toHaveText('Discovery');
    });

    test('reorders phases by dragging a label onto another tick', async ({ page }) => {
        await gotoApp(page);
        const firstBefore = await page.locator('text[data-phase-index="0"]').textContent();

        await dragElement(page, 'text[data-phase-index="0"]', { x: 320, y: 0 });

        await expect
            .poll(() => page.locator('text[data-phase-index="0"]').textContent())
            .not.toBe(firstBefore);
    });

    test('draws a separator on each internal phase boundary only', async ({ page }) => {
        await gotoApp(page);
        const separators = page.locator('#graph-container g.grid > *');
        // Four bands have three internal edges; the plot edges are not separators.
        await expect(separators).toHaveCount(3);

        await applyPreset(page, 'Empty');
        await clickRevealedBadge(page, '.phase-label', '[data-phase-remove="0"]');
        await expect(page.locator('.phase-label')).toHaveCount(1);
        // A single band has no internal edge at all.
        await expect(separators).toHaveCount(0);
    });
});
