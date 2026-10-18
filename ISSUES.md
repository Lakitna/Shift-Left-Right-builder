# Issues

Defects and coverage gaps found while building the test suites in this repo.

Run the suites with:

```sh
npm run test:unit   # component tier (vitest)
npm run test:e2e    # GUI tier (Playwright, Chromium + Firefox, randomised order)
npm run lint        # strict ESLint (typescript-eslint strictTypeChecked + eslint-plugin-unicorn)
```

**Status: items 1–7, 9 and 10 are fixed and both suites are green** — `npm run test:unit` is 97/97,
`npm run test:e2e` is 202/202 across Chromium and Firefox, and `npm run lint` reports zero problems.
Each fixed item keeps its original diagnosis with a **Resolved** note describing the change, so the
reasoning survives. Item **#11** is deliberately still open. (#8 was a test bug rather than a defect —
see the note in its place.)

---

## 1. `url-state.pipeBytes` leaks an unhandled rejection on a malformed share link

- **Severity:** medium
- **Where:** `src/url-state.ts` → `pipeBytes`
- **Symptom:** `writer.write(...)` and `writer.close()` are started with `void`, so when the stream
  errors — a corrupt or truncated `#p=` payload — those promises reject with nobody listening. Every
  malformed link produces an unhandled rejection. The decode still returns `null`, so the app shows
  the warning banner and falls back to the default model, which is why this went unnoticed.
- **Demonstrated by:** `tests/unit/url-state.test.ts` ›
  `leaks no unhandled rejection when a payload is corrupt` (currently EXPECTED RED; vitest also
  prints its process-level "unhandled errors" notice because of it).
- **Fix:** `await` both writer calls inside the `try`, or attach `.catch(() => {})`. The test then
  passes and the vitest run is clean.
- **Resolved:** the manual writer is gone. `pipeBytes` now wraps the bytes in a `Response`, pipes
  that body through the transform with `ReadableStream#pipeThrough`, and reads the result back with
  `arrayBuffer()`. `pipeThrough` marks its internal piping promise as handled and errors the output
  stream, so a corrupt payload arrives as one *handled* rejection on `decodeModel`'s existing
  `catch` — no `void`-ed promises, no unhandled rejection.

## 2. WCAG 2.2 AA: the `hint` text colour is below 4.5:1 in four styles

- **Severity:** medium
- **Where:** `src/styles/draftsman.ts`, `src/styles/toon.ts`, `src/styles/de-stijl.ts`,
  `src/styles/unicorn.ts` — the `canvas[theme].hint` token
- **Symptom:** the `hint vs ground` text pair misses the 4.5:1 normal-text ratio:

  | style     | light | dark | needed |
  | --------- | ----- | ---- | ------ |
  | draftsman | 2.38  | 3.15 | 4.5    |
  | toon      | 2.21  | 3.14 | 4.5    |
  | de-stijl  | 3.13  | 3.49 | 4.5    |
  | unicorn   | 2.18  | 3.58 | 4.5    |

- Everything else passes: `title`, `legendMuted` and `chipText` reach AA in all seven styles, curve
  fills reach the 3:1 non-text ratio, and the High contrast style reaches AAA (7:1).
- **Demonstrated by:** `tests/unit/validate.test.ts` ›
  `AA: every style reaches 4.5:1 on normal text and 3:1 on large text`
- **Fix:** darken (light theme) / lighten (dark theme) `hint` in those four styles until each pair
  clears 4.5:1 in both themes.
- **Resolved:** each of the eight `hint` tokens was blended towards black (light) or white (dark)
  until it cleared 4.5:1 with margin — draftsman `#a8a49a` → `#74716a` (4.66) and `#6b675e` →
  `#86827b` (4.65), toon `#b3a88f` → `#766f5e` (4.69) and `#5f6b85` → `#7d879c` (4.65), de-stijl
  `#8d887c` → `#6f6b62` (4.70) and `#6b675e` → `#7e7b73` (4.66), unicorn `#c98fd6` → `#835d8b`
  (4.69) and `#8a5fa8` → `#9a75b4` (4.66). Hue is preserved — only lightness moved. The 20 visual
  baselines are unaffected, because the hint only paints in the empty-model state.

## 3. `parseModel` silently accepts a non-numeric `opacity`

- **Severity:** low-medium — a contract mismatch, a malformed payload is half-accepted
- **Where:** `src/model.ts` → `parseCurve`
  (`typeof obj.opacity === 'number' ? clampOpacity(...) : DEFAULT_OPACITY`)
