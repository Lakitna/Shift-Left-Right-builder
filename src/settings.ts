/**
 * Persisted export-dialog settings (PNG and SVG). Both dialogs store the same shape — filename,
 * color theme, transparent background — so one small typed store covers them; PNG adds a width.
 */

export interface ExportSettingsBase {
    filename: string;
    transparent: boolean;
    theme: 'light' | 'dark';
}

export interface PngSettings extends ExportSettingsBase {
    width: number;
}

export const PNG_MIN_WIDTH = 120;
export const PNG_MAX_WIDTH = 8000;
export const PNG_DEFAULT_WIDTH = 1500;

export function clampPngWidth(value: number): number {
    if (!Number.isFinite(value)) return PNG_DEFAULT_WIDTH;
    return Math.min(PNG_MAX_WIDTH, Math.max(PNG_MIN_WIDTH, Math.round(value)));
}

function readJson(key: string): Record<string, unknown> | null {
    try {
        const raw = window.localStorage.getItem(key);
        if (raw === null) return null;
        const parsed = JSON.parse(raw) as unknown;
        return typeof parsed === 'object' && parsed !== null
            ? (parsed as Record<string, unknown>)
            : null;
    } catch {
        return null;
    }
}

function writeJson(key: string, value: unknown): void {
    try {
        window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Private mode or quota — the dialog still works, just forgetful.
    }
}

function textOr(stored: unknown, fallback: string): string {
    return typeof stored === 'string' && stored.trim() !== '' ? stored : fallback;
}

function boolOr(stored: unknown, fallback: boolean): boolean {
    return typeof stored === 'boolean' ? stored : fallback;
}

function themeOr(stored: unknown, fallback: 'light' | 'dark'): 'light' | 'dark' {
    return stored === 'dark' || stored === 'light' ? stored : fallback;
}

/** A localStorage-backed settings object, validated field-by-field against fresh defaults. */
export interface SettingsStore<T> {
    read(): T;
    write(settings: T): void;
}

function createStore<T extends ExportSettingsBase>(
    key: string,
    defaults: () => T,
    validate: (stored: Record<string, unknown>, fallback: T) => Partial<T>
): SettingsStore<T> {
    return {
        read(): T {
            const fallback = defaults();
            const stored = readJson(key);
            if (stored === null) return fallback;
            return { ...fallback, ...validate(stored, fallback) };
        },
        write(settings: T): void {
            writeJson(key, settings);
        },
    };
}

function validateBase(
    stored: Record<string, unknown>,
    fallback: ExportSettingsBase
): Partial<ExportSettingsBase> {
    return {
        filename: textOr(stored.filename, fallback.filename),
        transparent: boolOr(stored.transparent, fallback.transparent),
        theme: themeOr(stored.theme, fallback.theme),
    };
}

export function createSvgSettingsStore(
    key: string,
    defaults: () => ExportSettingsBase
): SettingsStore<ExportSettingsBase> {
    return createStore(key, defaults, validateBase);
}

export function createPngSettingsStore(
    key: string,
    defaults: () => PngSettings
): SettingsStore<PngSettings> {
    return createStore(key, defaults, (stored, fallback) => {
        const base = validateBase(stored, fallback);
        const width = stored.width;
        const validWidth =
            typeof width === 'number' && width >= PNG_MIN_WIDTH && width <= PNG_MAX_WIDTH;
        return { ...base, width: validWidth ? clampPngWidth(width) : fallback.width };
    });
}
