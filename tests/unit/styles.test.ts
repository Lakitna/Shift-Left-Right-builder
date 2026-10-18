/**
 * Component tests for the style registry (REQ-03). Style ids are public API — they travel in
 * shared URLs and live in localStorage — so their names and order are pinned here.
 */
import { describe, expect, it } from 'vitest';

import { DEFAULT_STYLE_ID, STYLES, classicStyle, getStyle, isValidStyleId } from '../../src/styles';
import { contrastRatio } from '../../src/styles/validate';

const PUBLIC_STYLE_IDS = [
    'classic',
    'draftsman',
    'contrast',
    'toon',
    'de-stijl',
    'unicorn',
    'bartosz',
];

// A `null` style id is what untyped URL / localStorage data can hand these functions, so it is
// exercised explicitly. It is produced from JSON rather than written as a bare literal.
const nullStyleId = JSON.parse('null') as string | null | undefined;

describe('REQ-03 style registry', () => {
    it('keeps the seven public style ids in a stable order', () => {
        expect(STYLES.map((style) => style.id)).toEqual(PUBLIC_STYLE_IDS);
    });

    it('defaults to Classic', () => {
        expect(DEFAULT_STYLE_ID).toBe('classic');
        expect(classicStyle.id).toBe('classic');
    });

    it('isValidStyleId accepts exactly the registered ids', () => {
        for (const id of PUBLIC_STYLE_IDS) {
            expect(isValidStyleId(id), id).toBe(true);
        }
        for (const id of [nullStyleId, undefined, '', 'Classic', 'nope', 'classic ']) {
            expect(isValidStyleId(id), String(id)).toBe(false);
        }
    });

    it('getStyle resolves a known id and falls back to Classic otherwise', () => {
        expect(getStyle('toon').id).toBe('toon');
        expect(getStyle('nope')).toBe(classicStyle);
        expect(getStyle(nullStyleId)).toBe(classicStyle);
        expect(getStyle(undefined)).toBe(classicStyle);
    });

    it('every style defines both themes for the canvas ground', () => {
        for (const style of STYLES) {
            expect(typeof style.canvas.light.background, style.id).toBe('string');
            expect(typeof style.canvas.dark.background, style.id).toBe('string');
            expect(style.curves.palette.light.length, style.id).toBeGreaterThan(0);
            expect(style.curves.palette.dark.length, style.id).toBeGreaterThan(0);
        }
    });

    it('dark editing badges contrast against their white background', () => {
        for (const id of ['draftsman', 'toon', 'de-stijl', 'contrast']) {
            const style = getStyle(id);
            const foreground = style.canvas.dark.badgeForeground;

            expect(foreground, id).toBeDefined();
            expect(contrastRatio(foreground ?? '#ffffff', '#ffffff'), id).toBeGreaterThanOrEqual(
                4.5
            );
        }
    });
});
