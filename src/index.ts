/*
Dear reader,

This code was written with AI. It was optimized for implementation speed.
Be careful to keep your sanity while reading this code.

You have been warned.

Lakitna
*/

import { createEditor, type GraphEditor } from './editor';
import { buildSvgString, exportPng, exportSvg, measurePngSheet, renderPngPreview } from './export';
import { collectDialogElements, createExportDialog, createPreviewRefresher } from './export-dialog';
import { ensureFontFaces, loadStyleFonts } from './fonts';
import { History } from './history';
import { cloneModel } from './model';
import { PRESETS } from './presets';
import {
    clampPngWidth,
    createPngSettingsStore,
    createSvgSettingsStore,
    PNG_DEFAULT_WIDTH,
    type ExportSettingsBase,
    type PngSettings,
} from './settings';
import {
    applyChromeVariables,
    getActiveStyle,
    getActiveStyleId,
    readStoredStyleId,
    setActiveStyle,
} from './style-state';
import { DEFAULT_STYLE_ID, STYLES, type GraphStyle } from './styles';
import { validateAllStyles } from './styles/validate';
import { initTheme, isDarkMode, toggleTheme } from './theme';
import { flashButton, mustFind } from './ui';
import { readHash, writeStateToHash } from './url-state';

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

const canvas = mustFind('graph-container', HTMLElement);
const toolbarElement = mustFind('editor-toolbar', HTMLDivElement);
const warningBanner = mustFind('warning', HTMLDivElement);
const copyButton = mustFind('btn-copy-link', HTMLButtonElement);
const shareButton = mustFind('btn-share', HTMLButtonElement);
const shareMenu = mustFind('share-menu', HTMLDivElement);
const styleButton = mustFind('btn-style', HTMLButtonElement);
const styleMenu = mustFind('style-menu', HTMLDivElement);
const themeButton = mustFind('btn-theme', HTMLButtonElement);

const pngDialog = collectDialogElements('png');
const svgDialog = collectDialogElements('svg');
const pngWidthInput = mustFind('png-width', HTMLInputElement);
const pngSizeHint = mustFind('png-size-hint', HTMLParagraphElement);

// --- Model + history ---------------------------------------------------------

/**
 * Mutable app state, held in one object so that no function assigns a module-level `let`
 * (`unicorn/no-top-level-assignment-in-function`). `loadFromHash()` replaces the model with the
 * URL's own (or leaves the default) before the first render.
 */
const appState = {
    model: cloneModel(DEFAULT_MODEL.data),
    warningMessage: '',
};
const history = new History();

// --- Editor ------------------------------------------------------------------

const editor: GraphEditor = createEditor(toolbarElement, canvas, {
    getModel: () => appState.model,
    replaceModel: (next) => {
        appState.model = next;
        history.push(appState.model);
        render();
    },
    onCommit: () => {
        history.push(appState.model);
        render();
    },
    onLive: () => {
        syncUrl();
    },
    undo: () => {
        applyHistoryStep(-1);
    },
    redo: () => {
        applyHistoryStep(1);
    },
    canUndo: () => history.canUndo(),
    canRedo: () => history.canRedo(),
});

function applyHistoryStep(offset: -1 | 1): void {
    const restored = history.step(offset);
    if (restored === undefined) {
        return;
    }

    appState.model = restored;
    render();
}

function showWarning(message: string): void {
    appState.warningMessage = message;
    warningBanner.hidden = false;
    warningBanner.textContent = message;
}

// --- URL sync ----------------------------------------------------------------

/**
 * The debounced hash update's timer, held inside a closure so that no function assigns a
 * module-level `let` (`unicorn/no-top-level-assignment-in-function`).
 */
const urlSync = (() => {
    let timer: number | undefined;
    const cancel = (): void => {
        if (timer === undefined) {
            return;
        }

        globalThis.clearTimeout(timer);
        timer = undefined;
    };
    const schedule = (run: () => void): void => {
        cancel();
        timer = globalThis.setTimeout(() => {
            timer = undefined;
            run();
        }, URL_SYNC_DELAY_MS);
    };
    return { cancel, schedule };
})();

/**
Debounced hash update (used during live drags).
*/
function syncUrl(): void {
    urlSync.schedule(() => {
        void writeStateToHash(appState.model, getActiveStyleId());
    });
}

/**
Immediate hash update; resolves once the URL carries the current model.
*/
async function syncUrlNow(): Promise<void> {
    urlSync.cancel();
    await writeStateToHash(appState.model, getActiveStyleId());
}

