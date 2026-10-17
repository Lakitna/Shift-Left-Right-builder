/**
 * Shared setup for the GUI suite.
 *
 * Three facts about this app drive every helper here:
 *
 * 1. **First paint is gated on fonts.** `loadFromHash` awaits `loadStyleFonts` before the first
 *    render, because the layout measures text with canvas metrics. So "the app is up" means the
 *    fonts reported loaded *and* a graph is painted.
 * 2. **The whole SVG is replaced on every render** (`canvasEl.replaceChildren(svg)`). Never cache an
 *    element across an action — re-query it.
 * 3. **Playwright's element `click()` is unreliable on the graph.** The app re-renders inside the
 *    `pointerdown` handler, so the element Playwright is holding detaches mid-click and the action
 *    times out. `page.mouse` sends real trusted input with no actionability post-checks, which is
 *    also exactly what a user does.
 *
 * Playwright gives every test a fresh browser context, so `localStorage` already starts empty —
 * helpers only *seed* it, they never clear it (clearing on every navigation would break the
 * persistence tests).
 */
import { expect, type Locator, type Page } from '@playwright/test';

export const STORAGE_KEYS = {
    theme: 'shift-left-right-theme',
    style: 'shift-left-right-style',
    pngExport: 'shift-left-right-png-export',
    svgExport: 'shift-left-right-svg-export',
} as const;

/**
 * The URL sync is debounced by 250 ms and deflates asynchronously, so the hash lands ~300 ms after
 * an action — and considerably later when both browser projects are loading the machine. This is a
 * wait-for-something-to-happen budget, so a generous value hides nothing.
 */
const HASH_SYNC_TIMEOUT_MS = 15_000;

/**
How long to allow for a full re-render (fonts + layout) after a model load.
*/
export const RENDER_TIMEOUT_MS = 15_000;

export interface GotoOptions {
    /**
    Hash to open with, including the leading `#`.
    */
    hash?: string;
    /**
    localStorage entries to install before the app boots.
    */
    storage?: Record<string, string>;
}

/**
Install localStorage values before any page script runs.
*/
export async function seedStorage(page: Page, storage: Record<string, string>): Promise<void> {
    await page.addInitScript((entries: Record<string, string>) => {
        for (const [key, value] of Object.entries(entries)) {
            globalThis.localStorage.setItem(key, value);
        }
    }, storage);
}

/**
 * Record what the app writes to the clipboard, without needing clipboard permissions.
 *
 * Playwright can only grant `clipboard-read` / `clipboard-write` in Chromium, so on Firefox the text
 * the app hands to `navigator.clipboard.writeText` is captured inside the page instead. That still
 * proves the app copied the *current* URL — it just cannot prove the OS clipboard accepted it.
 *
 * Call this before navigating, so the hook is installed before the app boots.
 */
export async function spyOnClipboardWrites(page: Page): Promise<() => Promise<string[]>> {
    await page.addInitScript(() => {
        const written: string[] = [];
        (globalThis as unknown as { __clipboardWrites: string[] }).__clipboardWrites = written;

        const clipboard = navigator.clipboard;
        if (clipboard === undefined) return;

        const original = clipboard.writeText.bind(clipboard);
        clipboard.writeText = (text: string) => {
            written.push(text);
            return original(text);
        };
    });

    return () =>
        page.evaluate(
            () => (globalThis as unknown as { __clipboardWrites: string[] }).__clipboardWrites
        );
}

/**
Open the app and wait until it has painted a graph.
*/
export async function gotoApp(page: Page, options: GotoOptions = {}): Promise<void> {
    const { hash = '', storage } = options;
    if (storage !== undefined) await seedStorage(page, storage);
    await page.goto(`/${hash}`, { waitUntil: 'domcontentloaded' });
    await waitForGraph(page);
}

export async function waitForGraph(page: Page): Promise<void> {
    await page.waitForFunction(() => document.fonts.status === 'loaded');
    await expect(page.locator('#graph-container svg.graph-svg')).toBeVisible();
    await expect(page.locator('#graph-container .curve-fill').first()).toBeAttached();
}

