/**
 * Persisted export-dialog settings (PNG and SVG). Both dialogs store the same shape — filename,
 * color theme, transparent background, include-legend — so one small typed store covers them;
 * PNG adds a width.
 */

export interface ExportSettingsBase {
    filename: string;
    transparent: boolean;
    includeLegend: boolean;
    theme: 'light' | 'dark';
}

export interface PngSettings extends ExportSettingsBase {
    width: number;
}

export const PNG_MIN_WIDTH = 120;
export const PNG_MAX_WIDTH = 8000;
export const PNG_DEFAULT_WIDTH = 1500;

export function clampPngWidth(value: number): number {
    return Number.isFinite(value)
        ? Math.min(PNG_MAX_WIDTH, Math.max(PNG_MIN_WIDTH, Math.round(value)))
        : PNG_DEFAULT_WIDTH;
}

function readJson(key: string): Record<string, unknown> | undefined {
    try {
        const raw = globalThis.localStorage.getItem(key);
        if (raw === null) return undefined;
        const parsed = JSON.parse(raw) as unknown;
        return typeof parsed === 'object' && parsed !== null
            ? (parsed as Record<string, unknown>)
            : undefined;
    } catch {
        return undefined;
    }
}

function writeJson(key: string, value: unknown): void {
    try {
        globalThis.localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Private mode or quota — the dialog still works, just forgetful.
    }
}

function textOr(stored: unknown, fallback: string): string {
    return typeof stored === 'string' && stored.trim() !== '' ? stored : fallback;
}

/**
Whether the stored value is a boolean — the guard for the two boolean settings.
*/
function isStoredBoolean(stored: unknown): stored is boolean {
    return typeof stored === 'boolean';
}

function themeOr(stored: unknown, fallback: 'light' | 'dark'): 'light' | 'dark' {
    return stored === 'dark' || stored === 'light' ? stored : fallback;
}

/**
A localStorage-backed settings object, validated field-by-field against fresh defaults.
*/
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
            return stored === undefined ? fallback : { ...fallback, ...validate(stored, fallback) };
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
        transparent: isStoredBoolean(stored.transparent)
            ? stored.transparent
            : fallback.transparent,
        includeLegend: isStoredBoolean(stored.includeLegend)
            ? stored.includeLegend
            : fallback.includeLegend,
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
        const isValidWidth =
            typeof width === 'number' && width >= PNG_MIN_WIDTH && width <= PNG_MAX_WIDTH;
        return { ...base, width: isValidWidth ? clampPngWidth(width) : fallback.width };
    });
}
