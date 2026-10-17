/**
 * Component tests for the undo/redo snapshot history that backs the toolbar buttons and the
 * Ctrl+Z / Ctrl+Y shortcuts (REQ-04, REQ-10).
 */
import { describe, expect, it } from 'vitest';

import { History } from '../../src/history';
import { makeModel } from './fixtures';

describe('REQ-04 undo/redo history', () => {
    it('starts with nothing to undo or redo', () => {
        const history = new History();
        expect(history.canUndo()).toBe(false);
        expect(history.canRedo()).toBe(false);
        expect(history.step(-1)).toBeNull();
        expect(history.step(1)).toBeNull();
    });

    it('treats a repeated push of the same model as a no-op', () => {
        const history = new History();
        const model = makeModel({ title: 'A' });

        history.push(model);
        history.push(model);
        expect(history.canUndo()).toBe(false);
    });

    it('steps back and forward over recorded states', () => {
        const history = new History();
        history.push(makeModel({ title: 'A' }));
        history.push(makeModel({ title: 'B' }));

        expect(history.canUndo()).toBe(true);
        expect(history.step(-1)?.title).toBe('A');
        expect(history.canRedo()).toBe(true);
        expect(history.step(1)?.title).toBe('B');
        expect(history.canRedo()).toBe(false);
    });

    it('drops the redo tail when a new state is pushed after an undo', () => {
        const history = new History();
        history.push(makeModel({ title: 'A' }));
        history.push(makeModel({ title: 'B' }));
        history.step(-1);

        history.push(makeModel({ title: 'C' }));
        expect(history.canRedo()).toBe(false);
        expect(history.step(1)).toBeNull();
        expect(history.step(-1)?.title).toBe('A');
    });

    it('caps the history at 100 states and returns null past the oldest', () => {
        const history = new History();
        for (let index = 0; index < 150; index += 1) {
            history.push(makeModel({ title: `T${index}` }));
        }

        let steps = 0;
        while (history.step(-1) !== null) steps += 1;

        // 100 retained states means 99 steps back before the boundary.
        expect(steps).toBe(99);
    });

    it('reset collapses the history to a single state', () => {
        const history = new History();
        history.push(makeModel({ title: 'A' }));
        history.push(makeModel({ title: 'B' }));

        history.reset(makeModel({ title: 'Z' }));
        expect(history.canUndo()).toBe(false);
        expect(history.canRedo()).toBe(false);
        expect(history.step(1)).toBeNull();
        expect(history.step(-1)).toBeNull();
    });

    it('hands back a detached model, not a live reference into the history', () => {
        const history = new History();
        const original = makeModel({ title: 'A' });
        history.push(original);
        history.push(makeModel({ title: 'B' }));

        const restored = history.step(-1);
        expect(restored).not.toBe(original);
        restored!.curves[0].points[0].y = 42;
        expect(original.curves[0].points[0].y).toBe(0);
    });
});
