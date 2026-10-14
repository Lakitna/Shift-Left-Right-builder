/*
Dear reader,

This code was written with AI. It was optimized for implementation speed.
Be careful to keep your sanity while reading this code.

You have been warned.

Lakitna
*/

import { createEditor, type GraphEditor } from './editor';
import { buildSvgString, exportPng, exportSvg, measurePngSheet, renderPngPreview } from './export';
import { cloneModel, parseModel, PRESETS, type GraphModel } from './model';
import { initTheme, isDarkMode, toggleTheme } from './theme';
import { readHash, writeStateToHash } from './urlState';

initTheme();

const DEFAULT_MODEL = PRESETS[0];
const URL_SYNC_DELAY_MS = 250;
const HISTORY_LIMIT = 100;
const INVALID_HASH_MESSAGE =
    'The model data in the URL is invalid or from an incompatible version. The default model was loaded instead.';

function mustFind<T extends HTMLElement>(id: string): T {
    const element = document.getElementById(id);
    if (element === null) {
        throw new Error(`Required element #${id} is missing from the page`);
    }
    return element as T;
}

const canvas = mustFind<HTMLElement>('graph-container');
const toolbarEl = mustFind<HTMLElement>('editor-toolbar');
const warningBanner = mustFind<HTMLElement>('warning');
const copyButton = mustFind<HTMLButtonElement>('btn-copy-link');
const exportSvgButton = mustFind<HTMLButtonElement>('btn-export-svg');
const exportPngButton = mustFind<HTMLButtonElement>('btn-export-png');
const shareButton = mustFind<HTMLButtonElement>('btn-share');
const shareMenu = mustFind<HTMLElement>('share-menu');
const themeButton = mustFind<HTMLButtonElement>('btn-theme');
const pngDialog = mustFind<HTMLDialogElement>('png-dialog');
const pngFilenameInput = mustFind<HTMLInputElement>('png-filename');
const pngThemeLightRadio = mustFind<HTMLInputElement>('png-theme-light');
const pngThemeDarkRadio = mustFind<HTMLInputElement>('png-theme-dark');
const pngTransparentInput = mustFind<HTMLInputElement>('png-transparent');
const pngWidthInput = mustFind<HTMLInputElement>('png-width');
const pngSizeHint = mustFind<HTMLElement>('png-size-hint');
const pngPreviewImg = mustFind<HTMLImageElement>('png-preview-img');
const pngCancelButton = mustFind<HTMLButtonElement>('png-cancel');
const pngDownloadButton = mustFind<HTMLButtonElement>('png-download');
const svgDialog = mustFind<HTMLDialogElement>('svg-dialog');
const svgFilenameInput = mustFind<HTMLInputElement>('svg-filename');
const svgThemeLightRadio = mustFind<HTMLInputElement>('svg-theme-light');
const svgThemeDarkRadio = mustFind<HTMLInputElement>('svg-theme-dark');
const svgTransparentInput = mustFind<HTMLInputElement>('svg-transparent');
const svgPreviewImg = mustFind<HTMLImageElement>('svg-preview-img');
const svgCancelButton = mustFind<HTMLButtonElement>('svg-cancel');
const svgDownloadButton = mustFind<HTMLButtonElement>('svg-download');

let model: GraphModel;
let warningMessage = '';
let urlTimer: number | undefined;

// --- Undo/redo history -------------------------------------------------------

const history: string[] = [];
let historyIndex = -1;

function pushHistory(): void {
    const snapshot = JSON.stringify(model);
    if (history[historyIndex] === snapshot) return;
    history.splice(historyIndex + 1);
    history.push(snapshot);
    if (history.length > HISTORY_LIMIT) history.shift();
    historyIndex = history.length - 1;
}

function restoreHistory(index: number): void {
    const parsed = parseModel(JSON.parse(history[index]));
    if (parsed === null) return;
    historyIndex = index;
    model = parsed;
    render();
}

function undo(): void {
    if (historyIndex > 0) restoreHistory(historyIndex - 1);
}

function redo(): void {
    if (historyIndex < history.length - 1) restoreHistory(historyIndex + 1);
}

// --- Editor ------------------------------------------------------------------

