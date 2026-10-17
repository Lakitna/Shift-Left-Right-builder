import { expect, test } from '@playwright/test';

import { clickRevealedBadge, dragElement, gotoApp, mouseClick, toolbarCheck } from './helpers';

test.describe('REQ-07 events (moments in time)', () => {
    test('renders a gate line, a diamond and a callout for each event', async ({ page }) => {
        await gotoApp(page);

        await expect(page.locator('.event-label')).toHaveCount(1);
        await expect(page.locator('[data-event-line="0"]')).toHaveCount(1);
        await expect(page.locator('[data-event-diamond="0"]')).toHaveCount(1);
        await expect(page.locator('[data-event-leader="0"]')).toHaveCount(1);
        await expect(page.locator('text[data-event-index="0"]')).toHaveText('Release');
    });

    test('adds an event at the centre of the timeline', async ({ page }) => {
        await gotoApp(page);

        await mouseClick(page, '[data-event-add]');
        // The add opens the new event's label for typing; Escape keeps the default name.
        const editor = page.locator('.inline-editor');
        if (await editor.isVisible()) await editor.press('Escape');

        await expect(page.locator('.event-label')).toHaveCount(2);
        // Sorted by position: the new event at x=50 lands left of "Release" at x=75.
        await expect(page.locator('text[data-event-index="0"]')).toHaveText('Event 2');
        await expect(page.locator('text[data-event-index="1"]')).toHaveText('Release');
    });

    test('edits the label and the note', async ({ page }) => {
        await gotoApp(page);
        await mouseClick(page, 'text[data-event-index="0"]');

        const editor = page.locator('.inline-editor');
        await expect(editor).toBeVisible();
        // An event label is multi-line: line one is the label, the rest is the note.
        await editor.fill('Launch\nGo / no-go gate');
        await editor.press('Control+Enter');

        await expect(page.locator('text[data-event-index="0"]')).toHaveText('Launch');
        await expect(page.locator('[data-event-note="0"]')).toContainText('Go / no-go gate');
    });

    test('snaps an event to a phase boundary when dragged', async ({ page }) => {
        await gotoApp(page);
        await toolbarCheck(page, 'Snap to phases').check();

        // The internal separators sit on the phase boundaries; extrapolate a step to reach the
        // plot edges, which are boundaries too but carry no separator line.
        const boundaries = await page.evaluate(() => {
            const lines = [...document.querySelectorAll('#graph-container g.grid line')];
            const xs = lines
                .map((line) => Number(line.getAttribute('x1')))
                .filter((value) => Number.isFinite(value))
                .sort((a, b) => a - b);
            if (xs.length < 2) return xs;
            const step = xs[1] - xs[0];
            return [xs[0] - step, ...xs, xs.at(-1) + step];
        });
        expect(boundaries.length).toBeGreaterThan(0);

        await dragElement(page, 'text[data-event-index="0"]', { x: -180, y: 0 });

        const gateX = Number(await page.locator('[data-event-line="0"]').getAttribute('x1'));
        expect(boundaries.some((boundary) => Math.abs(boundary - gateX) < 2)).toBe(true);
    });

    test('hugs the gate with its callout near the plot edge', async ({ page }) => {
        await gotoApp(page);
        const label = page.locator('text[data-event-index="0"]');
        await expect(label).toHaveAttribute('text-anchor', 'middle');

        // Drag the event hard right; at the edge the callout cannot stay centred without
        // overflowing, so it flips to hug the gate.
        await dragElement(page, 'text[data-event-index="0"]', { x: 300, y: 0 });

        await expect(label).toHaveAttribute('text-anchor', 'end');
    });

    test('removes an event from its hover badge', async ({ page }) => {
        await gotoApp(page);
        await clickRevealedBadge(page, '.event-label', '[data-event-remove="0"]');
        await expect(page.locator('.event-label')).toHaveCount(0);
    });
});
