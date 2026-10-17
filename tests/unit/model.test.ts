/**
 * Component tests for the model contract — the internal API every other module is built on.
 *
 * Two kinds of expectation live here:
 *  - the *contract as documented and relied upon* (clamping rules, strict validation, operation
 *    return values, identity preservation across re-sorts), and
 *  - the *desired* behavior where the current implementation disagrees with it. Those are marked
 *    `EXPECTED RED` — they define the target for the upcoming refactor rather than recording a bug.
 */
import { describe, expect, it } from 'vitest';

import {
    DEFAULT_OPACITY,
    MAX_CURVES,
    MAX_EVENTS,
    MAX_PHASES,
    MAX_POINTS,
    MIN_CURVES,
    MIN_PHASES,
    MIN_POINTS,
    MODEL_VERSION,
    PALETTE,
    addCurve,
    addEvent,
    addPhase,
    canAddCurve,
    canAddEvent,
    canAddPhase,
    canAddPoint,
    canRemoveCurve,
    canRemoveEvent,
    canRemovePhase,
    canRemovePoint,
    clampCoord,
    clampOpacity,
    cloneModel,
    insertPoint,
    moveCurve,
    nearestBoundaryX,
    nearestPhaseX,
    newCurve,
    parseModel,
    phaseBoundaries,
    phasePositions,
    removeCurve,
    removeEvent,
    removePhase,
    removePoint,
    reorderCurve,
    reorderPhase,
    setEventX,
    setPoint,
    type GraphModel,
} from '../../src/model';
import { makeCurve, makeEvent, makeModel, makePhase, makeRawModel } from './fixtures';

describe('REQ-01 model contract: clampCoord', () => {
    it('rounds to the nearest integer', () => {
        expect(clampCoord(50.4)).toBe(50);
        expect(clampCoord(50.6)).toBe(51);
    });

    it('clamps into 0..100', () => {
        expect(clampCoord(-5)).toBe(0);
        expect(clampCoord(150)).toBe(100);
        expect(clampCoord(-0.4)).toBe(0);
        expect(clampCoord(100.4)).toBe(100);
    });

    it('maps non-finite values to 0', () => {
        expect(clampCoord(NaN)).toBe(0);
        expect(clampCoord(Infinity)).toBe(0);
        expect(clampCoord(Number.NEGATIVE_INFINITY)).toBe(0);
    });
});

describe('REQ-01 model contract: clampOpacity', () => {
    it('rounds to two decimals and clamps into 0.05..1', () => {
        expect(clampOpacity(0.5)).toBe(0.5);
        expect(clampOpacity(0.333)).toBe(0.33);
        expect(clampOpacity(0.04)).toBe(0.05);
        expect(clampOpacity(1.5)).toBe(1);
    });

    it('falls back to the default opacity for non-finite input', () => {
        expect(clampOpacity(NaN)).toBe(DEFAULT_OPACITY);
        expect(clampOpacity(Number.NEGATIVE_INFINITY)).toBe(DEFAULT_OPACITY);
    });
});

describe('REQ-01 model contract: cloneModel', () => {
    it('deep-copies so the clone can be mutated freely', () => {
        const source = makeModel({ events: [makeEvent()] });
        const clone = cloneModel(source);

        expect(clone).not.toBe(source);
        expect(clone).toEqual(source);
        expect(clone.curves[0]).not.toBe(source.curves[0]);
        expect(clone.curves[0].points[0]).not.toBe(source.curves[0].points[0]);
        expect(clone.phases[0]).not.toBe(source.phases[0]);
        expect(clone.events[0]).not.toBe(source.events[0]);

        clone.curves[0].points[0].y = 99;
        expect(source.curves[0].points[0].y).toBe(0);
    });

    it('normalises an absent title and y-axis title to empty strings', () => {
        const source = makeModel();
        delete source.title;
        delete source.yAxisTitle;

        const clone = cloneModel(source);
        expect(clone.title).toBe('');
        expect(clone.yAxisTitle).toBe('');
    });

    it('carries colorCustom only when it is exactly true', () => {
        const custom = cloneModel(makeModel({ curves: [makeCurve({ colorCustom: true })] }));
        expect(custom.curves[0].colorCustom).toBe(true);

        const notCustom = cloneModel(makeModel({ curves: [makeCurve()] }));
        expect('colorCustom' in notCustom.curves[0]).toBe(false);
    });

    it('does not validate or clamp its input', () => {
        // Presets are trusted static data; the clone must be a faithful copy, not a sanitiser.
        const clone = cloneModel(makeModel({ curves: [makeCurve({ opacity: 5 })] }));
        expect(clone.curves[0].opacity).toBe(5);
    });
});