- **Symptom:** `parseModel` documents itself as strict and all-or-nothing — _"Every field must be
  present with the right type … a malformed payload is rejected rather than silently repaired"_ —
  but a present-but-wrong-typed `opacity` is repaired instead of rejecting the payload.
- **Demonstrated by:** `tests/unit/model.test.ts` › `rejects a present-but-non-numeric opacity`
  (EXPECTED RED)
- **Decision needed first:** either reject (strict, matching the documentation) or relax the
  documentation. The test currently asserts the strict reading.
- **Resolved:** the strict reading won. `parseCurve` rejects a *present* `opacity` that is not a
  number, while an *absent* one still falls back to `DEFAULT_OPACITY` — so the documented
  all-or-nothing contract holds and the lenient repair is gone.

## 4. `phaseBoundaries(0)` returns `[NaN]`

- **Severity:** low — unreachable through the UI (`MIN_PHASES` is 1), but a landmine
- **Where:** `src/model.ts` → `Math.round((i / count) * 100)` evaluates `0 / 0` when `count === 0`.
- **Demonstrated by:** `tests/unit/model.test.ts` ›
  `phaseBoundaries returns an empty list when there are no phases` (EXPECTED RED)
- **Fix:** return `[]` for `count <= 0`.
- **Resolved:** `phaseBoundaries` returns `[]` for `count <= 0`. `nearestBoundaryX` shares the same
  zero-phase case, so it now returns the clamped coordinate too.

## 5. `nearestPhaseX(x, 0)` returns `undefined` from a `number`-typed function

- **Severity:** low — same unreachable-input caveat as #4, but it breaks the type contract
- **Where:** `src/model.ts` → `phasePositions` is empty, so `positions[0]` is `undefined`, the
  distances become `NaN`, the comparison loop never assigns, and the function returns `undefined`
  even though its return type is `number`.
- **Demonstrated by:** `tests/unit/model.test.ts` › `nearestPhaseX always returns a real number`
  (EXPECTED RED)
- **Fix:** guard `count <= 0` and return `clampCoord(x)`; or widen the signature to
  `number | undefined` and handle it at the call sites.
- **Resolved:** `nearestPhaseX` guards `count <= 0` and returns `clampCoord(x)`, so the `number`
  signature is now honest instead of a lie.

## 6. Dead `dblclick` handler: double-click-to-add-a-point can never fire

