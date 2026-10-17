/**
 * Component tests for the style registry (REQ-03). Style ids are public API — they travel in
 * shared URLs and live in localStorage — so their names and order are pinned here.
 */
import { describe, expect, it } from 'vitest';

import { DEFAULT_STYLE_ID, STYLES, classicStyle, getStyle, isValidStyleId } from '../../src/styles';

const PUBLIC_STYLE_IDS = [
    'classic',
    'draftsman',
    'contrast',
    'toon',
    'de-stijl',
    'unicorn',
    'bartosz',
];

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
        for (const id of [null, undefined, '', 'Classic', 'nope', 'classic ']) {
            expect(isValidStyleId(id), String(id)).toBe(false);
        }
    });

    it('getStyle resolves a known id and falls back to Classic otherwise', () => {
        expect(getStyle('toon').id).toBe('toon');
        expect(getStyle('nope')).toBe(classicStyle);
        expect(getStyle(null)).toBe(classicStyle);
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
});
