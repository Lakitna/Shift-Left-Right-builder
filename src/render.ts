/**
 * Style-driven SVG renderer for the shift-left / shift-right graph.
 *
 * Everything visual comes from the active `GraphStyle`: colors, typography, fills (solid,
 * hatched or gradient), hand-drawn jitter, label treatment, frame and sparkles. The same
 * element is used for the on-page canvas and for both export formats, so all styling is
 * baked into SVG attributes and the exports render a fresh SVG from the model (never the
 * editing overlays).
 *
 * `computeLayout` centralizes all geometry (plot rect, phase tick positions, event callout
 * band, legend rows) and is exported so the editor can place control-point handles and
 * hit-test without duplicating math.
 */

import { addBadge, removeBadge, SVG_NS, svgElement, textElement } from './dom';
import {
    MAX_CURVES,
    MAX_EVENTS,
    phaseBoundaries,
    phasePositions,
    type Curve,
    type CurvePoint,
    type GraphEvent,
    type GraphModel,
} from './model';
import { getActiveStyle } from './style-state';
import type {
    CanvasPalette,
    GraphStyle,
    PatternName,
    StyleFills,
    StyleGradient,
    StyleJitter,
    StyleRole,
} from './styles/types';

export interface RenderOptions {
    style?: GraphStyle;
    dark: boolean;
    /**
    Editing canvas keeps full layout (placeholders); exports collapse empty title/legend.
    */
    editing?: boolean;
    transparentBackground?: boolean;
    attribution?: boolean;
    /**
    Exports may drop the legend block entirely; the editing canvas always shows it.
    */
    includeLegend?: boolean;
}

interface Pt {
    x: number;
    y: number;
}

export interface LegendRow {
    top: number;
    height: number;
    label: string;
    noteLines: string[];
}

/**
How a callout's text is anchored to its gate line, depending on how close the gate is to an edge.
*/
export type CalloutAnchor = 'start' | 'middle' | 'end';

/**
 * Decide where an event callout's text sits relative to its gate line. A callout centred on the
 * gate would overflow the plot near the left/right edges (and drift away from the line), so there
 * it flips to hug the gate: left-aligned just right of the line on the left edge, right-aligned
 * just left of the line on the right edge. Returns the SVG `text-anchor` and the x to draw at.
 */
export function calloutAnchor(
    gateX: number,
    plotX0: number,
    plotX1: number,
    maxWidth: number
): { anchor: CalloutAnchor; textX: number } {
    const half = maxWidth / 2;
    const pad = 4;
    if (gateX < plotX0 + half) return { anchor: 'start', textX: gateX + pad };
    return gateX > plotX1 - half
        ? { anchor: 'end', textX: gateX - pad }
        : { anchor: 'middle', textX: gateX };
}

/**
A laid-out event callout: its gate x and the wrapped label/note lines drawn above the plot.
*/
export interface EventCallout {
    /**
    Model x (0..100) of the event, for the gate line.
    */
    x: number;
    /**
    How the label + note are anchored to the gate (see {@link calloutAnchor}).
    */
    anchor: CalloutAnchor;
    /**
    Pixel x the label + note are drawn at (the gate x, nudged inward near the edges).
    */
    textX: number;
    label: string;
    noteLines: string[];
}

export interface GraphGeom {
    width: number;
    height: number;
    /**
    Y of the frame's bottom border; equals height when no attribution strip is reserved.
    */
    frameBottom: number;
    plotX0: number;
    plotY0: number;
    plotX1: number;
    plotY1: number;
    plotWidth: number;
    plotHeight: number;
    baselineY: number;
    /**
    Pixel x of each phase tick, in phase order.
    */
    phaseXs: number[];
    phaseLabelY: number;
    /**
    Pixel x of each event gate, in event order.
    */
    eventXs: number[];
    /**
    Laid-out event callouts (label + wrapped note), in event order.
    */
    eventCallouts: EventCallout[];
    /**
    Baseline y of the event label line, and the top of the first note line (both above the plot).
    */
    eventLabelY: number;
    eventNoteTop: number;
    legendX: number;
    legendWidth: number;
    legendRows: LegendRow[];
    /**
    Y where the legend rows end (before any editor-only "+ Add curve" row).
    */
    legendBottom: number;
    style: GraphStyle;
    palette: CanvasPalette;
    dark: boolean;
    toPx(x: number, y: number): Pt;
    fromPx(px: number, py: number): Pt;
}

const round = (n: number): number => Math.round(n * 100) / 100;

// --- Text measurement --------------------------------------------------------

/**
 * Lazily created 2D context reused for text measurement. Creating the canvas is DOM work, so it is
 * deferred until the first measurement; a browser without a 2D context caches `null` so it is only
 * asked once. The context lives in a closure because module-level state must not be reassigned from
 * inside a function.
 */
const getMeasureContext = (() => {
    let context: CanvasRenderingContext2D | null | undefined;
    return (): CanvasRenderingContext2D | null | undefined => {
        if (context === undefined) {
            context = document.createElement('canvas').getContext('2d');
        }
        return context;
    };
})();

function textWidth(text: string, font: string): number {
    const context = getMeasureContext();
    if (context === null || context === undefined) {
        return text.length * 8;
    }
    context.font = font;
    return context.measureText(text).width;
}

/**
The role's primary family (when set) followed by the style's fallback stack.
*/
function fontStack(style: GraphStyle, role: StyleRole): string {
    const r = style.typography.roles[role];
    return r.family === ''
        ? style.typography.fallback
        : `${r.family}, ${style.typography.fallback}`;
}

/**
Canvas `measureText`-compatible font spec for a role.
*/
function fontSpec(style: GraphStyle, role: StyleRole): string {
    const r = style.typography.roles[role];
    return `${String(r.weight)} ${String(r.size)}px ${fontStack(style, role)}`;
}

/**
 * Greedy word wrap by MEASURED width. `\n` are explicit breaks; blank lines are kept so they
 * reserve vertical space; overlong words are hard-broken. Returns [] for empty text.
 */
function wrapText(text: string, maxWidth: number, font: string): string[] {
    const lines: string[] = [];
    if (text === '') return lines;
    for (const paragraph of text.split('\n')) {
        if (paragraph === '') {
            lines.push('');
            continue;
        }
        let current = '';
        const flush = (): void => {
            if (current === '') {
                return;
            }

            lines.push(current);
            current = '';
        };
        const words = paragraph.split(/\s+/).filter((w) => w !== '');
        for (const word of words) {
            const candidate = current === '' ? word : current + ' ' + word;
            if (textWidth(candidate, font) <= maxWidth) {
                current = candidate;
                continue;
            }
            flush();
            if (textWidth(word, font) <= maxWidth) {
                current = word;
                continue;
            }
            let chunk = '';
            for (const ch of word) {
                if (chunk !== '' && textWidth(chunk + ch, font) > maxWidth) {
                    lines.push(chunk);
                    chunk = ch;
                } else {
                    chunk += ch;
                }
            }
            current = chunk;
        }
        flush();
    }
    return lines;
}

// --- Deterministic noise (hand-drawn jitter + sparkles) -----------------------