function render(): void {
    warningBanner.hidden = appState.warningMessage === '';
    warningBanner.textContent = appState.warningMessage;
    updateThemeButton();
    renderStyleMenu();
    editor.render();
    syncUrl();
}

function updateThemeButton(): void {
    const isDark = isDarkMode();
    themeButton.textContent = isDark ? '☀️' : '🌙';
    themeButton.title = isDark ? 'Switch to light mode' : 'Switch to dark mode';
}

themeButton.addEventListener('click', () => {
    toggleTheme();
    // The active style carries its own dark chrome tokens — rewrite them for the new mode.
    applyChromeVariables();
    updateThemeButton();
    editor.render();
});

// --- Keyboard ----------------------------------------------------------------

globalThis.addEventListener('keydown', (event) => {
    if (pngDialog.dialog.open || svgDialog.dialog.open) return;
    const target = event.target as HTMLElement | null;
    const isTyping =
        target !== null &&
        (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.tagName === 'SELECT' ||
            target.isContentEditable);
    const key = event.key.toLowerCase();
    if (key === 'z' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        applyHistoryStep(event.shiftKey ? 1 : -1);
        return;
    }
    if (key === 'y' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        applyHistoryStep(1);
        return;
    }
    if (isTyping) return;
    // Keys that are not listed have no nudge, hence the explicit undefined in the value type.
    const arrowDelta: Record<string, [number, number] | undefined> = {
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
        } else if (shareMenu.hidden) {
            editor.clearSelection();
        } else {
            setShareMenuOpen(false);
        }
    }
});

// --- Style selector ----------------------------------------------------------

function setStyleMenuOpen(isOpen: boolean): void {
    styleMenu.hidden = !isOpen;
    styleButton.setAttribute('aria-expanded', String(isOpen));
}

/**
 * A second repaint once a newly applied style's fonts resolve: `textWidth()` measures with canvas
 * metrics, so wrapping and chip sizing change with the real typeface.
 */
async function repaintWithFonts(style: GraphStyle): Promise<void> {
    await loadStyleFonts(style);
    render();
}

/**
 * Rebuild the dropdown: one entry per registered style (first four curve-palette colors as
 * swatches + the name), marking the active one, and refresh the button caption. Called from
 * render() so the menu follows both style and theme changes.
 */
function renderStyleMenu(): void {
    styleMenu.textContent = '';
    const isDark = isDarkMode();
    for (const style of STYLES) {
        const button = document.createElement('button');
        button.type = 'button';
        if (style.id === getActiveStyleId()) button.classList.add('active');
        const swatches = document.createElement('span');
        swatches.className = 'style-swatches';
        const palette = isDark ? style.curves.palette.dark : style.curves.palette.light;
        for (const color of palette.slice(0, 4)) {
            const swatch = document.createElement('span');
            swatch.className = 'style-swatch';
            swatch.style.background = color;
            swatches.append(swatch);
        }
        const name = document.createElement('span');
        name.textContent = style.name;
        button.append(swatches, name);
        button.addEventListener('click', () => {
            const applied = setActiveStyle(style.id);
            setStyleMenuOpen(false);
            render();
            void repaintWithFonts(applied);
        });
        styleMenu.append(button);
    }
    styleButton.textContent = `Style: ${getActiveStyle().name} ▾`;
}

styleButton.addEventListener('click', () => {
    // Open when hidden, close when visible (hidden === open-state inverted).
    setStyleMenuOpen(styleMenu.hidden);
});

// --- Share menu --------------------------------------------------------------

function setShareMenuOpen(isOpen: boolean): void {
    shareMenu.hidden = !isOpen;
    shareButton.setAttribute('aria-expanded', String(isOpen));
}

shareButton.addEventListener('click', () => {
    // Open when hidden, close when visible (hidden === open-state inverted).
    setShareMenuOpen(shareMenu.hidden);
});

document.addEventListener('pointerdown', (event) => {
    const target = event.target;
    const isInside = target instanceof Element && target.closest('.share-wrap') !== null;
    if (!isInside && !shareMenu.hidden) setShareMenuOpen(false);
    const isInsideStyle = target instanceof Element && target.closest('.style-wrap') !== null;
    if (!isInsideStyle && !styleMenu.hidden) setStyleMenuOpen(false);
});

async function copyLink(): Promise<void> {
    await syncUrlNow();
    try {
        await navigator.clipboard.writeText(globalThis.location.href);
        flashButton(copyButton, 'Copied!');
    } catch {
        flashButton(copyButton, 'Copy failed');
    }
    setShareMenuOpen(false);
}

