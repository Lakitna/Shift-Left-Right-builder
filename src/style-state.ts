import { DEFAULT_STYLE_ID, getStyle, isValidStyleId, type GraphStyle } from './styles';
import { isDarkMode } from './theme';

/**
 * Active style management. Like the theme, the style is chrome, not model data — but it
 * DOES travel with shared links via the URL `#s=` param, with localStorage as the viewer's
 * own preference. Precedence: URL > localStorage > default.
 */

const STORAGE_KEY = 'shift-left-right-style';

/**
 * The active style id, held inside a closure rather than a module-level `let`: a function may not
 * assign a top-level binding (`unicorn/no-top-level-assignment-in-function`).
 */
const activeStyle = (() => {
    let id: string = DEFAULT_STYLE_ID;
    return {
        get(): string {
            return id;
        },
        set(next: string): void {
            id = next;
        },
    };
})();

export function getActiveStyleId(): string {
    return activeStyle.get();
}

export function getActiveStyle(): GraphStyle {
    return getStyle(activeStyle.get());
}

/**
The stored style id, or undefined when absent/unknown.
*/
export function readStoredStyleId(): string | undefined {
    try {
        const stored = globalThis.localStorage.getItem(STORAGE_KEY);
        return isValidStyleId(stored) ? stored : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Make `id` the active style (unknown ids fall back to classic), apply its chrome CSS
 * variables and persist the choice. Returns the resolved style.
 */
export function setActiveStyle(id: string, shouldPersist = true): GraphStyle {
    const style = getStyle(id);
    activeStyle.set(style.id);
    applyChromeVariables(style);
    if (shouldPersist) {
        try {
            globalThis.localStorage.setItem(STORAGE_KEY, activeStyle.get());
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
export function applyChromeVariables(
    style: GraphStyle = getActiveStyle(),
    isDark: boolean = isDarkMode()
): void {
    const tokens = isDark ? style.chrome.dark : style.chrome.light;
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
