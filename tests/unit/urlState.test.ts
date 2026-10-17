/**
 * Component tests for the URL wire format (REQ-01, REQ-11).
 *
 * `encodeModel` / `decodeModel` only need `CompressionStream`, `TextEncoder` and `btoa`, all of
 * which Node provides, so the round-trip contract is testable without a browser. `readHash` /
 * `writeStateToHash` touch `window` and are covered by the GUI tier instead.
 *
 * The wire JSON is inspected directly (via `node:zlib`) so the compact encoding itself — what is
 * always written and what is omitted — is pinned, not just the round-trip.
 */
import { deflateRawSync, inflateRawSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { MODEL_VERSION, cloneModel } from '../../src/model';
import { PRESETS } from '../../src/presets';
import { decodeModel, encodeModel } from '../../src/urlState';
import { makeCurve, makeModel } from './fixtures';

function inflateWire(encoded: string): Record<string, unknown> {
    const json = inflateRawSync(Buffer.from(encoded, 'base64url')).toString('utf8');
    return JSON.parse(json) as Record<string, unknown>;
}

function deflateAsHash(value: unknown): string {
    return deflateRawSync(Buffer.from(JSON.stringify(value), 'utf8')).toString('base64url');
}

describe('REQ-01 / REQ-11 URL encoding', () => {
    it('round-trips every shipped preset', async () => {
        for (const preset of PRESETS) {
            const model = cloneModel(preset.data);
            const decoded = await decodeModel(await encodeModel(model));
            expect(decoded, preset.name).toEqual(model);
        }
    });

    it('round-trips every non-default field', async () => {
        const model = makeModel({
            numericAxis: true,
            events: [
                { label: 'Gate', note: 'go / no-go', x: 12 },
                { label: 'Release', note: '', x: 80 },
            ],
            curves: [
                makeCurve({
                    label: 'Custom',
                    color: '#123456',
                    colorCustom: true,
                    notes: 'a note that must survive the round trip',
                    smooth: false,
                    opacity: 0.8,
                }),
            ],
        });

        expect(await decodeModel(await encodeModel(model))).toEqual(model);
    });

    it('always writes events, even when the model has none', async () => {
        const encoded = await encodeModel(makeModel({ events: [] }));
        expect(inflateWire(encoded).events).toEqual([]);
        expect((await decodeModel(encoded))?.events).toEqual([]);
    });

    it('omits fields that hold their default value but always writes both titles', async () => {
        const wire = inflateWire(await encodeModel(makeModel({ curves: [makeCurve()] })));

        // Always written so the decoded model satisfies the strict parseModel shape.
        expect(typeof wire.title).toBe('string');
        expect(typeof wire.yAxisTitle).toBe('string');
        expect(wire.phases).toEqual(['Pre-merge', 'Post-merge', 'Pre-release']);
        expect(wire.version).toBe(MODEL_VERSION);

        // Defaults are left out entirely.
        expect(wire.numericAxis).toBeUndefined();
        const curve = (wire.curves as Record<string, unknown>[])[0];
        expect(curve.smooth).toBeUndefined();
        expect(curve.opacity).toBeUndefined();
        expect(curve.notes).toBeUndefined();
        expect(curve.colorCustom).toBeUndefined();
    });

    it('compresses a note-heavy model below the size of its own JSON', async () => {
        const heavy = makeModel({
            curves: [
                makeCurve({
                    notes: 'Quality moved earlier: unit, component and integration tests. '.repeat(
                        12
                    ),
                }),
            ],
        });

        const encoded = await encodeModel(heavy);
        expect(encoded.length).toBeLessThan(
            Buffer.byteLength(JSON.stringify(inflateWire(encoded)), 'utf8')
        );
    });

    it('rejects a payload that is not valid compressed data', async () => {
        expect(await decodeModel('!!!not-base64!!!')).toBeNull();
        expect(await decodeModel('')).toBeNull();
    });

    // EXPECTED RED — desired behavior, not yet implemented.
    // `pipeBytes` in urlState.ts starts `writer.write(...)` and `writer.close()` with `void`, so
    // when the stream errors on a corrupt payload those promises reject with nobody listening.
    // The decode still returns null, so the bug is invisible except as a leaked unhandled
    // rejection on every malformed share link.
    it('leaks no unhandled rejection when a payload is corrupt', async () => {
        const leaks: unknown[] = [];
        const onLeak = (reason: unknown) => leaks.push(reason);
        process.on('unhandledRejection', onLeak);
        try {
            await decodeModel('');
            await decodeModel('!!!not-base64!!!');
            await new Promise((resolve) => setTimeout(resolve, 50));
        } finally {
            process.off('unhandledRejection', onLeak);
        }
        expect(leaks).toEqual([]);
    });

    it('rejects a pre-release uncompressed link', async () => {
        const plain = Buffer.from(JSON.stringify(makeModel()), 'utf8').toString('base64url');
        expect(await decodeModel(plain)).toBeNull();
    });

    it('rejects a payload from a different model version', async () => {
        const other = deflateAsHash({
            version: MODEL_VERSION + 1,
            title: '',
            yAxisTitle: '',
            phases: ['a'],
            events: [],
            curves: [],
        });
        expect(await decodeModel(other)).toBeNull();
    });

    it('rejects a payload that inflates but is not a valid model', async () => {
        const notAModel = deflateAsHash({ version: MODEL_VERSION, nope: true });
        expect(await decodeModel(notAModel)).toBeNull();
    });
});
