/**
 * Style-driven SVG renderer for the shift-left / shift-right graph.
 *
 * Everything visual comes from the active `GraphStyle`. The same element is used for the on-page
 * canvas and for both export formats, so all styling is baked into SVG attributes and the exports
 * render a fresh SVG from the model (never the editing overlays).
 *
 * `computeLayout` centralizes all geometry (plot rect, phase tick positions, legend rows) and is
 * exported so the editor can place control-point handles and hit-test without duplicating math.
 */

import { phasePositions, MAX_CURVES, type Curve, type CurvePoint, type GraphModel } from './model';
import { STYLE, type CanvasPalette, type FontRole, type GraphStyle } from './style';

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface RenderOptions {
    style?: GraphStyle;
    dark: boolean;
    /** Editing canvas keeps full layout (placeholders); exports collapse empty title/legend. */
    editing?: boolean;
    transparentBackground?: boolean;
    attribution?: boolean;
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

export interface GraphGeom {
    width: number;
    height: number;
    plotX0: number;
    plotY0: number;
    plotX1: number;
    plotY1: number;
    plotWidth: number;
    plotHeight: number;
    baselineY: number;
    /** Pixel x of each phase tick, in phase order. */
    phaseXs: number[];
    phaseLabelY: number;
    legendX: number;
    legendWidth: number;
    legendRows: LegendRow[];
    /** Y where the legend rows end (before any editor-only "+ Add curve" row). */
    legendBottom: number;
    style: GraphStyle;
    palette: CanvasPalette;
    dark: boolean;
    toPx(x: number, y: number): Pt;
    fromPx(px: number, py: number): Pt;
}

const round = (n: number): number => Math.round(n * 100) / 100;

// --- Text measurement --------------------------------------------------------

let measureContext: CanvasRenderingContext2D | null | undefined;

function textWidth(text: string, font: string): number {
    if (measureContext === undefined) {
        measureContext = document.createElement('canvas').getContext('2d');
    }
    if (measureContext === null) {
        return text.length * 8;
    }
    measureContext.font = font;
    return measureContext.measureText(text).width;
}

function fontSpec(style: GraphStyle, role: FontRole): string {
    const spec = style.font[role] as { size: number; weight: number };
    return `${spec.weight} ${spec.size}px ${style.font.family}`;
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
            if (current !== '') {
                lines.push(current);
                current = '';
            }
        };
        for (const word of paragraph.split(/\s+/).filter((w) => w !== '')) {
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

// --- Layout ------------------------------------------------------------------

export function computeLayout(model: GraphModel, options: RenderOptions): GraphGeom {
    const style = options.style ?? STYLE;
    const palette = options.dark ? style.dark : style.light;
    const L = style.layout;

    const hasTitle = (model.title ?? '').trim() !== '';
    // The editing canvas always reserves the title band so the layout does not jump while the
    // title is being typed; exports collapse it when empty.
    const titleBand = hasTitle || options.editing ? L.titleSpace + L.titleGap : 0;

    const plotX0 = L.margin.left;
    const plotWidth = L.plotWidth;
    const plotX1 = plotX0 + plotWidth;
    const plotY0 = L.margin.top + titleBand;
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

    // Legend block below the phase labels. Rows are laid out in DISPLAY order (front-most curve
    // first), matching how renderGraphSvg paints them; consumers index this array by display slot.
    const legendX = plotX0;
    const legendWidth = plotWidth - (L.legendSwatch + L.legendSwatchGap) - L.legendRemoveZone;
    const noteFont = fontSpec(style, 'legendNote');
    const labelLineH = style.font.legendLabel.size + 6;
    const noteLineH = style.font.legendNote.lineHeight;
    const legendTop = phaseLabelY + (style.font.phaseLabel.size + 6) + L.legendGap;

    let cursor = legendTop;
    const legendRows: LegendRow[] = [...model.curves.keys()].reverse().map((curveIndex) => {
        const curve = model.curves[curveIndex];
        const noteLines = wrapText(curve.notes, legendWidth, noteFont);
        const height = labelLineH + noteLines.length * noteLineH + L.legendRowGap;
        const row: LegendRow = { top: cursor, height, label: curve.label, noteLines };
        cursor += height;
        return row;
    });

    const legendBottom = legendRows.length > 0 ? cursor : legendTop;
    // In the editor the legend reserves one extra row for the "+ Add curve" affordance.
    const legendRowH = labelLineH + noteLineH + 8;
    const contentBottom = options.editing ? legendBottom + legendRowH : legendBottom;
    const width = L.margin.left + plotWidth + L.margin.right;
    const height = contentBottom + L.margin.bottom;

    return {
        width,
        height,
        plotX0,
        plotY0,
        plotX1,
        plotY1,
        plotWidth,
        plotHeight,
        baselineY,
        phaseXs,
        phaseLabelY,
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
    return [...curve.points].sort((a, b) => a.x - b.x);
}

/** The top-line commands (after the initial M) for points already in pixel space. */
function topLineCommands(pts: Pt[], smooth: boolean): string {
    if (pts.length < 2) return '';
    if (!smooth) {
        let d = '';
        for (let i = 1; i < pts.length; i++) {
            d += `L${round(pts[i].x)},${round(pts[i].y)}`;
        }
        return d;
    }
    // Catmull-Rom converted to cubic beziers, endpoints clamped.
    let d = '';
    for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[Math.max(i - 1, 0)];
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const p3 = pts[Math.min(i + 2, pts.length - 1)];
        const c1x = p1.x + (p2.x - p0.x) / 6;
        const c1y = p1.y + (p2.y - p0.y) / 6;
        const c2x = p2.x - (p3.x - p1.x) / 6;
        const c2y = p2.y - (p3.y - p1.y) / 6;
        d += `C${round(c1x)},${round(c1y)} ${round(c2x)},${round(c2y)} ${round(p2.x)},${round(p2.y)}`;
    }
    return d;
}

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
    // Same bezier control points as topLineCommands; B(0.5) = (P0 + 3P1 + 3P2 + P3) / 8.
    const atMid = (p1: number, c1: number, c2: number, p2: number): number =>
        (p1 + 3 * c1 + 3 * c2 + p2) / 8;
    return {
        x: atMid(a.x, a.x + (b.x - p0.x) / 6, b.x - (p3.x - a.x) / 6, b.x),
        y: atMid(a.y, a.y + (b.y - p0.y) / 6, b.y - (p3.y - a.y) / 6, b.y),
    };
}

/** Open path along the curve's top edge. */
export function curveLinePath(curve: Curve, geom: GraphGeom): string {
    const pts = sortedPoints(curve).map((p) => geom.toPx(p.x, p.y));
    if (pts.length === 0) return '';
    return `M${round(pts[0].x)},${round(pts[0].y)}` + topLineCommands(pts, curve.smooth);
}

/** Closed path: the top edge filled down to the baseline. */
export function curveAreaPath(curve: Curve, geom: GraphGeom): string {
    const pts = sortedPoints(curve).map((p) => geom.toPx(p.x, p.y));
    if (pts.length === 0) return '';
    const first = pts[0];
    const last = pts[pts.length - 1];
    return (
        `M${round(first.x)},${round(geom.baselineY)} L${round(first.x)},${round(first.y)}` +
        topLineCommands(pts, curve.smooth) +
        ` L${round(last.x)},${round(geom.baselineY)} Z`
    );
}

export function pointPx(point: CurvePoint, geom: GraphGeom): Pt {
    return geom.toPx(point.x, point.y);
}

function peakPoint(curve: Curve): CurvePoint | null {
    let best: CurvePoint | null = null;
    for (const point of curve.points) {
        if (best === null || point.y > best.y) best = point;
    }
    return best;
}

// --- SVG assembly ------------------------------------------------------------

function svgEl<Tag extends keyof SVGElementTagNameMap>(
    tag: Tag,
    attrs: Record<string, string | number>
): SVGElementTagNameMap[Tag] {
    const element = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attrs)) {
        element.setAttribute(name, String(value));
    }
    return element;
}

