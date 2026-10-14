/**
 * Shared behavior for the two export dialogs (PNG and SVG). Both have the same controls —
 * color-mode radios, transparent-background checkbox, file-name input, live preview, cancel /
 * download buttons — plus a PNG-only width field merged in via `readCommon`. This wires the
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
        dialog: mustFind<HTMLDialogElement>(`${prefix}-dialog`),
        filenameInput: mustFind<HTMLInputElement>(`${prefix}-filename`),
        themeLightRadio: mustFind<HTMLInputElement>(`${prefix}-theme-light`),
        themeDarkRadio: mustFind<HTMLInputElement>(`${prefix}-theme-dark`),
        transparentInput: mustFind<HTMLInputElement>(`${prefix}-transparent`),
        previewImg: mustFind<HTMLImageElement>(`${prefix}-preview-img`),
        cancelButton: mustFind<HTMLButtonElement>(`${prefix}-cancel`),
        downloadButton: mustFind<HTMLButtonElement>(`${prefix}-download`),
    };
}

/** The three controls every export dialog has, after normalization/validation. */
export interface CommonExportValues {
    filename: string;
    transparent: boolean;
    theme: 'light' | 'dark';
}

export interface ExportDialogOptions<T extends CommonExportValues> {
    extension: 'png' | 'svg';
    fallbackFilename: string;
    /** Read the persisted settings shown when the dialog opens. */
    loadSettings(): T;
    /** Persist what the user chose on download. */
    saveSettings(settings: T): void;
    /** Merge the common control values into the last-known settings (adds format-specific fields). */
    readCommon(current: T, common: CommonExportValues): T;
    /** Called whenever a visual option changes (preview should refresh). */
    onOptionsChanged(): void;
    /** Called with the saved settings when Download is pressed. */
    onDownload(settings: T): void;
    /** Optional hook to populate format-specific controls (e.g. the PNG width field). */
    applyExtraSettings?(settings: T): void;
}

export function createExportDialog<T extends CommonExportValues>(
    el: DialogElements,
    options: ExportDialogOptions<T>
): {
    show(): void;
    isOpen(): boolean;
    setPreviewUrl(url: string): void;
    hidePreview(): void;
} {
    let current = options.loadSettings();

    el.cancelButton.addEventListener('click', () => el.dialog.close());
    closeOnBackdrop(el.dialog);
    for (const control of [el.transparentInput, el.themeLightRadio, el.themeDarkRadio]) {
        control.addEventListener('change', () => options.onOptionsChanged());
    }
    el.downloadButton.addEventListener('click', () => {
        current = options.readCommon(current, {
            filename: normalizeFilename(
                el.filenameInput.value,
                options.fallbackFilename,
                options.extension
            ),
            transparent: el.transparentInput.checked,
            theme: el.themeDarkRadio.checked ? 'dark' : 'light',
        });
        options.saveSettings(current);
        el.dialog.close();
        options.onDownload(current);
    });

    return {
        show() {
            const settings = options.loadSettings();
            el.filenameInput.value = settings.filename;
            el.transparentInput.checked = settings.transparent;
            (settings.theme === 'dark' ? el.themeDarkRadio : el.themeLightRadio).checked = true;
            if (options.applyExtraSettings) options.applyExtraSettings(settings);
            el.dialog.showModal();
            el.filenameInput.focus();
            el.filenameInput.select();
            options.onOptionsChanged();
        },
        isOpen: () => el.dialog.open,
        setPreviewUrl(url: string) {
            if (el.previewImg.dataset.url !== undefined) {
                URL.revokeObjectURL(el.previewImg.dataset.url);
            }
            el.previewImg.dataset.url = url;
            el.previewImg.src = url;
            el.previewImg.hidden = false;
        },
        hidePreview() {
            el.previewImg.hidden = true;
        },
    };
}

/** The preview half of an export dialog, as needed by the refresher. */
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
            window.clearTimeout(timer);
            timer = window.setTimeout(() => void run(), delayMs);
        },
    };
}
