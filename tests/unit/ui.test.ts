/**
 * Component tests for the export filename sanitiser (REQ-12). `normalizeFilename` is the one
 * `ui` helper with no DOM dependency, so it belongs to the component tier.
 */
import { describe, expect, it } from 'vitest';

import { normalizeFilename } from '../../src/ui';

describe('REQ-12 export filename normalisation', () => {
    it('trims surrounding whitespace', () => {
        expect(normalizeFilename('  my graph  ', 'fallback.svg', 'svg')).toBe('my graph.svg');
    });

    it('strips path separators and reserved characters', () => {
        expect(normalizeFilename('a/b\\c:d*e?f"g<h>i|j', 'fallback.png', 'png')).toBe(
            'abcdefghij.png'
        );
    });

    it('falls back when nothing usable is left', () => {
        expect(normalizeFilename('   ', 'fallback.png', 'png')).toBe('fallback.png');
        expect(normalizeFilename('/', 'fallback.svg', 'svg')).toBe('fallback.svg');
    });

    it('appends the expected extension when it is missing', () => {
        expect(normalizeFilename('graph', 'fallback.png', 'png')).toBe('graph.png');
        expect(normalizeFilename('graph.svg', 'fallback.png', 'png')).toBe('graph.svg.png');
    });

    it('keeps an existing extension, comparing case-insensitively', () => {
        expect(normalizeFilename('graph.png', 'fallback.png', 'png')).toBe('graph.png');
        expect(normalizeFilename('GRAPH.PNG', 'fallback.png', 'png')).toBe('GRAPH.PNG');
    });
});
