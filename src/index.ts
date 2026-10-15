/*
Dear reader,

This code was written with AI. It was optimized for implementation speed.
Be careful to keep your sanity while reading this code.

You have been warned.

Lakitna
*/

import { createEditor, type GraphEditor } from './editor';
import { buildSvgString, exportPng, exportSvg, measurePngSheet, renderPngPreview } from './export';
import { collectDialogElements, createExportDialog, createPreviewRefresher } from './exportDialog';
import { History } from './history';
import { cloneModel, type GraphModel } from './model';
import { PRESETS } from './presets';
import {
    clampPngWidth,
    createPngSettingsStore,
    createSvgSettingsStore,
    PNG_DEFAULT_WIDTH,
    type PngSettings,
} from './settings';
import { ensureFontFaces, loadStyleFonts } from './fonts';
import { DEFAULT_STYLE_ID, STYLES } from './styles';
import { validateAllStyles } from './styles/validate';
import {
    applyChromeVars,
    getActiveStyle,
    getActiveStyleId,
    readStoredStyleId,
    setActiveStyle,
} from './styleState';
import { initTheme, isDarkMode, toggleTheme } from './theme';
import { flashButton, mustFind } from './ui';
import { readHash, writeStateToHash } from './urlState';

initTheme();
// Style before first render: chrome CSS vars must be right from the start. The URL (read in
// loadFromHash) still wins over localStorage, but never overwrites the viewer's own preference.
setActiveStyle(readStoredStyleId() ?? DEFAULT_STYLE_ID, false);
ensureFontFaces(getActiveStyle().typography.fonts);

const DEFAULT_MODEL = PRESETS[0];
const URL_SYNC_DELAY_MS = 250;
const INVALID_HASH_MESSAGE =
    'The model data in the URL is invalid or from an incompatible version. The default model was loaded instead.';

// --- DOM ---------------------------------------------------------------------

const canvas = mustFind<HTMLElement>('graph-container');
const toolbarEl = mustFind<HTMLElement>('editor-toolbar');
const warningBanner = mustFind<HTMLElement>('warning');
const copyButton = mustFind<HTMLButtonElement>('btn-copy-link');
const shareButton = mustFind<HTMLButtonElement>('btn-share');
const shareMenu = mustFind<HTMLElement>('share-menu');
const styleButton = mustFind<HTMLButtonElement>('btn-style');
const styleMenu = mustFind<HTMLElement>('style-menu');
const themeButton = mustFind<HTMLButtonElement>('btn-theme');

const pngDialog = collectDialogElements('png');
const svgDialog = collectDialogElements('svg');
const pngWidthInput = mustFind<HTMLInputElement>('png-width');
const pngSizeHint = mustFind<HTMLElement>('png-size-hint');

// --- Model + history ---------------------------------------------------------

let model: GraphModel;
let warningMessage = '';
const history = new History();

// --- Editor ------------------------------------------------------------------

const editor: GraphEditor = createEditor(toolbarEl, canvas, {
    getModel: () => model,
    replaceModel: (next) => {
        model = next;
        history.push(model);
        render();
    },
    onCommit: () => {
        history.push(model);
        render();
    },
    onLive: () => syncUrl(),
    undo: () => applyHistoryStep(-1),
    redo: () => applyHistoryStep(1),
    canUndo: () => history.canUndo(),
    canRedo: () => history.canRedo(),
});

function applyHistoryStep(offset: -1 | 1): void {
    const restored = history.step(offset);
    if (restored !== null) {
        model = restored;
        render();
    }
}

function showWarning(message: string): void {
    warningMessage = message;
    warningBanner.hidden = false;
    warningBanner.textContent = message;
}

// --- URL sync ----------------------------------------------------------------

let urlTimer: number | undefined;

function cancelUrlSync(): void {
    if (urlTimer !== undefined) {
        window.clearTimeout(urlTimer);
        urlTimer = undefined;
    }
}

/** Debounced hash update (used during live drags). */
function syncUrl(): void {
    cancelUrlSync();
    urlTimer = window.setTimeout(() => {
        urlTimer = undefined;
        void writeStateToHash(model, getActiveStyleId());
    }, URL_SYNC_DELAY_MS);
}

/** Immediate hash update; resolves once the URL carries the current model. */
async function syncUrlNow(): Promise<void> {
    cancelUrlSync();
    await writeStateToHash(model, getActiveStyleId());
}

function render(): void {
    warningBanner.hidden = warningMessage === '';
    warningBanner.textContent = warningMessage;
    updateThemeButton();
    renderStyleMenu();
    editor.render();
    syncUrl();
}

function updateThemeButton(): void {
    const dark = isDarkMode();
    themeButton.textContent = dark ? '☀️' : '🌙';
    themeButton.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
}

themeButton.addEventListener('click', () => {
    toggleTheme();
    // The active style carries its own dark chrome tokens — rewrite them for the new mode.
    applyChromeVars();
    updateThemeButton();
    editor.render();
});

