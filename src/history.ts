/**
 * Undo/redo over whole-model snapshots. Snapshots are JSON strings so the history is a plain
 * bounded list with no shared object references; `restore` hands back the parsed model.
 */

import { parseModel, type GraphModel } from './model';

const HISTORY_LIMIT = 100;

export class History {
    private snapshots: string[] = [];
    private index = -1;

    /** Record the current model as a new state, dropping any redo tail. No-op if unchanged. */
    push(model: GraphModel): void {
        const snapshot = JSON.stringify(model);
        if (this.snapshots[this.index] === snapshot) return;
        this.snapshots.splice(this.index + 1);
        this.snapshots.push(snapshot);
        if (this.snapshots.length > HISTORY_LIMIT) this.snapshots.shift();
        this.index = this.snapshots.length - 1;
    }

    canUndo(): boolean {
        return this.index > 0;
    }

    canRedo(): boolean {
        return this.index < this.snapshots.length - 1;
    }

    /** Step back/forward and return the restored model, or null when at a boundary. */
    step(offset: -1 | 1): GraphModel | null {
        const target = this.index + offset;
        if (target < 0 || target >= this.snapshots.length) return null;
        const parsed = parseModel(JSON.parse(this.snapshots[target]));
        if (parsed === null) return null;
        this.index = target;
        return parsed;
    }

    /** Start over from a single initial state (e.g. after loading a model from the URL). */
    reset(model: GraphModel): void {
        this.snapshots = [JSON.stringify(model)];
        this.index = 0;
    }
}