describe('REQ-01 model contract: parseModel is strict', () => {
    it('accepts a valid model and reports the current version', () => {
        const parsed = parseModel(makeModel());
        expect(parsed).not.toBeNull();
        expect(parsed?.version).toBe(MODEL_VERSION);
    });

    it('rejects non-objects', () => {
        for (const value of [null, undefined, 42, 'model', []]) {
            expect(parseModel(value)).toBeNull();
        }
    });

    it('rejects a version mismatch', () => {
        const raw = makeRawModel();
        raw.version = MODEL_VERSION + 1;
        expect(parseModel(raw)).toBeNull();
    });

    it('requires title and yAxisTitle to be present strings', () => {
        const noTitle = makeRawModel();
        delete noTitle.title;
        expect(parseModel(noTitle)).toBeNull();

        const badY = makeRawModel();
        badY.yAxisTitle = 7;
        expect(parseModel(badY)).toBeNull();
    });

    it('requires events to be present', () => {
        const raw = makeRawModel();
        delete raw.events;
        expect(parseModel(raw)).toBeNull();
    });

    it('enforces the array bounds', () => {
        const noCurves = makeRawModel();
        noCurves.curves = [];
        expect(parseModel(noCurves)).toBeNull();

        const tooManyPhases = makeRawModel();
        tooManyPhases.phases = Array.from({ length: MAX_PHASES + 1 }, () => makePhase());
        expect(parseModel(tooManyPhases)).toBeNull();

        const tooManyEvents = makeRawModel();
        tooManyEvents.events = Array.from({ length: MAX_EVENTS + 1 }, () => makeEvent());
        expect(parseModel(tooManyEvents)).toBeNull();
    });

    it('enforces the curve point count bounds', () => {
        const tooFew = makeRawModel();
        (tooFew.curves as Record<string, unknown>[])[0].points = [{ x: 0, y: 0 }];
        expect(parseModel(tooFew)).toBeNull();

        const tooMany = makeRawModel();
        (tooMany.curves as Record<string, unknown>[])[0].points = Array.from(
            { length: MAX_POINTS + 1 },
            (_, index) => ({ x: index, y: 0 })
        );
        expect(parseModel(tooMany)).toBeNull();
    });

    it('rejects a curve color that is not #rrggbb and lower-cases a valid one', () => {
        const bad = makeRawModel();
        (bad.curves as Record<string, unknown>[])[0].color = 'red';
        expect(parseModel(bad)).toBeNull();

        const upper = makeRawModel();
        (upper.curves as Record<string, unknown>[])[0].color = '#ABC123';
        expect(parseModel(upper)?.curves[0].color).toBe('#abc123');
    });

    it('rejects a present-but-non-boolean colorCustom', () => {
        const raw = makeRawModel();
        (raw.curves as Record<string, unknown>[])[0].colorCustom = 'yes';
        expect(parseModel(raw)).toBeNull();
    });

    it('clamps coordinates and re-sorts points by ascending x', () => {
        const raw = makeRawModel();
        (raw.curves as Record<string, unknown>[])[0].points = [
            { x: 90, y: 140 },
            { x: -5, y: -20 },
        ];
        const curve = parseModel(raw)?.curves[0];
        expect(curve?.points).toEqual([
            { x: 0, y: 0 },
            { x: 90, y: 100 },
        ]);
    });

    it('re-sorts events by ascending x', () => {
        const raw = makeRawModel();
        raw.events = [
            { label: 'late', note: '', x: 90 },
            { label: 'early', note: '', x: 10 },
        ];
        expect(parseModel(raw)?.events.map((event) => event.label)).toEqual(['early', 'late']);
    });

    // EXPECTED RED — desired behavior, not yet implemented.
    // `parseModel` promises strict, all-or-nothing validation ("Every field must be present with
    // the right type — there are no lenient defaults, so a malformed payload is rejected rather
    // than silently repaired"), yet a present-but-non-numeric opacity is silently replaced with
    // DEFAULT_OPACITY instead of rejecting the payload.
    it('rejects a present-but-non-numeric opacity', () => {
        const raw = makeRawModel();
        (raw.curves as Record<string, unknown>[])[0].opacity = '0.5';
        expect(parseModel(raw)).toBeNull();
    });
});

