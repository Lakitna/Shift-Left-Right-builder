import { expect, test } from '@playwright/test';

import { dragElement, elementCentre, gotoApp, mouseClick } from './helpers';

// A viewport tall enough for the whole document. The legend sits at the very bottom of the page, so
// in the default 720px viewport there is no room to drag a row *downward* from it — the pointer
// leaves the viewport, Firefox scrolls the page instead of delivering the drag, and the gesture
// silently dies. Drag room is not what these tests are about.
test.use({ viewport: { width: 1280, height: 1200 } });

test.describe('REQ-08 legend', () => {
    test('renders one row per curve below the graph', async ({ page }) => {
        await gotoApp(page);
        const rows = page.locator('.legend-block');

        await expect(page.locator('.legend')).toHaveCount(1);
        await expect(rows).toHaveCount(3);

        // The legend reads top-down the way the graph stacks: the curve painted last is listed
        // first.
        await expect(rows.nth(0)).toContainText('Shift-right');
        await expect(rows.nth(1)).toContainText('Traditional quality model');
        await expect(rows.nth(2)).toContainText('Shift-left');
    });

    test('shows the notes on each row', async ({ page }) => {
        await gotoApp(page);
        await expect(page.locator('.legend-block').filter({ hasText: 'Shift-left' })).toContainText(
            'unit, component and integration tests'
        );
        await expect(
            page.locator('.legend-block').filter({ hasText: 'Shift-right' })
        ).toContainText('monitoring, canary releases');
    });

    test('opens a colour picker from a legend swatch', async ({ page }) => {
        await gotoApp(page);
        await mouseClick(page, '.legend-swatch[data-swatch-index="1"]');
        await expect(page.locator('.inline-color')).toBeVisible();
    });

    test('reorders the curves by dragging a legend row handle', async ({ page }) => {
        await gotoApp(page);
        const rows = page.locator('.legend-block');
        const before = await rows.evaluateAll((list) => list.map((row) => row.textContent));

        // The legend's first row corresponds to the topmost curve, whichever index that is.
        const firstRow = rows.first();
        const index = await firstRow.locator('[data-curve-drag]').getAttribute('data-curve-drag');
        expect(index).not.toBeNull();
        const handleSelector = `[data-curve-drag="${index}"]`;

        // Bring the handle into view *before* hovering: scrolling later would move the row out from
        // under the pointer and drop the hover that reveals the handle in the first place.
        await elementCentre(page, handleSelector);
        await firstRow.hover();

        // Aim at the last row rather than guessing a distance. The drop target advances one slot per
        // *crossed* boundary, and the row pitch depends on how the notes happened to wrap.
        const handleBox = await page.locator(handleSelector).boundingBox();
        const lastBox = await rows.last().boundingBox();
        if (handleBox === null || lastBox === null) throw new Error('legend rows are not rendered');
        const deltaY = lastBox.y + lastBox.height / 2 - (handleBox.y + handleBox.height / 2) + 8;

        await dragElement(page, handleSelector, { x: 0, y: deltaY });

        await expect
            .poll(() => rows.evaluateAll((list) => list.map((row) => row.textContent)))
            .not.toEqual(before);
    });
});