/**
Apply one of the toolbar presets by its visible name.
*/
export async function applyPreset(
    page: Page,
    name: 'Schematic' | 'Detailed' | 'Empty'
): Promise<void> {
    await page.locator('#editor-toolbar select').selectOption({ label: name });
}

/**
 * Open a header dropdown.
 *
 * REQ-Q quarantine: a real `click()` on the header buttons can fail Playwright's actionability
 * checks (see `quarantine.spec.ts`), so the documented workaround is used here.
 */
export async function openHeaderMenu(page: Page, id: 'btn-style' | 'btn-share'): Promise<void> {
    await page.evaluate((elementId) => {
        document.getElementById(elementId)?.click();
    }, id);
}

export async function currentHash(page: Page): Promise<string> {
    return page.evaluate(() => globalThis.location.hash);
}

/**
Wait until the debounced URL sync has written a hash containing `needle`.
*/
export async function waitForHashContaining(page: Page, needle: string): Promise<void> {
    await page.waitForFunction((value) => globalThis.location.hash.includes(value), needle, {
        timeout: HASH_SYNC_TIMEOUT_MS,
    });
}

/**
 * Wait until the hash differs from `previous` and return the new value.
 *
 * Boot always schedules a URL write for the default model, and `waitForHashContaining` can be
 * satisfied by that write rather than the one a test just triggered. Reading the hash *before* an
 * action and waiting for it to change is the only way to be sure the value belongs to the action.
 * (There is only ever one pending write: `syncUrl` cancels the previous timer.)
 */
export async function waitForHashChange(page: Page, previous: string): Promise<string> {
    await page.waitForFunction((before) => globalThis.location.hash !== before, previous, {
        timeout: HASH_SYNC_TIMEOUT_MS,
    });
    return currentHash(page);
}

/**
Read a numeric SVG attribute off an element.
*/
export async function numberAttribute(page: Page, selector: string, name: string): Promise<number> {
    const raw = await page.locator(selector).first().getAttribute(name);
    if (raw === null) throw new Error(`${selector} has no attribute ${name}`);
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new TypeError(`${selector}@${name} is not a number: ${raw}`);
    return value;
}

/**
Drag an element by a viewport-pixel delta with raw mouse input.
*/
export async function dragElement(
    page: Page,
    selector: string,
    delta: { x: number; y: number }
): Promise<void> {
    await mouseDrag(page, await elementCentre(page, selector), delta);
}

/**
 * Click a badge that CSS only reveals on hover (the ✕ remove badges and the legend drag handle).
 *
 * The badges are always in the DOM in edit mode, but the parent must be hovered first so the
 * browser hit-tests the badge rather than whatever sits beneath it.
 */
export async function clickRevealedBadge(
    page: Page,
    hoverSelector: string,
    badgeSelector: string
): Promise<void> {
    await page.locator(hoverSelector).first().hover();
    await mouseClick(page, badgeSelector);
}

/**
The x of a control-point handle, in SVG user units.
*/
export function handleX(page: Page, index: number): Promise<number> {
    return numberAttribute(page, `.point-handle[data-handle-index="${index}"]`, 'cx');
}

/**
 * Drag the body of the selected curve, i.e. grab it away from its handles.
 *
 * Control-point handles and insert badges sit on the curve and capture the pointer first, so this
 * walks the path until it finds a point where `elementFromPoint` resolves to the curve body itself.
 * Returns false if no such point exists.
 */