function mulberry32(a: number): () => number {
    return () => {
        // `a` is only ever read through 32-bit bitwise operators below, so truncating here (instead
        // of wrapping to int32) produces exactly the same stream.
        a = Math.trunc(a);
        a = Math.trunc(a + 0x6D_2B_79_F5);
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
        return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
    };
}

function hashNumbers(nums: number[]): number {
    let h = 2_166_136_261;
    for (const n of nums) {
        h = Math.imul(h ^ Math.round(n), 16_777_619);
    }
    return h >>> 0;
}

/**
 * Smooth 1D noise: a few sine harmonics with random frequency and phase, normalized to
 * [-1, 1]. Independent per-point randomness reads as sawtooth; a band-limited sum flows
 * like an actual hand stroke even at large amplitudes.
 */
function smoothNoise(seed: number): (t: number) => number {
    const rand = mulberry32(seed);
    const waves = [
        { a: 1, f: 0.7 + rand() * 0.6 },
        { a: 0.5, f: 1.9 + rand() * 1.1 },
        { a: 0.22, f: 3.4 + rand() * 1.6 },
    ];
    const phases = waves.map(() => rand() * Math.PI * 2);
    const norm = waves.reduce((sum, w) => sum + w.a, 0);
    return (t) =>
        waves.reduce(
            (sum, w, index) => sum + w.a * Math.sin(2 * Math.PI * w.f * t + phases[index]),
            0
        ) / norm;
}

// --- Fills --------------------------------------------------------------------

export interface CurvePattern {
    name: PatternName;
    color: string;
}

/**
 * The hatch this curve shows (name + effective color), or undefined when the curve is not
 * pattern-filled. Color: the style pattern's pencil color, falling back to ink. A curve
 * with a custom picked color is always solid — the hatch cycle skips it.
 */
export function effectiveCurvePattern(
    style: GraphStyle,
    curve: Curve,
    index: number,
    ink: string
): CurvePattern | undefined {
    if (curve.colorCustom === true) return undefined;
    if (style.fills.mode === 'pattern') {
        const entry = style.fills.patterns[index % style.fills.patterns.length];
        return { name: entry.name, color: entry.color ?? ink };
    }
    return undefined;
}

/**
The gradient this curve shows, or undefined when it is not a gradient fill.
*/
export function effectiveCurveGradient(
    style: GraphStyle,
    curve: Curve,
    index: number
): StyleGradient | undefined {
    if (curve.colorCustom === true) return undefined;
    if (style.fills.mode === 'gradient') {
        const gradients = style.fills.gradients ?? [];
        return gradients.length === 0 ? undefined : gradients[index % gradients.length];
    }
    return undefined;
}

/**
 * Effective area fill for a curve. Priority: custom solid color > style hatch cycle >
 * style gradient cycle > style palette positional > stored data color. Returns a hex,
 * `url(#graph-pat-{i})`, `url(#graph-grad-{i})`, or 'none' (a colorless paper curve).
 * Exported so the editor can update fills surgically without a re-render.
 */
export function effectiveCurveFill(
    style: GraphStyle,
    curve: Curve,
    index: number,
    isDark: boolean
): string {
    if (curve.colorCustom === true || style.curves.colorSource === 'data') return curve.color;
    const ink = (isDark ? style.canvas.dark : style.canvas.light).ink;
    const pattern = effectiveCurvePattern(style, curve, index, ink);
    if (pattern !== undefined) {
        return pattern.name === 'none' ? 'none' : `url(#graph-pat-${String(index)})`;
    }
    if (effectiveCurveGradient(style, curve, index) !== undefined) {
        return `url(#graph-grad-${String(index)})`;
    }
    const palette = isDark ? style.curves.palette.dark : style.curves.palette.light;
    return palette[index % palette.length] ?? curve.color;
}

/**
 * A plain hex standing in for the curve's fill — what a legend swatch (and the color
 * picker seed) should show, since patterns/gradients cannot tint a 16px box meaningfully.
 */
export function effectiveCurveSwatchColor(
    style: GraphStyle,
    curve: Curve,
    index: number,
    isDark: boolean
): string {
    if (curve.colorCustom === true || style.curves.colorSource === 'data') return curve.color;
    const palette = isDark ? style.curves.palette.dark : style.curves.palette.light;
    return palette[index % palette.length] ?? curve.color;
}

/**
One hatch tile, addressed by a per-curve id so each curve can carry its own pencil color.
*/
function patternElement(
    id: string,
    name: PatternName,
    color: string,
    fills: StyleFills
): SVGPatternElement {
    const s = fills.patternSpacing;
    const w = fills.patternStroke;
    const op = fills.patternOpacity;
    const pattern = svgElement('pattern', {
        id,
        width: s,
        height: s,
        patternUnits: 'userSpaceOnUse',
    });
    if (name === 'dots') {
        pattern.append(
            svgElement('circle', {
                cx: s / 2,
                cy: s / 2,
                r: Math.max(1, w * 1.1),
                fill: color,
                opacity: op,
            })
        );
    } else {
        const spacing = String(s);
        const halfNeg = String(-s / 2);
        const halfPos = String(s / 2);
        const oneAndHalf = String(s * 1.5);
        const d45 = `M0 ${spacing} L${spacing} 0 M${halfNeg} ${halfPos} L${halfPos} ${halfNeg} M${halfPos} ${oneAndHalf} L${oneAndHalf} ${halfPos}`;
        const d135 = `M0 0 L${spacing} ${spacing} M${halfNeg} ${halfPos} L${halfPos} ${oneAndHalf} M${halfPos} ${halfNeg} L${oneAndHalf} ${halfPos}`;
        const dH = `M0 ${halfPos} L${spacing} ${halfPos}`;
        let d = dH;
        switch (name) {
            case 'diag45': {
                d = d45;
                break;
            }
            case 'diag-45': {
                d = d135;
                break;
            }
            case 'cross': {
                d = `${d45} ${d135}`;
                break;
            }
        }
        pattern.append(
            svgElement('path', { d, stroke: color, 'stroke-width': w, opacity: op, fill: 'none' })
        );
    }
    return pattern;
}

/**
Pattern AND gradient defs are PER CURVE (ids graph-pat-{i} / graph-grad-{i}).
*/
function fillDefs(style: GraphStyle, ink: string, model: GraphModel): SVGDefsElement | undefined {
    const defs = svgElement('defs', {});
    let isAny = false;
    for (const [index, curve] of model.curves.entries()) {
        const pattern = effectiveCurvePattern(style, curve, index, ink);
        if (pattern !== undefined && pattern.name !== 'none') {
            isAny = true;
            defs.append(
                patternElement(`graph-pat-${String(index)}`, pattern.name, pattern.color, style.fills)
            );
        }
        const gradient = effectiveCurveGradient(style, curve, index);
        if (gradient === undefined) continue;
        isAny = true;
        const grad = svgElement('linearGradient', {
            id: `graph-grad-${String(index)}`,
            x1: '0%',
            y1: '0%',
            x2: '100%',
            y2: '100%',
        });
        for (const [stopIndex, color] of gradient.stops.entries()) {
            const offset =
                gradient.stops.length === 1
                    ? 0
                    : (stopIndex / (gradient.stops.length - 1)) * 100;
            const offsetPercent = `${String(Math.round(offset))}%`;
            grad.append(svgElement('stop', { offset: offsetPercent, 'stop-color': color }));
        }
        defs.append(grad);
    }
    return isAny ? defs : undefined;
}