const editor: GraphEditor = createEditor(toolbarEl, canvas, {
    getModel: () => model,
    replaceModel: (next) => {
        model = next;
        pushHistory();
        render();
    },
    onCommit: () => {
        pushHistory();
        render();
    },
    onLive: () => syncUrl(),
    undo,
    redo,
    canUndo: () => historyIndex > 0,
    canRedo: () => historyIndex < history.length - 1,
});

function showWarning(message: string): void {
    warningMessage = message;
    warningBanner.hidden = false;
    warningBanner.textContent = message;
}

function syncUrl(): void {
    if (urlTimer !== undefined) {
        window.clearTimeout(urlTimer);
        urlTimer = undefined;
    }
    urlTimer = window.setTimeout(() => {
        urlTimer = undefined;
        writeStateToHash(model);
    }, URL_SYNC_DELAY_MS);
}

function syncUrlNow(): void {
    if (urlTimer !== undefined) {
        window.clearTimeout(urlTimer);
        urlTimer = undefined;
    }
    writeStateToHash(model);
}

function render(): void {
    warningBanner.hidden = warningMessage === '';
    warningBanner.textContent = warningMessage;
    updateThemeButton();
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
    updateThemeButton();
    editor.render();
});

// --- Keyboard ----------------------------------------------------------------

window.addEventListener('keydown', (event) => {
    if (pngDialog.open || svgDialog.open) return;
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
        if (event.shiftKey) redo();
        else undo();
        return;
    }
    if ((event.ctrlKey || event.metaKey) && key === 'y') {
        event.preventDefault();
        redo();
        return;
    }
    if (typing) return;
    if (
        event.key === 'ArrowLeft' ||
        event.key === 'ArrowRight' ||
        event.key === 'ArrowUp' ||
        event.key === 'ArrowDown'
    ) {
        const step = event.shiftKey ? 5 : 1;
        let dx = 0;
        let dy = 0;
        if (event.key === 'ArrowLeft') dx = -step;
        else if (event.key === 'ArrowRight') dx = step;
        else if (event.key === 'ArrowUp') dy = step;
        else dy = -step;
        if (editor.nudge(dx, dy)) event.preventDefault();
        return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        editor.deleteSelected();
    } else if (event.key === 'Escape') {
        editor.clearSelection();
    }
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
});

function flashButton(button: HTMLButtonElement, message: string): void {
    const original = button.textContent;
    button.textContent = message;
    button.disabled = true;
    window.setTimeout(() => {
        button.textContent = original;
        button.disabled = false;
    }, 1200);
}

