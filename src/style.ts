/**
 * The single clean visual style for v1 — a small, pluggable style object (colors, typography,
 * layout geometry). This is deliberately NOT the reference app's 7-style system; it is one
 * `GraphStyle` so the renderer stays style-driven and more styles can be added later without
 * reworking render.ts.
 *
 * Accessibility (owner has dyslexia): no all-caps, mixed case, generous line height, no wide
 * letter-spacing. Accent is a Klein-class blue (strong on both light and dark); no acid yellow.
 */

export interface RoleFont {
    size: number;
    weight: number;
}

export interface NoteFont extends RoleFont {
    lineHeight: number;
}

export type FontRole =
    | 'title'
    | 'axisTitle'
    | 'phaseLabel'
    | 'tickLabel'
    | 'curveLabel'
    | 'legendLabel'
    | 'legendNote';

export interface Typography {
    family: string;
    title: RoleFont;
    axisTitle: RoleFont;
    phaseLabel: RoleFont;
    tickLabel: RoleFont;
    curveLabel: RoleFont;
    legendLabel: RoleFont;
    legendNote: NoteFont;
}

export interface CanvasPalette {
    background: string;
    axis: string;
    grid: string;
    phaseTick: string;
    phaseLabel: string;
    tickLabel: string;
    title: string;
    axisTitle: string;
    /** In-plot curve label text color and the halo drawn behind it for legibility over fills. */
    curveLabel: string;
    curveLabelHalo: string;
    legendText: string;
    legendMuted: string;
    legendSwatchStroke: string;
}

export interface Layout {
    plotWidth: number;
    plotHeight: number;
    margin: { top: number; right: number; bottom: number; left: number };
    /** Band reserved above the plot for the title (used only when a title is present). */
    titleSpace: number;
    titleGap: number;
    /** Gap between the baseline and the phase-label baseline. */
    phaseLabelGap: number;
    /** Gap between the phase labels and the legend block. */
    legendGap: number;
    legendRowGap: number;
    legendSwatch: number;
    legendSwatchGap: number;
    /** Space left of the legend swatch for the hover-revealed drag handle + remove button. */
    legendRemoveZone: number;
}

export interface GraphStyle {
    id: string;
    name: string;
    font: Typography;
    light: CanvasPalette;
    dark: CanvasPalette;
    layout: Layout;
    curveStrokeWidth: number;
    /** Radius of an editing control-point handle (px). */
    pointRadius: number;
}

const SYSTEM_STACK =
    "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

export const STYLE: GraphStyle = {
    id: 'clean',
    name: 'Clean',
    font: {
        family: SYSTEM_STACK,
        title: { size: 22, weight: 700 },
        axisTitle: { size: 14, weight: 600 },
        phaseLabel: { size: 15, weight: 600 },
        tickLabel: { size: 12, weight: 500 },
        curveLabel: { size: 15, weight: 700 },
        legendLabel: { size: 14, weight: 700 },
        legendNote: { size: 13, weight: 400, lineHeight: 18 },
    },
    light: {
        background: '#ffffff',
        axis: '#243041',
        grid: '#e7ebf0',
        phaseTick: '#dfe3e8',
        phaseLabel: '#243041',
        tickLabel: '#5f6b7a',
        title: '#16213a',
        axisTitle: '#243041',
        curveLabel: '#12203a',
        curveLabelHalo: '#ffffff',
        legendText: '#243041',
        legendMuted: '#5f6b7a',
        legendSwatchStroke: '#00000022',
    },
    dark: {
        background: '#14171d',
        axis: '#c7d0dc',
        grid: '#2a313c',
        phaseTick: '#2a313c',
        phaseLabel: '#e6e9ee',
        tickLabel: '#9aa4b2',
        title: '#eef2f7',
        axisTitle: '#c7d0dc',
        curveLabel: '#f2f5fa',
        curveLabelHalo: '#0b1220',
        legendText: '#e6e9ee',
        legendMuted: '#9aa4b2',
        legendSwatchStroke: '#ffffff33',
    },
    layout: {
        plotWidth: 920,
        plotHeight: 460,
        margin: { top: 28, right: 76, bottom: 24, left: 64 },
        titleSpace: 40,
        titleGap: 18,
        phaseLabelGap: 30,
        legendGap: 26,
        legendRowGap: 12,
        legendSwatch: 16,
        legendSwatchGap: 10,
        legendRemoveZone: 42,
    },
    curveStrokeWidth: 2.5,
    pointRadius: 6,
};
