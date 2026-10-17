/**
 * Component tests for the shipped preset models (REQ-04) — the data the app opens with and the
 * one-step starting points offered in the toolbar.
 */
import { describe, expect, it } from 'vitest';

import { cloneModel, parseModel } from '../../src/model';
import { PRESETS } from '../../src/presets';

describe('REQ-04 presets', () => {
    it('exposes Schematic, Detailed and Empty in that order', () => {
        expect(PRESETS.map((preset) => preset.name)).toEqual(['Schematic', 'Detailed', 'Empty']);
    });

    it('every preset satisfies the strict parseModel contract', () => {
        for (const preset of PRESETS) {
            expect(parseModel(preset.data), preset.name).not.toBeNull();
        }
    });

    it('Schematic spans four phases with a qualitative axis and a seeded release event', () => {
        const schematic = PRESETS[0].data;
        expect(schematic.numericAxis).toBe(false);
        expect(schematic.curves).toHaveLength(3);
        expect(schematic.phases).toHaveLength(4);
        expect(schematic.events).toEqual([{ label: 'Release', note: '', x: 75 }]);
    });

    it('Detailed puts one point on every phase and switches on the numeric axis', () => {
        const detailed = PRESETS[1].data;
        expect(detailed.numericAxis).toBe(true);
        expect(detailed.phases).toHaveLength(6);
        expect(detailed.events).toEqual([{ label: 'Release', note: '', x: 67 }]);
        for (const curve of detailed.curves) {
            expect(curve.points).toHaveLength(detailed.phases.length);
        }
    });

    it('Empty is a single flat curve with no events and no title', () => {
        const empty = PRESETS[2].data;
        expect(empty.curves).toHaveLength(1);
        expect(empty.events).toEqual([]);
        expect(empty.title).toBe('');
        expect(empty.curves[0].points.every((point) => point.y === 0)).toBe(true);
    });

    it('preset data is shared, so every clone must be independent', () => {
        const preset = PRESETS[0].data;
        const clone = cloneModel(preset);

        expect(clone).not.toBe(preset);
        expect(clone.curves[0]).not.toBe(preset.curves[0]);
        expect(clone.curves[0].points[0]).not.toBe(preset.curves[0].points[0]);

        clone.curves[0].points[0].y = 100;
        expect(preset.curves[0].points[0].y).not.toBe(100);
    });
});