function textEl(content: string, attrs: Record<string, string | number>): SVGTextElement {
    const element = svgEl('text', attrs);
    element.textContent = content;
    return element;
}

/** Bare dashed hint line for empty fields inside an already-clickable group. */
function dashedHintLine(x1: number, x2: number, y: number, palette: CanvasPalette): SVGLineElement {
    return svgEl('line', {
        x1: round(x1),
        y1: round(y),
        x2: round(x2),
        y2: round(y),
        stroke: palette.tickLabel,
        'stroke-width': 1.5,
        'stroke-dasharray': '5 4',
        'pointer-events': 'none',
    });
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
    attrs: Record<string, string | number>
): SVGGElement {
    const group = svgEl('g', { ...attrs, class: 'empty-hint' });
    group.appendChild(
        svgEl('rect', {
            x: round(cx - halfWidth),
            y: round(y - 13),
            width: round(halfWidth * 2),
            height: 26,
            fill: 'transparent',
            'pointer-events': 'all',
        })
    );
    group.appendChild(
        svgEl('line', {
            x1: round(cx - halfWidth),
            y1: round(y),
            x2: round(cx + halfWidth),
            y2: round(y),
            stroke: palette.tickLabel,
            'stroke-width': 1.5,
            'stroke-dasharray': '5 4',
            'pointer-events': 'none',
        })
    );
    return group;
}

