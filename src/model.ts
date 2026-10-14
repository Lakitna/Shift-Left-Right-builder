/**
 * Data model for the shift-left / shift-right graph builder.
 *
 * A model is a set of translucent area CURVES plotted over an SDLC-phase x-axis and a
 * testing/quality-effort y-axis ("Test volume"). Each curve is an ordered list of control
 * points in a normalized 0..100 coordinate space: `x` is a fraction of the plot width
 * (independent of how many phases there are, so curves keep their shape when phases are added
 * or removed) and `y` is effort (0 at the baseline, 100 at the top). Curves are filled down to
 * the baseline so their overlaps blend translucently.
 *
 * This module owns the type contract, constants, validation (`cloneModel` / `parseModel`), and
 * the curve/point/phase mutation helpers the editor calls. The static preset models live in
 * `presets.ts`.
 *
 * Invariant: a curve's `points` are kept sorted by ascending x. Dragging mutates a point in place
 * and re-sorts; callers track the dragged point by object identity.
 */

export interface CurvePoint {
    /** Horizontal position, 0..100 (% of the plot width). */
    x: number;
    /** Vertical position, 0..100 (effort; 0 = baseline). */
    y: number;
}

export interface Curve {
    /** Shown inside the plot near the curve's peak and in the legend. */
    label: string;
    /** Fill/stroke color as #rrggbb. */
    color: string;
    /** Free text shown in the legend below the graph. */
    notes: string;
    /** Control points, kept sorted by ascending x. Between MIN_POINTS and MAX_POINTS entries. */
    points: CurvePoint[];
    /** Smooth Catmull-Rom spline through the points when true; straight polyline when false. */
    smooth: boolean;
    /** Fill opacity for translucent overlap, 0..1. */
    opacity: number;
}

export interface Phase {
    /** X-axis label; the phase's position is its evenly-spaced index. */
    label: string;
}

export interface GraphModel {
    version: number;
    /** Optional heading drawn above the graph. */
    title?: string;
    /** Y-axis caption, e.g. "Test volume". */
    yAxisTitle?: string;
    /** Numeric scale + gridlines when true; qualitative axis when false. */
    numericAxis: boolean;
    /** X-axis phases, left to right. At least MIN_PHASES. */
    phases: Phase[];
    /** The curves, drawn in order (later curves paint on top). */
    curves: Curve[];
}

export const MODEL_VERSION = 1;

export const MIN_CURVES = 1;
export const MAX_CURVES = 12;
export const MIN_POINTS = 2;
export const MAX_POINTS = 40;
export const MIN_PHASES = 1;
export const MAX_PHASES = 12;

export const MIN_COORD = 0;
export const MAX_COORD = 100;

export const MIN_OPACITY = 0.05;
export const MAX_OPACITY = 1;
export const DEFAULT_OPACITY = 0.5;

/** Colors assigned to newly added curves, cycled by curve index. */
export const PALETTE = [
    '#22c1d9', // cyan (shift-left)
    '#f24d8d', // pink (traditional)
    '#8a7de0', // violet (shift-right)
    '#e63946',
    '#f4a261',
    '#2a9d8f',
    '#457b9d',
    '#b56576',
    '#6d597a',
    '#99b898',
    '#1d3557',
    '#84a98c',
];

const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** Clamp an arbitrary number into the 0..100 coordinate space (NaN/Infinity -> 0). */
export function clampCoord(value: number): number {
    if (!Number.isFinite(value)) return MIN_COORD;
    return Math.min(MAX_COORD, Math.max(MIN_COORD, Math.round(value)));
}

/** Clamp an arbitrary number into the valid fill-opacity range. */
export function clampOpacity(value: number): number {
    if (!Number.isFinite(value)) return DEFAULT_OPACITY;
    return Math.min(MAX_OPACITY, Math.max(MIN_OPACITY, Math.round(value * 100) / 100));
}

/**
 * Deep copy with normalized optional fields. Presets hold static models — the editor mutates
 * models in place, so every application of a preset (or initial load) must clone first.
 */
export function cloneModel(source: GraphModel): GraphModel {
    return {
        version: source.version,
        title: source.title ?? '',
        yAxisTitle: source.yAxisTitle ?? '',
        numericAxis: source.numericAxis,
        phases: source.phases.map((phase) => ({ label: phase.label })),
        curves: source.curves.map((curve) => ({
            label: curve.label,
            color: curve.color,
            notes: curve.notes,
            smooth: curve.smooth,
            opacity: curve.opacity,
            points: curve.points.map((point) => ({ x: point.x, y: point.y })),
        })),
    };
}

function record(input: unknown): Record<string, unknown> | null {
    return typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : null;
}

function parsePoint(input: unknown): CurvePoint | null {
    const obj = record(input);
    if (obj === null) return null;
    const { x, y } = obj;
    if (typeof x !== 'number' || typeof y !== 'number') return null;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x: clampCoord(x), y: clampCoord(y) };
}

