import type { GraphStyle } from './types';

const HAND = "'Patrick Hand'";
const MONO = "'IBM Plex Mono'";
const STACK = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

/**
 * Black-and-white engineering drawing, hand-drawn and wall-art grade: wobbled ink lines,
 * hatch patterns instead of fills, a double border frame, lettering-architect handwriting
 * with mono annotations. The graph reads as a drawing sheet.
 */
export const draftsmanStyle: GraphStyle = {
    id: 'draftsman',
    name: 'Draftsman',
    typography: {
        fallback: STACK,
        roles: {
            title: { family: HAND, weight: 400, size: 24 },
            axisTitle: { family: HAND, weight: 400, size: 16 },
            phaseLabel: { family: HAND, weight: 400, size: 16 },
            eventLabel: { family: HAND, weight: 400, size: 15 },
            eventNote: { family: MONO, weight: 400, size: 11.5, lineHeight: 15 },
            tickLabel: { family: MONO, weight: 400, size: 11.5 },
            curveLabel: { family: HAND, weight: 400, size: 16 },
            legendLabel: { family: HAND, weight: 400, size: 15 },
            legendNote: { family: MONO, weight: 400, size: 11.5, lineHeight: 15 },
        },
        fonts: [
            ['Patrick Hand', 400],
            ['IBM Plex Mono', 400],
        ],
    },
    canvas: {
        light: {
            background: '#fbfaf6',
            axis: '#1c1c1a',
            grid: '#e8e4d6',
            phaseTick: '#ddd8c8',
            phaseLabel: '#1c1c1a',
            eventLine: '#1c1c1a',
            eventLabel: '#1c1c1a',
            tickLabel: '#3a382f',
            title: '#1c1c1a',
            axisTitle: '#1c1c1a',
            curveLabel: '#1c1c1a',
            curveLabelHalo: '#fbfaf6',
            legendText: '#1c1c1a',
            legendMuted: '#3a382f',
            legendSwatchStroke: '#1c1c1a',
            ink: '#1c1c1a',
            chip: '#fbfaf6',
            chipStroke: '#1c1c1a',
            chipText: '#1c1c1a',
            hint: '#74716a',
        },
        dark: {
            background: '#17181a',
            badgeForeground: '#17181a',
            axis: '#f2efe6',
            grid: '#2a2b2e',
            phaseTick: '#33343a',
            phaseLabel: '#f2efe6',
            eventLine: '#f2efe6',
            eventLabel: '#f2efe6',
            tickLabel: '#c9c5b8',
            title: '#f2efe6',
            axisTitle: '#f2efe6',
            curveLabel: '#f2efe6',
            curveLabelHalo: '#17181a',
            legendText: '#f2efe6',
            legendMuted: '#c9c5b8',
            legendSwatchStroke: '#f2efe6',
            ink: '#f2efe6',
            chip: '#17181a',
            chipStroke: '#f2efe6',
            chipText: '#f2efe6',
            hint: '#86827b',
        },
    },
    fills: {
        mode: 'pattern',
        // Colored-pencil hatching over engineering ink: muted, slightly chalky hues like a
        // classic pencil tin. The bare-paper curve stays colorless; the pencil tin doubles
        // as the selector palette.
        patterns: [
            { name: 'diag45', color: '#b3455a' },
            { name: 'diag-45', color: '#3f6fb5' },
            { name: 'cross', color: '#7a5fae' },
            { name: 'horizontal', color: '#c07a2e' },
            { name: 'dots', color: '#4f8f5f' },
            { name: 'none' },
        ],
        patternSpacing: 10,
        patternStroke: 2,
        patternOpacity: 0.75,
    },
    stroke: { curveOutline: 1.5 },
    jitter: { amplitude: 1, segmentLength: 26, salt: 11 },
    label: {
        mode: 'plain-halo',
        rx: 0,
        padX: 0,
        height: 0,
        borderWidth: 0,
        shadowOffset: 0,
        haloWidth: 10,
    },
    frame: 'double',
    sparkles: undefined,
    curves: {
        colorSource: 'palette',
        palette: {
            // Selector swatches: the pencil tin (curves themselves are hatched, not filled).
            light: ['#b3455a', '#3f6fb5', '#4f8f5f', '#7a5fae', '#c07a2e', '#4a4a4a'],
            dark: ['#d4607a', '#6c8fd8', '#6fae7f', '#9a80c8', '#d99a52', '#b8b5ac'],
        },
    },
    layout: {
        plotWidth: 920,
        plotHeight: 460,
        margin: { top: 28, right: 76, bottom: 24, left: 64 },
        titleSpace: 44,
        titleGap: 18,
        phaseLabelGap: 32,
        legendGap: 26,
        eventLabelGap: 16,
        eventNoteLineH: 15,
        eventLeader: 10,
        eventBandPad: 8,
        eventCalloutMaxWidth: 200,
        legendRowGap: 12,
        legendSwatch: 16,
        legendSwatchGap: 10,
        legendRemoveZone: 42,
    },
    chrome: {
        light: {
            '--background': '#efece3',
            '--surface': '#fbfaf6',
            '--border': '#d5d0c2',
            '--text': '#1c1c1a',
            '--text-muted': '#6b6a64',
            '--accent': '#1c1c1a',
            // The accent is graphite ink — accent-filled surfaces need paper text.
            '--accent-ink': '#fbfaf6',
            '--danger': '#a4161a',
            '--hover': '#e7e2d5',
            '--font-ui': `${MONO}, ${STACK}`,
        },
        dark: {
            '--background': '#101113',
            '--surface': '#17181a',
            '--border': '#3a3a38',
            '--text': '#f2efe6',
            '--text-muted': '#a8a49a',
            '--accent': '#f2efe6',
            // The accent is paper itself — white-on-paper would vanish, so use ink.
            '--accent-ink': '#17181a',
            '--danger': '#e06060',
            '--hover': '#222326',
            '--font-ui': `${MONO}, ${STACK}`,
        },
    },
    curveStrokeWidth: 1.5,
    pointRadius: 6,
};
