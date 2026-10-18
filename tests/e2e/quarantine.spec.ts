import { expect, test } from '@playwright/test';

import { gotoApp, mouseClick, openHeaderMenu } from './helpers';

/**
 * REQ-Q — the known-flaky real interactions, quarantined.
 *
 * These specs exist so the *defect* is visible and pinned rather than silently worked around. The
 * rest of the suite drives the graph with raw `page.mouse` input (see `helpers.ts`); the tests here
 * show why, and prove the app itself behaves correctly when it is driven that way.
 */
test.describe('REQ-Q quarantined interactions', () => {
    test('an element click on the SVG "+" completes exactly once', async ({ page }) => {
        await gotoApp(page);
        await expect(page.locator('.event-label')).toHaveCount(1);

        // Historical interaction issue: the pointerdown handler replaces the whole SVG, which
        // used to detach the element mid-click — Playwright's actionability re-check never settled,
        // so the click timed out or double-fired. That no longer reproduces on the current
        // Playwright, so this is a regression guard rather than a workaround. The suite still drives
        // the graph with `page.mouse` (see helpers.ts), because that is what a user actually does.
        await page.locator('[data-event-add]').click();

        await expect(page.locator('.event-label')).toHaveCount(2);
    });

    test('the same click with raw mouse input adds exactly one event', async ({ page }) => {
        await gotoApp(page);
        await expect(page.locator('.event-label')).toHaveCount(1);

        await mouseClick(page, '[data-event-add]');
        // The add opens the new label for typing; Escape keeps the default name.
        const editor = page.locator('.inline-editor');
        if (await editor.isVisible()) await editor.press('Escape');

        // Exactly one, not two: a real click is also immune to the double-fire the element click
        // suffers when it retries.
        await expect(page.locator('.event-label')).toHaveCount(2);
        await expect(page.locator('text[data-event-index="0"]')).toHaveText('Event 2');
    });

    test('a header menu is opened programmatically', async ({ page }) => {
        await gotoApp(page);
        const button = page.locator('#btn-style');
        await expect(button).toHaveAttribute('aria-expanded', 'false');

        await openHeaderMenu(page, 'btn-style');

        await expect(button).toHaveAttribute('aria-expanded', 'true');
        await expect(page.locator('#style-menu')).toBeVisible();
    });
});