copyButton.addEventListener('click', () => {
    void copyLink();
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
    return measurePngSheet(appState.model, {
        dark: pngDialog.themeDarkRadio.checked,
        transparent: pngDialog.transparentInput.checked,
        includeLegend: pngDialog.legendInput.checked,
    });
}

function updatePngSizeHint(): void {
    const sheet = currentPngSheet();
    const width = clampPngWidth(Number(pngWidthInput.value));
    const height = Math.round((width * sheet.height) / sheet.width);
    pngSizeHint.textContent = `Exports at about ${String(width)} × ${String(height)} px`;
}

/**
Run the PNG export, turning a failure into the warning banner instead of a rejected promise.
*/
async function runPngExport(settings: PngSettings): Promise<void> {
    const scale = Math.min(10, Math.max(0.1, settings.width / currentPngSheet().width));
    try {
        await exportPng(appState.model, {
            filename: settings.filename,
            dark: settings.theme === 'dark',
            scale,
            transparent: settings.transparent,
            includeLegend: settings.includeLegend,
        });
    } catch (error) {
        showWarning(`PNG export failed: ${String(error)}`);
    }
}

const pngPreview = createExportDialog<PngSettings>(pngDialog, {
    extension: 'png',
    fallbackFilename: 'shift-left-right.png',
    loadSettings: () => pngStore.read(),
    saveSettings: (settings) => {
        pngStore.write(settings);
    },
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
        void runPngExport(settings);
    },
});

/**
Debounced rasterized preview; the refresher drops out-of-order and post-close results.
*/
const pngRefresher = createPreviewRefresher(
    pngPreview,
    () =>
        renderPngPreview(appState.model, {
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
mustFind('btn-export-png', HTMLButtonElement).addEventListener('click', () => {
    setShareMenuOpen(false);
    pngPreview.show();
});

// --- SVG ---------------------------------------------------------------------

const svgPreview = createExportDialog(svgDialog, {
    extension: 'svg',
    fallbackFilename: 'shift-left-right.svg',
    loadSettings: () => svgStore.read(),
    saveSettings: (settings) => {
        svgStore.write(settings);
    },
    readCommon: (current, common) => ({ ...current, ...common }),
    onOptionsChanged: refreshSvgPreview,
    onDownload: (settings) => {
        void runSvgExport(settings);
    },
});

/**
Run the SVG export, turning a failure into the warning banner instead of a rejected promise.
*/
async function runSvgExport(settings: ExportSettingsBase): Promise<void> {
    try {
        await exportSvg(appState.model, {
            filename: settings.filename,
            dark: settings.theme === 'dark',
            transparent: settings.transparent,
            includeLegend: settings.includeLegend,
        });
    } catch (error) {
        showWarning(`SVG export failed: ${String(error)}`);
    }
}

const svgRefresher = createPreviewRefresher(
    svgPreview,
    async () => {
        const svgString = await buildSvgString(appState.model, {
            dark: svgDialog.themeDarkRadio.checked,
            transparent: svgDialog.transparentInput.checked,
            includeLegend: svgDialog.legendInput.checked,
        });
        return new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    },
    () => {
        svgPreview.hidePreview();
    }
);

function refreshSvgPreview(): void {
    svgRefresher.refresh();
}

mustFind('btn-export-svg', HTMLButtonElement).addEventListener('click', () => {
    setShareMenuOpen(false);
    svgPreview.show();
});

// --- Boot --------------------------------------------------------------------

async function loadFromHash(): Promise<void> {
    const hash = await readHash();
    if (hash.styleId !== undefined) {
        // A shared link's style wins for this page load, but persist=false keeps it from
        // overwriting the viewer's own stored preference.
        setActiveStyle(hash.styleId, false);
    }
    if (hash.model === undefined) {
        appState.model = cloneModel(DEFAULT_MODEL.data);
        appState.warningMessage = hash.present ? INVALID_HASH_MESSAGE : '';
    } else {
        appState.model = hash.model;
        appState.warningMessage = '';
    }
    // Gate the first paint on the style's fonts — layout math measures text.
    await loadStyleFonts(getActiveStyle());
    history.reset(appState.model);
    render();
}

globalThis.addEventListener('hashchange', () => void loadFromHash());

void loadFromHash();

// Dev hook: `?validate-styles` logs every style's WCAG contrast issues.
if (globalThis.location.search.includes('validate-styles')) {
    const issues = validateAllStyles();
    if (issues.length === 0) {
        console.log('[styles] all checks passed');
    } else {
        console.log('[styles] contrast issues:', issues);
    }
}
