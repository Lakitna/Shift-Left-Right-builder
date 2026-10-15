/**
 * URL state: the whole graph model travels in the page URL as base64url DEFLATE of the compact
 * wire JSON in the `#p=` hash parameter, so any model can be shared by copying the link.
 * Written with `history.replaceState` (no history entries) and read back + validated on load.
 *
 * Compression uses the browser's built-in `CompressionStream` ('deflate-raw') — no dependency.
 * It roughly halves note-heavy payloads; tiny models may come out slightly larger, which is
 * fine. Streams are async, hence the Promise-based API. Old uncompressed links fail to inflate
 * and fall back to the default model with a warning banner.
 *
 * Wire format (version 1) is compact but still readable JSON:
 * - phases are plain strings ("Pre-merge"), not {label} objects;
 * - curve points are [x, y] tuples, not {x, y} objects;
 * - events are [label, note, x] tuples (always present, possibly empty);
 * - fields at their default are omitted: empty notes, numericAxis=false, smooth=true,
 *   opacity=DEFAULT_OPACITY.
 * `title` and `yAxisTitle` are always written (as "" when unset) so the decoded model satisfies
 * the strict shape `parseModel` requires. The in-memory model keeps its explicit object shape;
 * only this encoding is compact.
 *
 * The visual style is chrome, not model data: it travels as a sibling `#s=` hash parameter
 * (omitted for the default 'classic'), never inside the `#p=` payload.
 */

import {
    DEFAULT_OPACITY,
    MODEL_VERSION,
    parseModel,
    type CurvePoint,
    type GraphModel,
} from './model';
import { DEFAULT_STYLE_ID, isValidStyleId } from './styles';

const HASH_PARAM = 'p';
const STYLE_PARAM = 's';

interface WireCurve {
    label: string;
    color: string;
    /** Only present when true — the default (style palette / stored color) is omitted. */
    colorCustom?: true;
    notes?: string;
    smooth?: boolean;
    opacity?: number;
    points: [number, number][];
}

interface WireModel {
    version: number;
    title: string;
    yAxisTitle: string;
    numericAxis?: boolean;
    phases: string[];
    events: [string, string, number][];
    curves: WireCurve[];
}

function toWire(model: GraphModel): WireModel {
    return {
        version: MODEL_VERSION,
        title: model.title ?? '',
        yAxisTitle: model.yAxisTitle ?? '',
        ...(model.numericAxis ? { numericAxis: true } : {}),
        phases: model.phases.map((phase) => phase.label),
        events: model.events.map((event): [string, string, number] => [
            event.label,
            event.note,
            event.x,
        ]),
        curves: model.curves.map((curve) => {
            const entry: WireCurve = {
                label: curve.label,
                color: curve.color,
                points: curve.points.map((point): [number, number] => [point.x, point.y]),
            };
            if (curve.colorCustom === true) entry.colorCustom = true;
            if (curve.notes !== '') entry.notes = curve.notes;
            if (!curve.smooth) entry.smooth = false;
            if (curve.opacity !== DEFAULT_OPACITY) entry.opacity = curve.opacity;
            return entry;
        }),
    };
}

/** Expand the compact wire shape into the explicit object shape parseModel validates. */
function fromWire(wire: WireModel): unknown {
    return {
        version: wire.version,
        title: wire.title,
        yAxisTitle: wire.yAxisTitle,
        numericAxis: wire.numericAxis === true,
        phases: wire.phases.map((label) => ({ label })),
        events: wire.events.map(([label, note, x]) => ({ label, note, x })),
        curves: wire.curves.map((curve) => ({
            label: curve.label,
            color: curve.color,
            ...(curve.colorCustom === true ? { colorCustom: true } : {}),
            notes: curve.notes ?? '',
            smooth: curve.smooth ?? true,
            opacity: curve.opacity ?? DEFAULT_OPACITY,
            points: curve.points.map(([x, y]): CurvePoint => ({ x, y })),
        })),
    };
}

/**
 * Bytes → latin1 string in fixed chunks. A single `String.fromCharCode(...bytes)` spread would
 * hit the engine's argument-count limit on large models, so the conversion is chunked.
 */
function toBinary(bytes: Uint8Array): string {
    let binary = '';
    const CHUNK = 8192;
    for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return binary;
}

/** Raw bytes → URL-safe base64 (padding stripped). */
function toBase64Url(bytes: Uint8Array): string {
    return btoa(toBinary(bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

/** URL-safe base64 → raw bytes, re-padding before `atob`. */
function fromBase64Url(encoded: string): Uint8Array<ArrayBuffer> {
    let base64 = encoded.replaceAll('-', '+').replaceAll('_', '/');
    base64 += '='.repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

/** Push bytes through a Compression/DecompressionStream and collect the output. */
async function pipeBytes(
    bytes: Uint8Array<ArrayBuffer>,
    stream: CompressionStream | DecompressionStream
): Promise<Uint8Array> {
    const writer = stream.writable.getWriter();
    void writer.write(bytes);
    void writer.close();
    return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

/** Encode a model as URL-safe base64 of the DEFLATE'd compact wire JSON (UTF-8 safe). */
export async function encodeModel(model: GraphModel): Promise<string> {
    const json = JSON.stringify(toWire(model));
    const deflated = await pipeBytes(
        new TextEncoder().encode(json),
        new CompressionStream('deflate-raw')
    );
    return toBase64Url(deflated);
}

/** Decode a base64url DEFLATE string back into a validated model, or null when invalid. */
export async function decodeModel(encoded: string): Promise<GraphModel | null> {
    try {
        const inflated = await pipeBytes(
            fromBase64Url(encoded),
            new DecompressionStream('deflate-raw')
        );
        const parsed = JSON.parse(new TextDecoder().decode(inflated)) as {
            version?: unknown;
        } | null;
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
    /** The shared style id, or null when absent/unknown (the viewer's own preference applies). */
    styleId: string | null;
}

export async function readHash(): Promise<HashReadResult> {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const styleParam = params.get(STYLE_PARAM);
    const styleId = styleParam !== null && isValidStyleId(styleParam) ? styleParam : null;
    const value = params.get(HASH_PARAM);
    if (value === null || value === '') {
        return { model: null, present: false, styleId };
    }
    return { model: await decodeModel(value), present: true, styleId };
}

/**
 * Write the model + active style into the URL hash without adding a history entry. Callers that
 * must read the fresh URL back (copy-link) await this; the debounced sync fires and forgets.
 * `s=` is omitted for the default style so pre-style links stay short.
 */
export async function writeStateToHash(model: GraphModel, styleId: string): Promise<void> {
    const encoded = await encodeModel(model);
    const params = new URLSearchParams();
    params.set(HASH_PARAM, encoded);
    if (styleId !== DEFAULT_STYLE_ID) params.set(STYLE_PARAM, styleId);
    window.history.replaceState(null, '', `#${params.toString()}`);
}
