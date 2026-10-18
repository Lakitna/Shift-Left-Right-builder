import type { GraphStyle } from './types';

const HYPER = "'Atkinson Hyperlegible'";
const STACK = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

/**
 * WCAG AAA classic: pure black/white grounds, Atkinson Hyperlegible (designed by the
 * Braille Institute for low-vision readers), oversized chips with 2px borders, and a
 * palette where every curve fill reaches ≥ 3:1 against the ground while all text pairs
 * reach ≥ 7:1. No jitter, no shadows, no decoration — maximum legibility.
 */
export const contrastStyle: GraphStyle = {
    id: 'contrast',
    name: 'High contrast',
    typography: {
        fallback: STACK,
        roles: {
            title: { family: HYPER, weight: 700, size: 21 },
            axisTitle: { family: HYPER, weight: 700, size: 14 },
            phaseLabel: { family: HYPER, weight: 700, size: 14 },
            eventLabel: { family: HYPER, weight: 700, size: 13 },
            eventNote: { family: HYPER, weight: 400, size: 12, lineHeight: 18 },
            tickLabel: { family: HYPER, weight: 400, size: 12 },
            curveLabel: { family: HYPER, weight: 700, size: 14 },
            legendLabel: { family: HYPER, weight: 700, size: 14 },
            legendNote: { family: HYPER, weight: 400, size: 13, lineHeight: 18 },
        },
        fonts: [
            ['Atkinson Hyperlegible', 400],
            ['Atkinson Hyperlegible', 700],
        ],
    },
    canvas: {
        light: {
            background: '#ffffff',
            axis: '#000000',
            grid: '#595959',
            phaseTick: '#595959',
            phaseLabel: '#000000',
            eventLine: '#002fa7',
            eventLabel: '#002fa7',
            tickLabel: '#000000',
            title: '#000000',
            axisTitle: '#000000',
            curveLabel: '#000000',
            curveLabelHalo: '#ffffff',
            legendText: '#000000',
            legendMuted: '#000000',
            legendSwatchStroke: '#000000',
            ink: '#000000',
            chip: '#ffffff',
            chipStroke: '#000000',
            chipText: '#000000', // 21:1 on chip
            hint: '#595959', // 7:1 on white
        },
        dark: {
            background: '#000000',
            axis: '#ffffff',
            grid: '#a6a6a6',
            phaseTick: '#a6a6a6',
            phaseLabel: '#ffffff',
            eventLine: '#6c8cff',
            eventLabel: '#6c8cff',
            tickLabel: '#ffffff',
            title: '#ffffff',
            axisTitle: '#ffffff',
            curveLabel: '#ffffff',
            curveLabelHalo: '#000000',
            legendText: '#ffffff',
            legendMuted: '#ffffff',
            legendSwatchStroke: '#ffffff',
            ink: '#ffffff',
            chip: '#000000',
            chipStroke: '#ffffff',
            chipText: '#ffffff',
            hint: '#a6a6a6', // 8.5:1 on black
        },
    },
    fills: {
        mode: 'solid',
        patterns: [{ name: 'none' }],
        patternSpacing: 6,
        patternStroke: 1,
        patternOpacity: 1,
    },
    stroke: { curveOutline: 0 },
    jitter: { amplitude: 0, segmentLength: 24, salt: 0 },
    label: {
        mode: 'chip',
        rx: 4,
        padX: 9,
        height: 30,
        borderWidth: 2,
        shadowOffset: 0,
        haloWidth: 0,
    },
    frame: 'none',
    sparkles: undefined,
    curves: {
        colorSource: 'palette',
        palette: {
            // All ≥ 3:1 against white; Klein blue leads (also ≥ 7:1, so chip-less text works).
            light: ['#002fa7', '#b1000f', '#005e2e', '#5e0092', '#00676e', '#8a4b00'],
            // All ≥ 3:1 against black.
            dark: ['#6c8cff', '#ff6b6b', '#58d68d', '#bb86fc', '#4dd0e1', '#ffb74d'],
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
        eventNoteLineH: 18,
        eventLeader: 10,
        eventBandPad: 8,
        eventCalloutMaxWidth: 220, // Atkinson runs wide
        legendRowGap: 12,
        legendSwatch: 18,
        legendSwatchGap: 10,
        legendRemoveZone: 42,
    },
    chrome: {
        light: {
            '--background': '#f2f2f2',
            '--surface': '#ffffff',
            '--border': '#000000',
            '--text': '#000000',
            '--text-muted': '#595959',
            '--accent': '#002fa7',
            '--danger': '#b1000f',
            '--hover': '#e6e6e6',
            '--font-ui': `${HYPER}, ${STACK}`,
        },
        dark: {
            '--background': '#0a0a0a',
            '--surface': '#000000',
            '--border': '#ffffff',
            '--text': '#ffffff',
            '--text-muted': '#a6a6a6',
            '--accent': '#6c8cff',
            '--danger': '#ff6b6b',
            '--hover': '#1a1a1a',
            '--font-ui': `${HYPER}, ${STACK}`,
        },
    },
    curveStrokeWidth: 3.5,
    pointRadius: 7,
};
