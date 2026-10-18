/**
 * WCAG contrast utilities used to keep styles honest. Run from the console with
 * `?validate-styles` in the URL (see index.ts) — every style is checked and results are
 * logged. The 'contrast' style must pass AAA text ratios; all styles must keep curve
 * fills ≥ 3:1 against the canvas ground (WCAG 1.4.11 non-text contrast).
 */
import { STYLES } from './index';
import type { GraphStyle } from './types';

function channelLuminance(value8bit: number): number {
    const c = value8bit / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number {
    const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
    if (m === null) return 0;
    const n = Number.parseInt(m[1], 16);
    return (
        0.2126 * channelLuminance((n >> 16) & 0xFF) +
        0.7152 * channelLuminance((n >> 8) & 0xFF) +
        0.0722 * channelLuminance(n & 0xFF)
    );
}

/**
Contrast ratio between two #rrggbb colors (1..21). Ignores alpha suffixes.
*/
export function contrastRatio(a: string, b: string): number {
    const la = relativeLuminance(a.slice(0, 7));
    const lb = relativeLuminance(b.slice(0, 7));
    const [hi, lo] = la > lb ? [la, lb] : [lb, la];
    return (hi + 0.05) / (lo + 0.05);
}

export interface StyleIssue {
    style: string;
    theme: 'light' | 'dark';
    what: string;
    ratio: number;
    required: number;
}

/**
 * Check a style's contrast claims.
 * - `strictText` requires all text pairs ≥ 7:1 (AAA) — set for the 'contrast' style.
 * - Curve fills must reach ≥ 3:1 against the ground (WCAG 1.4.11) only when the style has
 *   no ink outline and solid fills: there the fills themselves carry the curve boundaries.
 *   Outlined/hatched/gradient styles (toon, de-stijl, draftsman, unicorn) express
 *   boundaries with rules or patterns, so their fields are decorative and exempt by design.
 */
export function validateStyle(style: GraphStyle, isStrictText: boolean): StyleIssue[] {
    const issues: StyleIssue[] = [];
    const isFillsCarryBoundaries =
        style.stroke.curveOutline === 0 && style.fills.mode === 'solid';
    for (const theme of ['light', 'dark'] as const) {
        const palette = style.canvas[theme];
        const fills = style.curves.palette[theme];
        if (isFillsCarryBoundaries && style.curves.colorSource === 'palette') {
            for (const [index, fill] of fills.entries()) {
                const ratio = contrastRatio(fill, palette.background);
                if (ratio < 3) {
                    issues.push({
                        style: style.id,
                        theme,
                        what: `curve fill #${String(index + 1)} vs ground`,
                        ratio: Math.round(ratio * 100) / 100,
                        required: 3,
                    });
                }
            }
        }
        if (!isStrictText) {
            continue;
        }

        const pairs: [string, string, string][] = [
            ['legendMuted vs ground', palette.legendMuted, palette.background],
            ['title vs ground', palette.title, palette.background],
            ['chipText vs chip', palette.chipText, palette.chip],
            ['hint vs ground', palette.hint, palette.background],
        ];
        for (const [what, fg, bg] of pairs) {
            const ratio = contrastRatio(fg, bg);
            if (ratio < 7) {
                issues.push({
                    style: style.id,
                    theme,
                    what,
                    ratio: Math.round(ratio * 100) / 100,
                    required: 7,
                });
            }
        }
    }
    return issues;
}

/**
Validate every registered style; returns all issues found.
*/
export function validateAllStyles(): StyleIssue[] {
    return STYLES.flatMap((style) => validateStyle(style, style.id === 'contrast'));
}