// --- Keyboard ----------------------------------------------------------------

window.addEventListener('keydown', (event) => {
    if (pngDialog.dialog.open || svgDialog.dialog.open) return;
    const target = event.target as HTMLElement | null;
    const typing =
        target !== null &&
        (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.tagName === 'SELECT' ||
            target.isContentEditable);
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && key === 'z') {
        event.preventDefault();
        applyHistoryStep(event.shiftKey ? 1 : -1);
        return;
    }
    if ((event.ctrlKey || event.metaKey) && key === 'y') {
        event.preventDefault();
        applyHistoryStep(1);
        return;
    }
    if (typing) return;
    const arrowDelta: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, 1],
        ArrowDown: [0, -1],
    };
    const delta = arrowDelta[event.key];
    if (delta !== undefined) {
        const step = event.shiftKey ? 5 : 1;
        if (editor.nudge(delta[0] * step, delta[1] * step)) event.preventDefault();
        return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        editor.deleteSelected();
    } else if (event.key === 'Escape') {
        if (!styleMenu.hidden) {
            setStyleMenuOpen(false);
        } else if (!shareMenu.hidden) {
            setShareMenuOpen(false);
        } else {
            editor.clearSelection();
        }
    }
});

// --- Style selector ----------------------------------------------------------

function setStyleMenuOpen(open: boolean): void {
    styleMenu.hidden = !open;
    styleButton.setAttribute('aria-expanded', String(open));
}

/**
 * Rebuild the dropdown: one entry per registered style (first four curve-palette colors as
 * swatches + the name), marking the active one, and refresh the button caption. Called from
 * render() so the menu follows both style and theme changes.
 */
function renderStyleMenu(): void {
    styleMenu.textContent = '';
    const dark = isDarkMode();
    for (const style of STYLES) {
        const button = document.createElement('button');
        button.type = 'button';
        if (style.id === getActiveStyleId()) button.classList.add('active');
        const swatches = document.createElement('span');
        swatches.className = 'style-swatches';
        const palette = dark ? style.curves.palette.dark : style.curves.palette.light;
        for (const color of palette.slice(0, 4)) {
            const swatch = document.createElement('span');
            swatch.className = 'style-swatch';
            swatch.style.background = color;
            swatches.appendChild(swatch);
        }
        const name = document.createElement('span');
        name.textContent = style.name;
        button.append(swatches, name);
        button.addEventListener('click', () => {
            const applied = setActiveStyle(style.id);
            setStyleMenuOpen(false);
            render();
            // A second repaint once the new style's fonts resolve: textWidth() measures with
            // canvas metrics, so wrapping and chip sizing change with the real typeface.
            void loadStyleFonts(applied).then(() => render());
        });
        styleMenu.appendChild(button);
    }
    styleButton.textContent = `Style: ${getActiveStyle().name} ▾`;
}

styleButton.addEventListener('click', () => {
    // Open when hidden, close when visible (hidden === open-state inverted).
    setStyleMenuOpen(styleMenu.hidden === true);
});

// --- Share menu --------------------------------------------------------------

function setShareMenuOpen(open: boolean): void {
    shareMenu.hidden = !open;
    shareButton.setAttribute('aria-expanded', String(open));
}

shareButton.addEventListener('click', () => {
    // Open when hidden, close when visible (hidden === open-state inverted).
    setShareMenuOpen(shareMenu.hidden === true);
});

document.addEventListener('pointerdown', (event) => {
    const target = event.target;
    const inside = target instanceof Element && target.closest('.share-wrap') !== null;
    if (!shareMenu.hidden && !inside) setShareMenuOpen(false);
    const insideStyle = target instanceof Element && target.closest('.style-wrap') !== null;
    if (!styleMenu.hidden && !insideStyle) setStyleMenuOpen(false);
});

async function copyLink(): Promise<void> {
    await syncUrlNow();
    try {
        await navigator.clipboard.writeText(window.location.href);
        flashButton(copyButton, 'Copied!');
    } catch {
        flashButton(copyButton, 'Copy failed');
    }
}

copyButton.addEventListener('click', () => {
    void copyLink().then(() => setShareMenuOpen(false));
});

// --- Export dialogs ----------------------------------------------------------

const PNG_SETTINGS_KEY = 'shift-left-right-png-export';
const SVG_SETTINGS_KEY = 'shift-left-right-svg-export';

const pngStore = createPngSettingsStore(PNG_SETTINGS_KEY, () => ({
    filename: 'shift-left-right.png',
    width: PNG_DEFAULT_WIDTH,
    transparent: false,
    includeLegend: true,
    theme: isDarkMode() ? 'dark' : 'light',
}));

const svgStore = createSvgSettingsStore(SVG_SETTINGS_KEY, () => ({
    filename: 'shift-left-right.svg',
    transparent: false,
    includeLegend: true,
    theme: isDarkMode() ? 'dark' : 'light',
}));

