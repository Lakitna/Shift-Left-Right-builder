import { FONT_FACES } from './fonts.generated';
import type { GraphStyle } from './styles/types';

/**
 * Font loading and export embedding. @font-face rules point at static woff2 files
 * (content-hashed names, cacheable independently of the JS bundle) and are injected
 * per style on demand: browsers eagerly fetch the src of every rule in the document,
 * so only the styles actually in use download their faces. Exports fetch the same
 * files on demand and inline them as data URIs, so SVG/PNG leave the page with the
 * style's real typefaces, offline and untainted.
 */

function faceRule(family: string, weight: number, source: string): string {
    return (
        `@font-face { font-family: '${family}'; font-style: normal; font-weight: ${weight}; ` +
        `src: url(${source}) format('woff2'); }`
    );
}

function findFace(family: string, weight: number): FontFaceEntry | undefined {
    return FONT_FACES.find((f) => f.family === family && f.weight === weight);
}
type FontFaceEntry = (typeof FONT_FACES)[number];

const injectedFaces = new Set<string>();

/**
 * Add @font-face rules for the given faces (each face exactly once). Call this before
 * `document.fonts.load` for a style — without a rule the load resolves empty and
 * canvas measurement would silently use the fallback stack.
 */
export function ensureFontFaces(keys: readonly (readonly [string, number])[]): void {
    let element = document.querySelector('#bundled-fonts') as HTMLStyleElement | null;
    if (element === null) {
        element = document.createElement('style');
        element.id = 'bundled-fonts';
        document.head.append(element);
    }
    for (const [family, weight] of keys) {
        const face = findFace(family, weight);
        if (face === undefined) continue;
        const key = `${family}:${weight}`;
        if (injectedFaces.has(key)) continue;
        injectedFaces.add(key);
        element.textContent +=
            (element.textContent === '' ? '' : '\n') + faceRule(family, weight, `'${face.url}'`);
    }
}

/**
 * base64 data URIs per font URL, cached in memory per page load. The browser's HTTP
 * cache covers the network side (content-hashed file names), so exports after the
 * first neither refetch nor re-encode.
 */
const dataUriCache = new Map<string, Promise<string>>();

function bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    const chunk = 0x80_00; // keep String.fromCharCode's argument count safe
    for (let index = 0; index < bytes.length; index += chunk) {
        binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
    }
    return btoa(binary);
}

function fontDataUri(url: string): Promise<string> {
    const cached = dataUriCache.get(url);
    if (cached !== undefined) return cached;
    const pending = fetch(url)
        .then((response) => {
            if (!response.ok) {
                throw new Error(`Could not load font '${url}' (${response.status})`);
            }
            return response.arrayBuffer();
        })
        .then((buffer) => `data:font/woff2;base64,${bytesToBase64(new Uint8Array(buffer))}`);
    dataUriCache.set(url, pending);
    pending.catch(() => dataUriCache.delete(url)); // let a later export retry a failed fetch
    return pending;
}

/**
 * The same rules as `fontFaceCss`, but with the font bytes inlined as data URIs — for
 * embedding in exported SVG/PNG, which must render offline. Rejects when a font file
 * cannot be fetched, so callers can warn instead of exporting a fontless sheet.
 */
export async function embeddedFontFaceCss(
    keys: readonly (readonly [string, number])[]
): Promise<string> {
    const parts: string[] = [];
    for (const [family, weight] of keys) {
        const face = findFace(family, weight);
        if (face === undefined) continue;
        parts.push(faceRule(family, weight, `"${await fontDataUri(face.url)}"`));
    }
    return parts.join('\n');
}

/**
 * Wait for a style's fonts to be ready. `textWidth()` measures with canvas metrics, so
 * wrapping and chip sizing must not run before the real typefaces are available.
 * Injects the style's @font-face rules first — that is what triggers (and limits) the
 * woff2 download to the styles actually used.
 */
export async function loadStyleFonts(style: GraphStyle): Promise<void> {
    ensureFontFaces(style.typography.fonts);
    const sample = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,:;!?()&/%-—’';
    await Promise.all(
        style.typography.fonts.map(
            ([family, weight]) =>
                document.fonts.load(`${weight} 16px "${family}"`, sample).catch(() => {}) // offline/failed: fallback stack still renders
        )
    );
}