export async function dragCurveBody(
    page: Page,
    curveIndex: number,
    delta: { x: number; y: number }
): Promise<boolean> {
    const start = await page.evaluate((index) => {
        const svg = document.querySelector<SVGSVGElement>('#graph-container svg.graph-svg');
        const body = document.querySelector<SVGPathElement>(`[data-curve-move="${CSS.escape(index)}"]`);
        if (svg === null || body === null) return null;

        const box = svg.getBoundingClientRect();
        const viewBox = svg.viewBox.baseVal;
        const scaleX = box.width / (viewBox.width || box.width);
        const scaleY = box.height / (viewBox.height || box.height);
        const total = body.getTotalLength();

        for (let step = 1; step < 40; step += 1) {
            const at = body.getPointAtLength((total * step) / 40);
            const x = box.left + (at.x - viewBox.x) * scaleX;
            const y = box.top + (at.y - viewBox.y) * scaleY;
            const hit = document.elementFromPoint(x, y);
            if (hit !== null && hit.closest('[data-curve-move]') !== null) return { x, y };
        }
        return null;
    }, curveIndex);

    if (start === null) return false;
    await mouseDrag(page, start, delta);
    return true;
}

export function handleY(page: Page, index: number): Promise<number> {
    return numberAttribute(page, `.point-handle[data-handle-index="${index}"]`, 'cy');
}

/**
 * The x of a phase label. Phase labels sit at the centre of their band, so this is exactly where
 * a snapped point's x must land — which is how the snap requirement is asserted without reaching
 * into the model.
 */
export async function phaseLabelX(page: Page, index: number): Promise<number> {
    return numberAttribute(page, `text[data-phase-index="${index}"]`, 'x');
}

/**
 * Fail if a point is outside the viewport.
 *
 * Raw mouse input cannot reach past an edge: a drag that ends outside the viewport makes Firefox
 * scroll the page instead, which silently destroys the gesture's frame of reference — `clientY` goes
 * negative, no `pointerup` is ever delivered, and the drag simply "does nothing". An out-of-bounds
 * drag is a broken test, so it throws rather than mis-reporting the app.
 */
function assertInsideViewport(page: Page, point: { x: number; y: number }, what: string): void {
    const viewport = page.viewportSize();
    if (viewport === null) return;
    if (point.x < 0 || point.y < 0 || point.x > viewport.width || point.y > viewport.height) {
        throw new Error(
            `${what} (${Math.round(point.x)}, ${Math.round(point.y)}) is outside the ` +
                `${viewport.width}x${viewport.height} viewport`
        );
    }
}

/**
Raw pointer drag over the graph, in viewport pixels.
*/
export async function mouseDrag(
    page: Page,
    start: { x: number; y: number },
    delta: { x: number; y: number }
): Promise<void> {
    const end = { x: start.x + delta.x, y: start.y + delta.y };
    assertInsideViewport(page, start, 'Drag start');
    assertInsideViewport(page, end, 'Drag end');

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    // Several intermediate moves so the gesture threshold is crossed the way a real drag does.
    await page.mouse.move(end.x, end.y, { steps: 10 });
    await page.mouse.up();
}

/**
Read a box until two consecutive reads agree, so an in-flight scroll animation cannot mislead us.
*/
async function stableBox(page: Page, locator: Locator) {
    let box = await locator.boundingBox();
    for (let attempt = 0; attempt < 20; attempt += 1) {
        const next = await locator.boundingBox();
        if (next === null) return null;
        if (box !== null && next.x === box.x && next.y === box.y) return next;
        box = next;
        await page.waitForTimeout(50);
    }
    return box;
}

/**
 * Bring `locator` inside the viewport by scrolling the window.
 *
 * The page is *window*-scrollable: the document is ~1170px tall in a 720px viewport, and the graph
 * container itself never scrolls (its content fits). Playwright's `scrollIntoViewIfNeeded` handles
 * that in Chromium, but for SVG graphics elements it is a no-op in Firefox — and
 * `Element.scrollIntoView` does not move the window for them either. Without this step a click is
 * dispatched below the viewport, no event ever reaches the page, and the click merely looks like it
 * "did nothing".
 */
async function scrollIntoViewport(page: Page, locator: Locator): Promise<void> {
    const viewport = page.viewportSize();
    if (viewport === null) return;

    for (let attempt = 0; attempt < 6; attempt += 1) {
        const box = await locator.boundingBox();
        if (box === null) return;

        const centreX = box.x + box.width / 2;
        const centreY = box.y + box.height / 2;
        const dx = centreX < 0 || centreX > viewport.width ? centreX - viewport.width / 2 : 0;
        const dy = centreY < 0 || centreY > viewport.height ? centreY - viewport.height / 2 : 0;
        if (dx === 0 && dy === 0) return;

        await page.evaluate((delta) => { window.scrollBy(delta.dx, delta.dy); }, { dx, dy });
        await page.waitForTimeout(50);
    }
}