// --- Layout ------------------------------------------------------------------

export function computeLayout(model: GraphModel, options: RenderOptions): GraphGeom {
    const style = options.style ?? getActiveStyle();
    const palette = options.dark ? style.canvas.dark : style.canvas.light;
    const L = style.layout;
    const R = style.typography.roles;

    const hasTitle = (model.title ?? '').trim() !== '';
    // The editing canvas always reserves the title band so the layout does not jump while the
    // title is being typed; exports collapse it when empty.
    const titleBand = hasTitle || options.editing ? L.titleSpace + L.titleGap : 0;

    const plotX0 = L.margin.left;
    const plotWidth = L.plotWidth;
    const plotX1 = plotX0 + plotWidth;

    // Event callout band above the plot: the tallest callout (label line + wrapped note lines)
    // sets its height and pushes the plot down. Empty when there are no events; in edit mode a
    // band with at least one event reserves a single line so the plot does not jump when a note is
    // first typed. Notes are wrapped once here and reused by the renderer.
    const eventNoteFont = fontSpec(style, 'eventNote');
    const eventLabelLineH = R.eventLabel.size + 6;
    const eventCallouts: EventCallout[] = model.events.map((event: GraphEvent) => {
        // Use the raw horizontal map, NOT `toPx` — `toPx` is declared further down (it closes over
        // `baselineY`, which the band height below has not fixed yet), so calling it there is a TDZ
        // error. Horizontally toPx(x,0).x is just plotX0 + (x/100)*plotWidth.
        const gateX = plotX0 + (event.x / 100) * plotWidth;
        const { anchor, textX } = calloutAnchor(gateX, plotX0, plotX1, L.eventCalloutMaxWidth);
        return {
            x: event.x,
            anchor,
            textX,
            label: event.label,
            noteLines: wrapText(event.note, L.eventCalloutMaxWidth, eventNoteFont),
        };
    });
    let eventBand = 0;
    if (model.events.length > 0) {
        const tallest = Math.max(
            ...eventCallouts.map(
                (callout) => eventLabelLineH + callout.noteLines.length * R.eventNote.lineHeight
            )
        );
        const reserved = options.editing ? Math.max(tallest, eventLabelLineH) : tallest;
        eventBand = L.eventLabelGap + reserved + L.eventBandPad;
    }

    const plotY0 = L.margin.top + titleBand + eventBand;
    const plotHeight = L.plotHeight;
    const plotY1 = plotY0 + plotHeight;
    const baselineY = plotY1;

    const toPx = (x: number, y: number): Pt => ({
        x: plotX0 + (x / 100) * plotWidth,
        y: baselineY - (y / 100) * plotHeight,
    });
    const fromPx = (px: number, py: number): Pt => ({
        x: ((px - plotX0) / plotWidth) * 100,
        y: ((baselineY - py) / plotHeight) * 100,
    });

    const phaseXs = phasePositions(model.phases.length).map((position) => toPx(position, 0).x);
    const phaseLabelY = plotY1 + L.phaseLabelGap;

    // Event geometry: gate x per event, plus the label/note baselines inside the band above the
    // plot. The leader tick runs from the callout block's bottom down toward the plot top.
    const eventXs = model.events.map((event) => toPx(event.x, 0).x);
    const eventLabelY = L.margin.top + titleBand + L.eventLabelGap;
    const eventNoteTop = eventLabelY + 6;

    // Legend block below the phase labels. Rows are laid out in DISPLAY order (front-most curve
    // first), matching how renderGraphSvg paints them; consumers index this array by display slot.
    // Exports can drop the whole block (includeLegend false); the editor always keeps it.
    const legendX = plotX0;
    const legendWidth = plotWidth - (L.legendSwatch + L.legendSwatchGap) - L.legendRemoveZone;
    const noteFont = fontSpec(style, 'legendNote');
    const labelLineH = R.legendLabel.size + 6;
    const noteLineH = R.legendNote.lineHeight;
    const phaseBottom = phaseLabelY + (R.phaseLabel.size + 6);
    const isIncludeLegend = options.includeLegend ?? true;
    const legendTop = isIncludeLegend ? phaseBottom + L.legendGap : phaseBottom;

    let cursor = legendTop;
    const legendRows: LegendRow[] = isIncludeLegend
        ? model.curves.keys().toArray().toReversed().map((curveIndex) => {
              const curve = model.curves[curveIndex];
              const noteLines = wrapText(curve.notes, legendWidth, noteFont);
              const height = labelLineH + noteLines.length * noteLineH + L.legendRowGap;
              const row: LegendRow = { top: cursor, height, label: curve.label, noteLines };
              cursor += height;
              return row;
          })
        : [];

    const legendBottom = legendRows.length > 0 ? cursor : legendTop;
    // In the editor the legend reserves one extra row for the "+ Add curve" affordance.
    const legendRowH = labelLineH + noteLineH + 8;
    const contentBottom = options.editing ? legendBottom + legendRowH : legendBottom;
    const width = L.margin.left + plotWidth + L.margin.right;
    // The frame hugs the artwork; exports reserve a small strip below its bottom border for the
    // attribution notice.
    const frameBottom = contentBottom + L.margin.bottom;
    const height = options.attribution ? frameBottom + 18 : frameBottom;

    return {
        width,
        height,
        frameBottom,
        plotX0,
        plotY0,
        plotX1,
        plotY1,
        plotWidth,
        plotHeight,
        baselineY,
        phaseXs,
        phaseLabelY,
        eventXs,
        eventCallouts,
        eventLabelY,
        eventNoteTop,
        legendX,
        legendWidth,
        legendRows,
        legendBottom,
        style,
        palette,
        dark: options.dark,
        toPx,
        fromPx,
    };
}

// --- Curve geometry ----------------------------------------------------------

function sortedPoints(curve: Curve): CurvePoint[] {
    return curve.points.toSorted((a, b) => a.x - b.x);
}

/**
The top-line commands (after the initial M) for points already in pixel space.
*/
function topLineCommands(pts: Pt[], isSmooth: boolean): string {
    if (pts.length < 2) return '';
    if (!isSmooth) {
        let d = '';
        for (let index = 1; index < pts.length; index++) {
            d += `L${String(round(pts[index].x))},${String(round(pts[index].y))}`;
        }
        return d;
    }
    // Catmull-Rom converted to cubic beziers, endpoints clamped.
    let d = '';
    for (let index = 0; index < pts.length - 1; index++) {
        const p0 = pts[Math.max(index - 1, 0)];
        const p1 = pts[index];
        const p2 = pts[index + 1];
        const p3 = pts[Math.min(index + 2, pts.length - 1)];
        const c1x = p1.x + (p2.x - p0.x) / 6;
        const c1y = p1.y + (p2.y - p0.y) / 6;
        const c2x = p2.x - (p3.x - p1.x) / 6;
        const c2y = p2.y - (p3.y - p1.y) / 6;
        d += `C${String(round(c1x))},${String(round(c1y))} ${String(round(c2x))},${String(round(c2y))} ${String(round(p2.x))},${String(round(p2.y))}`;
    }
    return d;
}