describe('REQ-06 phase math', () => {
    it('phasePositions returns the centre of each equal band', () => {
        expect(phasePositions(4)).toEqual([13, 38, 63, 88]);
        expect(phasePositions(1)).toEqual([50]);
        expect(phasePositions(0)).toEqual([]);
    });

    it('nearestPhaseX snaps to the closest band centre', () => {
        expect(nearestPhaseX(20, 4)).toBe(13);
        expect(nearestPhaseX(60, 4)).toBe(63);
        expect(nearestPhaseX(50, 1)).toBe(50);
    });

    it('phaseBoundaries spans the whole axis, edges included', () => {
        // The plot edges are part of the set; the renderer slices them off when it draws the
        // faint internal separators.
        expect(phaseBoundaries(4)).toEqual([0, 25, 50, 75, 100]);
        expect(phaseBoundaries(1)).toEqual([0, 100]);
    });

    it('nearestBoundaryX snaps an event to the closest phase edge', () => {
        expect(nearestBoundaryX(40, 4)).toBe(50);
        expect(nearestBoundaryX(10, 4)).toBe(0);
    });

    // EXPECTED RED — desired behavior, not yet implemented.
    // No phases means no boundaries; an empty list is the honest answer. Today this returns
    // [NaN] because 0/0 is computed for the single boundary.
    it('phaseBoundaries returns an empty list when there are no phases', () => {
        expect(phaseBoundaries(0)).toEqual([]);
    });

    // EXPECTED RED — desired behavior, not yet implemented.
    // The signature promises a number; today it returns undefined (and NaN distances) for a
    // zero-phase model instead of a usable position.
    it('nearestPhaseX always returns a real number', () => {
        expect(Number.isFinite(nearestPhaseX(30, 0))).toBe(true);
    });
});

describe('REQ-05 curve operations', () => {
    it('newCurve labels by position and cycles a palette color that differs from its neighbours', () => {
        const empty = makeModel({ curves: [] });
        const first = newCurve(empty, 0);
        expect(first.label).toBe('Curve 1');
        expect(first.color).toBe(PALETTE[0]);
        expect(first.opacity).toBe(DEFAULT_OPACITY);
        expect(first.smooth).toBe(true);
        expect(first.points).toHaveLength(5);

        // The colour already used by the previous curve is avoided.
        const afterOne = makeModel({ curves: [makeCurve({ color: PALETTE[0] })] });
        expect(newCurve(afterOne, 1).color).toBe(PALETTE[1]);

        // Both the next curve's colour and the previous one's are avoided.
        const sandwiched = makeModel({
            curves: [makeCurve({ color: PALETTE[0] }), makeCurve({ color: PALETTE[1] })],
        });
        expect(newCurve(sandwiched, 1).color).toBe(PALETTE[2]);
    });

    it('addCurve appends while below the cap and refuses at it', () => {
        const model = makeModel({ curves: [makeCurve()] });
        expect(canAddCurve(model)).toBe(true);
        expect(addCurve(model)).toBe(true);
        expect(model.curves).toHaveLength(2);
        expect(model.curves[1].label).toBe('Curve 2');

        const full = makeModel({
            curves: Array.from({ length: MAX_CURVES }, () => makeCurve()),
        });
        expect(canAddCurve(full)).toBe(false);
        expect(addCurve(full)).toBe(false);
        expect(full.curves).toHaveLength(MAX_CURVES);
    });

    it('cannot remove the last curve', () => {
        const model = makeModel({ curves: [makeCurve()] });
        expect(model.curves).toHaveLength(MIN_CURVES);
        expect(canRemoveCurve(model)).toBe(false);
        expect(removeCurve(model, 0)).toBe(false);
        expect(model.curves).toHaveLength(MIN_CURVES);
    });

    it('removeCurve rejects an out-of-range index', () => {
        const model = makeModel({ curves: [makeCurve(), makeCurve()] });
        expect(removeCurve(model, 5)).toBe(false);
        expect(removeCurve(model, -1)).toBe(false);
        expect(removeCurve(model, 1)).toBe(true);
        expect(model.curves).toHaveLength(1);
    });

    it('reorderCurve moves a curve and refuses no-op or out-of-range moves', () => {
        const model = makeModel({
            curves: [
                makeCurve({ label: 'A' }),
                makeCurve({ label: 'B' }),
                makeCurve({ label: 'C' }),
            ],
        });

        expect(reorderCurve(model, 5, 0)).toBe(false);
        expect(reorderCurve(model, 0, 0)).toBe(false);
        // A target that clamps back onto `from` is a no-op, not a move.
        expect(reorderCurve(model, 2, 99)).toBe(false);

        expect(reorderCurve(model, 0, 2)).toBe(true);
        expect(model.curves.map((curve) => curve.label)).toEqual(['B', 'C', 'A']);

        // The target index is clamped into range rather than rejected.
        expect(reorderCurve(model, 0, 99)).toBe(true);
        expect(model.curves.map((curve) => curve.label)).toEqual(['C', 'A', 'B']);
    });

    it('moveCurve delegates to reorderCurve and reports a no-op at the edge', () => {
        const model = makeModel({
            curves: [makeCurve({ label: 'A' }), makeCurve({ label: 'B' })],
        });
        expect(moveCurve(model, 0, -1)).toBe(false);
        expect(moveCurve(model, 0, 1)).toBe(true);
        expect(model.curves.map((curve) => curve.label)).toEqual(['B', 'A']);
    });
});

