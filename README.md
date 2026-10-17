# Shift-Left-Right-builder

A WYSIWYG builder for shift-left / shift-right quality models: edit the graph in the browser, share
it as a URL, and export it as PNG or SVG. The whole model lives in the page URL.

## Development

```sh
npm install
npx playwright install chromium firefox   # only needed to run the GUI tests

npm start        # rebuild on change (tsdown --watch)
npm run serve:web   # serve dist/web on http://localhost:8080
```

The app is build-then-serve rather than a dev server: `npm start` writes to `dist/web` and
`npm run serve:web` serves that directory. Run the two in separate terminals.

## Testing

Two tiers, both runnable from the repo root. Start with both:

```sh
npm test
```

### Component tier — `tests/unit/` (vitest)

```sh
npm run test:unit          # one shot
npm run test:unit:watch
```

Covers the **pure-logic modules only** — `model` (parsing, clamping, all the curve/phase/event
operations), `presets`, `history`, the `urlState` wire format, the style registry and its WCAG
contrast maths, the settings validators and the `ui` string helpers.

These deliberately run in the plain `node` environment with no DOM: if a module needs `window` or
`localStorage`, its behaviour belongs to the GUI tier instead. That keeps this tier fast and free of
mocks. It runs in a shuffled order on every run (see _Randomisation_ below).

### GUI tier — `tests/e2e/` (Playwright, Chromium + Firefox)

```sh
npm run test:e2e           # randomised order, both specs and files
npm run test:e2e:update    # re-seed the visual baselines
```

Covers everything that needs a real browser: boot and URL restore, the theme and style system, the
toolbar and presets, curve/phase/event/legend editing, inline text editing, keyboard shortcuts, the
export dialogs with **real downloads**, the WCAG 2.2 AA checks a browser can perform, and a visual
regression baseline (3 presets × 2 themes, 7 styles × 2 themes).

### Randomisation

Both tiers shuffle on every run:

- vitest — `sequence.shuffle` in `vitest.config.ts`;
- Playwright — `--shuffle` in the `test:e2e` script.

A test that only passes in one particular order is coupled to another test rather than isolated, and
shuffling is what makes that visible. To reproduce a run exactly, pass a seed:

```sh
npx playwright test --shuffle=1234
npx vitest run --sequence.seed=1234
```

### Visual baselines

Snapshots live next to the spec that owns them, one folder per browser
(`tests/e2e/__screenshots__/{projectName}/…`), because Chromium and Firefox rasterise differently
and must not share a baseline. They describe **the build as it exists today** — a characterisation
baseline, not a statement of desired behaviour. When a change is meant to alter rendering, re-seed
deliberately:

```sh
npm run test:e2e:update
```

### Firefox

Firefox runs as a second project alongside Chromium, so `npm run test:e2e` covers both — currently
202 tests. Visual baselines are **per browser**, so a new visual test needs seeding for Firefox too:

```sh
npx playwright test --project=firefox tests/e2e/visual.spec.ts --update-snapshots
```

Keep the worker pool small (`playwright.config.ts` pins it deliberately). Each project starts its
own browsers, and Firefox begins crashing its renderer and timing out on downloads once a dozen
instances run at once — failures that look real but are pure contention. If you see a burst of
actionability timeouts or a `RenderCompositorSWGL` crash, re-run before diagnosing.

### Reference

- **`tests/REQUIREMENTS.md`** — the requirement list (REQ-01…REQ-14) plus the map from each
  requirement to the specs that cover it. Requirement ids also appear in the `describe()` names, so
  `npx playwright test -g REQ-05` runs one requirement.
- **`ISSUES.md`** — the open-bug handover list: what is broken, where, which test demonstrates it,
  and how to fix it.

### Conventions

- The suites assert **desired** behaviour, so a red test is a real finding rather than a stale
  expectation. Known defects are either left red deliberately or marked with `test.fail(...)` and
  listed in `ISSUES.md`, so a green run still means what it says.
- Assert on what a **user** can observe. The GUI suite drives the graph with real `page.mouse` input
  and reads real downloaded bytes, rather than poking at internal state.
- `tests/e2e/helpers.ts` carries the app-specific traps (scrolling below the fold, the debounced URL
  sync, selecting a specific curve) — read it before adding an interaction test.
