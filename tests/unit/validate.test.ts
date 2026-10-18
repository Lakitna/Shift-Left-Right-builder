/**
 * Component tests for the WCAG contrast math behind the style system (REQ-03), plus a
 * synthetic style that exercises the gating rules directly.
 */
import { describe, expect, it } from 'vitest';

import { STYLES, classicStyle, type GraphStyle } from '../../src/styles';
import {
    contrastRatio,
    relativeLuminance,
    validateAllStyles,
    validateStyle,
} from '../../src/styles/validate';

/**
 * Classic's structure with the three conditions that make curve fills "carry the boundaries"
 * forced on, and every checked colour collapsed onto its ground so each rule trips.
 */
function syntheticStyle(): GraphStyle {
    const flatten = (theme: 'light' | 'dark', color: string) => ({
        ...classicStyle.canvas[theme],
        background: color,
        chip: color,
        chipText: color,
        legendMuted: color,
        title: color,
        hint: color,
    });

    return {
        ...classicStyle,
        id: 'synthetic',
        canvas: {
            light: flatten('light', '#ffffff'),
            dark: flatten('dark', '#000000'),
        },
        curves: {
            ...classicStyle.curves,
            colorSource: 'palette',
            palette: { light: ['#ffffff'], dark: ['#000000'] },
        },
        fills: { ...classicStyle.fills, mode: 'solid' },
        stroke: { ...classicStyle.stroke, curveOutline: 0 },
    };
}

describe('REQ-03 contrast math', () => {
    it('relativeLuminance spans 0 for black to 1 for white', () => {
        expect(relativeLuminance('#000000')).toBe(0);
        expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 6);
        expect(relativeLuminance('ffffff')).toBeCloseTo(1, 6);
    });

    it('relativeLuminance reports 0 for anything that is not a six-digit hex colour', () => {
        for (const value of ['nope', 'fff', '#12345', '#gggggg', '', '#ffffff80']) {
            expect(relativeLuminance(value), value).toBe(0);
        }
    });

    it('contrastRatio returns the WCAG ratio between two colours', () => {
        expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
        expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
        expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 6);
    });

    it('contrastRatio ignores an alpha suffix', () => {
        expect(contrastRatio('#ffffff80', '#000000')).toBeCloseTo(21, 5);
    });
});

describe('REQ-03 validateStyle gating', () => {
    it('flags curve fills below 3:1 when solid fills carry the curve boundaries', () => {
        const issues = validateStyle(syntheticStyle(), false);
        expect(issues).toHaveLength(2);
        const themes = issues.map((issue) => issue.theme).toSorted((a, b) => a.localeCompare(b));
        expect(themes).toEqual(['dark', 'light']);
        for (const issue of issues) {
            expect(issue.required).toBe(3);
            expect(issue.ratio).toBe(1);
        }
    });

    it('adds the four AAA text pairs when strictText is set', () => {
        const issues = validateStyle(syntheticStyle(), true);
        expect(issues.filter((issue) => issue.required === 3)).toHaveLength(2);
        expect(issues.filter((issue) => issue.required === 7)).toHaveLength(8);
    });

    it('exempts a style whose boundaries are drawn rather than filled', () => {
        const outlined = syntheticStyle();
        outlined.stroke = { ...outlined.stroke, curveOutline: 1 };
        expect(validateStyle(outlined, false)).toEqual([]);

        const patterned = syntheticStyle();
        patterned.fills = { ...patterned.fills, mode: 'pattern' };
        expect(validateStyle(patterned, false)).toEqual([]);
    });
});

/**
 * The text pairs the renderer paints, tagged with the WCAG size class. Sizes come from the style
 * typography: the chart title is 22px at weight 700, which WCAG counts as *large* text, while the
 * legend notes (13px), hints and chip captions are normal text.
 */
interface TextPair {
    what: string;
    fg: string;
    bg: string;
    large: boolean;
}

function textPairs(style: GraphStyle, theme: 'light' | 'dark'): TextPair[] {
    const palette = style.canvas[theme];
    return [
        {
            what: 'legendMuted vs ground',
            fg: palette.legendMuted,
            bg: palette.background,
            large: false,
        },
        { what: 'chipText vs chip', fg: palette.chipText, bg: palette.chip, large: false },
        { what: 'hint vs ground', fg: palette.hint, bg: palette.background, large: false },
        { what: 'title vs ground', fg: palette.title, bg: palette.background, large: true },
    ];
}

function textContrastViolations(
    required: (pair: TextPair) => number,
    styles: GraphStyle[] = STYLES
): string[] {
    const violations: string[] = [];
    for (const style of styles) {
        for (const theme of ['light', 'dark'] as const) {
            for (const pair of textPairs(style, theme)) {
                const wanted = required(pair);
                const ratio = contrastRatio(pair.fg, pair.bg);
                if (ratio < wanted) {
                    violations.push(
                        `${style.id}/${theme}: ${pair.what} is ${ratio.toFixed(2)}:1, needs ${String(wanted)}:1`
                    );
                }
            }
        }
    }
    return violations;
}

describe('REQ-13 WCAG 2.2 Level AA', () => {
    it('AA: every style reaches 4.5:1 on normal text and 3:1 on large text', () => {
        expect(textContrastViolations((pair) => (pair.large ? 3 : 4.5))).toEqual([]);
    });

    it('AA: every shipped style keeps its non-text contrast claims', () => {
        // The rule (curve fills >= 3:1 whenever the fills themselves carry the curve boundaries)
        // and its exemptions are asserted in the gating tests above; this is the registry-wide claim.
        expect(validateAllStyles()).toEqual([]);
    });

    it('AAA: the high contrast style reaches 7:1 on normal text and 4.5:1 on large text', () => {
        const contrastStyle = STYLES.filter((style) => style.id === 'contrast');
        expect(contrastStyle).toHaveLength(1);
        expect(textContrastViolations((pair) => (pair.large ? 4.5 : 7), contrastStyle)).toEqual([]);
    });
});
