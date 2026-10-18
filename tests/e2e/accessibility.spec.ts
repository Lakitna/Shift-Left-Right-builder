import { expect, test, type Page } from '@playwright/test';

import { applyPreset, gotoApp } from './helpers';

/**
 * REQ-13 — WCAG 2.2 Level AA, the criteria a browser can actually check.
 *
 * The contrast half of REQ-13 is covered by the component tier (`tests/unit/validate.test.ts`),
 * because it is arithmetic over the style palettes. What is left needs a real layout engine: focus
 * visibility, target size, reflow, text spacing, accessible names and labels.
 */

/**
Identifies the focused element in a way that reads well in an assertion failure.
*/
async function focusedLabel(page: Page): Promise<string> {
    return page.evaluate(() => {
        const element = document.activeElement as HTMLElement | null;
        return element === null ? '' : (
            element.id ||
            (element.getAttribute('aria-label') ?? '') ||
            (element.getAttribute('title') ?? '') ||
            element.textContent.trim().slice(0, 40) ||
            element.tagName
        );
    });
}

test.describe('REQ-13 accessibility: WCAG 2.2 Level AA', () => {
    test('AA: keyboard reaches every control', async ({ page }) => {
        await gotoApp(page);
        // A disabled control is correctly not focusable, so first give the history a middle state:
        // two edits, then one undo leaves both undo *and* redo available.
        await applyPreset(page, 'Detailed');
        await applyPreset(page, 'Empty');
        await page.locator('#editor-toolbar select').blur();
        await page.keyboard.press('Control+z');

        const reached: string[] = [];
        for (let step = 0; step < 16; step += 1) {
            await page.keyboard.press('Tab');
            const label = await focusedLabel(page);
            if (label !== '') reached.push(label);
        }

        // Header controls, the history buttons, the preset picker and the axis toggles are all
        // reachable in a sensible order.
        expect(reached).toContain('btn-style');
        expect(reached).toContain('btn-theme');
        expect(reached).toContain('btn-share');
        expect(reached).toContain('Undo (Ctrl+Z)');
        expect(reached).toContain('Redo (Ctrl+Y)');
        expect(reached).toContain('Apply a preset');
    });

    test('AA: the focus indicator is visible', async ({ page }) => {
        await gotoApp(page);

        const withoutIndicator: string[] = [];
        for (let step = 0; step < 10; step += 1) {
            await page.keyboard.press('Tab');
            const result = await page.evaluate(() => {
                const element = document.activeElement as HTMLElement | null;
                // The body is not a control — focus lands there when the browser moves focus out of
                // the page, and it carries no indicator by design.
                if (element === null || element.tagName === 'BODY') return;
                const style = getComputedStyle(element);
                // Computed `outline-width` is always a px length (`'2px'`, `'0px'`), and
                // `Number('2px')` is `NaN` — so the unit comes off before the value is coerced.
                const outlineWidth = Number(style.outlineWidth.replace('px', ''));
                return {
                    label: element.id || (element.getAttribute('title') ?? '') || element.tagName,
                    visible: style.outlineStyle !== 'none' && outlineWidth > 0,
                };
            });
            if (result !== undefined && !result.visible) withoutIndicator.push(result.label);
        }

        expect(withoutIndicator).toEqual([]);
    });

    test('AA: every pointer target is at least 24x24', async ({ page }) => {
        await gotoApp(page);

        // Measured on the *clickable* element — the label wrapping a checkbox is the target, not the
        // 16px input inside it.
        const tooSmall = await page.evaluate(() => {
            const targets = [
                ...document.querySelectorAll('.app-header button'),
                ...document.querySelectorAll('#editor-toolbar button'),
                ...document.querySelectorAll('#editor-toolbar .tool-check'),
                ...document.querySelectorAll('#editor-toolbar .tool-range'),
                ...document.querySelectorAll('#png-dialog button'),
                ...document.querySelectorAll('#png-dialog .segment'),
                ...document.querySelectorAll('#svg-dialog button'),
                ...document.querySelectorAll('#svg-dialog .segment'),
            ];
            return targets
                .filter((element) => element.getBoundingClientRect().width > 0)
                .map((element) => {
                    const box = element.getBoundingClientRect();
                    return {
                        label:
                            element.id ||
                            (element.getAttribute('title') ?? '') ||
                            element.textContent.trim().slice(0, 30) ||
                            element.tagName,
                        width: Math.round(box.width),
                        height: Math.round(box.height),
                    };
                })
                .filter((target) => target.width < 24 || target.height < 24);
        });

        expect(tooSmall).toEqual([]);
    });

    test('AA: text spacing changes do not clip the labels', async ({ page }) => {
        await gotoApp(page);

        // The WCAG 1.4.12 recipe: more line, letter and word spacing, and paragraph spacing.
        await page.addStyleTag({
            content: `
                * {
                    line-height: 1.5 !important;
                    letter-spacing: 0.12em !important;
                    word-spacing: 0.16em !important;
                }
                p { margin-bottom: 2em !important; }
            `,
        });

        const clipped = await page.evaluate(() => {
            const nodes = [
                ...document.querySelectorAll('.phase-label'),
                ...document.querySelectorAll('.event-label'),
                ...document.querySelectorAll('.legend-block'),
            ];
            return nodes
                .filter(
                    (element) =>
                        element.getBoundingClientRect().height === 0 ||
                        element.getBoundingClientRect().width === 0
                )
                .map((element) => element.textContent.trim().slice(0, 40));
        });

        expect(clipped).toEqual([]);
        const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - window.innerWidth
        );
        expect(overflow).toBeLessThanOrEqual(1);
    });

    test('AA: icon-only buttons expose an accessible name', async ({ page }) => {
        await gotoApp(page);

        const unnamed = await page.evaluate(() =>
            [...document.querySelectorAll('button')]
                .filter((button) => {
                    const text = button.textContent.trim();
                    // A button with readable text names itself; a glyph or emoji does not.
                    return (
                        !/^[a-z0-9]/i.test(text) &&
                        (button.getAttribute('aria-label') ?? '') === '' &&
                        (button.getAttribute('title') ?? '') === ''
                    );
                })
                .map((button) => button.textContent.trim())
        );

        expect(unnamed).toEqual([]);
    });

    test('AA: every dialog field has a visible label', async ({ page }) => {
        await gotoApp(page);

        const unlabelled = await page.evaluate(() =>
            [...document.querySelectorAll('#png-dialog input, #svg-dialog input')]
                .filter(
                    (input) =>
                        input.closest('label') === null &&
                        document.querySelector(`label[for="${CSS.escape(input.id)}"]`) === null
                )
                .map((input) => input.id)
        );

        expect(unlabelled).toEqual([]);
    });

    test('AA: colour is never the only carrier of meaning', async ({ page }) => {
        await gotoApp(page);

        // Every curve is identified by its label text in the legend, not only by its swatch colour.
        const rows = page.locator('.legend-block');
        const count = await rows.count();
        expect(count).toBeGreaterThan(0);
        for (let index = 0; index < count; index += 1) {
            const text = (await rows.nth(index).textContent()) ?? '';
            // Strip the ✕ remove badge; a real name must remain.
            expect(text.replace('✕', '').trim().length).toBeGreaterThan(0);
        }
    });

    test('house rule: no all-caps text anywhere in the UI', async ({ page }) => {
        await gotoApp(page);
        await page.locator('#editor-toolbar').waitFor();

        const offenders = await page.evaluate(() => {
            const selectors = [
                '.app-title',
                '.app-header button',
                '#editor-toolbar button',
                '#editor-toolbar .tool-check span',
                '#editor-toolbar .tool-range span',
                '#editor-toolbar option',
                '.phase-label',
                '.event-label',
                '.legend-block',
                '.modal-title',
                '.field-label',
            ];
            const found: string[] = [];
            for (const selector of selectors) {
                for (const element of document.querySelectorAll(selector)) {
                    const text = element.textContent.trim();
                    // Casing is only a problem when there are letters to case.
                    if (text === '' || !/[a-z]/i.test(text)) continue;
                    if (text === text.toUpperCase())
                        found.push(`${selector}: ${text.slice(0, 40)}`);
                    const transform = getComputedStyle(element).textTransform;
                    if (transform === 'uppercase')
                        found.push(`${selector}: text-transform uppercase`);
                }
            }
            return found;
        });

        expect(offenders).toEqual([]);
    });
});

test.describe('REQ-13 accessibility: reflow', () => {
    // WCAG 1.4.10: content must reflow to a 320 CSS px wide viewport without needing two dimensions
    // of scrolling. The plot itself is essential 2D content and keeps its aspect inside a scrolling
    // container, so what matters here is that the *page* does not scroll sideways.
    test.use({ viewport: { width: 320, height: 800 } });

    test('AA: the page reflows at 320px without sideways scrolling', async ({ page }) => {
        await gotoApp(page);

        const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - window.innerWidth
        );
        expect(overflow).toBeLessThanOrEqual(1);

        // The header controls are still on screen and usable rather than pushed out of reach.
        await expect(page.locator('#btn-theme')).toBeVisible();
        await expect(page.locator('#btn-style')).toBeVisible();
    });
});
