/**
 * Style registry. Adding a visual language = one new file + one entry here.
 * Ids are public API: they live in shared URLs (`#s=`) and localStorage — never rename.
 */
import { bartoszStyle } from './bartosz';
import { classicStyle } from './classic';
import { contrastStyle } from './contrast';
import { deStijlStyle } from './de-stijl';
import { draftsmanStyle } from './draftsman';
import { toonStyle } from './toon';
import type { GraphStyle } from './types';
import { unicornStyle } from './unicorn';

export type { GraphStyle } from './types';


export const DEFAULT_STYLE_ID = 'classic';

export const STYLES: GraphStyle[] = [
    classicStyle,
    draftsmanStyle,
    contrastStyle,
    toonStyle,
    deStijlStyle,
    unicornStyle,
    bartoszStyle,
];

export function isValidStyleId(id: string | null | undefined): id is string {
    return typeof id === 'string' && STYLES.some((style) => style.id === id);
}

/**
Resolve a style by id, falling back to classic for unknown/absent ids (forward-compat).
*/
export function getStyle(id: string | null | undefined): GraphStyle {
    return STYLES.find((style) => style.id === id) ?? classicStyle;
}

export {classicStyle} from './classic';