function cubicAt(a: Pt, c1: Pt, c2: Pt, b: Pt, t: number): Pt {
    const mt = 1 - t;
    return {
        x: mt * mt * mt * a.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * b.x,
        y: mt * mt * mt * a.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * b.y,
    };
}

/**
 * Densify the top edge into points roughly `segmentLength` px apart so the jitter has
 * control points to wobble between. Smooth curves are re-sampled along their actual
 * Catmull-Rom beziers (the same control points `topLineCommands` draws), straight ones
 * along their chords.
 */
function denseTopPoints(pts: Pt[], isSmooth: boolean, segmentLength: number): Pt[] {
    if (pts.length < 2) return pts;
    const out: Pt[] = [pts[0]];
    for (let index = 0; index < pts.length - 1; index++) {
        const p0 = pts[Math.max(index - 1, 0)];
        const p1 = pts[index];
        const p2 = pts[index + 1];
        const p3 = pts[Math.min(index + 2, pts.length - 1)];
        const length = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        const steps = Math.max(2, Math.round(length / segmentLength));
        if (!isSmooth) {
            for (let k = 1; k <= steps; k++) {
                const t = k / steps;
                out.push({ x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t });
            }
            continue;
        }
        const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
        const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
        for (let k = 1; k <= steps; k++) {
            out.push(cubicAt(p1, c1, c2, p2, k / steps));
        }
    }
    return out;
}

/**
 * Offset each point perpendicular to the local edge direction by one smooth noise function
 * over the edge's arc length — a single continuous wobble per curve, like a hand stroke,
 * instead of per-point sawtooth.
 */
function jitterPoints(pts: Pt[], jitter: StyleJitter, saltExtra: number): Pt[] {
    const last = pts.at(-1);
    if (last === undefined || pts.length < 2) return pts;
    const cum: number[] = [0];
    for (let index = 1; index < pts.length; index++) {
        cum.push(
            cum[index - 1] +
                Math.hypot(pts[index].x - pts[index - 1].x, pts[index].y - pts[index - 1].y)
        );
    }
    const lastCum = cum.at(-1);
    // Treat a missing or zero-length total (every point at the same spot) as 1 so the ratio below
    // never divides by zero.
    const total = lastCum === undefined || lastCum === 0 ? 1 : lastCum;
    const first = pts[0];
    const seed = hashNumbers([
        jitter.salt,
        saltExtra,
        Math.round(first.x * 2),
        Math.round(last.x * 2),
        Math.round(first.y * 2),
    ]);
    const noise = smoothNoise(seed);
    return pts.map((p, index) => {
        const previous = pts[Math.max(index - 1, 0)];
        const next = pts[Math.min(index + 1, pts.length - 1)];
        const dx = next.x - previous.x;
        const dy = next.y - previous.y;
        const span = Math.hypot(dx, dy) || 1;
        const off = jitter.amplitude * noise(cum[index] / total);
        return { x: p.x + (-dy / span) * off, y: p.y + (dx / span) * off };
    });
}

/**
 * The curve's top edge as `M`-less commands plus its endpoints. With jitter the edge is
 * densified and wobbled ONCE and shared by the line and the area path, so a filled curve
 * can never leak past its own stroked outline.
 */
function curveTopEdge(
    curve: Curve,
    geom: GraphGeom
): { start: Pt; end: Pt; commands: string } | undefined {
    const style = geom.style;
    const pts = sortedPoints(curve).map((p) => geom.toPx(p.x, p.y));
    const last = pts.at(-1);
    if (last === undefined) return undefined;
    if (style.jitter.amplitude <= 0) {
        return {
            start: pts[0],
            end: last,
            commands: topLineCommands(pts, curve.smooth),
        };
    }
    const dense = denseTopPoints(pts, curve.smooth, style.jitter.segmentLength);
    const wob = jitterPoints(dense, style.jitter, pts.length);
    const wobLast = wob.at(-1);
    if (wobLast === undefined) return undefined;
    return {
        start: wob[0],
        end: wobLast,
        commands: wob
            .slice(1)
            .map((p) => `L${String(round(p.x))},${String(round(p.y))}`)
            .join(''),
    };
}

/**
 * B(0.5) of the cubic bezier with control points `c1`/`c2` between `p1` and `p2` — the same control
 * points `topLineCommands` draws, so the midpoint lands on the visible line.
 */
const atMid = (p1: number, c1: number, c2: number, p2: number): number =>
    (p1 + 3 * c1 + 3 * c2 + p2) / 8;

/**
 * The point halfway along the drawn curve between control points `index` and `index+1`, in
 * model coordinates. For smooth curves this evaluates the segment's cubic bezier at t=0.5 — the
 * chord midpoint would float off the visible line wherever the spline bulges.
 */
export function segmentMidpoint(curve: Curve, index: number): CurvePoint {
    const pts = sortedPoints(curve);
    const a = pts[index];
    const b = pts[index + 1];
    if (!curve.smooth) return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const p0 = pts[Math.max(index - 1, 0)];
    const p3 = pts[Math.min(index + 2, pts.length - 1)];
    return {
        x: atMid(a.x, a.x + (b.x - p0.x) / 6, b.x - (p3.x - a.x) / 6, b.x),
        y: atMid(a.y, a.y + (b.y - p0.y) / 6, b.y - (p3.y - a.y) / 6, b.y),
    };
}

/**
Open path along the curve's top edge (jittered when the style asks for it).
*/
export function curveLinePath(curve: Curve, geom: GraphGeom): string {
    const edge = curveTopEdge(curve, geom);
    return edge === undefined
        ? ''
        : `M${String(round(edge.start.x))},${String(round(edge.start.y))}${edge.commands}`;
}

/**
Closed path: the top edge filled down to the baseline.
*/
export function curveAreaPath(curve: Curve, geom: GraphGeom): string {
    const edge = curveTopEdge(curve, geom);
    return edge === undefined
        ? ''
        : `M${String(round(edge.start.x))},${String(round(geom.baselineY))} L${String(round(edge.start.x))},${String(round(edge.start.y))}` +
              edge.commands +
              ` L${String(round(edge.end.x))},${String(round(geom.baselineY))} Z`;
}

export function pointPx(point: CurvePoint, geom: GraphGeom): Pt {
    return geom.toPx(point.x, point.y);
}

function peakPoint(curve: Curve): CurvePoint | undefined {
    let best: CurvePoint | undefined;
    for (const point of curve.points) {
        if (best === undefined || point.y > best.y) best = point;
    }
    return best;
}

// --- SVG assembly ------------------------------------------------------------