describe('REQ-05 point operations', () => {
    it('canAddPoint / canRemovePoint track the point bounds', () => {
        expect(canAddPoint(makeCurve())).toBe(true);
        expect(canRemovePoint(makeCurve())).toBe(true);
        expect(
            canRemovePoint(
                makeCurve({
                    points: [
                        { x: 0, y: 0 },
                        { x: 1, y: 1 },
                    ],
                })
            )
        ).toBe(false);
        expect(
            canAddPoint(
                makeCurve({
                    points: Array.from({ length: MAX_POINTS }, (_, index) => ({
                        x: index,
                        y: 0,
                    })),
                })
            )
        ).toBe(false);
    });

    it('insertPoint interpolates y from the neighbouring points when no y is given', () => {
        const model = makeModel();
        expect(insertPoint(model, 0, 25)).toBe(true);
        expect(model.curves[0].points).toEqual([
            { x: 0, y: 0 },
            { x: 25, y: 25 },
            { x: 50, y: 50 },
            { x: 100, y: 0 },
        ]);
    });

    it('insertPoint respects an explicit y and clamps x', () => {
        const model = makeModel();
        expect(insertPoint(model, 0, -40, 300)).toBe(true);
        expect(model.curves[0].points).toContainEqual({ x: 0, y: 100 });
        expect(model.curves[0].points).toHaveLength(4);
    });

    it('insertPoint refuses a missing curve or a full curve', () => {
        const model = makeModel();
        expect(insertPoint(model, 9, 10)).toBe(false);

        const full = makeModel({
            curves: [
                makeCurve({
                    points: Array.from({ length: MAX_POINTS }, (_, index) => ({
                        x: index,
                        y: 0,
                    })),
                }),
            ],
        });
        expect(insertPoint(full, 0, 10)).toBe(false);
    });

    it('removePoint refuses to drop below the minimum and rejects bad indexes', () => {
        const model = makeModel();
        expect(removePoint(model, 0, 5)).toBe(false);
        expect(removePoint(model, 9, 0)).toBe(false);

        const atMinimum = makeModel({
            curves: [
                makeCurve({
                    points: Array.from({ length: MIN_POINTS }, (_, index) => ({
                        x: index * 50,
                        y: 0,
                    })),
                }),
            ],
        });
        expect(canRemovePoint(atMinimum.curves[0])).toBe(false);
        expect(removePoint(atMinimum, 0, 0)).toBe(false);

        expect(removePoint(model, 0, 1)).toBe(true);
        expect(model.curves[0].points).toHaveLength(2);
    });

    it('setPoint clamps, re-sorts and keeps the dragged identity', () => {
        const model = makeModel();
        const dragged = model.curves[0].points[1];

        expect(setPoint(model, 0, dragged, 90, 10)).toBe(true);
        expect(dragged.x).toBe(90);
        expect(dragged.y).toBe(10);
        // Identity survives the re-sort, so an in-flight drag keeps tracking the same point.
        expect(model.curves[0].points).toContain(dragged);
        expect(model.curves[0].points.map((point) => point.x)).toEqual([0, 90, 100]);
    });

    it('setPoint clamps out-of-range coordinates and rejects a foreign point', () => {
        const model = makeModel();
        const dragged = model.curves[0].points[0];
        expect(setPoint(model, 0, dragged, -10, 500)).toBe(true);
        expect(dragged).toEqual({ x: 0, y: 100 });

        const stranger = { x: 1, y: 1 };
        expect(setPoint(model, 0, stranger, 10, 10)).toBe(false);
        expect(setPoint(model, 9, dragged, 10, 10)).toBe(false);
    });
});

