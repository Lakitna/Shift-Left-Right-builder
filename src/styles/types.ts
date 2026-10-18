/**
 * The style contract: one `GraphStyle` object fully describes a visual language —
 * typography, canvas colors, fills (solid or hatched), hand-drawn jitter, label treatment,
 * frame, layout geometry and the app-chrome CSS variables.
 *
 * A style is chrome, NOT data: it never changes what a graph *is* (curves, points, phases,
 * events, labels, notes), only how it looks. Curve fills are resolved at render time: a
 * curve keeps its own color only when `colorCustom` is set (or the style's colorSource is
 * 'data'); otherwise the style's palette (or hatch pattern / gradient cycle) wins.
 *
 * Authoring rules (accessibility, see also styles/validate.ts):
 * - No all-caps anywhere; no text-transform, tracking stays ≤ 0.01em.
 * - No acid/neon yellow as an accent; strong blues (Klein-class) are the safe accent.
 * - Text on chips/plates must reach 7:1 contrast; curve fills 3:1 against the ground.
 * - Dyslexia-friendly: generous line height, avoid wide letter-spacing and justified text.
 */

export type StyleRole =
    | 'title'
    | 'axisTitle'
    | 'phaseLabel'
    | 'eventLabel'
    | 'eventNote'
    | 'tickLabel'
    | 'curveLabel'
    | 'legendLabel'
    | 'legendNote';

export interface TypographyRole {
    /**
    Primary family; appended with the style's fallback stack. '' = fallback only.
    */
    family: string;
    weight: number;
    /**
    Font size in px.
    */
    size: number;
}

/**
 * Roles that can stack multiple lines carry the line height they stack by. Single-line
 * roles take their vertical metrics from layout bands instead — no dead lineHeight on those.
 */
export interface MultilineTypographyRole extends TypographyRole {
    lineHeight: number;
}

export interface StyleTypography {
    /**
    System stack used when a bundled family is unavailable.
    */
    fallback: string;
    roles: {
        title: TypographyRole;
        axisTitle: TypographyRole;
        phaseLabel: TypographyRole;
        eventLabel: TypographyRole;
        eventNote: MultilineTypographyRole;
        tickLabel: TypographyRole;
        curveLabel: TypographyRole;
        legendLabel: TypographyRole;
        legendNote: MultilineTypographyRole;
    };
    /**
    [family, weight] pairs to load before first render and embed in exports.
    */
    fonts: [string, number][];
}

export interface CanvasPalette {
    background: string;
    /**
    Axis lines + arrowheads.
    */
    axis: string;
    /**
    Numeric gridlines.
    */
    grid: string;
    /**
    Phase boundary separators.
    */
    phaseTick: string;
    phaseLabel: string;
    /**
    Vertical gate line + baseline diamond marker for a moment-in-time event.
    */
    eventLine: string;
    /**
    Event callout label text (above the plot).
    */
    eventLabel: string;
    tickLabel: string;
    title: string;
    axisTitle: string;
    /**
    In-plot curve label text color (plain-halo styles) and the halo drawn behind it.
    */
    curveLabel: string;
    curveLabelHalo: string;
    legendText: string;
    legendMuted: string;
    legendSwatchStroke: string;
    /**
    Ink for hand-drawn outlines, frames, leaders and hatch patterns.
    */
    ink: string;
    /**
    Label chip/plate/bubble ground, border and text.
    */
    chip: string;
    chipStroke: string;
    chipText: string;
    /**
    Dashed "click to edit" hint lines.
    */
    hint: string;
}

export type PatternName = 'none' | 'diag45' | 'diag-45' | 'cross' | 'dots' | 'horizontal';

export interface StyleGradient {
    /**
    Evenly spaced color stops, drawn along the area's diagonal (the barf angle).
    */
    stops: string[];
}

export interface PatternDefinition {
    name: PatternName;
    /**
    Default color for this pattern — e.g. a colored-pencil hue. Falls back to ink.
    */
    color?: string;
}

export interface StyleFills {
    /**
    'pattern' cycles `patterns` per curve; 'gradient' cycles `gradients` per curve.
    */
    mode: 'solid' | 'pattern' | 'gradient';
    patterns: PatternDefinition[];
    /**
    Cycled per curve when mode='gradient' (each curve gets its own rainbow).
    */
    gradients?: StyleGradient[];
    patternSpacing: number;
    patternStroke: number;
    patternOpacity: number;
}

