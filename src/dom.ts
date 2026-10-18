/**
 * Tiny shared DOM helpers used by the renderer and the editor.
 */

export const SVG_NS = 'http://www.w3.org/2000/svg';

export function svgElement<Tag extends keyof SVGElementTagNameMap>(
    tag: Tag,
    attributes: Record<string, string | number>
): SVGElementTagNameMap[Tag] {
    const element = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attributes)) {
        element.setAttribute(name, String(value));
    }
    return element;
}

export function textElement(
    content: string,
    attributes: Record<string, string | number>
): SVGTextElement {
    const element = svgElement('text', attributes);
    element.textContent = content;
    return element;
}

/**
A hover-revealed circular "✕" button group (used to remove a phase or a legend curve).
*/
export function removeBadge(
    cx: number,
    cy: number,
    radius: number,
    fontSize: number,
    /**
    Baseline offset below `cy` for the glyph (kept per-badge so sizes match the old layout).
    */
    textOffset: number,
    palette: { background: string; legendSwatchStroke: string; phaseLabel: string },
    attributes: Record<string, string | number>
): SVGGElement {
    const group = svgElement('g', attributes);
    group.append(
        svgElement('circle', {
            cx,
            cy,
            r: radius,
            fill: palette.background,
            stroke: palette.legendSwatchStroke,
            'stroke-width': 1,
        })
    );
    group.append(
        textElement('✕', {
            x: cx,
            y: cy + textOffset,
            'text-anchor': 'middle',
            fill: palette.phaseLabel,
            'font-size': fontSize,
            'font-weight': 700,
        })
    );
    return group;
}

/**
A white circular "+" affordance (insert point on a curve, add a phase).
*/
export function addBadge(
    cx: number,
    cy: number,
    color: string,
    attributes: Record<string, string | number>
): SVGGElement {
    const group = svgElement('g', attributes);
    group.append(
        svgElement('circle', { cx, cy, r: 9, fill: '#ffffff', stroke: color, 'stroke-width': 2 })
    );
    group.append(
        textElement('+', {
            x: cx,
            y: cy + 4,
            'text-anchor': 'middle',
            fill: color,
            'font-size': 13,
            'font-weight': 700,
            'pointer-events': 'none',
        })
    );
    return group;
}
