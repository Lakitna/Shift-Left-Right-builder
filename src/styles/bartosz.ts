import type { GraphStyle } from './types';

const MONTSERRAT = "'Montserrat'";
const STACK = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

/**
 * Bartosz: the corporate look of bartosz.nl — brand purple (#5A2CBC) used as INK on
 * white paper (their blog literally sets body text in purple). Their marketing
 * diagrams run on shades of purple alone, so both modes do too: every curve fill is
 * a purple (night → brand → lilac), chips are white pills outlined in purple, and
 * the brand's mint (#92E8E3) survives only as an accent — a pale mint wash behind
 * the light-mode app chrome and the hint in dark mode. Montserrat type
 * (ARS Maquette's open-source cousin). Flat color blocks, no jitter, no decoration:
 * precision-tested software, grensverleggend. Every fill reaches ≥ 3:1 against its
 * ground; chips hit ≥ 7:1.
 */
export const bartoszStyle: GraphStyle = {
    id: 'bartosz',
    name: 'Bartosz',
    typography: {
        fallback: STACK,
        roles: {
            title: { family: MONTSERRAT, weight: 700, size: 22 },
            axisTitle: { family: MONTSERRAT, weight: 600, size: 14 },
            phaseLabel: { family: MONTSERRAT, weight: 600, size: 14 },
            eventLabel: { family: MONTSERRAT, weight: 700, size: 13 },
            eventNote: { family: MONTSERRAT, weight: 400, size: 12, lineHeight: 18 },
            tickLabel: { family: MONTSERRAT, weight: 400, size: 12 },
            curveLabel: { family: MONTSERRAT, weight: 600, size: 14 },
            legendLabel: { family: MONTSERRAT, weight: 600, size: 14 },
            legendNote: { family: MONTSERRAT, weight: 400, size: 13, lineHeight: 18 },
        },
        fonts: [
            ['Montserrat', 400],
            ['Montserrat', 600],
            ['Montserrat', 700],
        ],
    },
    canvas: {
        light: {
            // White paper + purple ink; the pills are the site's outline style: white
            // ground, purple border, purple text. No other hues — the brand has none.
            background: '#ffffff',
            axis: '#5a2cbc',
            grid: '#eee9fa',
            phaseTick: '#e2d9f6',
            phaseLabel: '#5a2cbc',
            eventLine: '#5a2cbc',
            eventLabel: '#5a2cbc',
            tickLabel: '#5a2cbc',
            title: '#5a2cbc',
            axisTitle: '#5a2cbc',
            curveLabel: '#5a2cbc',
            curveLabelHalo: '#ffffff',
            legendText: '#5a2cbc',
            legendMuted: '#5a2cbc',
            legendSwatchStroke: '#5a2cbc',
            ink: '#5a2cbc',
            chip: '#ffffff',
            chipStroke: '#5a2cbc',
            chipText: '#5a2cbc',
            hint: '#5a2cbc',
        },
        dark: {
            background: '#150c2e',
            axis: '#9f7bea',
            grid: '#241645',
            phaseTick: '#2f2058',
            phaseLabel: '#efeafb',
            eventLine: '#9f7bea',
            eventLabel: '#9f7bea',
            tickLabel: '#e6dcfa',
            title: '#ffffff',
            axisTitle: '#ffffff',
            curveLabel: '#3b1e78',
            curveLabelHalo: '#ffffff',
            legendText: '#efeafb',
            legendMuted: '#e6dcfa',
            legendSwatchStroke: '#9f7bea',
            ink: '#9f7bea',
            chip: '#ffffff',
            chipStroke: '#9f7bea',
            chipText: '#3b1e78',
            // The mint accent: brand mint reads 12:1 on night purple.
            hint: '#92e8e3',
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
    jitter: { amplitude: 0, segmentLength: 24, salt: 21 },
    label: {
        // The site's buttons: fully rounded pills, white with a purple outline.
        mode: 'chip',
        rx: 16,
        padX: 14,
        height: 32,
        borderWidth: 2,
        shadowOffset: 0,
        haloWidth: 0,
    },
    frame: 'none',
    sparkles: undefined,
    curves: {
        colorSource: 'palette',
        palette: {
            // Shades of purple only — like their marketing diagrams. All ≥ 3:1 on white.
            light: ['#5a2cbc', '#24124d', '#7a4fd0', '#3b1e78', '#9b6fe0', '#4a148c'],
            // Shades of purple only. All ≥ 3:1 against the night-purple ground.
            dark: ['#9f7bea', '#c9b3f5', '#7a52cc', '#b79cf0', '#e2d7fa', '#8a63e0'],
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
        eventCalloutMaxWidth: 210, // Montserrat runs wide
        legendRowGap: 12,
        legendSwatch: 16,
        legendSwatchGap: 10,
        legendRemoveZone: 42,
    },
    chrome: {
        light: {
            // Purple ink on white; the mint accent lives here as a pale wash behind
            // the app chrome (the site's own header-band mint, muted).
            '--background': '#eef6f5',
            '--surface': '#ffffff',
            '--border': '#cdeae5',
            '--text': '#5a2cbc',
            '--text-muted': '#6f5aa8',
            '--accent': '#5a2cbc',
            '--danger': '#d81b60',
            '--hover': '#e0f2ef',
            '--font-ui': `${MONTSERRAT}, ${STACK}`,
        },
        dark: {
            '--background': '#120a26',
            '--surface': '#1b1038',
            '--border': '#43336e',
            '--text': '#efeafb',
            '--text-muted': '#b4a8d6',
            '--accent': '#9f7bea',
            // The accent is a light lilac — white-on-lilac would fall short, so ink it dark.
            '--accent-ink': '#1b0e3f',
            '--danger': '#ff8080',
            '--hover': '#241645',
            '--font-ui': `${MONTSERRAT}, ${STACK}`,
        },
    },
    curveStrokeWidth: 2.5,
    pointRadius: 6,
};