async function copyLink(): Promise<void> {
    syncUrlNow();
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

function normalizeFilename(raw: string, fallback: string, extension: string): string {
    const cleaned = raw.trim().replace(/[\\/:*?"<>|]/g, '');
    if (cleaned === '') return fallback;
    const suffix = `.${extension}`;
    return cleaned.toLowerCase().endsWith(suffix) ? cleaned : cleaned + suffix;
}

function closeOnBackdrop(dialog: HTMLDialogElement): void {
    dialog.addEventListener('click', (event) => {
        if (event.target === dialog) dialog.close();
    });
}

const PNG_SETTINGS_KEY = 'shift-left-right-png-export';
const PNG_MIN_WIDTH = 120;
const PNG_MAX_WIDTH = 8000;
const PNG_DEFAULT_WIDTH = 1500;

interface PngSettings {
    filename: string;
    width: number;
    transparent: boolean;
    theme: 'light' | 'dark';
}

function clampPngWidth(value: number): number {
    if (!Number.isFinite(value)) return PNG_DEFAULT_WIDTH;
    return Math.min(PNG_MAX_WIDTH, Math.max(PNG_MIN_WIDTH, Math.round(value)));
}

function defaultPngSettings(): PngSettings {
    return {
        filename: 'shift-left-right.png',
        width: PNG_DEFAULT_WIDTH,
        transparent: false,
        theme: isDarkMode() ? 'dark' : 'light',
    };
}

function readPngSettings(): PngSettings {
    const fallback = defaultPngSettings();
    try {
        const raw = window.localStorage.getItem(PNG_SETTINGS_KEY);
        if (raw === null) return fallback;
        const stored = JSON.parse(raw) as Partial<PngSettings>;
        return {
            filename:
                typeof stored.filename === 'string' && stored.filename.trim() !== ''
                    ? stored.filename
                    : fallback.filename,
            width:
                typeof stored.width === 'number' &&
                stored.width >= PNG_MIN_WIDTH &&
                stored.width <= PNG_MAX_WIDTH
                    ? clampPngWidth(stored.width)
                    : fallback.width,
            transparent: stored.transparent === true,
            theme:
                stored.theme === 'dark' || stored.theme === 'light' ? stored.theme : fallback.theme,
        };
    } catch {
        return fallback;
    }
}

function writePngSettings(settings: PngSettings): void {
    try {
        window.localStorage.setItem(PNG_SETTINGS_KEY, JSON.stringify(settings));
    } catch {
        // Private mode or quota — the dialog still works, just forgetful.
    }
}

let pngSettings = readPngSettings();

function currentPngSheet(): { width: number; height: number } {
    return measurePngSheet(model, {
        dark: pngThemeDarkRadio.checked,
        transparent: pngTransparentInput.checked,
    });
}

function pngExportScale(width: number): number {
    return Math.min(10, Math.max(0.1, width / currentPngSheet().width));
}

function updatePngSizeHint(): void {
    const sheet = currentPngSheet();
    const width = clampPngWidth(Number(pngWidthInput.value));
    const height = Math.round((width * sheet.height) / sheet.width);
    pngSizeHint.textContent = `Exports at about ${width} × ${height} px`;
}

let previewTimer: number | undefined;
let previewToken = 0;

function schedulePngPreview(): void {
    window.clearTimeout(previewTimer);
    previewTimer = window.setTimeout(() => void updatePngPreview(), 150);
}

async function updatePngPreview(): Promise<void> {
    const token = ++previewToken;
    const dark = pngThemeDarkRadio.checked;
    const transparent = pngTransparentInput.checked;
    try {
        const blob = await renderPngPreview(model, { dark, transparent });
        if (token !== previewToken || !pngDialog.open) return;
        const url = URL.createObjectURL(blob);
        if (pngPreviewImg.dataset.url !== undefined) URL.revokeObjectURL(pngPreviewImg.dataset.url);
        pngPreviewImg.dataset.url = url;
        pngPreviewImg.src = url;
        pngPreviewImg.hidden = false;
    } catch {
        if (token === previewToken) {
            pngSizeHint.textContent = 'Preview unavailable — the download will still be attempted.';
        }
    }
}

function applyPngSettingsToUi(): void {
    pngFilenameInput.value = pngSettings.filename;
    pngWidthInput.value = String(pngSettings.width);
    pngTransparentInput.checked = pngSettings.transparent;
    (pngSettings.theme === 'dark' ? pngThemeDarkRadio : pngThemeLightRadio).checked = true;
}

function openPngDialog(): void {
    applyPngSettingsToUi();
    pngDialog.showModal();
    pngFilenameInput.focus();
    pngFilenameInput.select();
    updatePngSizeHint();
    schedulePngPreview();
}

exportPngButton.addEventListener('click', () => {
    setShareMenuOpen(false);
    openPngDialog();
});

pngCancelButton.addEventListener('click', () => pngDialog.close());
closeOnBackdrop(pngDialog);
for (const control of [pngTransparentInput, pngThemeLightRadio, pngThemeDarkRadio]) {
    control.addEventListener('change', () => schedulePngPreview());
}
pngWidthInput.addEventListener('input', updatePngSizeHint);
pngDownloadButton.addEventListener('click', () => {
    const settings: PngSettings = {
        filename: normalizeFilename(pngFilenameInput.value, 'shift-left-right.png', 'png'),
        width: clampPngWidth(Number(pngWidthInput.value)),
        transparent: pngTransparentInput.checked,
        theme: pngThemeDarkRadio.checked ? 'dark' : 'light',
    };
    pngSettings = settings;
    writePngSettings(settings);
    const scale = pngExportScale(settings.width);
    pngDialog.close();
    exportPng(model, {
        filename: settings.filename,
        dark: settings.theme === 'dark',
        scale,
        transparent: settings.transparent,
    }).catch((error: unknown) => {
        showWarning(`PNG export failed: ${String(error)}`);
    });
});

const SVG_SETTINGS_KEY = 'shift-left-right-svg-export';

interface SvgSettings {
    filename: string;
    transparent: boolean;
    theme: 'light' | 'dark';
}

function defaultSvgSettings(): SvgSettings {
    return {
        filename: 'shift-left-right.svg',
        transparent: false,
        theme: isDarkMode() ? 'dark' : 'light',
    };
}

function readSvgSettings(): SvgSettings {
    const fallback = defaultSvgSettings();
    try {
        const raw = window.localStorage.getItem(SVG_SETTINGS_KEY);
        if (raw === null) return fallback;
        const stored = JSON.parse(raw) as Partial<SvgSettings>;
        return {
            filename:
                typeof stored.filename === 'string' && stored.filename.trim() !== ''
                    ? stored.filename
                    : fallback.filename,
            transparent: stored.transparent === true,
            theme:
                stored.theme === 'dark' || stored.theme === 'light' ? stored.theme : fallback.theme,
        };
    } catch {
        return fallback;
    }
}

function writeSvgSettings(settings: SvgSettings): void {
    try {
        window.localStorage.setItem(SVG_SETTINGS_KEY, JSON.stringify(settings));
    } catch {
        // Private mode or quota — the dialog still works, just forgetful.
    }
}

let svgSettings = readSvgSettings();
let svgPreviewToken = 0;

async function updateSvgPreview(): Promise<void> {
    const token = ++svgPreviewToken;
    try {
        const svgString = buildSvgString(model, {
            dark: svgThemeDarkRadio.checked,
            transparent: svgTransparentInput.checked,
        });
        if (token !== svgPreviewToken || !svgDialog.open) return;
        const url = URL.createObjectURL(
            new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
        );
        if (svgPreviewImg.dataset.url !== undefined) URL.revokeObjectURL(svgPreviewImg.dataset.url);
        svgPreviewImg.dataset.url = url;
        svgPreviewImg.src = url;
        svgPreviewImg.hidden = false;
    } catch {
        if (token === svgPreviewToken) svgPreviewImg.hidden = true;
    }
}

function openSvgDialog(): void {
    svgFilenameInput.value = svgSettings.filename;
    svgTransparentInput.checked = svgSettings.transparent;
    (svgSettings.theme === 'dark' ? svgThemeDarkRadio : svgThemeLightRadio).checked = true;
    svgDialog.showModal();
    svgFilenameInput.focus();
    svgFilenameInput.select();
    void updateSvgPreview();
}

exportSvgButton.addEventListener('click', () => {
    setShareMenuOpen(false);
    openSvgDialog();
});

svgCancelButton.addEventListener('click', () => svgDialog.close());
closeOnBackdrop(svgDialog);
for (const control of [svgTransparentInput, svgThemeLightRadio, svgThemeDarkRadio]) {
    control.addEventListener('change', () => void updateSvgPreview());
}
svgDownloadButton.addEventListener('click', () => {
    const settings: SvgSettings = {
        filename: normalizeFilename(svgFilenameInput.value, 'shift-left-right.svg', 'svg'),
        transparent: svgTransparentInput.checked,
        theme: svgThemeDarkRadio.checked ? 'dark' : 'light',
    };
    svgSettings = settings;
    writeSvgSettings(settings);
    svgDialog.close();
    try {
        exportSvg(model, {
            filename: settings.filename,
            dark: settings.theme === 'dark',
            transparent: settings.transparent,
        });
    } catch (error: unknown) {
        showWarning(`SVG export failed: ${String(error)}`);
    }
});

// --- Boot --------------------------------------------------------------------

function loadFromHash(): void {
    const hash = readHash();
    if (hash.model !== null) {
        model = hash.model;
        warningMessage = '';
    } else if (hash.present) {
        model = cloneModel(DEFAULT_MODEL.data);
        warningMessage = INVALID_HASH_MESSAGE;
    } else {
        model = cloneModel(DEFAULT_MODEL.data);
        warningMessage = '';
    }
    history.length = 0;
    historyIndex = -1;
    pushHistory();
    render();
}

window.addEventListener('hashchange', () => loadFromHash());

loadFromHash();
