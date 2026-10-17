/**
 * Shared fixtures for the component tests. Deliberately NOT named `*.test.ts` so vitest does not
 * collect it as a suite (see `include` in vitest.config.ts).
 *
 * `makeModel` produces a model that already satisfies the strict `parseModel` contract, so tests
 * can use it both as a valid input and as a known-good baseline to mutate.
 */
import {
    DEFAULT_OPACITY,
    MODEL_VERSION,
    type Curve,
    type GraphEvent,
    type GraphModel,
    type Phase,
} from '../../src/model';

export function makeCurve(overrides: Partial<Curve> = {}): Curve {
    return {
        label: 'Curve',
        color: '#22c1d9',
        notes: '',
        smooth: true,
        opacity: DEFAULT_OPACITY,
        points: [
            { x: 0, y: 0 },
            { x: 50, y: 50 },
            { x: 100, y: 0 },
        ],
        ...overrides,
    };
}

export function makePhase(label = 'Phase'): Phase {
    return { label };
}

export function makeEvent(overrides: Partial<GraphEvent> = {}): GraphEvent {
    return { label: 'Release', note: '', x: 75, ...overrides };
}

export function makeModel(overrides: Partial<GraphModel> = {}): GraphModel {
    return {
        version: MODEL_VERSION,
        title: 'Shift-Left / Shift-Right',
        yAxisTitle: 'Test volume',
        numericAxis: false,
        phases: [makePhase('Pre-merge'), makePhase('Post-merge'), makePhase('Pre-release')],
        events: [],
        curves: [makeCurve({ label: 'Shift-left' })],
        ...overrides,
    };
}

/** A `makeModel` result as plain JSON data, for feeding deliberately-broken payloads into parseModel. */
export function makeRawModel(): Record<string, unknown> {
    return JSON.parse(JSON.stringify(makeModel())) as Record<string, unknown>;
}
