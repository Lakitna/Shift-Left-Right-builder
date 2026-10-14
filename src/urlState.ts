/**
 * URL state: the whole graph model travels in the page URL as base64url JSON in the `#p=`
 * hash parameter, so any model can be shared by copying the link. Written with
 * `history.replaceState` (no history entries) and read back + validated on load.
 *
 * Wire format (version 1) is compact but still readable JSON:
 * - phases are plain strings ("Pre-merge"), not {label} objects;
 * - curve points are [x, y] tuples, not {x, y} objects;
 * - fields at their default are omitted: empty title/yAxisTitle/notes, numericAxis=false,
 *   smooth=true, opacity=DEFAULT_OPACITY.
 * The in-memory model keeps its explicit object shape; only this encoding is compact.
 */

import {
    DEFAULT_OPACITY,
    MODEL_VERSION,
    parseModel,
    type CurvePoint,
    type GraphModel,
} from './model';

const HASH_PARAM = 'p';

interface WireCurve {
    label: string;
    color: string;
    notes?: string;
    smooth?: boolean;
    opacity?: number;
    points: [number, number][];
}

interface WireModel {
    version: number;
    title?: string;
    yAxisTitle?: string;
    numericAxis?: boolean;
    phases: string[];
    curves: WireCurve[];
}

function toWire(model: GraphModel): WireModel {
    const wire: WireModel = {
        version: MODEL_VERSION,
        phases: model.phases.map((phase) => phase.label),
        curves: model.curves.map((curve) => {
            const entry: WireCurve = {
                label: curve.label,
                color: curve.color,
                points: curve.points.map((point): [number, number] => [point.x, point.y]),
            };
            if (curve.notes !== '') entry.notes = curve.notes;
            if (!curve.smooth) entry.smooth = false;
            if (curve.opacity !== DEFAULT_OPACITY) entry.opacity = curve.opacity;
            return entry;
        }),
    };
    if ((model.title ?? '') !== '') wire.title = model.title;
    if ((model.yAxisTitle ?? '') !== '') wire.yAxisTitle = model.yAxisTitle;
    if (model.numericAxis) wire.numericAxis = true;
    return wire;
}

/** Expand the compact wire shape into the explicit object shape parseModel validates. */
function fromWire(wire: WireModel): unknown {
    return {
        version: wire.version,
        title: wire.title ?? '',
        yAxisTitle: wire.yAxisTitle ?? '',
        numericAxis: wire.numericAxis === true,
        phases: wire.phases.map((label) => ({ label })),
        curves: wire.curves.map((curve) => ({
            label: curve.label,
            color: curve.color,
            notes: curve.notes ?? '',
            smooth: curve.smooth ?? true,
            opacity: curve.opacity ?? DEFAULT_OPACITY,
            points: curve.points.map(([x, y]): CurvePoint => ({ x, y })),
        })),
    };
}

/** Encode a model as URL-safe base64 of its compact wire JSON (UTF-8 safe). */
export function encodeModel(model: GraphModel): string {
    const json = JSON.stringify(toWire(model));
    const bytes = new TextEncoder().encode(json);
    let binary = '';
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

/** Decode a base64url string back into a validated model, or null when invalid. */
export function decodeModel(encoded: string): GraphModel | null {
    try {
        let base64 = encoded.replaceAll('-', '+').replaceAll('_', '/');
        while (base64.length % 4 !== 0) {
            base64 += '=';
        }
        const binary = atob(base64);
        const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
        const json = new TextDecoder().decode(bytes);
        const parsed = JSON.parse(json) as { version?: unknown } | null;
        if (typeof parsed !== 'object' || parsed === null || parsed.version !== MODEL_VERSION) {
            return null;
        }
        return parseModel(fromWire(parsed as WireModel));
    } catch {
        return null;
    }
}

export interface HashReadResult {
    /** The decoded model, or null when absent/invalid. */
    model: GraphModel | null;
    /** Whether the hash contained model data at all (even if invalid). */
    present: boolean;
}

export function readHash(): HashReadResult {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const value = params.get(HASH_PARAM);
    if (value === null || value === '') {
        return { model: null, present: false };
    }
    return { model: decodeModel(value), present: true };
}

/**
 * Write the model into the URL hash without adding a history entry. Returns the encoded model
 * string (the caller compares it to avoid needless rewrites).
 */
export function writeStateToHash(model: GraphModel): string {
    const encoded = encodeModel(model);
    const params = new URLSearchParams();
    params.set(HASH_PARAM, encoded);
    window.history.replaceState(null, '', `#${params.toString()}`);
    return encoded;
}