/**
A dashed rule used as the "click to edit" placeholder for an empty field.
*/
function hintLine(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    palette: CanvasPalette
): SVGLineElement {
    return svgElement('line', {
        x1: round(x1),
        y1: round(y1),
        x2: round(x2),
        y2: round(y2),
        stroke: palette.hint,
        'stroke-width': 1.5,
        'stroke-dasharray': '5 4',
        'pointer-events': 'none',
    });
}

/**
Bare dashed horizontal hint line for empty fields inside an already-clickable group.
*/
function dashedHintLine(x1: number, x2: number, y: number, palette: CanvasPalette): SVGLineElement {
    return hintLine(x1, y, x2, y, palette);
}

/**
 * Dashed blank-line placeholder for an empty editable field (edit mode only — exports never
 * show hints). The group carries the field's data-edit attributes and holds a transparent hit
 * rect sized to the visual hint, so the click target matches what the user sees.
 */
function hintPlaceholder(
    cx: number,
    y: number,
    halfWidth: number,
    palette: CanvasPalette,
    attributes: Record<string, string | number>
): SVGGElement {
    const group = svgElement('g', { ...attributes, class: 'empty-hint' });
    group.append(
        svgElement('rect', {
            x: round(cx - halfWidth),
            y: round(y - 13),
            width: round(halfWidth * 2),
            height: 26,
            fill: 'transparent',
            'pointer-events': 'all',
        })
    );
    group.append(hintLine(cx - halfWidth, y, cx + halfWidth, y, palette));
    return group;
}

/**
Draw the in-plot curve label according to the style's label treatment.
*/
function renderCurveLabel(
    container: SVGElement,
    geom: GraphGeom,
    label: string,
    index: number,
    cx: number,
    textY: number
): void {
    const style = geom.style;
    const palette = geom.palette;
    const t = style.label;
    const role = style.typography.roles.curveLabel;
    const fieldAttributes = { 'data-curve-index': index, 'data-edit-field': 'curve-label' };

    if (t.mode === 'plain-halo') {
        // Ink text with a ground-colored halo (paint-order) instead of a box.
        container.append(
            textElement(label, {
                x: round(cx),
                y: round(textY),
                'text-anchor': 'middle',
                'font-size': role.size,
                'font-weight': role.weight,
                fill: palette.curveLabel,
                stroke: palette.curveLabelHalo,
                'stroke-width': Math.max(3, t.haloWidth),
                'paint-order': 'stroke',
                'stroke-linejoin': 'round',
                ...fieldAttributes,
            })
        );
        return;
    }

    const boxWidth = textWidth(label, fontSpec(style, 'curveLabel')) + t.padX * 2;
    const boxX = cx - boxWidth / 2;
    const boxY = textY - (t.height - 10);
    if (t.shadowOffset > 0) {
        container.append(
            svgElement('rect', {
                x: round(boxX + t.shadowOffset),
                y: round(boxY + t.shadowOffset),
                width: round(boxWidth),
                height: t.height,
                rx: t.rx,
                fill: palette.ink,
                'pointer-events': 'none',
            })
        );
    }
    container.append(
        svgElement('rect', {
            x: round(boxX),
            y: round(boxY),
            width: round(boxWidth),
            height: t.height,
            rx: t.rx,
            'data-label-chip': index,
            fill: palette.chip,
            stroke: t.mode === 'chip' ? palette.chipStroke : palette.ink,
            'stroke-width': t.borderWidth,
            'pointer-events': 'none',
        })
    );
    container.append(
        textElement(label, {
            x: round(cx),
            y: round(textY),
            'text-anchor': 'middle',
            'font-size': role.size,
            'font-weight': role.weight,
            fill: palette.chipText,
            ...fieldAttributes,
        })
    );
}

/**
Four-point sparkle star centered on (cx, cy) with arm length s.
*/
function sparkleStar(cx: number, cy: number, s: number): string {
    const k = s * 0.22;
    return (
        `M${String(round(cx))} ${String(round(cy - s))} L${String(round(cx + k))} ${String(round(cy - k))} ` +
        `L${String(round(cx + s))} ${String(round(cy))} L${String(round(cx + k))} ${String(round(cy + k))} ` +
        `L${String(round(cx))} ${String(round(cy + s))} L${String(round(cx - k))} ${String(round(cy + k))} ` +
        `L${String(round(cx - s))} ${String(round(cy))} L${String(round(cx - k))} ${String(round(cy - k))} Z`
    );
}

export interface RenderResult {
    svg: SVGSVGElement;
    /**
    The layout the SVG was built with — the editor reuses it for handles and hit-testing.
    */
    geom: GraphGeom;
}

