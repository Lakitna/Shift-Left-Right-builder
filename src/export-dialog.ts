/**
 * Shared behavior for the two export dialogs (PNG and SVG). Both have the same controls —
 * color-mode radios, transparent-background and include-legend checkboxes, file-name input,
 * live preview, cancel / download buttons — plus a PNG-only width field merged in via
 * `readCommon`. This wires the
 * common DOM plumbing once; the caller supplies the settings store and the actual export.
 *
 * `collectDialogElements` looks a dialog's controls up by id prefix, and `createPreviewRefresher`
 * owns the debounced-preview-with-race-guard pattern both formats share, so a third export format
 * would reuse all of it unchanged.
 */

import { closeOnBackdrop, mustFind, normalizeFilename } from './ui';

export interface DialogElements {
    dialog: HTMLDialogElement;
    filenameInput: HTMLInputElement;
    themeLightRadio: HTMLInputElement;
    themeDarkRadio: HTMLInputElement;
    transparentInput: HTMLInputElement;
    legendInput: HTMLInputElement;
    previewImg: HTMLImageElement;
    cancelButton: HTMLButtonElement;
    downloadButton: HTMLButtonElement;
}

/**
 * Look up one export dialog's controls by id prefix (`png-…`, `svg-…`). The markup contract is
 * encoded once here instead of duplicated per format in the page wiring.
 */
export function collectDialogElements(prefix: string): DialogElements {
    return {
        dialog: mustFind(`${prefix}-dialog`, HTMLDialogElement),
        filenameInput: mustFind(`${prefix}-filename`, HTMLInputElement),
        themeLightRadio: mustFind(`${prefix}-theme-light`, HTMLInputElement),
        themeDarkRadio: mustFind(`${prefix}-theme-dark`, HTMLInputElement),
        transparentInput: mustFind(`${prefix}-transparent`, HTMLInputElement),
        legendInput: mustFind(`${prefix}-legend`, HTMLInputElement),
        previewImg: mustFind(`${prefix}-preview-img`, HTMLImageElement),
        cancelButton: mustFind(`${prefix}-cancel`, HTMLButtonElement),
        downloadButton: mustFind(`${prefix}-download`, HTMLButtonElement),
    };
}

/**
The controls every export dialog has, after normalization/validation.
*/
export interface CommonExportValues {
    filename: string;
    transparent: boolean;
    includeLegend: boolean;
    theme: 'light' | 'dark';
}

export interface ExportDialogOptions<T extends CommonExportValues> {
    extension: 'png' | 'svg';
    fallbackFilename: string;
    /**
    Read the persisted settings shown when the dialog opens.
    */
    loadSettings(): T;
    /**
    Persist what the user chose on download.
    */
    saveSettings(settings: T): void;
    /**
    Merge the common control values into the last-known settings (adds format-specific fields).
    */
    readCommon(current: T, common: CommonExportValues): T;
    /**
    Called whenever a visual option changes (preview should refresh).
    */
    onOptionsChanged(): void;
    /**
    Called with the saved settings when Download is pressed.
    */
    onDownload(settings: T): void;
    /**
    Optional hook to populate format-specific controls (e.g. the PNG width field).
    */
    applyExtraSettings?(settings: T): void;
}

export function createExportDialog<T extends CommonExportValues>(
    element: DialogElements,
    options: ExportDialogOptions<T>
): {
    show(): void;
    isOpen(): boolean;
    setPreviewUrl(url: string): void;
    hidePreview(): void;
} {
    let current = options.loadSettings();

    element.cancelButton.addEventListener('click', () => {
        element.dialog.close();
    });
    closeOnBackdrop(element.dialog);
    for (const control of [
        element.transparentInput,
        element.legendInput,
        element.themeLightRadio,
        element.themeDarkRadio,
    ]) {
        control.addEventListener('change', () => {
            options.onOptionsChanged();
        });
    }
    element.downloadButton.addEventListener('click', () => {
        current = options.readCommon(current, {
            filename: normalizeFilename(
                element.filenameInput.value,
                options.fallbackFilename,
                options.extension
            ),
            transparent: element.transparentInput.checked,
            includeLegend: element.legendInput.checked,
            theme: element.themeDarkRadio.checked ? 'dark' : 'light',
        });
        options.saveSettings(current);
        element.dialog.close();
        options.onDownload(current);
    });

    return {
        show() {
            const settings = options.loadSettings();
            element.filenameInput.value = settings.filename;
            element.transparentInput.checked = settings.transparent;
            element.legendInput.checked = settings.includeLegend;
            (settings.theme === 'dark' ? element.themeDarkRadio : element.themeLightRadio).checked =
                true;
            if (options.applyExtraSettings) options.applyExtraSettings(settings);
            element.dialog.showModal();
            element.filenameInput.focus();
            element.filenameInput.select();
            options.onOptionsChanged();
        },
        isOpen: () => element.dialog.open,
        setPreviewUrl(url: string) {
            if (element.previewImg.dataset.url !== undefined) {
                URL.revokeObjectURL(element.previewImg.dataset.url);
            }
            element.previewImg.dataset.url = url;
            element.previewImg.src = url;
            element.previewImg.hidden = false;
        },
        hidePreview() {
            element.previewImg.hidden = true;
        },
    };
}

/**
The preview half of an export dialog, as needed by the refresher.
*/
export interface PreviewTarget {
    isOpen(): boolean;
    setPreviewUrl(url: string): void;
}

/**
 * Debounced preview refresher with a race guard: only the newest build may update the dialog,
 * and results are dropped once it has closed. `build` produces the preview blob; `onError` lets
 * the caller surface a fallback hint. Both export dialogs use this — the token bookkeeping
 * existed twice before.
 */
export function createPreviewRefresher(
    dialog: PreviewTarget,
    build: () => Promise<Blob>,
    onError?: () => void,
    delayMs = 0
): { refresh(): void } {
    let timer: number | undefined;
    let token = 0;

    async function run(): Promise<void> {
        const my = ++token;
        try {
            const blob = await build();
            if (my !== token || !dialog.isOpen()) return;
            dialog.setPreviewUrl(URL.createObjectURL(blob));
        } catch {
            if (my === token) onError?.();
        }
    }

    return {
        refresh(): void {
            if (delayMs === 0) {
                void run();
                return;
            }
            globalThis.clearTimeout(timer);
            timer = globalThis.setTimeout(() => void run(), delayMs);
        },
    };
}