/**
 * Centre of an element's box in viewport pixels, guaranteed to be inside the viewport.
 *
 * Throws when the point is still unreachable, so a mis-aimed click fails loudly instead of quietly
 * hitting nothing.
 */
export async function elementCentre(
    page: Page,
    selector: string,
    offset: { x: number; y: number } = { x: 0, y: 0 }
): Promise<{ x: number; y: number }> {
    const locator = page.locator(selector).first();

    await locator.scrollIntoViewIfNeeded();
    await scrollIntoViewport(page, locator);

    const box = await stableBox(page, locator);
    if (box === null) throw new Error(`No bounding box for ${selector}`);

    const point = {
        x: box.x + box.width / 2 + offset.x,
        y: box.y + box.height / 2 + offset.y,
    };
    assertInsideViewport(page, point, `Cannot click ${selector}:`);

    return point;
}

/**
Click a graph element with raw mouse input (see the note at the top of this file).
*/
export async function mouseClick(
    page: Page,
    selector: string,
    offset: { x: number; y: number } = { x: 0, y: 0 }
): Promise<void> {
    const point = await elementCentre(page, selector, offset);
    await page.mouse.click(point.x, point.y);
}

/**
 * Viewport coordinates of a curve's peak, nudged just inside its fill.
 *
 * Every curve's fill reaches down to the baseline, so a point belonging to a lower curve also sits
 * inside the fill of any curve drawn after it — clicking a bounding-box centre therefore selects a
 * neighbour, or nothing. A curve's peak is the one place it is reliably on top.
 */
export async function curvePeakPoint(page: Page, index: number): Promise<{ x: number; y: number }> {
    const point = await page.evaluate((curveIndex) => {
        const path = document.querySelector<SVGPathElement>(
            `#graph-container g.curves > g[data-curve-index="${CSS.escape(curveIndex)}"] .curve-line`
        );
        const svg = path?.ownerSVGElement ?? null;
        if (path === null || svg === null) return null;

        const total = path.getTotalLength();
        let peak: { x: number; y: number } | null = null;
        for (let step = 0; step <= 60; step += 1) {
            const at = path.getPointAtLength((total * step) / 60);
            // Smallest y is highest on screen.
            if (peak === null || at.y < peak.y) peak = { x: at.x, y: at.y };
        }
        if (peak === null) return null;

        const box = svg.getBoundingClientRect();
        const viewBox = svg.viewBox.baseVal;
        const scaleX = box.width / (viewBox.width || box.width);
        const scaleY = box.height / (viewBox.height || box.height);
        return {
            x: box.left + (peak.x - viewBox.x) * scaleX,
            // Just inside the fill, rather than exactly on its boundary stroke.
            y: box.top + (peak.y - viewBox.y) * scaleY + 4,
        };
    }, index);

    if (point === null) throw new Error(`Curve ${index} is not rendered`);
    return point;
}

/**
Select the curve at `index` and wait for its editing overlay.
*/
export async function selectCurve(page: Page, index = 0): Promise<void> {
    const point = await curvePeakPoint(page, index);
    await page.mouse.click(point.x, point.y);
    await expect(page.locator('.editing-ui .point-handle').first()).toBeAttached();
}

/**
The `<input>` of a toolbar checkbox, matched by its visible caption.
*/
export function toolbarCheck(page: Page, caption: string) {
    return page.locator('#editor-toolbar label.tool-check', { hasText: caption }).locator('input');
}

/**
A toolbar button, matched by its title (the toolbar buttons carry no ids).
*/
export function toolbarButton(page: Page, title: string) {
    return page.locator(`#editor-toolbar button[title="${title}"]`);
}
