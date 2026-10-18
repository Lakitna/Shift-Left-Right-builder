# Requirements → test traceability

The single list of user-facing requirements this test suite encodes, plus the map from each
requirement to the spec file and test names that cover it.

**Sources.** `PLAN.md` ("Design decisions, agreed with user, 2026-10-08") and the persisted project
notes for this repo provide the explicit requirements. Anything an ordinary user would expect from a
WYSIWYG graph builder but that was never written down is captured as an implicit requirement in the
same list. The repo owner is the final authority on any conflict.

**Two tiers.**

| Tier      | Tool                  | Location      | Encodes                                                                                    |
| --------- | --------------------- | ------------- | ------------------------------------------------------------------------------------------ |
| Component | vitest (`node` env)   | `tests/unit/` | The internal contract: types, invariants, validation, operation return values, edge cases. |
| GUI       | Playwright (chromium) | `tests/e2e/`  | The user-facing requirements below, driven through real browser interaction.               |

Component tests reference requirements too (a `REQ-xx` id in the `describe` name) where they cover
the internals behind one. Requirements that are purely about the rendered UI have no component
counterpart by design — the component tier is restricted to pure-logic modules.

**Expected failures.** The suite encodes _desired_ behavior, not a snapshot of today's behavior.
Where the code currently disagrees with the requirement, the test is expected to fail at handoff;
those cases are listed under each requirement as `(expected red)` with the current actual value.

---

## Requirements

### REQ-01 — Boot, default model and URL restore

