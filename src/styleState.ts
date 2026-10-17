import { DEFAULT_STYLE_ID, getStyle, isValidStyleId, type GraphStyle } from './styles';
import { isDarkMode } from './theme';

/**
 * Active style management. Like the theme, the style is chrome, not model data — but it
 * DOES travel with shared links via the URL `#s=` param, with localStorage as the viewer's
 * own preference. Precedence: URL > localStorage > default.
 */

const STORAGE_KEY = 'shift-left-right-style';

let activeId: string = DEFAULT_STYLE_ID;

export function getActiveStyleId(): string {
    return activeId;
}

export function getActiveStyle(): GraphStyle {
    return getStyle(activeId);
}

/**
The stored style id, or null when absent/unknown.
*/
export function readStoredStyleId(): string | null {
    try {
        const stored = globalThis.localStorage.getItem(STORAGE_KEY);
        return isValidStyleId(stored) ? stored : null;
    } catch {
        return null;
    }
}

/**
 * Make `id` the active style (unknown ids fall back to classic), apply its chrome CSS
 * variables and persist the choice. Returns the resolved style.
 */
export function setActiveStyle(id: string, persist = true): GraphStyle {
    const style = getStyle(id);
    activeId = style.id;
    applyChromeVars(style);
    if (persist) {
        try {
            globalThis.localStorage.setItem(STORAGE_KEY, activeId);
        } catch {
            // Private mode / disabled storage: the selection still works for this session.
        }
    }
    return style;
}

const CHROME_VARS = [
    '--background',
    '--surface',
    '--border',
    '--text',
    '--text-muted',
    '--accent',
    '--accent-ink',
    '--danger',
    '--hover',
    '--font-ui',
] as const;

/**
 * Write the style's chrome tokens onto the root element as inline CSS custom properties,
 * overriding the classic defaults in styles.css. Called on style change AND theme toggle.
 * Optional tokens a style omits (like --accent-ink) are removed, falling back to the
 * stylesheet default.
 */
export function applyChromeVars(
    style: GraphStyle = getActiveStyle(),
    dark: boolean = isDarkMode()
): void {
    const tokens = dark ? style.chrome.dark : style.chrome.light;
    for (const name of CHROME_VARS) {
        const value = tokens[name];
        if (value === undefined) {
            document.documentElement.style.removeProperty(name);
        } else {
            document.documentElement.style.setProperty(name, value);
        }
    }
    // Lets CSS key style-specific chrome (e.g. the High contrast dialog rules).
    document.documentElement.dataset.style = style.id;
}