export interface StyleStroke {
    /**
     * Width of the ink line drawn along each curve's top edge (0 = the line follows the
     * effective fill color at `curveStrokeWidth` instead).
     */
    curveOutline: number;
}

export interface StyleJitter {
    /**
    Perpendicular wobble amplitude in px; 0 = straight edges.
    */
    amplitude: number;
    /**
    Distance between wobble control points.
    */
    segmentLength: number;
    /**
    Seed salt so different styles wobble differently but deterministically.
    */
    salt: number;
}

export type LabelMode = 'chip' | 'plain-halo' | 'plate' | 'bubble';

export interface StyleLabelTreatment {
    mode: LabelMode;
    /**
    Corner radius of the label box (plate = 0).
    */
    rx: number;
    padX: number;
    /**
    Box height in px; the baseline sits 7px below the vertical center.
    */
    height: number;
    borderWidth: number;
    /**
    Sticker shadow offset for 'bubble' (0 = none).
    */
    shadowOffset: number;
    /**
    Halo stroke width for 'plain-halo'.
    */
    haloWidth: number;
}

export type FrameMode = 'none' | 'single' | 'double';

export interface ChromeTokens {
    '--background': string;
    '--surface': string;
    '--border': string;
    '--text': string;
    '--text-muted': string;
    '--accent': string;
    /**
     * Readable text color ON accent-filled surfaces (primary buttons). Optional: styles
     * with saturated/dark accents can rely on the stylesheet default (white); styles whose
     * accent is a light paper color (draftsman dark) must set a dark ink here.
     */
    '--accent-ink'?: string;
    '--danger': string;
    '--hover': string;
    '--font-ui': string;
}

/**
Glitter scattered deterministically across the canvas, under all content.
*/
export interface StyleSparkles {
    count: number;
    colors: string[];
    opacity: number;
    minSize: number;
    maxSize: number;
}

/**
Plot + legend geometry. Shared by all styles; per-style tweaks happen inside the values.
*/
export interface Layout {
    plotWidth: number;
    plotHeight: number;
    margin: { top: number; right: number; bottom: number; left: number };
    /**
    Band reserved above the plot for the title (used only when a title is present).
    */
    titleSpace: number;
    titleGap: number;
    /**
    Gap between the baseline and the phase-label baseline.
    */
    phaseLabelGap: number;
    /**
    Gap between the phase labels and the legend block.
    */
    legendGap: number;
    /** Event callout band above the plot: label gap, note line height, leader tick length, and
     *  bottom padding before the plot top. */
    eventLabelGap: number;
    eventNoteLineH: number;
    eventLeader: number;
    eventBandPad: number;
    /**
    Max width an event note wraps to, so callouts stay compact.
    */
    eventCalloutMaxWidth: number;
    legendRowGap: number;
    legendSwatch: number;
    legendSwatchGap: number;
    /**
    Space left of the legend swatch for the hover-revealed drag handle + remove button.
    */
    legendRemoveZone: number;
}

export interface GraphStyle {
    /**
    Stable id used in the URL `#s=` param and localStorage. Never rename shipped ids.
    */
    id: string;
    /**
    Display name in the style selector.
    */
    name: string;
    typography: StyleTypography;
    canvas: { light: CanvasPalette; dark: CanvasPalette };
    fills: StyleFills;
    stroke: StyleStroke;
    jitter: StyleJitter;
    label: StyleLabelTreatment;
    frame: FrameMode;
    sparkles?: StyleSparkles;
    curves: {
        /**
         * 'data' honors each curve's stored color (classic — keeps old shared links and
         * the color picker semantics intact); 'palette' lets the style palette win
         * positionally unless the curve is marked `colorCustom`.
         */
        colorSource: 'data' | 'palette';
        palette: { light: string[]; dark: string[] };
    };
    layout: Layout;
    chrome: { light: ChromeTokens; dark: ChromeTokens };
    /**
    Top-edge line width when `stroke.curveOutline` is 0.
    */
    curveStrokeWidth: number;
    /**
    Radius of an editing control-point handle (px).
    */
    pointRadius: number;
}