function parseCurve(input: unknown): Curve | null {
    const obj = record(input);
    if (obj === null) return null;
    const { label, notes, color, smooth } = obj;
    if (typeof label !== 'string' || typeof notes !== 'string') return null;
    if (typeof color !== 'string' || !COLOR_PATTERN.test(color)) return null;
    if (typeof smooth !== 'boolean') return null;
    if (!Array.isArray(obj.points)) return null;
    if (obj.points.length < MIN_POINTS || obj.points.length > MAX_POINTS) return null;

    const points: CurvePoint[] = [];
    for (const rawPoint of obj.points) {
        const point = parsePoint(rawPoint);
        if (point === null) return null;
        points.push(point);
    }
    // Keep the invariant that points are sorted by ascending x.
    points.sort((a, b) => a.x - b.x);

    const opacity = typeof obj.opacity === 'number' ? clampOpacity(obj.opacity) : DEFAULT_OPACITY;
    return { label, color: color.toLowerCase(), notes, points, smooth, opacity };
}

function parsePhase(input: unknown): Phase | null {
    const obj = record(input);
    if (obj === null) return null;
    if (typeof obj.label !== 'string') return null;
    return { label: obj.label };
}

/**
 * Validate and sanitize unknown data (e.g. JSON decoded from the URL) into a GraphModel.
 * Returns null when the data cannot be interpreted as a model of the current version. Every
 * field must be present with the right type — there are no lenient defaults, so a malformed
 * payload is rejected rather than silently repaired.
 */
export function parseModel(input: unknown): GraphModel | null {
    const obj = record(input);
    if (obj === null) return null;

    const { title, yAxisTitle, numericAxis, phases, curves } = obj;
    if (obj.version !== MODEL_VERSION) return null;
    if (typeof title !== 'string' || typeof yAxisTitle !== 'string') return null;
    if (typeof numericAxis !== 'boolean') return null;
    if (!Array.isArray(phases) || !Array.isArray(curves)) return null;
    if (phases.length < MIN_PHASES || phases.length > MAX_PHASES) return null;
    if (curves.length < MIN_CURVES || curves.length > MAX_CURVES) return null;

    const parsedPhases: Phase[] = [];
    for (const rawPhase of phases) {
        const phase = parsePhase(rawPhase);
        if (phase === null) return null;
        parsedPhases.push(phase);
    }

    const parsedCurves: Curve[] = [];
    for (const rawCurve of curves) {
        const curve = parseCurve(rawCurve);
        if (curve === null) return null;
        parsedCurves.push(curve);
    }

    return {
        version: MODEL_VERSION,
        title: title as string | undefined,
        yAxisTitle: yAxisTitle as string | undefined,
        numericAxis,
        phases: parsedPhases,
        curves: parsedCurves,
    };
}

// --- Phase positions ---------------------------------------------------------

/**
 * X position (0..100, integer) of each phase tick: the CENTER of an equal-width band, so the
 * first and last labels sit half a band away from the plot edges and the layout scales with any
 * phase count (one phase → centered). Rounded so the value survives the 0..100 integer
 * coordinate invariant on both the render side (ticks) and the snap side (points) and across
 * URL round-trips.
 */
export function phasePositions(count: number): number[] {
    const positions: number[] = [];
    for (let i = 0; i < count; i++) {
        positions.push(Math.round(((i + 0.5) / count) * 100));
    }
    return positions;
}

/** The phase tick x (0..100) nearest to `x`. */
export function nearestPhaseX(x: number, count: number): number {
    const positions = phasePositions(count);
    let best = positions[0];
    let bestDistance = Math.abs(x - best);
    for (const position of positions) {
        const distance = Math.abs(x - position);
        if (distance < bestDistance) {
            best = position;
            bestDistance = distance;
        }
    }
    return best;
}

// --- Curve operations --------------------------------------------------------

/** Keep the invariant that a curve's points are sorted by ascending x. */
function sortPoints(points: CurvePoint[]): void {
    points.sort((a, b) => a.x - b.x);
}

/** Linear y between the points bracketing `x` (points must be sorted by x). */
function interpolateY(points: CurvePoint[], x: number): number {
    if (points.length === 0) return 0;
    if (x <= points[0].x) return points[0].y;
    const last = points[points.length - 1];
    if (x >= last.x) return last.y;
    for (let i = 0; i < points.length - 1; i++) {
        const a = points[i];
        const b = points[i + 1];
        if (x >= a.x && x <= b.x) {
            const span = b.x - a.x;
            if (span === 0) return a.y;
            const t = (x - a.x) / span;
            return Math.round(a.y + (b.y - a.y) * t);
        }
    }
    return last.y;
}

