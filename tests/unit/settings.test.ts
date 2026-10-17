/**
 * Component tests for the persisted export-dialog settings (REQ-12). Only the pure validator is
 * exercised here — the stores themselves touch localStorage and are covered by the GUI tier.
 */
import { describe, expect, it } from 'vitest';

import { PNG_DEFAULT_WIDTH, PNG_MAX_WIDTH, PNG_MIN_WIDTH, clampPngWidth } from '../../src/settings';

describe('REQ-12 PNG width validation', () => {
    it('clampPngWidth keeps a value already inside the range', () => {
        expect(clampPngWidth(PNG_DEFAULT_WIDTH)).toBe(PNG_DEFAULT_WIDTH);
        expect(clampPngWidth(PNG_MIN_WIDTH)).toBe(PNG_MIN_WIDTH);
        expect(clampPngWidth(PNG_MAX_WIDTH)).toBe(PNG_MAX_WIDTH);
    });

    it('clampPngWidth clamps below the minimum and above the maximum', () => {
        expect(clampPngWidth(0)).toBe(PNG_MIN_WIDTH);
        expect(clampPngWidth(-500)).toBe(PNG_MIN_WIDTH);
        expect(clampPngWidth(99_999)).toBe(PNG_MAX_WIDTH);
    });

    it('clampPngWidth rounds to a whole pixel', () => {
        expect(clampPngWidth(1500.4)).toBe(1500);
        expect(clampPngWidth(1500.6)).toBe(1501);
    });

    it('clampPngWidth falls back to the default for non-finite input', () => {
        expect(clampPngWidth(NaN)).toBe(PNG_DEFAULT_WIDTH);
        expect(clampPngWidth(Infinity)).toBe(PNG_DEFAULT_WIDTH);
        expect(clampPngWidth(Number.NEGATIVE_INFINITY)).toBe(PNG_DEFAULT_WIDTH);
    });

    it('declares a sane 120..8000 range around a 1500 default', () => {
        expect(PNG_MIN_WIDTH).toBe(120);
        expect(PNG_MAX_WIDTH).toBe(8000);
        expect(PNG_DEFAULT_WIDTH).toBe(1500);
        expect(PNG_MIN_WIDTH).toBeLessThan(PNG_DEFAULT_WIDTH);
        expect(PNG_DEFAULT_WIDTH).toBeLessThan(PNG_MAX_WIDTH);
    });
});