// --- PNG ---------------------------------------------------------------------

function currentPngSheet(): { width: number; height: number } {
    return measurePngSheet(model, {
        dark: pngDialog.themeDarkRadio.checked,
        transparent: pngDialog.transparentInput.checked,
        includeLegend: pngDialog.legendInput.checked,
    });
}

function updatePngSizeHint(): void {
    const sheet = currentPngSheet();
    const width = clampPngWidth(Number(pngWidthInput.value));
    const height = Math.round((width * sheet.height) / sheet.width);
    pngSizeHint.textContent = `Exports at about ${width} × ${height} px`;
}

const pngPreview = createExportDialog<PngSettings>(pngDialog, {
    extension: 'png',
    fallbackFilename: 'shift-left-right.png',
    loadSettings: () => pngStore.read(),
    saveSettings: (settings) => pngStore.write(settings),
    readCommon: (current, common) => ({
        ...current,
        ...common,
        width: clampPngWidth(Number(pngWidthInput.value)),
    }),
    applyExtraSettings: (settings) => {
        pngWidthInput.value = String(settings.width);
    },
    onOptionsChanged: refreshPngPreview,
    onDownload: (settings) => {
        const scale = Math.min(10, Math.max(0.1, settings.width / currentPngSheet().width));
        exportPng(model, {
            filename: settings.filename,
            dark: settings.theme === 'dark',
            scale,
            transparent: settings.transparent,
            includeLegend: settings.includeLegend,
        }).catch((error: unknown) => {
            showWarning(`PNG export failed: ${String(error)}`);
        });
    },
});

/** Debounced rasterized preview; the refresher drops out-of-order and post-close results. */
const pngRefresher = createPreviewRefresher(
    pngPreview,
    () =>
        renderPngPreview(model, {
            dark: pngDialog.themeDarkRadio.checked,
            transparent: pngDialog.transparentInput.checked,
            includeLegend: pngDialog.legendInput.checked,
        }),
    () => {
        pngSizeHint.textContent = 'Preview unavailable — the download will still be attempted.';
    },
    150
);

function refreshPngPreview(): void {
    updatePngSizeHint();
    pngRefresher.refresh();
}

pngWidthInput.addEventListener('input', updatePngSizeHint);
mustFind<HTMLButtonElement>('btn-export-png').addEventListener('click', () => {
    setShareMenuOpen(false);
    pngPreview.show();
});

// --- SVG ---------------------------------------------------------------------

const svgPreview = createExportDialog(svgDialog, {
    extension: 'svg',
    fallbackFilename: 'shift-left-right.svg',
    loadSettings: () => svgStore.read(),
    saveSettings: (settings) => svgStore.write(settings),
    readCommon: (current, common) => ({ ...current, ...common }),
    onOptionsChanged: refreshSvgPreview,
    onDownload: (settings) => {
        exportSvg(model, {
            filename: settings.filename,
            dark: settings.theme === 'dark',
            transparent: settings.transparent,
            includeLegend: settings.includeLegend,
        }).catch((error: unknown) => {
            showWarning(`SVG export failed: ${String(error)}`);
        });
    },
});

const svgRefresher = createPreviewRefresher(
    svgPreview,
    async () => {
        const svgString = await buildSvgString(model, {
            dark: svgDialog.themeDarkRadio.checked,
            transparent: svgDialog.transparentInput.checked,
            includeLegend: svgDialog.legendInput.checked,
        });
        return new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    },
    () => svgPreview.hidePreview()
);

function refreshSvgPreview(): void {
    svgRefresher.refresh();
}

mustFind<HTMLButtonElement>('btn-export-svg').addEventListener('click', () => {
    setShareMenuOpen(false);
    svgPreview.show();
});

// --- Boot --------------------------------------------------------------------

async function loadFromHash(): Promise<void> {
    const hash = await readHash();
    if (hash.styleId !== null) {
        // A shared link's style wins for this page load, but persist=false keeps it from
        // overwriting the viewer's own stored preference.
        setActiveStyle(hash.styleId, false);
    }
    if (hash.model !== null) {
        model = hash.model;
        warningMessage = '';
    } else {
        model = cloneModel(DEFAULT_MODEL.data);
        warningMessage = hash.present ? INVALID_HASH_MESSAGE : '';
    }
    // Gate the first paint on the style's fonts — layout math measures text.
    await loadStyleFonts(getActiveStyle());
    history.reset(model);
    render();
}

window.addEventListener('hashchange', () => void loadFromHash());

void loadFromHash();

// Dev hook: `?validate-styles` logs every style's WCAG contrast issues.
if (window.location.search.includes('validate-styles')) {
    const issues = validateAllStyles();
    if (issues.length === 0) {
        console.log('[styles] all checks passed');
    } else {
        console.log('[styles] contrast issues:', issues);
    }
}
