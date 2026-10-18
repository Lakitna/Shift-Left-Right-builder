# Shift-Left-Right Graph Model Builder — Plan

A dependency-free vanilla TypeScript + SVG web app (same stack and infra as
`C:\code\test-pyramid-builder`) for building a **graph-based shift-left / shift-right model**:
translucent area **curves** over an editable SDLC-phase **x-axis** and a testing/quality-effort
**y-axis** ("Test volume"). Curves are edited as **free control points**, with an easy constraint
that snaps a point's horizontal position to the nearest phase tick. Ships **Schematic + Detailed**
presets to span a range of complexities. Exports PNG/SVG and shares the whole model via the URL
hash.

## Design decisions (agreed with user, 2026-10-08)

- **Editing primitive:** free control points. A point's **X snaps to the nearest phase tick** while
  holding **Shift** during a drag, or whenever a global **"Snap to phases"** toolbar toggle is on.
  This realizes "one fixed control point per phase" without a separate mode. (Default = fully free
  2D.)
- **X-axis phases:** editable labels, add/remove; evenly spaced ticks. Curves keep their shape when
  phases change (points are stored as a % of plot width, independent of phase count).
- **Curves:** start with 3 (Shift-left, Traditional, Shift-right); add/remove freely.
- **Editable elements:** curve labels (in-canvas), curve colors, Y-axis title, X-axis phase labels,
  chart title, per-curve notes/legend. The top "↔" spectrum indicator is **omitted**.
- **Y-axis:** toggle between qualitative (label + arrowheads) and numeric (+ gridlines, tick
  labels).
- **Visual styles:** a single clean style first (system font stack — the `@fontsource` pipeline is
  deferred). Light/dark theme via CSS variables. Kept pluggable so a full style system can return.
- **Overlap:** translucent fills so colors blend where curves cross.
- **Legend:** below the graph (one row per curve: swatch + name + wrapped notes).
- **Export/share:** PNG + SVG download and a shareable URL hash (`#p=`), same as the reference.
- **Presets:** Schematic + Detailed, with the architecture (a `PRESETS` array + `cloneModel`) ready
  to add more later.

## Data model (`src/model.ts`)

```ts
interface CurvePoint {
  x: number;
  y: number;
} // both 0..100
interface Curve {
  label: string; // in-canvas near the peak + legend
  color: string; // #rrggbb
  notes: string; // legend text
  points: CurvePoint[]; // sorted by x, MIN_POINTS..MAX_POINTS
  smooth: boolean; // Catmull-Rom spline vs straight polyline
  opacity: number; // fill opacity for translucent overlap, 0..1
}
interface Phase {
  label: string;
} // position = evenly spaced index
interface GraphModel {
  version: number;
  title?: string; // chart title (top)
  yAxisTitle?: string; // e.g. "Test volume"
  numericAxis: boolean; // qualitative <-> numeric + gridlines
  phases: Phase[]; // add/remove, editable labels
  curves: Curve[]; // drawn in order (later on top)
}
```

- Area for a curve = the (smooth) path through its points, closed down to the baseline (y=0).
- **URL wire format (version 1, in `url-state.ts`)** is a compact view of the same model: phases are
  plain strings, points are `[x, y]` tuples, and default-valued fields are omitted (empty
  title/yAxisTitle/notes, `numericAxis: false`, `smooth: true`, default opacity). The in-memory
  model keeps its explicit object shape — only the encoding is compact.
- `PALETTE`, `PRESETS`, `cloneModel`, `parseModel` (validation), and ops: add/remove curve,
  add/remove/move point, add/remove/rename phase, reorder curves, `snapPointToPhase`. (Types +
  constants + `cloneModel` + `parseModel` land in Phase A; presets + ops in Phase B.)

## Rendering (`src/render.ts` — new, Phase B)

- `renderGraphSvg(model, opts) -> <svg>`; reuse `serializeSvg(svg, { embedFontCss })`.
- Layout bands: title (top) -> plot area -> phase labels (bottom) -> legend (below); Y-axis title
  rotated on the left.
- Axes: baseline + Y-axis line. When `numericAxis`: horizontal gridlines at 0/25/50/75/100 + tick
  labels; otherwise arrowheads + a qualitative "Test volume" caption. Phase ticks = faint vertical
  lines + centered labels.
- Curves drawn in order with `fill-opacity` so overlaps blend; stroke the top line; place each curve
  label at its peak (clamped inside the plot). Legend below = one row per curve.
- Reuse `wrapToWidth` / `textWidth` / `svgEl` helpers from the reference `render.ts`.

## Editing (`src/editor.ts` — rewrite, reuse interaction patterns, Phase C)

- Toolbar above the canvas: undo/redo, Preset…, Add curve, Delete curve, curve color picker, smooth
  toggle, Add/Remove phase, Numeric-axis toggle, Snap-to-phases toggle. Selection-dependent controls
  disable without a selection.