describe('REQ-06 phase operations', () => {
    it('addPhase appends with a positional label and refuses at the cap', () => {
        const model = makeModel();
        expect(canAddPhase(model)).toBe(true);
        expect(addPhase(model)).toBe(true);
        expect(model.phases.at(-1).label).toBe('Phase 4');

        const full = makeModel({
            phases: Array.from({ length: MAX_PHASES }, () => makePhase()),
            curves: [makeCurve()],
        });
        expect(canAddPhase(full)).toBe(false);
        expect(addPhase(full)).toBe(false);
    });

    it('removePhase keeps at least one phase and rejects bad indexes', () => {
        const model = makeModel();
        expect(removePhase(model, 9)).toBe(false);
        expect(removePhase(model, 0)).toBe(true);
        expect(model.phases).toHaveLength(2);

        const single = makeModel({ phases: [makePhase()] });
        expect(canRemovePhase(single)).toBe(false);
        expect(removePhase(single, 0)).toBe(false);
        expect(single.phases).toHaveLength(MIN_PHASES);
    });

    it('reorderPhase moves labels and refuses no-op moves', () => {
        const model = makeModel({
            phases: [makePhase('A'), makePhase('B'), makePhase('C')],
        });
        expect(reorderPhase(model, 0, 0)).toBe(false);
        expect(reorderPhase(model, 9, 0)).toBe(false);

        expect(reorderPhase(model, 2, 0)).toBe(true);
        expect(model.phases.map((phase) => phase.label)).toEqual(['C', 'A', 'B']);
    });
});

describe('REQ-07 event operations', () => {
    it('addEvent returns the created event at the centre and keeps events sorted', () => {
        const model = makeModel({
            events: [makeEvent({ label: 'late', x: 90 })],
        });

        const created = addEvent(model);
        expect(created).not.toBeNull();
        expect(created).toEqual({ label: 'Event 2', note: '', x: 50 });
        expect(model.events.map((event) => event.label)).toEqual(['Event 2', 'late']);
        // The returned reference is the same object that landed in the model.
        expect(model.events[0]).toBe(created);
    });

    it('addEvent returns null at the cap', () => {
        const model = makeModel({
            events: Array.from({ length: MAX_EVENTS }, () => makeEvent()),
        });
        expect(canAddEvent(model)).toBe(false);
        expect(addEvent(model)).toBeNull();
        expect(model.events).toHaveLength(MAX_EVENTS);
    });

    it('removeEvent respects the minimum and rejects bad indexes', () => {
        const model = makeModel({ events: [makeEvent()] });
        expect(removeEvent(model, 0)).toBe(true);
        expect(model.events).toHaveLength(0);
        expect(canRemoveEvent(model)).toBe(false);
        expect(removeEvent(model, 0)).toBe(false);
    });

    it('setEventX clamps, re-sorts and keeps the dragged identity', () => {
        const model = makeModel({
            events: [makeEvent({ label: 'a', x: 10 }), makeEvent({ label: 'b', x: 80 })],
        });
        const dragged = model.events[0];

        expect(setEventX(model, dragged, 200)).toBe(true);
        expect(dragged.x).toBe(100);
        expect(model.events.map((event) => event.label)).toEqual(['b', 'a']);
        expect(model.events[1]).toBe(dragged);
    });

    it('setEventX rejects an event that is not in the model', () => {
        const model = makeModel({ events: [makeEvent()] });
        expect(setEventX(model, makeEvent({ x: 5 }), 5)).toBe(false);
    });

    it('keeps a model with no events valid', () => {
        const model: GraphModel = makeModel({ events: [] });
        expect(parseModel(JSON.parse(JSON.stringify(model)))).not.toBeNull();
    });
});