- With no hash, the app opens on the **Schematic** preset.
- A `#p=` hash containing a valid model restores that model exactly.
- A `#p=` hash that is invalid, corrupt or from an incompatible version shows the warning banner
  ("The model data in the URL is invalid or from an incompatible version. The default model was
  loaded instead.") **and** loads the default model — never a partially-applied model.
- Changing the hash in the address bar re-loads the model without a page reload.
- `#s=` applies a shared visual style; an unknown style id is ignored rather than breaking the load.

### REQ-02 — Light/dark theme

- A header control toggles between light and dark.
- The choice is remembered across reloads.
- The theme is chrome, not model data: it never appears in the URL hash.

### REQ-03 — Visual style system

- Seven styles are offered: Classic, Draftsman, High contrast, Cartoon, De Stijl, Unicorn, Bartosz.
- Selecting a style repaints the graph in that style.
- The style travels in the `#s=` hash; it is omitted for Classic so links stay short.
- The style is remembered across reloads, and a style supplied in the URL wins over the remembered
  one.
- Every style must keep its contrast claims (see REQ-13).

### REQ-04 — Toolbar, presets, history and axis toggles

- Undo and redo are available from the toolbar and reflect whether an undo/redo is possible.
- A preset control applies Schematic, Detailed or Empty in one step and resets itself afterwards.
- Applying a preset clears any selection.
- A "Snap to phases" toggle constrains point dragging for the whole session.
- A "Numeric axis" toggle switches the y-axis between qualitative and numeric + gridlines.

### REQ-05 — Curve editing

- Clicking a curve selects it and reveals its control-point handles.
- A control point can be dragged freely in two dimensions.
- Holding Shift while dragging, or turning on "Snap to phases", locks the point's x to the nearest
  phase tick.
- Clicking an insert handle adds a point on the curve at that spot.
- A selected point can be deleted.
- Grabbing the curve body slides the whole curve horizontally, clamped to the plot.
- Curves can be added and removed, and the graph always keeps at least one.
- A curve's fill can be made smooth (spline) or straight (polyline).
- A curve's fill opacity is adjustable and curves stay translucent so overlaps blend.
- A curve can be sent backward / brought forward, and the selection follows the moved curve.
- A curve's color can be changed.

### REQ-06 — Phase editing

- The x-axis phases can be added and removed, and the axis always keeps at least one.
- Phase labels are editable in place.
- A phase label can be dragged horizontally to reorder the phases.
- Dragging a phase label out of the label row removes that phase.
- Phases are evenly spaced, and the internal phase boundaries are drawn at the band edges (a single
  phase draws no boundary separators).

### REQ-07 — Events (moments in time)

- An event can be added; it lands at the centre of the timeline.
- An event has an editable label and an editable note.
- An event can be dragged horizontally and snaps to phase _boundaries_ (not band centres) with Shift
  or the snap toggle.
- An event can be removed, and the graph keeps events sorted by position.
- Each event renders as a gate line through the plot with a callout above it, and the callout hugs
  the gate near the plot edges instead of overflowing.

### REQ-08 — Legend

- The legend sits below the graph with one row per curve: colour swatch, name and wrapped notes.
- A legend row's swatch opens a colour picker for that curve.
- Legend rows can be dragged to change the curve paint order.
- The legend is omitted from the graph when the export setting asks for no legend.

### REQ-09 — Inline WYSIWYG text editing

- Chart title, y-axis title, phase labels, curve labels, event labels/notes and curve notes are all
  edited in place on the canvas.
- Enter commits a single-line edit; Ctrl/Cmd+Enter commits a multi-line edit; Escape cancels; moving
  focus away commits.
- Editing must work from an ordinary mouse click (the click must not be swallowed).

### REQ-10 — Keyboard shortcuts

- Ctrl/Cmd+Z undoes; Ctrl/Cmd+Shift+Z and Ctrl/Cmd+Y redo.
- Arrow keys nudge the selected point by 1 unit; holding Shift nudges by 5.
- Delete/Backspace removes the selected point, or the selected curve when no point is selected.
- Escape closes the style menu first, then the share menu, then clears the selection.
- Shortcuts do nothing while a dialog is open, and arrow nudging does nothing while typing.

### REQ-11 — Sharing via URL

- The URL tracks the model as it is edited, without adding browser history entries.
- "Copy link" copies a URL that reproduces the current model and style.
- The compressed payload must not make a typical (note-heavy) model's URL longer than the raw model.
- Old, uncompressed links fail gracefully into REQ-01's banner + default model.

### REQ-12 — Export PNG / SVG

- Both exports open a dialog with a live preview and can be cancelled.
- Both dialogs expose: filename, light/dark, transparent background, include legend; PNG adds a
  target width.
- The typed filename is sanitised and given the right extension.
- The downloaded SVG is standalone, honours the theme / transparency / legend choices, and contains
  **no** editing overlays. The style's bundled faces are embedded as base64 `@font-face` data URIs so
  the file paints correctly offline. (Classic ships no faces — it uses the operating system's font
  stack — so its SVG legitimately carries none.)
- The downloaded PNG is rasterised at the requested width and honours the same choices, and the size
  the dialog advertises matches the file it produces.
- Dialog settings are remembered between uses.

### REQ-13 — Accessibility: WCAG 2.2 Level AA

The UI targets **WCAG 2.2 Level AA**. The success criteria that actually apply to a canvas-based
graph editor, and how this app is expected to satisfy them:

- **1.3.1 Info and relationships** — every control and text field exposes a real role and an
  accessible name (headings, `aria-label`s on icon buttons, `<label>`s on dialog fields).
- **1.4.1 Use of colour** — colour is never the only carrier of meaning. Curve identity is also
  carried by the label and the legend text, and the selected curve is also shown by its point
  handles and outline.
- **1.4.3 Contrast (minimum)** — text meets **4.5:1** against its ground, or **3:1** for large text
  (≥ 24px, or ≥ ~18.66px when bold) — in both the light and the dark theme.
- **1.4.11 Non-text contrast** — graphical objects that carry meaning (the curve fills) meet **3:1**
  against the canvas ground.
- **1.4.4 Resize text / 1.4.10 Reflow** — the app stays usable at 200% zoom and reflows to 320 CSS
  px wide without loss of function. The plot area itself is two-dimensional content that is
  essential to the meaning, so it keeps its aspect rather than reflowing.
- **1.4.12 Text spacing** — increasing line/letter/word spacing does not clip the labels.
- **2.1.1 Keyboard / 2.4.3 Focus order / 2.4.7 Focus visible** — every control is reachable and
  operable by keyboard, in a sensible order, with a visible focus indicator.
- **2.4.11 Focus not obscured (minimum)** — the focused control is not hidden behind the toolbar or
  an open menu.
- **2.5.8 Target size (minimum)** — every pointer target is at least **24 × 24 CSS px**, or has
  equivalent spacing so it can still be hit.
- **2.5.1 Pointer gestures** — nothing requires a path-based or multi-point gesture; every canvas
  gesture has a single-pointer equivalent.
- **3.3.1 Error identification / 3.3.2 Labels or instructions** — a failed export is announced, and
  every dialog field has a visible label.

**The High contrast style additionally targets WCAG 2.2 Level AAA where reasonable**, chiefly
**1.4.6 Contrast (enhanced)**: text at **7:1** (4.5:1 for large text). Ratios that AAA cannot reach
without wrecking the style's own visual language may stay at AA.

**House rules on top of AA** (stricter than WCAG requires — the owner has dyslexia):

- No all-caps text anywhere in the UI, including toolbar labels, menu entries and axis labels.
- Emphasis comes from weight and colour blocks rather than letter-spacing.

Where a house rule and a WCAG criterion disagree, the stricter of the two wins.

### REQ-14 — Visual regression baseline

- The rendered graph is captured for the three presets (light + dark) and for all seven styles
  (light + dark), so an unintended visual change is caught by review.

> Design note: the snapshots describe **the build as it exists today** — a characterization
> baseline, not a statement of desired behavior. When the upcoming refactor intentionally changes
> rendering, re-seed them deliberately with `npm run test:e2e:update`.

### REQ-Q — Quarantined: known-flaky real interactions

Recorded so the defect is visible rather than worked around silently. These are the only specs
allowed to use synthetic events.

- Clicking the SVG "+" (add event / add curve) with a real click can double-fire: the handler
  re-renders and detaches the element, the click times out, and a retried pointerdown can drag the
  new element to the click position.
- Header buttons (`Style:`, `Share`) can fail Playwright's actionability checks.

---

## Traceability

| REQ    | Spec / test file                    | Covering tests (by name)                                                                                                                                                                                                                                                                                                                                                                                 |
| ------ | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| REQ-01 | `tests/e2e/boot-url.spec.ts`        | `loads the Schematic preset with no hash`, `restores a shared model from #p=`, `shows the banner and the default model for an invalid hash`, `reloads the model on hashchange`, `applies a shared style from #s=`                                                                                                                                                                                        |
| REQ-01 | `tests/unit/url-state.test.ts`    | `round-trips every shipped preset`, `round-trips every non-default field`, `rejects a payload that is not valid compressed data`, `rejects a pre-release uncompressed link`, `rejects a payload from a different model version`, `rejects a payload that inflates but is not a valid model`                                                                                                              |
| REQ-01 | `tests/unit/presets.test.ts`        | `exposes Schematic, Detailed and Empty in that order`, `every preset satisfies the strict parseModel contract`                                                                                                                                                                                                                                                                                           |
| REQ-02 | `tests/e2e/theme-style.spec.ts`     | `toggles between light and dark`, `remembers the theme across a reload`                                                                                                                                                                                                                                                                                                                                  |
| REQ-03 | `tests/e2e/theme-style.spec.ts`     | `offers all seven styles`, `repaints when a style is chosen`, `travels in the URL`, `omits the style param for Classic`, `URL style beats the stored style`                                                                                                                                                                                                                                              |
| REQ-03 | `tests/unit/styles.test.ts`         | `keeps the seven public style ids in a stable order`, `isValidStyleId accepts exactly the registered ids`, `getStyle resolves a known id and falls back to Classic otherwise`                                                                                                                                                                                                                            |
| REQ-04 | `tests/e2e/toolbar-presets.spec.ts` | `applies each preset in one step`, `clears the selection when a preset is applied`, `undo and redo reflect availability`, `snap-to-phases constrains dragging`, `numeric axis adds gridlines`                                                                                                                                                                                                            |
| REQ-05 | `tests/e2e/curves.spec.ts`          | `selecting a curve reveals its handles`, `drags a point freely`, `snaps a point to the nearest phase with Shift`, `adds a point from the insert handle`, `deletes the selected point`, `slides the whole curve horizontally`, `adds and removes curves`, `toggles smooth and straight fills`, `changes fill opacity`, `reorders the paint order`, `picks a curve colour` |
| REQ-05 | `tests/unit/model.test.ts`          | `didAddCurve appends while below the cap and refuses at it`, `didRemoveCurve rejects an out-of-range index`, `didReorderCurve moves a curve and refuses no-op or out-of-range moves`, `didMoveCurve delegates to didReorderCurve and reports a no-op at the edge`, `didInsertPoint interpolates y from the neighbouring points when no y is given`, `didSetPoint clamps, re-sorts and keeps the dragged identity`, `cannot remove the last curve`             |
| REQ-06 | `tests/e2e/phases.spec.ts`          | `adds a phase at the end of the axis`, `removes a phase from its hover badge`, `never removes the last phase`, `renames a phase in place`, `reorders phases by dragging a label onto another tick`, `draws a separator on each internal phase boundary only`                                                                                                                                             |
| REQ-06 | `tests/unit/model.test.ts`          | `phasePositions returns the centre of each equal band`, `nearestPhaseX snaps to the closest band centre`, `phaseBoundaries spans the whole axis, edges included`, `nearestBoundaryX snaps an event to the closest phase edge`                                                                                                                                                                            |
| REQ-07 | `tests/e2e/events.spec.ts`          | `adds an event at the centre`, `edits the label and the note`, `snaps to phase boundaries`, `renders a gate line and a callout`, `hugs the gate near the plot edge`, `removes an event`                                                                                                                                                                                                                  |
| REQ-07 | `tests/unit/model.test.ts`          | `addEvent returns the created event at the centre and keeps events sorted`, `addEvent returns undefined at the cap`, `didRemoveEvent respects the minimum and rejects bad indexes`, `didSetEventX clamps, re-sorts and keeps the dragged identity`                                                                                                                                                      |
| REQ-08 | `tests/e2e/legend.spec.ts`          | `renders one row per curve below the graph`, `wraps the notes`, `opens a colour picker from the swatch`, `reorders curves by dragging rows`, `drops the legend when the export asks for it`                                                                                                                                                                                                              |
| REQ-09 | `tests/e2e/inline-edit.spec.ts`     | `edits the chart title`, `edits the y-axis title`, `edits a phase label`, `edits a curve label and note`, `commits on Enter, cancels on Escape, commits on blur`, `requires Ctrl+Enter for multi-line`                                                                                                                                                                                                   |
| REQ-10 | `tests/e2e/keyboard.spec.ts`        | `undoes and redoes`, `nudges the selected point`, `nudges by five with Shift`, `deletes a point then a curve`, `Escape closes menus before clearing the selection`, `does nothing while a dialog is open`                                                                                                                                                                                                |
| REQ-11 | `tests/e2e/boot-url.spec.ts`        | `tracks the model in the URL`, `copy link reproduces the model`, `the payload does not grow a note-heavy model`                                                                                                                                                                                                                                                                                          |
| REQ-11 | `tests/unit/url-state.test.ts`      | `omits fields that hold their default value but always writes both titles`, `always writes events, even when the model has none`, `compresses a note-heavy model below the size of its own JSON`, `leaks no unhandled rejection when a payload is corrupt`                                                                                                                                               |
| REQ-12 | `tests/e2e/export.spec.ts`          | `opens both dialogs with a live preview`, `cancelling downloads nothing`, `sanitises the filename and forces the extension`, `exports a standalone SVG, free of editing overlays`, `embeds the bundled fonts when the style brings its own`, `drops the legend only when the option is unchecked`, `honours the colour mode and the transparency option`, `exports a PNG at the requested width`, `exports a PNG of exactly the size the dialog promises`, `remembers the dialog settings for the next export` |
| REQ-12 | `tests/unit/settings.test.ts`       | `clampPngWidth keeps a value already inside the range`, `clampPngWidth clamps below the minimum and above the maximum`, `clampPngWidth rounds to a whole pixel`, `clampPngWidth falls back to the default for non-finite input`, `declares a sane 120..8000 range around a 1500 default`                                                                                                                 |
| REQ-12 | `tests/unit/ui.test.ts`             | `trims surrounding whitespace`, `strips path separators and reserved characters`, `falls back when nothing usable is left`, `appends the expected extension when it is missing`, `keeps an existing extension, comparing case-insensitively`                                                                                                                                                             |
| REQ-13 | `tests/e2e/accessibility.spec.ts`   | `AA: keyboard reaches every control`, `AA: the focus indicator is visible`, `AA: every pointer target is at least 24x24`, `AA: text spacing changes do not clip the labels`, `AA: icon-only buttons expose an accessible name`, `AA: every dialog field has a visible label`, `AA: colour is never the only carrier of meaning`, `AA: the page reflows at 320px without sideways scrolling`, `house rule: no all-caps text anywhere in the UI` |
| REQ-13 | `tests/unit/validate.test.ts`       | `AA: every style reaches 4.5:1 on normal text and 3:1 on large text`, `AA: every shipped style keeps its non-text contrast claims`, `AAA: the high contrast style reaches 7:1 on normal text and 4.5:1 on large text`                                                                                                                                                                                    |
| REQ-14 | `tests/e2e/visual.spec.ts`          | one per combination: `preset {Schematic, Detailed, Empty} in {light, dark}` and `style {classic, draftsman, contrast, toon, de-stijl, unicorn, bartosz} in {light, dark}` — 20 baselines, seeded with `npm run test:e2e:update` |
| REQ-Q  | `tests/e2e/quarantine.spec.ts`      | `an element click on the SVG "+" completes exactly once`, `the same click with raw mouse input adds exactly one event`, `a header menu is opened programmatically`                                                                                                                                                                                                                                        |
| —      | `tests/unit/history.test.ts`        | Supports REQ-04/REQ-10: `treats a repeated push of the same model as a no-op`, `steps back and forward over recorded states`, `drops the redo tail when a new state is pushed after an undo`, `caps the history at 100 states and returns undefined past the oldest`, `reset collapses the history to a single state`, `hands back a detached model, not a live reference into the history`                   |
| —      | `tests/unit/model.test.ts`          | Supports REQ-01: `parseModel is strict`, `cloneModel normalises optional fields`                                                                                                                                                                                                                                                                                                                         |