- Click a curve fill to select it (highlight + show its control points as draggable handles).
- Drag a point = free 2D; Shift-drag or Snap-toggle = lock X to the nearest phase tick.
- Add a point: "+" on segment midpoints / double-click the curve. Delete a point: select + Del.
- Inline single-click text editing (reuse the overlay-input pattern) for chart title, Y-axis title,
  phase labels, curve labels, and curve notes.
- Keyboard: `Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y`, `Del`/`Backspace`, `Esc` deselect (suppressed
  while typing).

## Wiring (`src/index.ts` — reuse, Phase C)

- Boot from `#p=` (valid -> load; invalid -> warning banner + Schematic default). Debounced URL sync
  via `history.replaceState`. JSON-snapshot undo/redo (cap 100). Theme init. No style menu in v1.

## Infra — copy near-verbatim (rename symbols/keys), Phase A

- `package.json` (drop `@fontsource` + font-build deps), `tsconfig.json`, `tsdown.config.ts` (entry
  `{ app: 'src/index.ts' }` -> `dist/web/app.js`; copy `index.html` + `styles.css`),
  `scripts/serve-web.mjs`, `.prettierrc` / `.editorconfig` / `.gitignore` / `.prettierignore`,
  `.vscode/*`.
- `src/theme.ts` (light/dark, `localStorage` key `shift-left-right-theme`), `src/url-state.ts`
  (base64url JSON in `#p=`).
- **Drop for v1:** the 7-style `styles/` system and the `fonts.ts` + `scripts/build-font.mjs` +
  `fonts/` pipeline (use a system font stack).

## Phases

- **Phase A — Scaffold:** copy infra + config + scripts; add `theme.ts`, `url-state.ts`, and the
  `model.ts` type contract (types, constants, `cloneModel`, `parseModel`). Verify `tsc --noEmit`.
- **Phase B — Model & render:** finish `model.ts` (PALETTE presets, PRESETS, curve/point/phase ops,
  `snapPointToPhase`); write `render.ts` (axes, gridlines, phase ticks, smooth area curves, labels,
  below-legend).
- **Phase C — Editor & wiring:** write `editor.ts` (select, drag points, snap, add/remove
  point/curve/phase, inline text edit, toolbar); `index.ts` (boot/URL/history/keyboard/export
  wiring); `index.html` + `styles.css`; port `export.ts` + export dialogs.
- **Phase D — Presets & polish:** author Schematic (matches the attached example) + Detailed
  (per-phase points, numeric axis, notes) + Empty presets; contrast/dark/dyslexia pass.

## Verification

1. `npm install && npm run build` -> `dist/web/` has `app.js`, `index.html`, `styles.css`.
2. `npm run serve:web` (from repo root) -> open URL -> Schematic preset renders like the example.
3. Select a curve -> handles; free vs Shift/snap drag; add/remove curve, phase, point.
4. Inline-edit title / y-label / phase labels / curve labels / notes. Toggle numeric axis ->
   gridlines.
5. Undo/redo, `Del`, `Esc` behave; URL updates live; reload restores; garbage hash -> banner +
   default.
6. Export `.svg` (standalone, no selection UI) and `.png` at 2x; light/dark honored.

## Accessibility / user constraints (owner has dyslexia)

- No all-caps anywhere; mixed case, bold weight + color blocks for emphasis.
- No acid/neon yellow accents; Klein-blue accent (`#002fa7` light / `#6c8cff` dark).
- Simplest direct implementation: if a feature fits an existing extension point, add the case.

## Further considerations (defer / confirm)

1. Whole-curve drag (grab the body to slide a curve) — v1 or later?
2. Per-curve opacity editable vs a fixed translucent value for v1.
3. Custom typefaces via the `@fontsource` pipeline (deferred to a later style pass).

## Status — all phases complete (2026-10-08)

Phases A–D are implemented and validated in the browser (light + dark). `npm run build` passes
(tsc + tsdown → `dist/web/app.js` ≈ 35 kB, zero runtime deps).

- **A Scaffold**: build/serve/config infra, `theme.ts`, `url-state.ts`, `model.ts` type contract.
- **B Model & render**: presets (Schematic/Detailed/Empty), curve/point/phase ops, snapping,
  `style.ts`, `render.ts` (axes, gridlines, phase ticks, translucent Catmull-Rom curves,
  below-legend).
- **C Editor & wiring**: `editor.ts` (select, free + Shift/snap drag, insert/delete points,
  add/remove curve/phase, inline text editing, toolbar), `index.ts` (history, keyboard, share,
  export dialogs), `index.html`, `styles.css`, `export.ts` (PNG/SVG).
- **D Polish**: per-curve opacity slider, curve z-order buttons (selection follows the moved curve),
  whole-curve horizontal drag via the top line, arrow-key point nudge, focus-visible outlines.

Run it: `npm run build` then `npm run serve:web` (default port 8080; pass another if busy).
