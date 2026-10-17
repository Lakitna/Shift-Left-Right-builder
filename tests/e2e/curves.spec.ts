import { expect, test } from '@playwright/test';

import {
    clickRevealedBadge,
    dragCurveBody,
    dragElement,
    gotoApp,
    handleX,
    mouseClick,
    phaseLabelX,
    selectCurve,
    toolbarButton,
    toolbarCheck,
} from './helpers';

/** Schematic's first curve ("Shift-left") carries seven control points. */
const SHIFT_LEFT_POINTS = 7;

const curveGroup = (index: number) => `#graph-container g.curves > g[data-curve-index="${index}"]`;

test.describe('REQ-05 curve editing', () => {
    test('selecting a curve reveals its control points', async ({ page }) => {
        await gotoApp(page);
        await expect(page.locator('.point-handle')).toHaveCount(0);

        await selectCurve(page);

        await expect(page.locator('.point-handle')).toHaveCount(SHIFT_LEFT_POINTS);
        await expect(page.locator('.curve-move')).toHaveCount(1);
        // The curve-only toolbar segment appears with a selection.
        await expect(toolbarButton(page, 'Delete selected curve')).toBeVisible();
    });

    test('drags a point freely in two dimensions', async ({ page }) => {
        await gotoApp(page);
        await selectCurve(page);

        const before = await handleX(page, 1);
        await dragElement(page, '.point-handle[data-handle-index="1"]', { x: 40, y: -18 });
        const after = await handleX(page, 1);

        // The viewport-to-model mapping is 1:1, so a 40px drag moves the point about 40 units.
        expect(Math.abs(after - (before + 40))).toBeLessThan(5);
    });

    test('snaps a point to a phase tick when snap-to-phases is on', async ({ page }) => {
        await gotoApp(page);
        await toolbarCheck(page, 'Snap to phases').check();
        await selectCurve(page);

        await dragElement(page, '.point-handle[data-handle-index="1"]', { x: 90, y: 0 });

        const centres = await Promise.all([0, 1, 2, 3].map((index) => phaseLabelX(page, index)));
        const snapped = await handleX(page, 1);
        expect(centres.some((centre) => Math.abs(centre - snapped) < 1)).toBe(true);
    });

    test('adds a point from an insert handle on the curve', async ({ page }) => {
        await gotoApp(page);
        await selectCurve(page);
        await expect(page.locator('.insert-handle')).toHaveCount(SHIFT_LEFT_POINTS - 1);

        await mouseClick(page, '.insert-handle');

        await expect(page.locator('.point-handle')).toHaveCount(SHIFT_LEFT_POINTS + 1);
    });

    test('slides the whole curve horizontally', async ({ page }) => {
        await gotoApp(page);
        // Schematic's Shift-left curve spans the full width, so it has no room to shift. The
        // Shift-right curve (index 2) starts at x=40 and can move left.
        await selectCurve(page, 2);
        const before = await page.locator(`${curveGroup(2)} .curve-line`).boundingBox();

        expect(await dragCurveBody(page, 2, { x: -30, y: 0 })).toBe(true);

        const after = await page.locator(`${curveGroup(2)} .curve-line`).boundingBox();
        expect(Math.abs(after!.x - before!.x + 30)).toBeLessThan(5);
    });

    test('adds and removes curves, keeping the legend in step', async ({ page }) => {
        await gotoApp(page);
        await expect(page.locator('#graph-container .curve-fill')).toHaveCount(3);

        await mouseClick(page, '[data-curve-add]');
        // Adding a curve opens its label for typing; Escape keeps the default name.
        const editor = page.locator('.inline-editor');
        if (await editor.isVisible()) await editor.press('Escape');
        await expect(page.locator('#graph-container .curve-fill')).toHaveCount(4);
        await expect(page.locator('.legend-block')).toHaveCount(4);

        await clickRevealedBadge(page, '.legend-block', '[data-curve-remove="0"]');
        await expect(page.locator('#graph-container .curve-fill')).toHaveCount(3);
    });

    test('switches a curve between a smooth spline and straight segments', async ({ page }) => {
        await gotoApp(page);
        await selectCurve(page);
        const before = await page.locator(`${curveGroup(0)} .curve-line`).getAttribute('d');

        await page
            .locator('#editor-toolbar label.tool-check', { hasText: 'Smooth' })
            .locator('input')
            .uncheck();

        await expect
            .poll(() => page.locator(`${curveGroup(0)} .curve-line`).getAttribute('d'))
            .not.toBe(before);
    });

    test('changes the fill opacity of the selected curve', async ({ page }) => {
        await gotoApp(page);
        await selectCurve(page);
        const before = await page.locator(curveGroup(0)).evaluate((node) => node.outerHTML);

        await page.locator('#editor-toolbar input[type="range"]').fill('0.9');

        await expect
            .poll(() => page.locator(curveGroup(0)).evaluate((node) => node.outerHTML))
            .not.toBe(before);
    });

    test('reorders the paint order and keeps the selection on the moved curve', async ({
        page,
    }) => {
        await gotoApp(page);
        const firstBefore = await page.locator(`${curveGroup(0)} .curve-fill`).getAttribute('fill');
        await selectCurve(page);

        await toolbarButton(page, 'Bring curve forward').click();

        // The moved curve now paints last, and is still the selected one.
        await expect(page.locator('.point-handle')).toHaveCount(SHIFT_LEFT_POINTS);
        await expect
            .poll(() => page.locator(`${curveGroup(0)} .curve-fill`).getAttribute('fill'))
            .not.toBe(firstBefore);
    });

    test('picks a new colour for a curve from its legend swatch', async ({ page }) => {
        await gotoApp(page);
        const swatch = page.locator('.legend-swatch[data-swatch-index="0"]');
        const before = await swatch.getAttribute('fill');

        await mouseClick(page, '.legend-swatch[data-swatch-index="0"]');
        const picker = page.locator('.inline-color');
        await expect(picker).toBeVisible();

        await picker.evaluate((input: HTMLInputElement) => {
            input.value = '#123456';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        });

        await expect(page.locator('.legend-swatch[data-swatch-index="0"]')).not.toHaveAttribute(
            'fill',
            before ?? ''
        );
    });
});
