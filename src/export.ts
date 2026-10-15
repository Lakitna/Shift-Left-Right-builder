/**
 * Image export. Both formats render a FRESH SVG from the model (never the editing overlays), so
 * selection UI never leaks into files. Exports are WYSIWYG for the ACTIVE style: the same
 * `renderGraphSvg` path runs, and the style's bundled fonts are inlined as base64 `@font-face`
 * data URIs so SVG/PNG leave the page with the real typefaces, offline and untainted.
 */

import { embeddedFontFaceCss } from './fonts';
import type { GraphModel } from './model';
import { computeLayout, renderGraphSvg, serializeSvg } from './render';
import { getActiveStyle } from './styleState';

function triggerDownload(objectUrl: string, filename: string): void {
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
}

export interface SvgExportOptions {
    filename: string;
    dark: boolean;
    transparent: boolean;
    includeLegend: boolean;
}

export interface PngExportOptions {
    filename: string;
    dark: boolean;
    /** Rasterization pixel ratio; 2 gives retina quality. */
    scale: number;
    transparent: boolean;
    includeLegend: boolean;
}

/** Standalone SVG document string for the model in the given color mode / background. */
export async function buildSvgString(
    model: GraphModel,
    options: { dark: boolean; transparent: boolean; includeLegend: boolean }
): Promise<string> {
    const style = getActiveStyle();
    const { svg } = renderGraphSvg(model, {
        style,
        dark: options.dark,
        attribution: true,
        transparentBackground: options.transparent,
        includeLegend: options.includeLegend,
    });
    return serializeSvg(svg, {
        embedFontCss: await embeddedFontFaceCss(style.typography.fonts),
    });
}

export async function exportSvg(model: GraphModel, options: SvgExportOptions): Promise<void> {
    const blob = new Blob([await buildSvgString(model, options)], {
        type: 'image/svg+xml;charset=utf-8',
    });
    triggerDownload(URL.createObjectURL(blob), options.filename);
}

interface PngSheet {
    svgString: string;
    width: number;
    height: number;
}

async function buildPngSheet(
    model: GraphModel,
    dark: boolean,
    transparent: boolean,
    includeLegend: boolean
): Promise<PngSheet> {
    const style = getActiveStyle();
    const { svg, geom } = renderGraphSvg(model, {
        style,
        dark,
        attribution: true,
        transparentBackground: transparent,
        includeLegend,
    });
    return {
        svgString: serializeSvg(svg, {
            embedFontCss: await embeddedFontFaceCss(style.typography.fonts),
        }),
        width: geom.width,
        height: geom.height,
    };
}

async function rasterizeSheet(
    sheet: PngSheet,
    dark: boolean,
    transparent: boolean,
    scale: number
): Promise<Blob> {
    const image = new Image();
    const dataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(sheet.svgString);
    await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('Could not rasterize the graph SVG'));
        image.src = dataUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(sheet.width * scale);
    canvas.height = Math.round(sheet.height * scale);
    const context = canvas.getContext('2d');
    if (context === null) {
        throw new Error('Canvas 2D rendering context is not available');
    }
    if (!transparent) {
        const style = getActiveStyle();
        context.fillStyle = (dark ? style.canvas.dark : style.canvas.light).background;
        context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (blob === null) {
        throw new Error('Could not encode the graph as PNG');
    }
    return blob;
}

export async function exportPng(model: GraphModel, options: PngExportOptions): Promise<void> {
    const sheet = await buildPngSheet(model, options.dark, options.transparent, options.includeLegend);
    const blob = await rasterizeSheet(sheet, options.dark, options.transparent, options.scale);
    triggerDownload(URL.createObjectURL(blob), options.filename);
}

/** Sheet size in pixels at scale 1 — layout only, no SVG build or rasterization. */
export function measurePngSheet(
    model: GraphModel,
    options: { dark: boolean; transparent: boolean; includeLegend: boolean }
): { width: number; height: number } {
    const geom = computeLayout(model, {
        style: getActiveStyle(),
        dark: options.dark,
        transparentBackground: options.transparent,
        includeLegend: options.includeLegend,
    });
    return { width: geom.width, height: geom.height };
}

/** Small rasterized preview for the export dialog (never above scale 1). */
export async function renderPngPreview(
    model: GraphModel,
    options: { dark: boolean; transparent: boolean; includeLegend: boolean },
    maxWidth = 320
): Promise<Blob> {
    const sheet = await buildPngSheet(model, options.dark, options.transparent, options.includeLegend);
    const scale = Math.min(1, maxWidth / sheet.width);
    return rasterizeSheet(sheet, options.dark, options.transparent, scale);
}