/** A curve for position `index`, cycling the palette so it differs from its neighbors. */
export function newCurve(model: GraphModel, index: number): Curve {
    const prev = model.curves[index - 1]?.color;
    const next = model.curves[index]?.color;
    let color = PALETTE[index % PALETTE.length];
    for (let offset = 0; offset < PALETTE.length; offset++) {
        const candidate = PALETTE[(index + offset) % PALETTE.length];
        if (candidate !== prev && candidate !== next) {
            color = candidate;
            break;
        }
    }
    return {
        label: `Curve ${index + 1}`,
        color,
        notes: '',
        smooth: true,
        opacity: DEFAULT_OPACITY,
        points: [
            { x: 0, y: 0 },
            { x: 25, y: 35 },
            { x: 50, y: 70 },
            { x: 75, y: 35 },
            { x: 100, y: 0 },
        ],
    };
}

export function canAddCurve(model: GraphModel): boolean {
    return model.curves.length < MAX_CURVES;
}

export function canRemoveCurve(model: GraphModel): boolean {
    return model.curves.length > MIN_CURVES;
}

/** Append a new curve at the top of the stack. */
export function addCurve(model: GraphModel): boolean {
    if (!canAddCurve(model)) return false;
    model.curves.push(newCurve(model, model.curves.length));
    return true;
}

export function removeCurve(model: GraphModel, index: number): boolean {
    if (!canRemoveCurve(model)) return false;
    if (index < 0 || index >= model.curves.length) return false;
    model.curves.splice(index, 1);
    return true;
}

/** Move the curve at `from` to index `to` (changes paint order). */
export function reorderCurve(model: GraphModel, from: number, to: number): boolean {
    if (from < 0 || from >= model.curves.length) return false;
    const target = Math.max(0, Math.min(model.curves.length - 1, to));
    if (target === from) return false;
    const [curve] = model.curves.splice(from, 1);
    model.curves.splice(target, 0, curve);
    return true;
}

export function moveCurve(model: GraphModel, index: number, offset: -1 | 1): boolean {
    return reorderCurve(model, index, index + offset);
}

// --- Point operations --------------------------------------------------------

export function canAddPoint(curve: Curve): boolean {
    return curve.points.length < MAX_POINTS;
}

export function canRemovePoint(curve: Curve): boolean {
    return curve.points.length > MIN_POINTS;
}

/**
 * Insert a point at x `atX`, then re-sort. `atY` places the point on a computed spot (e.g. the
 * spline midpoint an insert handle sits on); without it, y is interpolated linearly from the
 * neighbouring points.
 */
export function insertPoint(
    model: GraphModel,
    curveIndex: number,
    atX: number,
    atY?: number
): boolean {
    const curve = model.curves[curveIndex];
    if (curve === undefined || !canAddPoint(curve)) return false;
    const x = clampCoord(atX);
    const y = atY === undefined ? clampCoord(interpolateY(curve.points, x)) : clampCoord(atY);
    curve.points.push({ x, y });
    sortPoints(curve.points);
    return true;
}

export function removePoint(model: GraphModel, curveIndex: number, pointIndex: number): boolean {
    const curve = model.curves[curveIndex];
    if (curve === undefined || !canRemovePoint(curve)) return false;
    if (pointIndex < 0 || pointIndex >= curve.points.length) return false;
    curve.points.splice(pointIndex, 1);
    return true;
}

/**
 * Move a point (clamped to 0..100) and re-sort. The point object identity survives the re-sort,
 * so callers keep tracking the dragged point by reference.
 */
export function setPoint(
    model: GraphModel,
    curveIndex: number,
    point: CurvePoint,
    x: number,
    y: number
): boolean {
    const curve = model.curves[curveIndex];
    if (curve === undefined || !curve.points.includes(point)) return false;
    point.x = clampCoord(x);
    point.y = clampCoord(y);
    sortPoints(curve.points);
    return true;
}

// --- Phase operations --------------------------------------------------------

export function canAddPhase(model: GraphModel): boolean {
    return model.phases.length < MAX_PHASES;
}

export function canRemovePhase(model: GraphModel): boolean {
    return model.phases.length > MIN_PHASES;
}

/** Append a phase at the right end of the axis. */
export function addPhase(model: GraphModel): boolean {
    if (!canAddPhase(model)) return false;
    model.phases.push({ label: `Phase ${model.phases.length + 1}` });
    return true;
}

export function removePhase(model: GraphModel, index: number): boolean {
    if (!canRemovePhase(model)) return false;
    if (index < 0 || index >= model.phases.length) return false;
    model.phases.splice(index, 1);
    return true;
}

/**
 * Move the phase at `from` to index `to`. Tick positions are positional (evenly spaced by
 * index), so reordering swaps the labels only — curves are untouched.
 */
export function reorderPhase(model: GraphModel, from: number, to: number): boolean {
    if (from < 0 || from >= model.phases.length) return false;
    const target = Math.max(0, Math.min(model.phases.length - 1, to));
    if (target === from) return false;
    const [phase] = model.phases.splice(from, 1);
    model.phases.splice(target, 0, phase);
    return true;
}