export function renderGraphSvg(model: GraphModel, options: RenderOptions): SVGSVGElement {
    const geom = computeLayout(model, options);
    const { style, palette } = geom;
    const L = style.layout;

    const svg = svgEl('svg', {
        xmlns: SVG_NS,
        viewBox: `0 0 ${round(geom.width)} ${round(geom.height)}`,
        width: round(geom.width),
        height: round(geom.height),
        class: 'graph-svg',
    });
    svg.setAttribute('font-family', style.font.family);

    if (!options.transparentBackground) {
        svg.appendChild(
            svgEl('rect', {
                x: 0,
                y: 0,
                width: round(geom.width),
                height: round(geom.height),
                fill: palette.background,
            })
        );
    }

    // Title
    const title = (model.title ?? '').trim();
    if (title !== '') {
        svg.appendChild(
            textEl(title, {
                x: round(geom.plotX0 + geom.plotWidth / 2),
                y: round(style.layout.margin.top + style.layout.titleSpace * 0.7),
                'text-anchor': 'middle',
                fill: palette.title,
                'font-size': style.font.title.size,
                'font-weight': style.font.title.weight,
                'data-edit-field': 'title',
            })
        );
    } else if (options.editing) {
        svg.appendChild(
            hintPlaceholder(
                geom.plotX0 + geom.plotWidth / 2,
                style.layout.margin.top + style.layout.titleSpace * 0.7 - 5,
                150,
                palette,
                { 'data-edit-field': 'title' }
            )
        );
    }

    // Axes are split into two layers so curve fills can never cover the axis lines: the faint
    // grid / phase ticks paint *below* the curves, everything structural (axis lines, arrowheads,
    // baseline, tick and phase labels, y-axis title) paints *above* them.
    const grid = svgEl('g', { class: 'grid' });
    const axes = svgEl('g', { class: 'axes' });
    if (model.numericAxis) {
        for (const value of [0, 25, 50, 75, 100]) {
            const py = geom.toPx(0, value).y;
            if (value !== 0) {
                grid.appendChild(
                    svgEl('line', {
                        x1: round(geom.plotX0),
                        y1: round(py),
                        x2: round(geom.plotX1),
                        y2: round(py),
                        stroke: palette.grid,
                        'stroke-width': 1,
                    })
                );
            }
            axes.appendChild(
                textEl(String(value), {
                    x: round(geom.plotX0 - 10),
                    y: round(py + 4),
                    'text-anchor': 'end',
                    fill: palette.tickLabel,
                    'font-size': style.font.tickLabel.size,
                    'font-weight': style.font.tickLabel.weight,
                })
            );
        }
        // Y axis line
        axes.appendChild(
            svgEl('line', {
                x1: round(geom.plotX0),
                y1: round(geom.plotY0),
                x2: round(geom.plotX0),
                y2: round(geom.baselineY),
                stroke: palette.axis,
                'stroke-width': 2,
            })
        );
    } else {
        // X axis with arrowhead
        axes.appendChild(
            svgEl('line', {
                x1: round(geom.plotX0),
                y1: round(geom.baselineY),
                x2: round(geom.plotX1 + 10),
                y2: round(geom.baselineY),
                stroke: palette.axis,
                'stroke-width': 2,
            })
        );
        axes.appendChild(
            svgEl('polygon', {
                points: `${round(geom.plotX1 + 10)},${round(geom.baselineY - 5)} ${round(
                    geom.plotX1 + 20
                )},${round(geom.baselineY)} ${round(geom.plotX1 + 10)},${round(
                    geom.baselineY + 5
                )}`,
                fill: palette.axis,
            })
        );
        // Y axis with arrowhead
        axes.appendChild(
            svgEl('line', {
                x1: round(geom.plotX0),
                y1: round(geom.baselineY),
                x2: round(geom.plotX0),
                y2: round(geom.plotY0 - 10),
                stroke: palette.axis,
                'stroke-width': 2,
            })
        );
        axes.appendChild(
            svgEl('polygon', {
                points: `${round(geom.plotX0 - 5)},${round(geom.plotY0 - 10)} ${round(
                    geom.plotX0
                )},${round(geom.plotY0 - 20)} ${round(geom.plotX0 + 5)},${round(geom.plotY0 - 10)}`,
                fill: palette.axis,
            })
        );
    }

    // Baseline (both modes)
    axes.appendChild(
        svgEl('line', {
            x1: round(geom.plotX0),
            y1: round(geom.baselineY),
            x2: round(geom.plotX1),
            y2: round(geom.baselineY),
            stroke: palette.axis,
            'stroke-width': 2,
        })
    );

    // Phase ticks + labels. In edit mode each label sits in a group that reveals a small ✕
    // on hover (remove phase); the label itself is click-to-edit / drag-to-reorder.
    model.phases.forEach((phase, index) => {
        const px = geom.phaseXs[index];
        grid.appendChild(
            svgEl('line', {
                x1: round(px),
                y1: round(geom.plotY0),
                x2: round(px),
                y2: round(geom.baselineY),
                stroke: palette.phaseTick,
                'stroke-width': 1,
            })
        );
        const group = svgEl('g', { class: 'phase-group' });
        group.appendChild(
            textEl(phase.label, {
                x: round(px),
                y: round(geom.phaseLabelY),
                'text-anchor': 'middle',
                fill: palette.phaseLabel,
                'font-size': style.font.phaseLabel.size,
                'font-weight': style.font.phaseLabel.weight,
                class: 'phase-label',
                'data-edit-field': 'phase',
                'data-phase-index': index,
            })
        );
        if (phase.label === '' && options.editing) {
            group.appendChild(
                hintPlaceholder(px, geom.phaseLabelY - 5, 36, palette, {
                    'data-edit-field': 'phase',
                    'data-phase-index': index,
                })
            );
        }
        if (options.editing) {
            const remove = svgEl('g', { class: 'phase-remove', 'data-phase-remove': index });
            remove.appendChild(
                svgEl('circle', {
                    cx: round(px),
                    cy: round(geom.phaseLabelY + 24),
                    r: 9,
                    fill: palette.background,
                    stroke: palette.legendSwatchStroke,
                    'stroke-width': 1,
                })
            );
            remove.appendChild(
                textEl('✕', {
                    x: round(px),
                    y: round(geom.phaseLabelY + 28),
                    'text-anchor': 'middle',
                    fill: palette.phaseLabel,
                    'font-size': 11,
                    'font-weight': 700,
                })
            );
            group.appendChild(remove);
        }
        axes.appendChild(group);
    });

    // Y-axis title (rotated)
    const yTitle = (model.yAxisTitle ?? '').trim();
    // A rotated `<text>` grows to the *left* of its baseline, so hug the title's baseline against
    // whatever owns the left gutter: the tick labels when the numeric axis is on, the axis line
    // itself otherwise. Anything larger reopens a dead gap between the label and the y-axis.
    const tickGutter = L.margin.left - 10 - style.font.tickLabel.size;
    // Leave ~2px of ink between the label and the gutter content it hugs.
    const yTitlePad = (style.font.axisTitle.size + 6) / 2 + 2;
    const yTitleX = model.numericAxis
        ? round(tickGutter - yTitlePad)
        : round(L.margin.left - 8 - yTitlePad);
    const yTitleY = (geom.plotY0 + geom.baselineY) / 2;
    if (yTitle !== '') {
        axes.appendChild(
            textEl(yTitle, {
                x: round(yTitleX),
                y: round(yTitleY),
                'text-anchor': 'middle',
                fill: palette.axisTitle,
                'font-size': style.font.axisTitle.size,
                'font-weight': style.font.axisTitle.weight,
                transform: `rotate(-90 ${round(yTitleX)} ${round(yTitleY)})`,
                'data-edit-field': 'yaxis',
            })
        );
    } else if (options.editing) {
        // The hint's rotated text grows left from its baseline, so anchor the baseline near the
        // gutter edge instead of centring it on `yTitleX` — otherwise half the band falls off the
        // canvas and the field looks unclickable.
        const hintBaseline = model.numericAxis
            ? round(L.margin.left - 10 - style.font.tickLabel.size - 2)
            : round(L.margin.left - 10);
        const hint = svgEl('g', { 'data-edit-field': 'yaxis', class: 'empty-hint' });
        hint.appendChild(
            svgEl('rect', {
                x: round(hintBaseline - (style.font.axisTitle.size + 6)),
                y: round(yTitleY - 90),
                width: round(style.font.axisTitle.size + 6 + 8),
                height: 180,
                fill: 'transparent',
                'pointer-events': 'all',
            })
        );
        hint.appendChild(
            svgEl('line', {
                x1: hintBaseline,
                y1: round(yTitleY - 90),
                x2: hintBaseline,
                y2: round(yTitleY + 90),
                stroke: palette.tickLabel,
                'stroke-width': 1.5,
                'stroke-dasharray': '5 4',
                'pointer-events': 'none',
            })
        );
        axes.appendChild(hint);
    }

    svg.appendChild(grid);

    // Curves (fills + top lines), later curves paint on top so overlaps blend.
    const curvesGroup = svgEl('g', { class: 'curves' });
    model.curves.forEach((curve, index) => {
        const group = svgEl('g', { 'data-curve-index': index });
        group.appendChild(
            svgEl('path', {
                d: curveAreaPath(curve, geom),
                fill: curve.color,
                'fill-opacity': curve.opacity,
                class: 'curve-fill',
                'pointer-events': 'all',
            })
        );
        group.appendChild(
            svgEl('path', {
                d: curveLinePath(curve, geom),
                fill: 'none',
                stroke: curve.color,
                'stroke-width': style.curveStrokeWidth,
                'stroke-linecap': 'round',
                'stroke-linejoin': 'round',
                class: 'curve-line',
                'pointer-events': 'none',
            })
        );
        // Invisible wide stroke over the top line: makes the curve hoverable/clickable as a band
        // (and hover-highlightable) without painting anything.
        group.appendChild(
            svgEl('path', {
                d: curveLinePath(curve, geom),
                fill: 'none',
                stroke: 'transparent',
                'stroke-width': Math.max(14, style.curveStrokeWidth + 10),
                'stroke-linecap': 'round',
                'stroke-linejoin': 'round',
                class: 'curve-hit',
                'pointer-events': 'stroke',
            })
        );
        curvesGroup.appendChild(group);
    });
    svg.appendChild(curvesGroup);

    // In-plot curve labels at each peak.
    const labelsGroup = svgEl('g', { class: 'curve-labels' });
    model.curves.forEach((curve, index) => {
        const label = (curve.label ?? '').trim();
        const peak = peakPoint(curve);
        if (peak === null) return;
        const p = geom.toPx(peak.x, peak.y);
        let ty = p.y - 12;
        if (ty < geom.plotY0 + 14) ty = p.y + 20;
        if (label !== '') {
            labelsGroup.appendChild(
                textEl(label, {
                    x: round(p.x),
                    y: round(ty),
                    'text-anchor': 'middle',
                    fill: palette.curveLabel,
                    'font-size': style.font.curveLabel.size,
                    'font-weight': style.font.curveLabel.weight,
                    'paint-order': 'stroke',
                    stroke: palette.curveLabelHalo,
                    'stroke-width': 4,
                    'stroke-linejoin': 'round',
                    'data-curve-index': index,
                    'data-edit-field': 'curve-label',
                })
            );
        } else if (options.editing) {
            labelsGroup.appendChild(
                hintPlaceholder(p.x, ty - 5, 60, palette, {
                    'data-curve-index': index,
                    'data-edit-field': 'curve-label',
                })
            );
        }
    });
    svg.appendChild(labelsGroup);
    // Axis lines / arrowheads / labels sit above every curve so nothing can occlude them.
    svg.appendChild(axes);

    // Legend below: one editable block per curve (first line = label, rest = notes). Rows are
    // displayed in REVERSE paint order: the front-most curve (last in the model) sits on top.
    const legendGroup = svgEl('g', { class: 'legend' });
    const labelLineH = style.font.legendLabel.size + 6;
    const noteLineH = style.font.legendNote.lineHeight;
    const displayOrder = [...model.curves.keys()].reverse();
    displayOrder.forEach((curveIndex, slot) => {
        const row = geom.legendRows[slot];
        const curve = model.curves[curveIndex];
        const swatchX = geom.legendX + L.legendRemoveZone;
        const textX = swatchX + L.legendSwatch + L.legendSwatchGap;
        const rowHeight = row.height - L.legendRowGap;
        const block = svgEl('g', {
            class: 'legend-block',
            'data-edit-field': 'legend-block',
            'data-curve-index': curveIndex,
        });
        block.appendChild(
            svgEl('rect', {
                x: round(geom.legendX),
                y: round(row.top),
                width: round(L.legendRemoveZone + L.legendSwatch + L.legendSwatchGap + geom.legendWidth),
                height: round(rowHeight),
                fill: 'transparent',
                'pointer-events': 'all',
            })
        );
        // Hover-revealed affordances left of the color swatch (editor only): a drag handle that
        // reorders the curve's layer, and a ✕ that removes it.
        if (options.editing) {
            const rowMidY = row.top + L.legendSwatch / 2;
            const handle = svgEl('g', { class: 'legend-drag', 'data-curve-drag': curveIndex });
            handle.appendChild(
                svgEl('rect', {
                    x: round(geom.legendX),
                    y: round(row.top),
                    width: 18,
                    height: round(L.legendSwatch),
                    fill: 'transparent',
                })
            );
            for (const dotX of [geom.legendX + 5, geom.legendX + 13]) {
                for (const dotY of [rowMidY - 4, rowMidY, rowMidY + 4]) {
                    handle.appendChild(
                        svgEl('circle', {
                            cx: round(dotX),
                            cy: round(dotY),
                            r: 1.6,
                            fill: palette.legendMuted,
                        })
                    );
                }
            }
            block.appendChild(handle);

            const remove = svgEl('g', { class: 'legend-remove', 'data-curve-remove': curveIndex });
            remove.appendChild(
                svgEl('circle', {
                    cx: round(geom.legendX + 30),
                    cy: round(rowMidY),
                    r: 8,
                    fill: palette.background,
                    stroke: palette.legendSwatchStroke,
                    'stroke-width': 1,
                })
            );
            remove.appendChild(
                textEl('✕', {
                    x: round(geom.legendX + 30),
                    y: round(rowMidY + 4),
                    'text-anchor': 'middle',
                    fill: palette.phaseLabel,
                    'font-size': 10,
                    'font-weight': 700,
                })
            );
            block.appendChild(remove);
        }
        block.appendChild(
            svgEl('rect', {
                x: round(swatchX),
                y: round(row.top),
                width: L.legendSwatch,
                height: L.legendSwatch,
                rx: 3,
                fill: curve.color,
                'fill-opacity': Math.max(0.85, curve.opacity),
                stroke: palette.legendSwatchStroke,
                'stroke-width': 1,
                class: 'legend-swatch',
                'data-swatch-index': curveIndex,
                'pointer-events': options.editing ? 'all' : 'none',
            })
        );
        if (row.label !== '') {
            block.appendChild(
                textEl(row.label, {
                    x: round(textX),
                    y: round(row.top + style.font.legendLabel.size),
                    fill: palette.legendText,
                    'font-size': style.font.legendLabel.size,
                    'font-weight': style.font.legendLabel.weight,
                    'pointer-events': 'none',
                })
            );
        } else if (options.editing) {
            block.appendChild(
                dashedHintLine(textX, textX + 120, row.top + labelLineH - 6, palette)
            );
        }
        // Notes get no placeholder: the wrapped note lines would otherwise show a long dash rule.
        if (row.noteLines.length > 0) {
            row.noteLines.forEach((line, j) => {
                block.appendChild(
                    textEl(line, {
                        x: round(textX),
                        y: round(row.top + labelLineH + j * noteLineH + style.font.legendNote.size),
                        fill: palette.legendMuted,
                        'font-size': style.font.legendNote.size,
                        'font-weight': style.font.legendNote.weight,
                        'pointer-events': 'none',
                    })
                );
            });
        }
        legendGroup.appendChild(block);
    });

    // WYSIWYG "add curve": a dashed placeholder row at the bottom of the legend, in place of the
    // old toolbar button. Clicking it appends a curve and immediately selects its label for typing.
    if (options.editing && model.curves.length < MAX_CURVES) {
        const addRow = svgEl('g', { class: 'legend-add', 'data-curve-add': 1 });
        const textX = geom.legendX + L.legendRemoveZone;
        addRow.appendChild(
            svgEl('rect', {
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
        addRow.appendChild(
            textEl('+ Add curve', {
                x: round(textX),
                y: round(geom.legendBottom + style.font.legendLabel.size - 2),
                fill: palette.legendMuted,
                'font-size': style.font.legendLabel.size,
                'font-weight': style.font.legendNote.weight,
                'pointer-events': 'none',
            })
        );
        legendGroup.appendChild(addRow);
    }

    svg.appendChild(legendGroup);

    // Attribution (exports only).
    if (options.attribution) {
        svg.appendChild(
            textEl('shift-left-right.builder', {
                x: round(geom.width - style.layout.margin.right),
                y: round(geom.height - 6),
                'text-anchor': 'end',
                fill: palette.tickLabel,
                'font-size': 10,
            })
        );
    }

    return svg;
}

/** Serialize the SVG element into a standalone document string, optionally embedding font CSS. */
export function serializeSvg(svg: SVGSVGElement, options: { embedFontCss?: string } = {}): string {
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('xmlns', SVG_NS);
    const viewBox = clone.getAttribute('viewBox')?.trim().split(/\s+/).map(Number) ?? [];
    if (viewBox.length === 4 && viewBox[2] > 0) {
        clone.setAttribute('width', String(viewBox[2]));
        clone.setAttribute('height', String(viewBox[3]));
    }
    if (options.embedFontCss) {
        const styleEl = document.createElementNS(SVG_NS, 'style');
        styleEl.setAttribute('type', 'text/css');
        styleEl.textContent = options.embedFontCss;
        clone.insertBefore(styleEl, clone.firstChild);
    }
    return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`;
}
