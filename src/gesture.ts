/**
 * Shared pointer-gesture plumbing for direct manipulation on the canvas.
 *
 * Every canvas gesture (point drag, whole-curve move, phase reorder, legend reorder) is the same
 * state machine: a pointerdown starts tracking window-level pointermove/pointerup (and
 * pointercancel), the pointer must travel past a threshold before the gesture counts as a drag,
 * and on release the caller decides click-vs-drag from `moved`. Gesture-specific math (coordinate
 * mapping, previews, commits) stays in the caller's onMove/onEnd callbacks.
 *
 * Listening to pointercancel matters: without it a canceled touch leaves the move/up listeners
 * attached, and the NEXT pointerup anywhere on the page finishes the stale gesture.
 */

export interface GestureState {
    /** Total pointer delta from the gesture start, in client px. */
    dx: number;
    dy: number;
    /** True once the pointer has travelled past the drag threshold. */
    moved: boolean;
    /** The event that produced this state (pointermove, pointerup, or pointercancel). */
    event: PointerEvent;
}

export interface GestureOptions {
    /**
     * Client px the pointer must travel before the gesture counts as a drag. Default 0, which
     * means the first pointermove already drags.
     */
    threshold?: number;
    /** Called for each move once the gesture is dragging. */
    onMove?(state: GestureState): void;
    /** Called exactly once on release or cancel, after the listeners are removed. */
    onEnd(state: GestureState): void;
}

export function startGesture(down: PointerEvent, options: GestureOptions): void {
    const threshold = options.threshold ?? 0;
    let moved = false;

    const state = (event: PointerEvent): GestureState => {
        const dx = event.clientX - down.clientX;
        const dy = event.clientY - down.clientY;
        if (!moved && Math.hypot(dx, dy) >= threshold) moved = true;
        return { dx, dy, moved, event };
    };

    const onPointerMove = (event: PointerEvent): void => {
        const current = state(event);
        if (current.moved && options.onMove !== undefined) options.onMove(current);
    };

    const finish = (event: PointerEvent): void => {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', finish);
        window.removeEventListener('pointercancel', finish);
        options.onEnd(state(event));
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
}
