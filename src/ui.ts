/**
 * Tiny DOM helpers for building plain HTML controls (toolbar, dialogs) and small app-shell
 * utilities.
 */

export function makeElement(tag: 'div', className?: string): HTMLDivElement;
export function makeElement(tag: 'label', className?: string): HTMLLabelElement;
export function makeElement(tag: 'span', className?: string): HTMLSpanElement;
export function makeElement(tag: 'option', value: string, text: string): HTMLOptionElement;
export function makeElement(
    tag: 'button',
    options: { label: string; title?: string; onClick?: () => void }
): HTMLButtonElement;
export function makeElement(tag: string, argument?: unknown, text?: string): HTMLElement {
    const element = document.createElement(tag);
    if (tag === 'button' && argument !== undefined) {
        const options = argument as { label: string; title?: string; onClick?: () => void };
        element.textContent = options.label;
        if (options.title !== undefined) element.title = options.title;
        if (options.onClick !== undefined) element.addEventListener('click', options.onClick);
    } else if (tag === 'option' && typeof argument === 'string') {
        element.setAttribute('value', argument);
        if (text !== undefined) element.textContent = text;
    } else if (typeof argument === 'string') {
        element.className = argument;
    }
    return element;
}

/**
A `<label class="tool-check">` wrapping a checkbox and its caption.
*/
export function makeCheck(
    caption: string,
    onChange: (checked: boolean) => void
): { label: HTMLLabelElement; input: HTMLInputElement } {
    const label = makeElement('label', 'tool-check');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.addEventListener('change', () => { onChange(input.checked); });
    const span = makeElement('span');
    span.textContent = caption;
    label.append(input, span);
    return { label, input };
}

/**
Look up a required element by id, failing loudly if the page is missing it.
*/
export function mustFind<T extends HTMLElement>(id: string): T {
    const element = document.getElementById(id);
    if (element === null) {
        throw new Error(`Required element #${id} is missing from the page`);
    }
    return element as T;
}

/**
Strip path characters from a typed file name and ensure it carries the given extension.
*/
export function normalizeFilename(raw: string, fallback: string, extension: string): string {
    const cleaned = raw.trim().replaceAll(/[\\/:*?"<>|]/g, '');
    if (cleaned === '') return fallback;
    const suffix = `.${extension}`;
    return cleaned.toLowerCase().endsWith(suffix) ? cleaned : cleaned + suffix;
}

/**
Close a `<dialog>` when its backdrop is clicked.
*/
export function closeOnBackdrop(dialog: HTMLDialogElement): void {
    dialog.addEventListener('click', (event) => {
        if (event.target === dialog) dialog.close();
    });
}

/**
Temporarily replace a button's label (e.g. "Copied!"), then restore it.
*/
export function flashButton(button: HTMLButtonElement, message: string): void {
    const original = button.textContent;
    button.textContent = message;
    button.disabled = true;
    globalThis.setTimeout(() => {
        button.textContent = original;
        button.disabled = false;
    }, 1200);
}