- **Severity:** low — dead code, but it marks the real defect (see #7)
- **Where:** `src/editor.ts` — the `dblclick` listener that calls `insertPoint(...)`
- **Why it can never fire:** every `pointerdown` on the graph calls `render()`, which does
  `canvasEl.replaceChildren(svg)`. The element that took the first click is detached before the
  second click lands, so the browser never emits `dblclick`.
- The requirement was removed from `tests/REQUIREMENTS.md`, so nothing covers this now.
- **Fix:** delete the handler and its branch (simplest), or stop re-rendering on a pointerdown that
  does not change the selection — which would also fix #7.
- **Resolved:** the `dblclick` listener and its `onDoubleClick` handler are deleted. The
  double-click requirement had already been dropped from `tests/REQUIREMENTS.md`, so nothing covered
  it. #7 was fixed separately, so the two halves of the root cause are no longer alternatives.

## 7. Re-rendering the whole SVG inside `pointerdown` breaks element-level interaction

- **Severity:** low-medium — developer experience, and the app replaces its whole DOM on every
  mousedown
- **Where:** `src/editor.ts` — `routePointer` / `render` (`canvasEl.replaceChildren(svg)`)
- **Symptom:** the same root cause as #6. Replacing the DOM during `pointerdown` detaches the
  element mid-interaction, so Playwright's element `.click()` times out on SVG targets, and a
  retried pointerdown can double-fire — the `+` badges (add event, add curve) are the worst
  offenders.
- **Worked around** in the GUI suite by driving every graph interaction through real `page.mouse`
  input (see `tests/e2e/helpers.ts`), which is the more faithful approach anyway. The underlying
  re-render-per-pointerdown is still worth fixing.
- **Update 2026-10-17:** this **no longer reproduces** on the current Playwright + Chromium.
  `tests/e2e/quarantine.spec.ts` now asserts that an element click on the `+` completes and adds
  exactly one event. The redundant re-render is still worth removing, but nothing in the suite
  depends on the `page.mouse` workaround any more — it is kept because it is the more faithful
  input.
- **Resolved:** the redundant repaint is gone. `routePointer`'s curve-hit branch now renders only
  when the selection actually changes (`index !== selectedCurve || selectedPoint !== undefined`), so
  clicking an already-selected curve no longer throws the SVG away and rebuilds it mid-click.

---

## 8. Resolved — the Firefox legend drag was a test bug, not a defect

**Closed, no app change needed.** The Firefox legend drag was never broken: the spec dragged the
pointer _out of the viewport_, and Firefox scrolls the page instead of delivering that drag —
`clientY` went negative, **no `pointerup` was ever delivered**, and the gesture died silently while
still showing its "dragging" state. The legend sits at the very bottom of the page, so in the
default 720px viewport there was no room to drag a row downward at all.

The evidence, from a probe that logged the raw pointer stream for the same drag:

| browser  | pointerdown | last move | pointerup | result     |
| -------- | ----------- | --------- | --------- | ---------- |
| Chromium | `@391`      | `@591`    | `@591`    | reordered  |
| Firefox  | `@675`      | `@-85`    | **none**  | no reorder |

What changed (no `src/` edits):

- `tests/e2e/legend.spec.ts` runs on a viewport tall enough to give the drag room, and aims at the
  last row instead of guessing a 120px distance — the row pitch depends on how the notes wrapped.
- `tests/e2e/helpers.ts` → `mouseDrag` now **throws** when either end of a drag falls outside the
  viewport, so this can never again masquerade as an app defect.
- The `test.fail(browserName === 'firefox')` marker is gone: the test genuinely passes on both
  browsers now, rather than passing _as an expected failure_.

Kept deliberately as a warning: an out-of-viewport drag is indistinguishable from a broken feature
unless you check the pointer stream.

## 9. The PNG dialog's size hint is short by the attribution strip

- **Severity:** low — the dialog promises a size it does not deliver
- **Where:** `src/export.ts` → `measurePngSheet` (this feeds `#png-size-hint`) versus
  `buildPngSheet` (what the export actually renders)
- **Symptom:** the dialog reads _"Exports at about 600 × 476 px"_ but the downloaded PNG is **600 ×
  486**.
- **Root cause:** the sheet grows when attribution is on — `src/render.ts:508`,
  `const height = options.attribution ? frameBottom + 18 : frameBottom`. The real export passes
  `attribution: true`; `measurePngSheet` → `computeLayout` does not, so it measures 18 sheet pixels
  short. On a 1060px-wide sheet rendered at 600px, that surfaces as 10px.
- **Demonstrated by:** `tests/e2e/export.spec.ts` ›
  `exports a PNG of exactly the size the dialog promises`, marked `test.fail(true, …)` so the suite
  stays green and the fix arrives as an unexpected pass. Note the adjacent width assertion is
  already correct and stays green.
- **Fix:** measure with the same layout options as the export (pass `attribution: true`), or have
  both paths call one shared sheet-measuring helper so they cannot drift again.
- **Resolved:** `measurePngSheet` passes `attribution: true` to `computeLayout` — the same option the
  real export draws with — with a comment tying the two together so they cannot silently drift. The
  `test.fail(true, …)` marker in `tests/e2e/export.spec.ts` is gone and the test asserts for real.

## 10. The two toolbar checkboxes are 22px tall, under the 24px AA minimum

- **Severity:** low — a 2px fix, but it is a genuine WCAG 2.2 AA failure (2.5.8 Target Size
  (Minimum))
- **Where:** `src/styles.css` → `.tool-check`
- **Symptom:** the `Snap to phases` and `Numeric axis` labels measure **123 × 22** and **108 × 22**.
  Every other pointer target in the app already clears 24×24 (header buttons, toolbar buttons,
  dialog buttons and dialog segments were all measured and pass).
- **Demonstrated by:** `tests/e2e/accessibility.spec.ts` ›
  `AA: every pointer target is at least 24x24`, marked `test.fail(true, …)` so the suite stays green
  and the fix arrives as an unexpected pass.
- **Fix:** give `.tool-check` at least 2px more vertical padding, or `min-height: 24px`.
- **Resolved:** `.tool-check` carries `min-height: 24px`, with the WCAG 2.2 AA (2.5.8) reason in the
  rule. The `test.fail(true, …)` marker in `tests/e2e/accessibility.spec.ts` is gone and the test
  asserts for real. The visual baselines only snapshot `#graph-container`, so they are unaffected.

## 11. The graph canvas is not reachable by keyboard

- **Severity:** medium — a WCAG 2.2 AA failure (2.1.1 Keyboard: all functionality must be operable
  through a keyboard interface)
- **Where:** `src/render.ts` — nothing in the rendered SVG carries `tabindex`, so no element inside
  `#graph-container` ever enters the tab order.
- **Symptom:** a keyboard-only user can reach every toolbar and header control (asserted by
  `tests/e2e/accessibility.spec.ts` › `AA: keyboard reaches every control`), but cannot select a
  curve, select a point or move one — which is the whole point of the app. Selecting is mouse-only;
  the arrow keys and Delete only work once something _is_ selected.
- **Evidence:** a 16-step tab walk from a reset focus visits the header, the toolbar and the footer
  link, and never enters the canvas.
- **Not asserted by the suite:** the accessibility spec deliberately checks the _controls_;
  asserting canvas keyboard support would need the feature to exist first.
- **Fix direction:** give curves, handles and phase labels a `tabindex` plus a focus style, or offer
  a keyboard-accessible list-based way to choose a curve and point (a roving `tabindex` over
  `.point-handle` is the usual pattern). This needs a design decision rather than just markup.
- **Left open on purpose** (2026-10-17): both directions above are viable and the choice is a product
  decision — the item stays open rather than being guessed at. Everything else in this file is done.

---

## Coverage gaps (not product bugs)

- **The clipboard check is browser-aware.** `tests/e2e/boot-url.spec.ts` ›
  `copy link reproduces the current model` reads Chromium's real clipboard, because Playwright
  grants `clipboard-read` / `clipboard-write` there. Firefox cannot be granted those
  (`browser.newContext: Unknown permission: clipboard-read`), so it captures what the app hands to
  `navigator.clipboard.writeText` instead — see `spyOnClipboardWrites` in `tests/e2e/helpers.ts`.
  Both verify the URL a user would paste; only Chromium proves the OS clipboard accepted it. Nothing
  is skipped.
- **Visual baselines are machine- and browser-specific.** `tests/e2e/visual.spec.ts` seeds 20
  baselines (3 presets × 2 themes, 7 styles × 2 themes) under
  `tests/e2e/__screenshots__/{projectName}/…`. They describe today's rendering, so an intentional
  visual change means re-seeding with `npm run test:e2e:update` rather than hand-editing them.
- **The canvas itself is not keyboard-reachable** — see #11. The accessibility spec covers the
  controls (tab order, focus visibility, target size, labels, text spacing and reflow at 320px); it
  cannot yet cover canvas keyboard editing, because that feature does not exist.
- **`tests/unit/` covers pure logic only.** `render.ts`, `editor.ts`, `export-dialog.ts`,
  `style-state.ts`, `theme.ts` and `fonts.ts` have no direct component tests by design (they need a
  DOM); their behaviour is covered through the GUI tier instead.

---

## Notes for whoever picks this up

- **Randomised order is on purpose.** `vitest` shuffles files and tests (`vitest.config.ts` →
  `sequence.shuffle`), and the browser suite runs with `--shuffle` (`package.json` → `test:e2e`). A
  test that only passes in one particular order is coupled, not isolated — reproduce a specific run
  with `--shuffle <seed>` / `sequence.seed`.
- **Keep the worker pool small.** Two browser projects multiplied by Playwright's default worker
  count oversubscribes a dev machine and produces _false_ failures: unrelated tests time out on
  actionability (30s), and trace files race with `ENOENT`. `playwright.config.ts` pins `workers: 4`
  locally for this reason. If you see a burst of timeouts, re-run before diagnosing — and check a
  single spec in isolation (`npx playwright test --project=firefox <spec>`) before concluding it is
  a real browser difference.
- **Traps baked into the helpers** (all verified by real runs, all documented in
  `tests/e2e/helpers.ts`):
  - **Scrolling is the big one.** The page is _window_-scrollable (the document is ~1170px tall in a
    720px viewport) and the graph container itself never scrolls. Playwright's
    `scrollIntoViewIfNeeded` is a **no-op for SVG graphics elements in Firefox**, and
    `Element.scrollIntoView` will not move the window for them either — so clicks on the legend and
    the phase row were dispatched below the viewport, no event reached the page, and the tests
    looked like "the click did nothing" rather than failing. `elementCentre` now scrolls the window
    itself and throws if the point is still unreachable, so this class of bug fails loudly.
  - the URL sync is debounced 250 ms and deflates asynchronously, so the hash lands ~300 ms after an
    action; `waitForHashContaining('#p=')` can be satisfied by the _default_ model's write, so read
    the hash before an action and use `waitForHashChange`;
  - hover-revealed badges must be scrolled into view _before_ hovering — scrolling afterwards moves
    the row out from under the pointer and drops the hover;
  - the legend lists curves in **reverse paint order** (the curve painted last is row 0);
  - to select a specific curve, click its **peak** — every fill reaches the baseline, so a click
    over a lower curve is captured by a higher one drawn after it.