export function renderGraphSvg(model: GraphModel, options: RenderOptions): RenderResult {
    const geom = computeLayout(model, options);
    const { style, palette } = geom;
    const R = style.typography.roles;
    const L = style.layout;

    const svg = svgElement('svg', {
        xmlns: SVG_NS,
        viewBox: `0 0 ${String(round(geom.width))} ${String(round(geom.height))}`,
        width: round(geom.width),
        height: round(geom.height),
        class: 'graph-svg',
    });
    svg.setAttribute('font-family', style.typography.fallback);

    const defs = fillDefs(style, palette.ink, model);
    if (defs !== undefined) svg.append(defs);

    if (!options.transparentBackground) {
        svg.append(
            svgElement('rect', {
                x: 0,
                y: 0,
                width: round(geom.width),
                height: round(geom.height),
                fill: palette.background,
            })
        );
    }

    // --- Sparkles (glitter under everything, deterministic per model+style) ----
    if (style.sparkles) {
        const { count, colors, opacity, minSize, maxSize } = style.sparkles;
        const rand = mulberry32(
            hashNumbers([style.jitter.salt + 991, count, geom.width, geom.height])
        );
        const inset = 12;
        for (let index = 0; index < count; index++) {
            const x = inset + rand() * Math.max(1, geom.width - 2 * inset);
            const y = inset + rand() * Math.max(1, geom.height - 2 * inset);
            const size = minSize + rand() * (maxSize - minSize);
            const color = colors[Math.floor(rand() * colors.length)];
            svg.append(
                svgElement('path', {
                    d: sparkleStar(x, y, size),
                    fill: color,
                    opacity,
                    'pointer-events': 'none',
                })
            );
        }
    }

    // --- Frame (wall-art border, around the whole sheet) ----
    // Stroked in the axis color, not ink: styles whose ink is a "seam" black (toon dark)
    // still need their border visible on a dark ground.
    if (style.frame !== 'none') {
        svg.append(
            svgElement('rect', {
                x: 4,
                y: 4,
                width: round(geom.width - 8),
                height: round(geom.frameBottom - 8),
                fill: 'none',
                stroke: palette.axis,
                'stroke-width': 1.5,
            })
        );
        if (style.frame === 'double') {
            svg.append(
                svgElement('rect', {
                    x: 8,
                    y: 8,
                    width: round(geom.width - 16),
                    height: round(geom.frameBottom - 16),
                    fill: 'none',
                    stroke: palette.axis,
                    'stroke-width': 0.75,
                })
            );
        }
    }

    // Title
    const title = (model.title ?? '').trim();
    if (title !== '') {
        svg.append(
            textElement(title, {
                x: round(geom.plotX0 + geom.plotWidth / 2),
                y: round(L.margin.top + L.titleSpace * 0.7),
                'text-anchor': 'middle',
                fill: palette.title,
                'font-size': R.title.size,
                'font-weight': R.title.weight,
                'font-family': fontStack(style, 'title'),
                'data-edit-field': 'title',
            })
        );
    } else if (options.editing) {
        svg.append(
            hintPlaceholder(
                geom.plotX0 + geom.plotWidth / 2,
                L.margin.top + L.titleSpace * 0.7 - 5,
                150,
                palette,
                { 'data-edit-field': 'title' }
            )
        );
    }

    // Axes are split into two layers so curve fills can never cover the axis lines: the faint
    // grid / phase ticks paint *below* the curves, everything structural (axis lines, arrowheads,
    // baseline, tick and phase labels, y-axis title) paints *above* them.
    const grid = svgElement('g', { class: 'grid' });
    const axes = svgElement('g', { class: 'axes' });
    // --- Axes ---------------------------------------------------------------

    const axisStroke = { stroke: palette.axis, 'stroke-width': 2 };

    /**
    A line ending in a triangular arrowhead pointing along (dx, dy) — one of the unit dirs.
    */
    function arrowedAxis(x1: number, y1: number, x2: number, y2: number): void {
        axes.append(svgElement('line', { x1: round(x1), y1: round(y1), x2, y2, ...axisStroke }));
        // Arrowhead: tip 10px beyond the line end, base ±5px perpendicular.
        const dx = Math.sign(x2 - x1);
        const dy = Math.sign(y2 - y1);
        const tipX = x2 + dx * 10;
        const tipY = y2 + dy * 10;
        const px = -dy; // perpendicular
        const py = dx;
        const points =
            `${String(round(x2 + px * 5))},${String(round(y2 + py * 5))} ` +
            `${String(round(tipX))},${String(round(tipY))} ` +
            `${String(round(x2 - px * 5))},${String(round(y2 - py * 5))}`;
        axes.append(svgElement('polygon', { points, fill: palette.axis }));
    }

    if (model.numericAxis) {
        for (const value of [0, 25, 50, 75, 100]) {
            const py = geom.toPx(0, value).y;
            if (value !== 0) {
                grid.append(
                    svgElement('line', {
                        x1: round(geom.plotX0),
                        y1: round(py),
                        x2: round(geom.plotX1),
                        y2: round(py),
                        stroke: palette.grid,
                        'stroke-width': 1,
                    })
                );
            }
            axes.append(
                textElement(String(value), {
                    x: round(geom.plotX0 - 10),
                    y: round(py + 4),
                    'text-anchor': 'end',
                    fill: palette.tickLabel,
                    'font-size': R.tickLabel.size,
                    'font-weight': R.tickLabel.weight,
                    'font-family': fontStack(style, 'tickLabel'),
                })
            );
        }
        // Y axis line (no arrowhead in numeric mode)
        axes.append(
            svgElement('line', {
                x1: round(geom.plotX0),
                y1: round(geom.plotY0),
                x2: round(geom.plotX0),
                y2: round(geom.baselineY),
                ...axisStroke,
            })
        );
    } else {
        arrowedAxis(geom.plotX0, geom.baselineY, geom.plotX1 + 10, geom.baselineY);
        arrowedAxis(geom.plotX0, geom.baselineY, geom.plotX0, geom.plotY0 - 10);
    }

    // Baseline (both modes)
    axes.append(
        svgElement('line', {
            x1: round(geom.plotX0),
            y1: round(geom.baselineY),
            x2: round(geom.plotX1),
            y2: round(geom.baselineY),
            ...axisStroke,
        })
    );

    // Phase separators: faint vertical lines on the BOUNDARIES between adjacent bands — the same
    // edges events snap to — instead of at the band centres, and none at the plot's outer edges.
    const separators = phaseBoundaries(model.phases.length).slice(1, -1);
    for (const boundary of separators) {
        const bx = geom.toPx(boundary, 0).x;
        grid.append(
            svgElement('line', {
                x1: round(bx),
                y1: round(geom.plotY0),
                x2: round(bx),
                y2: round(geom.baselineY),
                stroke: palette.phaseTick,
                'stroke-width': 1,
            })
        );
    }

    // Phase labels sit at each band's centre. In edit mode each label is a group that reveals a
    // small ✕ on hover (remove phase); the label itself is click-to-edit / drag-to-reorder.
    for (const [index, phase] of model.phases.entries()) {
        const px = geom.phaseXs[index];
        const group = svgElement('g', { class: 'phase-group' });
        group.append(
            textElement(phase.label, {
                x: round(px),
                y: round(geom.phaseLabelY),
                'text-anchor': 'middle',
                fill: palette.phaseLabel,
                'font-size': R.phaseLabel.size,
                'font-weight': R.phaseLabel.weight,
                'font-family': fontStack(style, 'phaseLabel'),
                class: 'phase-label',
                'data-edit-field': 'phase',
                'data-phase-index': index,
            })
        );
        if (phase.label === '' && options.editing) {
            group.append(
                hintPlaceholder(px, geom.phaseLabelY - 5, 36, palette, {
                    'data-edit-field': 'phase',
                    'data-phase-index': index,
                })
            );
        }
        if (options.editing) {
            group.append(
                removeBadge(px, geom.phaseLabelY + 24, 9, 11, 4, palette, {
                    class: 'phase-remove',
                    'data-phase-remove': index,
                })
            );
        }
        axes.append(group);
    }

    // Y-axis title (rotated)
    const yTitle = (model.yAxisTitle ?? '').trim();
    // A rotated `<text>` grows to the *left* of its baseline, so hug the title's baseline against
    // whatever owns the left gutter: the tick labels when the numeric axis is on, the axis line
    // itself otherwise. Anything larger reopens a dead gap between the label and the y-axis.
    const tickGutter = L.margin.left - 10 - R.tickLabel.size;
    // Leave ~2px of ink between the label and the gutter content it hugs.
    const yTitlePad = (R.axisTitle.size + 6) / 2 + 2;
    const yTitleX = round((model.numericAxis ? tickGutter : L.margin.left - 8) - yTitlePad);
    const yTitleY = (geom.plotY0 + geom.baselineY) / 2;
    const yTitleTransform = `rotate(-90 ${String(yTitleX)} ${String(round(yTitleY))})`;
    if (yTitle !== '') {
        axes.append(
            textElement(yTitle, {
                x: yTitleX,
                y: round(yTitleY),
                'text-anchor': 'middle',
                fill: palette.axisTitle,
                'font-size': R.axisTitle.size,
                'font-weight': R.axisTitle.weight,
                'font-family': fontStack(style, 'axisTitle'),
                transform: yTitleTransform,
                'data-edit-field': 'yaxis',
            })
        );
    } else if (options.editing) {
        // The hint's rotated text grows left from its baseline, so anchor the baseline near the
        // gutter edge instead of centring it on `yTitleX` — otherwise half the band falls off the
        // canvas and the field looks unclickable.
        const hintBaseline = round(
            model.numericAxis ? L.margin.left - 10 - R.tickLabel.size - 2 : L.margin.left - 10
        );
        const hint = svgElement('g', { 'data-edit-field': 'yaxis', class: 'empty-hint' });
        hint.append(
            svgElement('rect', {
                x: round(hintBaseline - (R.axisTitle.size + 6)),
                y: round(yTitleY - 90),
                width: round(R.axisTitle.size + 14),
                height: 180,
                fill: 'transparent',
                'pointer-events': 'all',
            })
        );
        hint.append(hintLine(hintBaseline, yTitleY - 90, hintBaseline, yTitleY + 90, palette));
        axes.append(hint);
    }

    svg.append(grid);

    // Curves (fills + top lines), later curves paint on top so overlaps blend. Each curve group
    // carries an invisible wide stroke over the top line so it is hoverable/clickable as a band.
    const hitWidth = Math.max(14, style.curveStrokeWidth + 10);
    const curvesGroup = svgElement('g', { class: 'curves' });
    for (const [index, curve] of model.curves.entries()) {
        const group = svgElement('g', { 'data-curve-index': index });
        const fillValue = effectiveCurveFill(style, curve, index, geom.dark);
        const line = curveLinePath(curve, geom);
        group.append(
            svgElement('path', {
                d: curveAreaPath(curve, geom),
                fill: fillValue,
                'fill-opacity': curve.opacity,
                class: 'curve-fill',
                'pointer-events': 'all',
            })
        );
        // Styles with an ink outline draw the top edge in ink (toon seams, de-stijl rules,
        // draftsman technical lines); otherwise the line follows the fill color.
        let lineColor = curve.color;
        if (style.stroke.curveOutline > 0) {
            lineColor = palette.ink;
        } else if (fillValue.startsWith('#')) {
            lineColor = fillValue;
        }
        const lineWidth =
            style.stroke.curveOutline > 0 ? style.stroke.curveOutline : style.curveStrokeWidth;
        group.append(
            svgElement('path', {
                d: line,
                fill: 'none',
                stroke: lineColor,
                'stroke-width': lineWidth,
                'stroke-linecap': 'round',
                'stroke-linejoin': 'round',
                class: 'curve-line',
                'pointer-events': 'none',
            })
        );
        group.append(
            svgElement('path', {
                d: line,
                fill: 'none',
                stroke: 'transparent',
                'stroke-width': hitWidth,
                'stroke-linecap': 'round',
                'stroke-linejoin': 'round',
                class: 'curve-hit',
                'pointer-events': 'stroke',
            })
        );
        curvesGroup.append(group);
    }
    svg.append(curvesGroup);

    // In-plot curve labels at each peak, in the style's label treatment.
    const labelsGroup = svgElement('g', { class: 'curve-labels' });
    for (const [index, curve] of model.curves.entries()) {
        const label = curve.label.trim();
        const peak = peakPoint(curve);
        if (peak === undefined) continue;
        const p = geom.toPx(peak.x, peak.y);
        let ty = p.y - 12;
        if (ty < geom.plotY0 + 14) ty = p.y + 20;
        if (label !== '') {
            renderCurveLabel(labelsGroup, geom, label, index, p.x, ty);
        } else if (options.editing) {
            labelsGroup.append(
                hintPlaceholder(p.x, ty - 5, 60, palette, {
                    'data-curve-index': index,
                    'data-edit-field': 'curve-label',
                })
            );
        }
    }
    svg.append(labelsGroup);
    // Axis lines / arrowheads / labels sit above every curve so nothing can occlude them.
    svg.append(axes);

    // Events (moments in time). The gate line + baseline diamond are appended to `axes` so they
    // paint ABOVE the translucent curve fills — a gate must stay readable wherever a curve runs.
    // The label + wrapped note sit in the reserved band above the plot, joined by a short leader
    // tick. In edit mode each callout reveals a hover ✕ (remove) and empty labels show a hint.
    for (const [index, event] of model.events.entries()) {
        const callout = geom.eventCallouts[index];
        const px = geom.eventXs[index];
        axes.append(
            svgElement('line', {
                x1: round(px),
                y1: round(geom.plotY0),
                x2: round(px),
                y2: round(geom.baselineY),
                stroke: palette.eventLine,
                'stroke-width': 1.5,
                'stroke-dasharray': '6 4',
                class: 'event-line',
                'data-event-line': index,
                'pointer-events': 'none',
            })
        );
        const dm = 5;
        const points =
            `${String(round(px))},${String(round(geom.baselineY - dm))} ` +
            `${String(round(px + dm))},${String(round(geom.baselineY))} ` +
            `${String(round(px))},${String(round(geom.baselineY + dm))} ` +
            `${String(round(px - dm))},${String(round(geom.baselineY))}`;
        axes.append(
            svgElement('polygon', {
                points,
                fill: palette.eventLine,
                stroke: palette.background,
                'stroke-width': 1,
                class: 'event-diamond',
                'data-event-diamond': index,
                'pointer-events': 'none',
            })
        );

        const group = svgElement('g', { class: 'event-group' });
        const blockBottom = geom.eventNoteTop + callout.noteLines.length * R.eventNote.lineHeight;
        group.append(
            svgElement('line', {
                x1: round(px),
                y1: round(blockBottom),
                x2: round(px),
                y2: round(geom.plotY0 - L.eventLeader),
                stroke: palette.eventLine,
                'stroke-width': 1,
                'data-event-leader': index,
                'pointer-events': 'none',
            })
        );
        const label = event.label.trim();
        if (label !== '') {
            group.append(
                textElement(label, {
                    x: round(callout.textX),
                    y: round(geom.eventLabelY),
                    'text-anchor': callout.anchor,
                    fill: palette.eventLabel,
                    'font-size': R.eventLabel.size,
                    'font-weight': R.eventLabel.weight,
                    'font-family': fontStack(style, 'eventLabel'),
                    class: 'event-label',
                    'data-edit-field': 'event',
                    'data-event-index': index,
                })
            );
        } else if (options.editing) {
            group.append(
                hintPlaceholder(callout.textX, geom.eventLabelY - 5, 36, palette, {
                    'data-edit-field': 'event',
                    'data-event-index': index,
                })
            );
        }
        for (const [index_, line] of callout.noteLines.entries()) {
            group.append(
                textElement(line, {
                    x: round(callout.textX),
                    y: round(
                        geom.eventNoteTop + index_ * R.eventNote.lineHeight + R.eventNote.size
                    ),
                    'text-anchor': callout.anchor,
                    fill: palette.legendMuted,
                    'font-size': R.eventNote.size,
                    'font-weight': R.eventNote.weight,
                    'font-family': fontStack(style, 'eventNote'),
                    'data-event-note': index,
                    'pointer-events': 'none',
                })
            );
        }
        if (options.editing) {
            group.append(
                removeBadge(px, blockBottom + 12, 9, 11, 4, palette, {
                    class: 'event-remove',
                    'data-event-remove': index,
                })
            );
        }
        svg.append(group);
    }

    // WYSIWYG "add event": a "+" at the right end of the callout band (mirrors the phase-row "+").
    if (options.editing && model.events.length < MAX_EVENTS) {
        svg.append(
            addBadge(geom.plotX1 + 28, geom.eventLabelY - 5, palette.eventLabel, {
                class: 'event-add',
                'data-event-add': 1,
            })
        );
    }

    // Legend below: one editable block per curve (first line = label, rest = notes). Rows are
    // displayed in REVERSE paint order: the front-most curve (last in the model) sits on top.
    // When an export drops the legend, geom.legendRows is empty and this loop paints nothing.
    const legendGroup = svgElement('g', { class: 'legend' });
    const labelLineH = R.legendLabel.size + 6;
    const noteLineH = R.legendNote.lineHeight;
    const displayOrder = model.curves.keys().toArray().toReversed();
    for (const [slot, row] of geom.legendRows.entries()) {
        const curveIndex = displayOrder[slot];
        const curve = model.curves[curveIndex];
        const swatchX = geom.legendX + L.legendRemoveZone;
        const textX = swatchX + L.legendSwatch + L.legendSwatchGap;
        const rowHeight = row.height - L.legendRowGap;
        const block = svgElement('g', {
            class: 'legend-block',
            'data-edit-field': 'legend-block',
            'data-curve-index': curveIndex,
        });
        block.append(
            svgElement('rect', {
                x: round(geom.legendX),
                y: round(row.top),
                width: round(
                    L.legendRemoveZone + L.legendSwatch + L.legendSwatchGap + geom.legendWidth
                ),
                height: round(rowHeight),
                fill: 'transparent',
                'pointer-events': 'all',
            })
        );
        // Hover-revealed affordances left of the color swatch (editor only): a drag handle that
        // reorders the curve's layer, and a ✕ that removes it.
        if (options.editing) {
            const rowMidY = row.top + L.legendSwatch / 2;
            const handle = svgElement('g', { class: 'legend-drag', 'data-curve-drag': curveIndex });
            handle.append(
                svgElement('rect', {
                    x: round(geom.legendX),
                    y: round(row.top),
                    width: 18,
                    height: round(L.legendSwatch),
                    fill: 'transparent',
                })
            );
            for (const dotX of [geom.legendX + 5, geom.legendX + 13]) {
                for (const dotY of [rowMidY - 4, rowMidY, rowMidY + 4]) {
                    handle.append(
                        svgElement('circle', {
                            cx: round(dotX),
                            cy: round(dotY),
                            r: 1.6,
                            fill: palette.legendMuted,
                        })
                    );
                }
            }
            block.append(handle);

            block.append(
                removeBadge(geom.legendX + 30, rowMidY, 8, 10, 4, palette, {
                    class: 'legend-remove',
                    'data-curve-remove': curveIndex,
                })
            );
        }
        block.append(
            svgElement('rect', {
                x: round(swatchX),
                y: round(row.top),
                width: L.legendSwatch,
                height: L.legendSwatch,
                rx: 3,
                // Swatches show the curve's effective color; hatches/gradients are represented
                // by the palette entry they stand in for.
                fill: effectiveCurveSwatchColor(style, curve, curveIndex, geom.dark),
                'fill-opacity': Math.max(0.85, curve.opacity),
                stroke: palette.legendSwatchStroke,
                'stroke-width': 1,
                class: 'legend-swatch',
                'data-swatch-index': curveIndex,
                'pointer-events': options.editing ? 'all' : 'none',
            })
        );
        if (row.label !== '') {
            block.append(
                textElement(row.label, {
                    x: round(textX),
                    y: round(row.top + R.legendLabel.size),
                    fill: palette.legendText,
                    'font-size': R.legendLabel.size,
                    'font-weight': R.legendLabel.weight,
                    'font-family': fontStack(style, 'legendLabel'),
                    'pointer-events': 'none',
                })
            );
        } else if (options.editing) {
            block.append(dashedHintLine(textX, textX + 120, row.top + labelLineH - 6, palette));
        }
        // Notes get no placeholder: the wrapped note lines would otherwise show a long dash rule.
        if (row.noteLines.length > 0) {
            for (const [index, line] of row.noteLines.entries()) {
                block.append(
                    textElement(line, {
                        x: round(textX),
                        y: round(row.top + labelLineH + index * noteLineH + R.legendNote.size),
                        fill: palette.legendMuted,
                        'font-size': R.legendNote.size,
                        'font-weight': R.legendNote.weight,
                        'font-family': fontStack(style, 'legendNote'),
                        'pointer-events': 'none',
                    })
                );
            }
        }
        legendGroup.append(block);
    }

    // WYSIWYG "add curve": a dashed placeholder row at the bottom of the legend, in place of the
    // old toolbar button. Clicking it appends a curve and immediately selects its label for typing.
    if (options.editing && model.curves.length < MAX_CURVES) {
        const placeholderRow = svgElement('g', { class: 'legend-add', 'data-curve-add': 1 });
        const textX = geom.legendX + L.legendRemoveZone;
        placeholderRow.append(
            svgElement('rect', {
                x: round(geom.legendX),
                y: round(geom.legendBottom),
                width: round(
                    L.legendRemoveZone + L.legendSwatch + L.legendSwatchGap + geom.legendWidth
                ),
                height: round(labelLineH + noteLineH + 8),
                fill: 'transparent',
                'pointer-events': 'all',
            })
        );
        placeholderRow.append(
            textElement('+ Add curve', {
                x: round(textX),
                y: round(geom.legendBottom + R.legendLabel.size - 2),
                fill: palette.legendMuted,
                'font-size': R.legendLabel.size,
                'font-weight': R.legendNote.weight,
                'font-family': fontStack(style, 'legendLabel'),
                'pointer-events': 'none',
            })
        );
        legendGroup.append(placeholderRow);
    }

    svg.append(legendGroup);

    // Attribution (exports only): right-aligned in the strip below the frame's bottom border.
    if (options.attribution) {
        svg.append(
            textElement('https://share.lakitna.nl/shift-left-right-builder', {
                x: round(geom.width),
                y: round(geom.frameBottom + 12),
                'text-anchor': 'end',
                fill: palette.tickLabel,
                'font-size': 10,
            })
        );
    }

    return { svg, geom };
}

/**
Serialize the SVG element into a standalone document string, optionally embedding font CSS.
*/
export function serializeSvg(svg: SVGSVGElement, options: { embedFontCss?: string } = {}): string {
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('xmlns', SVG_NS);
    const viewBox = clone.getAttribute('viewBox')?.trim().split(/\s+/).map(Number) ?? [];
    if (viewBox.length === 4 && viewBox[2] > 0) {
        clone.setAttribute('width', String(viewBox[2]));
        clone.setAttribute('height', String(viewBox[3]));
    }
    if (options.embedFontCss) {
        const styleElement = document.createElementNS(SVG_NS, 'style');
        styleElement.setAttribute('type', 'text/css');
        styleElement.textContent = options.embedFontCss;
        clone.insertBefore(styleElement, clone.firstChild);
    }
    return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`;
}
