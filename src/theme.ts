/**
 * Theme management: light/dark mode, persisted in localStorage, defaulting to the system
 * preference. The theme is UI chrome, not model data — it deliberately does NOT live in the
 * URL hash.
 */

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'shift-left-right-theme';

export function isDarkMode(): boolean {
    return document.documentElement.dataset.theme === 'dark';
}

/** Apply the stored (or system) theme before the first render to avoid a flash of wrong colors. */
export function initTheme(): void {
    let stored: string | null = null;
    try {
        stored = window.localStorage.getItem(STORAGE_KEY);
    } catch {
        stored = null;
    }
    const systemDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
    const dark = stored === 'dark' || (stored !== 'light' && systemDark);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

export function toggleTheme(): Theme {
    const next: Theme = isDarkMode() ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
        window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
        // Private mode / disabled storage: the toggle still works for this session.
    }
    return next;
}
