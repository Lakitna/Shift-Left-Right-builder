/**
 * The WYSIWYG graph editor: a formatting toolbar above the canvas plus direct manipulation on the
 * SVG. Click a curve to select it and reveal its control points; drag a point freely, or hold
 * Shift (or turn on "Snap to phases") to lock its x to the nearest phase tick. Click "+" affordances
 * to add points, double-click a curve to add one where you click, and click any label / note /
 * title to edit its text in place. Phase labels are click-to-edit too and drag sideways to
 * reorder; hovering one reveals a ✕ that removes the phase, and the "+" at the end of the axis row
 * appears on hover (graph or phase) or while editing. The legend shows one editable block per
 * curve: first line = label, rest = notes; its swatch is the curve's color picker (a native popup
 * anchored on the swatch) and hovering the row reveals a ✕ that removes the curve. Curves are
 * added from the "+ Add curve" legend row. The toolbar is segmented — generic (undo/redo + preset,
 * always), curve (shown only with a selection; inapplicable controls are disabled, not hidden),
 * and graph (Snap/Numeric toggles) — separated by dividers so the row never jumps.
 * All canvas interactions run on pointerdown.
 *
 * The editor mutates the model in place through the helpers in model.ts and asks the host to
 * commit (history + full re-render) or just sync the URL (live drag).
 */

import {
    addCurve,
    addPhase,
    canAddPhase,
    canRemoveCurve,
    canRemovePoint,
    clampCoord,
    clampOpacity,
    cloneModel,
    insertPoint,
    MAX_OPACITY,
    MIN_OPACITY,
    moveCurve,
    nearestPhaseX,
    PRESETS,
    removeCurve,
    removePhase,
    removePoint,
    reorderCurve,
    reorderPhase,
    setPoint,
    type CurvePoint,
    type GraphModel,
} from './model';
import {
    computeLayout,
    curveAreaPath,
    curveLinePath,
    pointPx,
    renderGraphSvg,
    segmentMidpoint,
    type GraphGeom,
} from './render';
import { STYLE } from './style';
import { isDarkMode } from './theme';

const SVG_NS = 'http://www.w3.org/2000/svg';
const ACCENT = { light: '#002fa7', dark: '#6c8cff' };

export interface EditorHost {
    getModel(): GraphModel;
    /** Replace the whole model (preset application). The host pushes history + re-renders. */
    replaceModel(next: GraphModel): void;
    /** A finished change: push to history, re-render everything, sync URL. */
    onCommit(): void;
    /** An in-progress change (dragging, live color): sync the URL only. */
    onLive(): void;
    undo(): void;
    redo(): void;
    canUndo(): boolean;
    canRedo(): boolean;
}

export interface GraphEditor {
    render(): void;
    deleteSelected(): void;
    clearSelection(): void;
    /** Nudge the selected control point by (dx, dy) model units; true if a point was moved. */
    nudge(dx: number, dy: number): boolean;
}

function svgEl<Tag extends keyof SVGElementTagNameMap>(
    tag: Tag,
    attrs: Record<string, string | number>
): SVGElementTagNameMap[Tag] {
    const element = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attrs)) {
        element.setAttribute(name, String(value));
    }
    return element;
}

/** Toolbar controls that do not apply are removed from view entirely, not left greyed out. */
function hide(element: HTMLElement): void {
    element.style.display = 'none';
}

function show(element: HTMLElement): void {
    element.style.display = '';
}

export function createEditor(
    toolbarEl: HTMLElement,
    canvasEl: HTMLElement,
    host: EditorHost
): GraphEditor {
    let selectedCurve: number | null = null;
    let selectedPoint: CurvePoint | null = null;
    let snapEnabled = false;
    let geom: GraphGeom | null = null;
    let svg: SVGSVGElement | null = null;
    let handlePoints: CurvePoint[] = [];
    let activeInline: { commit: () => void } | null = null;

    const toolbar = buildToolbar();

    canvasEl.addEventListener('pointerdown', onPointerDown);
    canvasEl.addEventListener('dblclick', onDoubleClick);

    function model(): GraphModel {
        return host.getModel();
    }

    function accent(): string {
        return isDarkMode() ? ACCENT.dark : ACCENT.light;
    }

    // --- Toolbar -------------------------------------------------------------

    function buildToolbar() {
        toolbarEl.textContent = '';
        // Three segments separated by visual dividers: generic (always), curve (selection only),
        // graph (always). Within the curve segment, controls that cannot apply to the current
        // curve/selection are disabled rather than hidden, so nothing shifts.
        const segment = (): HTMLElement => {
            if (toolbarEl.childElementCount > 0) {
                const divider = document.createElement('div');
                divider.className = 'tool-divider';
                toolbarEl.appendChild(divider);
            }
            const el = document.createElement('div');
            el.className = 'tool-segment';
            toolbarEl.appendChild(el);
            return el;
        };
        const group = (parent: HTMLElement): HTMLElement => {
            const el = document.createElement('div');
            el.className = 'tool-group';
            parent.appendChild(el);
            return el;
        };
        const button = (
            parent: HTMLElement,
            label: string,
            title: string,
            onClick: () => void
        ): HTMLButtonElement => {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = label;
            b.title = title;
            b.addEventListener('click', onClick);
            parent.appendChild(b);
            return b;
        };

        const segGeneric = segment();
        const gHistory = group(segGeneric);
        const btnUndo = button(gHistory, '↶', 'Undo (Ctrl+Z)', () => host.undo());
        const btnRedo = button(gHistory, '↷', 'Redo (Ctrl+Y)', () => host.redo());

        const presetSelect = document.createElement('select');
        presetSelect.title = 'Apply a preset';
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'Preset…';
        presetSelect.appendChild(placeholder);
        PRESETS.forEach((preset, index) => {
            const option = document.createElement('option');
            option.value = String(index);
            option.textContent = preset.name;
            presetSelect.appendChild(option);
        });
        presetSelect.addEventListener('change', () => {
            const value = presetSelect.value;
            if (value === '') return;
            // Clear the selection BEFORE replacing the model — replaceModel renders immediately,
            // and stale selection state would paint handles on the new model's first curve.
            selectedCurve = null;
            selectedPoint = null;
            host.replaceModel(cloneModel(PRESETS[Number(value)].data));
            presetSelect.value = '';
        });
        segGeneric.appendChild(presetSelect);

        const segCurve = segment();
        const gCurves = group(segCurve);
        const btnDeleteCurve = button(gCurves, '🗑', 'Delete selected curve', () => {
            if (selectedCurve !== null && removeCurve(model(), selectedCurve)) {
                selectedCurve = null;
                selectedPoint = null;
                host.onCommit();
            }
        });

        const gStyle = group(segCurve);

        const smoothWrap = document.createElement('label');
        smoothWrap.className = 'tool-check';
        const smoothInput = document.createElement('input');
        smoothInput.type = 'checkbox';
        const smoothSpan = document.createElement('span');
        smoothSpan.textContent = 'Smooth';
        smoothInput.addEventListener('change', () => {
            if (selectedCurve !== null) {
                const curve = model().curves[selectedCurve];
                if (curve) {
                    curve.smooth = smoothInput.checked;
                    host.onCommit();
                }
            }
        });
        smoothWrap.append(smoothInput, smoothSpan);
        gStyle.appendChild(smoothWrap);

        const opacityWrap = document.createElement('label');
        opacityWrap.className = 'tool-range';
        const opacitySpan = document.createElement('span');
        opacitySpan.textContent = 'Opacity';
        const opacityInput = document.createElement('input');
        opacityInput.type = 'range';
        opacityInput.min = String(MIN_OPACITY);
        opacityInput.max = String(MAX_OPACITY);
        opacityInput.step = '0.05';
        opacityInput.title = 'Selected curve opacity';
        opacityInput.addEventListener('input', () => {
            if (selectedCurve !== null) {
                const curve = model().curves[selectedCurve];
                if (curve) {
                    curve.opacity = clampOpacity(Number(opacityInput.value));
                    updateCurveOpacity(selectedCurve);
                    host.onLive();
                }
            }
        });
        opacityInput.addEventListener('change', () => host.onCommit());
        opacityWrap.append(opacitySpan, opacityInput);
        gStyle.appendChild(opacityWrap);

        const gOrder = group(segCurve);
        const btnBack = button(gOrder, '⟨', 'Send curve backward', () => {
            if (selectedCurve !== null && moveCurve(model(), selectedCurve, -1)) {
                selectedCurve -= 1; // follow the moved curve so selection stays on it
                host.onCommit();
            }
        });
        const btnForward = button(gOrder, '⟩', 'Bring curve forward', () => {
            if (selectedCurve !== null && moveCurve(model(), selectedCurve, 1)) {
                selectedCurve += 1;
                host.onCommit();
            }
        });

        const segGraph = segment();
        const gToggles = group(segGraph);

        const snapWrap = document.createElement('label');
        snapWrap.className = 'tool-check';
        const snapInput = document.createElement('input');
        snapInput.type = 'checkbox';
        const snapSpan = document.createElement('span');
        snapSpan.textContent = 'Snap to phases';
        snapInput.addEventListener('change', () => {
            snapEnabled = snapInput.checked;
        });
        snapWrap.append(snapInput, snapSpan);
        gToggles.appendChild(snapWrap);

        const numericWrap = document.createElement('label');
        numericWrap.className = 'tool-check';
        const numericInput = document.createElement('input');
        numericInput.type = 'checkbox';
        const numericSpan = document.createElement('span');
        numericSpan.textContent = 'Numeric axis';
        numericInput.addEventListener('change', () => {
            model().numericAxis = numericInput.checked;
            host.onCommit();
        });
        numericWrap.append(numericInput, numericSpan);
        gToggles.appendChild(numericWrap);

        // The second divider (curve | graph) only belongs to the layout while the curve segment is
        // visible; hiding it with the segment keeps a single divider when nothing is picked.
        const allDividers = [...toolbarEl.querySelectorAll('.tool-divider')] as HTMLElement[];

        return {
            btnUndo,
            btnRedo,
            segCurve,
            dividerAfterCurve: allDividers[1],
            btnDeleteCurve,
            smoothInput,
            opacityInput,
            btnBack,
            btnForward,
            snapInput,
            numericInput,
        };
    }

    function updateToolbar(): void {
        const m = model();
        toolbar.btnUndo.disabled = !host.canUndo();
        toolbar.btnRedo.disabled = !host.canRedo();

        // The curve segment appears only with a selection; inside it controls stay visible but
        // disabled when they cannot apply (e.g. "backward" on the bottom curve), so nothing shifts.
        const selected = selectedCurve !== null ? m.curves[selectedCurve] : undefined;
        if (selected === undefined) {
            hide(toolbar.segCurve);
            hide(toolbar.dividerAfterCurve);
        } else {
            show(toolbar.segCurve);
            show(toolbar.dividerAfterCurve);
        }
        toolbar.btnDeleteCurve.disabled = !(selected && canRemoveCurve(m));
        if (selected) {
            toolbar.smoothInput.checked = selected.smooth;
            toolbar.opacityInput.value = String(selected.opacity);
        }
        toolbar.smoothInput.disabled = !selected;
        toolbar.opacityInput.disabled = !selected;
        toolbar.btnBack.disabled = !(selected && selectedCurve !== null && selectedCurve > 0);
        toolbar.btnForward.disabled = !(
            selected &&
            selectedCurve !== null &&
            selectedCurve < m.curves.length - 1
        );
        toolbar.snapInput.checked = snapEnabled;
        toolbar.numericInput.checked = m.numericAxis;
    }

    // --- Render --------------------------------------------------------------

    function render(): void {
        const m = model();
        if (selectedCurve !== null && (selectedCurve < 0 || selectedCurve >= m.curves.length)) {
            selectedCurve = null;
            selectedPoint = null;
        }
        const dark = isDarkMode();
        geom = computeLayout(m, { style: STYLE, dark, editing: true });
        svg = renderGraphSvg(m, { style: STYLE, dark, editing: true });
        canvasEl.replaceChildren(svg);
        buildOverlay(m);
        updateToolbar();
    }

    function buildOverlay(m: GraphModel): void {
        if (svg === null || geom === null) return;
        const g = geom; // capture the non-null geometry for use inside callbacks
        const overlay = svgEl('g', { class: 'editing-ui' });
        const acc = accent();

        if (selectedCurve !== null) {
            const curve = m.curves[selectedCurve];
            if (curve) {
                overlay.appendChild(
                    svgEl('path', {
                        class: 'curve-move',
                        d: curveLinePath(curve, g),
                        fill: 'none',
                        stroke: acc,
                        'stroke-width': STYLE.curveStrokeWidth + 3,
                        'stroke-opacity': 0.35,
                        'stroke-linecap': 'round',
                        'stroke-linejoin': 'round',
                        'data-curve-move': selectedCurve,
                    })
                );
                handlePoints = [...curve.points];
                handlePoints.forEach((point, index) => {
                    const p = pointPx(point, g);
                    const isSelected = point === selectedPoint;
                    overlay.appendChild(
                        svgEl('circle', {
                            cx: p.x,
                            cy: p.y,
                            r: STYLE.pointRadius,
                            class: 'point-handle',
                            'data-handle-index': index,
                            fill: isSelected ? acc : '#ffffff',
                            stroke: acc,
                            'stroke-width': 2,
                        })
                    );
                });
                for (let i = 0; i < handlePoints.length - 1; i++) {
                    // Sit the "+" on the drawn curve (spline midpoint), not on the chord between
                    // the two control points. Round to the model's integer coordinates first so
                    // the inserted point lands exactly where the handle is.
                    const rawMid = segmentMidpoint(curve, i);
                    const midX = Math.round(rawMid.x);
                    const midY = Math.round(rawMid.y);
                    const mid = g.toPx(midX, midY);
                    const handle = svgEl('g', {
                        class: 'insert-handle',
                        'data-insert-x': midX,
                        'data-insert-y': midY,
                        'data-curve-index': selectedCurve,
                    });
                    handle.appendChild(
                        svgEl('circle', {
                            cx: mid.x,
                            cy: mid.y,
                            r: 9,
                            fill: '#ffffff',
                            stroke: acc,
                            'stroke-width': 2,
                        })
                    );
                    const plus = svgEl('text', {
                        x: mid.x,
                        y: mid.y + 4,
                        'text-anchor': 'middle',
                        fill: acc,
                        'font-size': 13,
                        'font-weight': 700,
                        'pointer-events': 'none',
                    });
                    plus.textContent = '+';
                    handle.appendChild(plus);
                    overlay.appendChild(handle);
                }
            }
        } else {
            handlePoints = [];
        }

        // "+" at the end of the phase row: WYSIWYG add-phase (append; drag to reposition).
        if (canAddPhase(m)) {
            const addX = g.plotX1 + 28;
            const addY = g.phaseLabelY - 5;
            const add = svgEl('g', { class: 'phase-add', 'data-phase-add': 1 });
            add.appendChild(
                svgEl('circle', {
                    cx: addX,
                    cy: addY,
                    r: 9,
                    fill: '#ffffff',
                    stroke: acc,
                    'stroke-width': 2,
                })
            );
            const plus = svgEl('text', {
                x: addX,
                y: addY + 4,
                'text-anchor': 'middle',
                fill: acc,
                'font-size': 13,
                'font-weight': 700,
                'pointer-events': 'none',
            });
            plus.textContent = '+';
            add.appendChild(plus);
            overlay.appendChild(add);
        }

        svg.appendChild(overlay);
    }

    // --- Live updates during a drag -----------------------------------------

    function updateCurve(index: number): void {
        if (svg === null || geom === null) return;
        const curve = model().curves[index];
        const group = svg.querySelector(`.curves g[data-curve-index="${index}"]`);
        if (curve === undefined || group === null) return;
        const paths = group.querySelectorAll('path');
        if (paths[0]) paths[0].setAttribute('d', curveAreaPath(curve, geom));
        if (paths[1]) paths[1].setAttribute('d', curveLinePath(curve, geom));
    }

    function updateCurveColor(index: number): void {
        if (svg === null) return;
        const curve = model().curves[index];
        const group = svg.querySelector(`.curves g[data-curve-index="${index}"]`);
        if (curve === undefined || group === null) return;
        const paths = group.querySelectorAll('path');
        if (paths[0]) paths[0].setAttribute('fill', curve.color);
        if (paths[1]) paths[1].setAttribute('stroke', curve.color);
        // The invisible hit band is a wide stroke too — keep it transparent so the hover
        // highlight never paints through it.
        if (paths[2]) paths[2].setAttribute('stroke', 'transparent');
    }

    function updateCurveOpacity(index: number): void {
        if (svg === null) return;
        const curve = model().curves[index];
        const group = svg.querySelector(`.curves g[data-curve-index="${index}"]`);
        if (curve === undefined || group === null) return;
        const paths = group.querySelectorAll('path');
        if (paths[0]) paths[0].setAttribute('fill-opacity', String(curve.opacity));
    }

    function repositionHandles(): void {
        if (svg === null || geom === null) return;
        svg.querySelectorAll<SVGCircleElement>('circle.point-handle').forEach((circle) => {
            const index = Number(circle.getAttribute('data-handle-index'));
            const point = handlePoints[index];
            if (point === undefined) return;
            const p = pointPx(point, geom as GraphGeom);
            circle.setAttribute('cx', String(p.x));
            circle.setAttribute('cy', String(p.y));
        });
    }

    // --- Pointer handling ----------------------------------------------------

    function svgPointToModel(clientX: number, clientY: number): CurvePoint | null {
        if (svg === null || geom === null) return null;
        const rect = svg.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return null;
        const ux = (clientX - rect.left) * (geom.width / rect.width);
        const uy = (clientY - rect.top) * (geom.height / rect.height);
        const mapped = geom.fromPx(ux, uy);
        return { x: mapped.x, y: mapped.y };
    }

    function onPointerDown(event: PointerEvent): void {
        if (activeInline !== null) {
            // Clicks inside the open editor (caret placement, text selection) must not commit it.
            if ((event.target as Element).closest('.inline-editor') !== null) return;
            activeInline.commit();
            // Route the same click to whatever is now under the pointer (the DOM was re-rendered),
            // so clicking another label while editing commits the first and opens the second.
            const fresh = document.elementFromPoint(event.clientX, event.clientY);
            if (fresh !== null) routePointer(fresh, event);
            return;
        }
        routePointer(event.target as Element, event);
    }

    function routePointer(target: Element, event: PointerEvent): void {
        const handle = target.closest('[data-handle-index]');
        if (handle !== null) {
            startDrag(Number(handle.getAttribute('data-handle-index')), event);
            return;
        }

        const moveHandle = target.closest('[data-curve-move]');
        if (moveHandle !== null) {
            startMoveCurve(Number(moveHandle.getAttribute('data-curve-move')), event);
            return;
        }

        const insert = target.closest('[data-insert-x]');
        if (insert !== null) {
            const curveIndex = Number(insert.getAttribute('data-curve-index'));
            const x = Number(insert.getAttribute('data-insert-x'));
            const yAttr = insert.getAttribute('data-insert-y');
            const y = yAttr === null ? undefined : Number(yAttr);
            if (insertPoint(model(), curveIndex, x, y)) {
                selectedCurve = curveIndex;
                selectedPoint = null;
                host.onCommit();
            }
            return;
        }

        const phaseRemove = target.closest('[data-phase-remove]');
        if (phaseRemove !== null) {
            const index = Number(phaseRemove.getAttribute('data-phase-remove'));
            if (removePhase(model(), index)) host.onCommit();
            return;
        }

        if (target.closest('[data-phase-add]') !== null) {
            if (addPhase(model())) host.onCommit();
            return;
        }

        // Legend "+ Add curve" row: append a curve, select it, and open its label for typing so
        // the new curve is named right where it was clicked.
        if (target.closest('[data-curve-add]') !== null) {
            if (addCurve(model())) {
                const index = model().curves.length - 1;
                selectedCurve = index;
                selectedPoint = null;
                host.onCommit();
                const block = svg?.querySelector(`.legend-block[data-curve-index="${index}"]`);
                if (block instanceof SVGElement) startInline(block);
            }
            return;
        }

        const phaseText = target.closest('text[data-phase-index]');
        if (phaseText !== null) {
            // Phase labels carry three interactions on one element: a plain click edits the text,
            // a horizontal drag reorders the phase, and a drag below the label row deletes it.
            startPhaseInteraction(
                Number(phaseText.getAttribute('data-phase-index')),
                phaseText as SVGElement,
                event
            );
            return;
        }

        // Legend row hover-reveal drag handle: reorders the curve's paint layer.
        const curveDrag = target.closest('[data-curve-drag]');
        if (curveDrag !== null) {
            startLegendDrag(Number(curveDrag.getAttribute('data-curve-drag')), event);
            return;
        }

        // Legend row hover-reveal ✕: removes that curve (mirrors the phase-row ✕).
        const curveRemove = target.closest('[data-curve-remove]');
        if (curveRemove !== null) {
            const index = Number(curveRemove.getAttribute('data-curve-remove'));
            if (removeCurve(model(), index)) {
                if (selectedCurve === index) {
                    selectedCurve = null;
                    selectedPoint = null;
                } else if (selectedCurve !== null && selectedCurve > index) {
                    selectedCurve -= 1;
                }
                host.onCommit();
            }
            return;
        }

        const edit = target.closest('[data-edit-field]');
        if (edit !== null) {
            // The legend swatch is a color selector, not a text field.
            if (edit.getAttribute('data-edit-field') === 'legend-block') {
                const swatch = target.closest('[data-swatch-index]');
                if (swatch !== null) {
                    event.preventDefault();
                    openSwatchPicker(Number(swatch.getAttribute('data-swatch-index')));
                    return;
                }
            }
            // Without preventDefault the browser's default focus handling blurs the freshly
            // opened editor, and its blur-commit closes it again in the same click.
            event.preventDefault();
            startInline(edit as SVGElement);
            return;
        }

        const curveHit = target.closest('[data-curve-index]');
        if (curveHit !== null) {
            selectedCurve = Number(curveHit.getAttribute('data-curve-index'));
            selectedPoint = null;
            render();
            return;
        }

        if (selectedCurve !== null) {
            selectedCurve = null;
            selectedPoint = null;
            render();
        }
    }

    function onDoubleClick(event: MouseEvent): void {
        const target = event.target as Element;
        if (target.closest('[data-edit-field]') !== null) return;
        const curveEl = target.closest('[data-curve-index]');
        if (curveEl === null) return;
        const curveIndex = Number(curveEl.getAttribute('data-curve-index'));
        const point = svgPointToModel(event.clientX, event.clientY);
        if (point === null) return;
        if (insertPoint(model(), curveIndex, clampCoord(point.x))) {
            selectedCurve = curveIndex;
            host.onCommit();
        }
    }

    function startDrag(handleIndex: number, event: PointerEvent): void {
        if (selectedCurve === null || geom === null) return;
        const point = handlePoints[handleIndex];
        if (point === undefined) return;
        selectedPoint = point;
        const curveIndex = selectedCurve;

        const move = (moveEvent: PointerEvent): void => {
            const mapped = svgPointToModel(moveEvent.clientX, moveEvent.clientY);
            if (mapped === null) return;
            let x = mapped.x;
            const y = mapped.y;
            if (moveEvent.shiftKey || snapEnabled) {
                x = nearestPhaseX(x, model().phases.length);
            }
            setPoint(model(), curveIndex, point, clampCoord(x), clampCoord(y));
            updateCurve(curveIndex);
            repositionHandles();
            host.onLive();
        };
        const up = (): void => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            host.onCommit();
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        event.preventDefault();
    }

    /** Drag the selected curve's top line to translate the whole curve horizontally (rigid). */
    function startMoveCurve(curveIndex: number, event: PointerEvent): void {
        const curve = model().curves[curveIndex];
        if (curve === undefined) return;
        const start = svgPointToModel(event.clientX, event.clientY);
        if (start === null) return;
        const snapshot = curve.points.map((point) => ({ point, x0: point.x }));
        const minX = Math.min(...snapshot.map((s) => s.x0));
        const maxX = Math.max(...snapshot.map((s) => s.x0));

        const move = (moveEvent: PointerEvent): void => {
            const mapped = svgPointToModel(moveEvent.clientX, moveEvent.clientY);
            if (mapped === null) return;
            const dx = Math.max(-minX, Math.min(100 - maxX, mapped.x - start.x));
            for (const s of snapshot) s.point.x = clampCoord(s.x0 + dx);
            curve.points.sort((a, b) => a.x - b.x);
            updateCurve(curveIndex);
            repositionHandles();
            host.onLive();
        };
        const up = (): void => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            host.onCommit();
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        event.preventDefault();
    }

    /**
     * Click-vs-drag on a phase label: releasing without dragging opens the inline text editor;
     * dragging follows the pointer and, on release, reorders the phase to the nearest tick. The
     * ✕ revealed on hover (see render.ts) is the single way to remove a phase.
     */
    function startPhaseInteraction(index: number, element: SVGElement, event: PointerEvent): void {
        if (svg === null || geom === null) return;
        const g = geom;
        const startClient = { x: event.clientX, y: event.clientY };
        let lastClient = startClient;
        let dragging = false;

        const toSvg = (clientX: number, clientY: number): { x: number; y: number } => {
            const rect = (svg as SVGSVGElement).getBoundingClientRect();
            return {
                x: (clientX - rect.left) * (g.width / rect.width),
                y: (clientY - rect.top) * (g.height / rect.height),
            };
        };

        const move = (moveEvent: PointerEvent): void => {
            if (!dragging) {
                const dx = moveEvent.clientX - startClient.x;
                const dy = moveEvent.clientY - startClient.y;
                if (Math.hypot(dx, dy) < 6) return;
                dragging = true;
            }
            lastClient = { x: moveEvent.clientX, y: moveEvent.clientY };
            const p = toSvg(lastClient.x, lastClient.y);
            element.setAttribute('x', String(Math.min(g.plotX1, Math.max(g.plotX0, p.x))));
        };
        const up = (): void => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            if (!dragging) {
                startInline(element);
                return;
            }
            const p = toSvg(lastClient.x, lastClient.y);
            let targetIndex = index;
            let best = Infinity;
            g.phaseXs.forEach((tickX, i) => {
                const distance = Math.abs(tickX - p.x);
                if (distance < best) {
                    best = distance;
                    targetIndex = i;
                }
            });
            if (reorderPhase(model(), index, targetIndex)) host.onCommit();
            else render();
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        // Without preventDefault the browser's default focus handling blurs the inline editor
        // a plain click opens (same fix as the other edit fields).
        event.preventDefault();
    }

    // --- Legend swatch color picker -----------------------------------------

    /** Open picker, if any, so a second click can close it (programmatic clicks don't toggle). */
    let activePicker: { input: HTMLInputElement; index: number } | null = null;

    /**
     * The legend swatch is the curve's color control. A transparent native `<input type="color">`
     * is laid over the swatch — sized generously so the OS popup anchors on the swatch itself —
     * and clicked. Live picks repaint the swatch/curve; closing commits once. Clicking the same
     * swatch again closes the stuck-open picker instead of dead-ending.
     */
    function openSwatchPicker(index: number): void {
        const swatch = svg?.querySelector(`rect[data-swatch-index="${index}"]`);
        if (!(swatch instanceof SVGRectElement) || geom === null) return;
        const curve = model().curves[index];
        if (curve === undefined) return;

        if (activePicker !== null && activePicker.index === index) {
            const stale = activePicker.input;
            activePicker = null;
            stale.remove();
            return;
        }
        if (activePicker !== null) {
            const stale = activePicker.input;
            activePicker = null;
            stale.remove();
        }

        const canvasRect = canvasEl.getBoundingClientRect();
        const box = swatch.getBoundingClientRect();
        // Scale between the SVG's user units and its rendered size (the canvas can scroll/zoom).
        const scale = box.width / STYLE.layout.legendSwatch;
        const overlaySize = Math.max(48, 30 * scale);
        const input = document.createElement('input');
        input.type = 'color';
        input.className = 'inline-color';
        input.value = /^#[0-9a-f]{6}$/i.test(curve.color) ? curve.color : '#000000';
        input.style.position = 'absolute';
        input.style.left = `${Math.max(0, box.left - canvasRect.left + canvasEl.scrollLeft - (overlaySize - box.width) / 2)}px`;
        input.style.top = `${Math.max(0, box.top - canvasRect.top + canvasEl.scrollTop - (overlaySize - box.height) / 2)}px`;
        input.style.width = `${overlaySize}px`;
        input.style.height = `${overlaySize}px`;
        canvasEl.appendChild(input);

        let done = false;
        const finish = (): void => {
            if (done) return;
            done = true;
            canvasEl.removeEventListener('pointerdown', canvasGuard);
            if (activePicker !== null && activePicker.input === input) activePicker = null;
            input.remove();
        };
        const commit = (): void => {
            if (done) return;
            finish();
            host.onCommit();
        };
        // Swallow the gesture that opened the picker (and any later canvas click) so the canvas
        // handler never fights the native popup; clicking elsewhere closes the picker via blur.
        const canvasGuard = (event: PointerEvent): void => {
            event.stopPropagation();
        };
        input.addEventListener('input', () => {
            curve.color = input.value;
            updateCurveColor(index);
            swatch.setAttribute('fill', input.value);
            host.onLive();
        });
        input.addEventListener('change', commit);
        input.addEventListener('blur', commit);
        canvasEl.addEventListener('pointerdown', canvasGuard);
        activePicker = { input, index };
        input.click();
    }

    /**
     * Drag a legend row by its hover handle to change the curve's paint order. The legend shows
     * rows in reverse paint order (front-most curve on top), so this works entirely in display
     * slots: `data-curve-drag` carries the model index, which is mapped to its DOM slot here and
     * back through `reorderCurve`'s display-order equivalent on release. Slot geometry comes from
     * the layout (`geom.legendRows`) captured once at drag start, so the decision is pure
     * arithmetic on the pointer delta and never disagrees with the preview. Rows can have different
     * heights (wrapped notes): the dragged row follows the pointer 1:1, and the other rows shift
     * by the dragged row's own slot size, which is exactly how much space the vacated slot needs.
     * The drop target advances one slot per crossed boundary of the *original* stack — cumulative
     * distance, not round() — so intermediate positions are reachable for any row count. Release
     * reorders the model once.
     */
    function startLegendDrag(curveIndex: number, event: PointerEvent): void {
        if (svg === null || geom === null) return;
        const currentSvg = svg;
        const blocks = [...currentSvg.querySelectorAll('.legend-block')] as SVGGElement[];
        // Display slot of the dragged curve (blocks are rendered front-most first).
        const index = blocks.findIndex(
            (b) => Number(b.getAttribute('data-curve-index')) === curveIndex
        );
        const dragged = blocks[index];
        if (dragged === undefined) return;
        // Only the row being dragged keeps its hover affordances; others stop reacting mid-drag.
        currentSvg.classList.add('legend-dragging');

        // SVG renders 1:1 inside the canvas, so layout units equal CSS pixels here.
        const rows = geom.legendRows;
        const tops = rows.map((row) => row.top);
        // Preview shift for neighbours equals the dragged row's own slot size.
        const shiftPx = Math.max(1, rows[index].height);

        const startY = event.clientY;
        let lastY = startY;
        let moved = false;
        let currentTarget = index;

        // Cumulative pointer distance against each crossed boundary of the original stack: to land
        // k slots away the dragged row must travel the summed pitch between those slots. Symmetric
        // up/down, works for any row count and variable row heights.
        const targetFor = (clientY: number): number => {
            const dy = clientY - startY;
            let t = index;
            if (dy > 0) {
                while (t < rows.length - 1 && dy >= tops[t + 1] - tops[index]) t += 1;
            } else if (dy < 0) {
                while (t > 0 && -dy >= tops[index] - tops[t - 1]) t -= 1;
            }
            return t;
        };

        // Shift the untouched rows out of the dragged row's slot while the pointer is over it.
        const applyPreview = (targetIndex: number): void => {
            if (targetIndex === currentTarget) return;
            currentTarget = targetIndex;
            blocks.forEach((block, i) => {
                if (i === index) return;
                let shift = 0;
                if (index < targetIndex && i > index && i <= targetIndex) shift = -1;
                if (index > targetIndex && i >= targetIndex && i < index) shift = 1;
                block.style.transform = shift === 0 ? '' : `translateY(${shift * shiftPx}px)`;
            });
        };

        const move = (moveEvent: PointerEvent): void => {
            const dy = moveEvent.clientY - startY;
            if (!moved && Math.abs(dy) < 4) return;
            moved = true;
            lastY = moveEvent.clientY;
            dragged.style.transform = `translateY(${dy}px)`;
            dragged.classList.add('dragging');
            applyPreview(targetFor(moveEvent.clientY));
        };
        const up = (): void => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            dragged.style.transform = '';
            dragged.classList.remove('dragging');
            blocks.forEach((block) => {
                if (block !== dragged) block.style.transform = '';
            });
            currentSvg.classList.remove('legend-dragging');
            if (!moved) return;
            const targetSlot = targetFor(lastY);
            if (targetSlot === index) return;
            // Display slots run front-to-back; the model array runs back-to-front. Moving a curve
            // to display slot `targetSlot` is an insert-before in reversed coordinates.
            const n = blocks.length;
            const from = n - 1 - index;
            const to = n - 1 - targetSlot;
            if (reorderCurve(model(), from, to)) {
                // Keep selection glued to the same curve after the splice.
                if (selectedCurve === from) selectedCurve = to;
                else if (selectedCurve !== null) {
                    const lo = Math.min(from, to);
                    const hi = Math.max(from, to);
                    if (selectedCurve > lo && selectedCurve <= hi) {
                        selectedCurve += from < to ? -1 : 1;
                    }
                }
                host.onCommit();
            }
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        event.preventDefault();
    }

    // --- Inline text editing -------------------------------------------------

    function startInline(element: SVGElement): void {
        const field = element.getAttribute('data-edit-field');
        if (field === null) return;
        const m = model();
        let value = '';
        let multiline = false;
        let write: (next: string) => void = () => {};

        if (field === 'title') {
            value = m.title ?? '';
            write = (next) => {
                m.title = next;
            };
        } else if (field === 'yaxis') {
            value = m.yAxisTitle ?? '';
            write = (next) => {
                m.yAxisTitle = next;
            };
        } else if (field === 'phase') {
            const index = Number(element.getAttribute('data-phase-index'));
            const phase = m.phases[index];
            if (phase === undefined) return;
            value = phase.label;
            write = (next) => {
                const target = m.phases[index];
                if (target) target.label = next;
            };
        } else if (field === 'curve-label') {
            const index = Number(element.getAttribute('data-curve-index'));
            const curve = m.curves[index];
            if (curve === undefined) return;
            value = curve.label;
            write = (next) => {
                const target = m.curves[index];
                if (target) target.label = next;
            };
        } else if (field === 'legend-block') {
            const index = Number(element.getAttribute('data-curve-index'));
            const curve = m.curves[index];
            if (curve === undefined) return;
            // One block for the whole legend row: first line is the label, the rest are notes.
            value = curve.notes === '' ? curve.label : `${curve.label}\n${curve.notes}`;
            multiline = true;
            write = (next) => {
                const target = m.curves[index];
                if (target === undefined) return;
                const newline = next.indexOf('\n');
                target.label = newline === -1 ? next : next.slice(0, newline);
                target.notes = newline === -1 ? '' : next.slice(newline + 1);
            };
        } else {
            return;
        }

        openInlineInput(element, value, multiline, write);
    }

    function openInlineInput(
        element: SVGElement,
        value: string,
        multiline: boolean,
        write: (next: string) => void
    ): void {
        const canvasRect = canvasEl.getBoundingClientRect();
        const elementRect = element.getBoundingClientRect();
        const input = (
            multiline ? document.createElement('textarea') : document.createElement('input')
        ) as HTMLTextAreaElement;
        input.className = 'inline-editor' + (multiline ? ' multiline' : '');
        input.value = value;
        input.style.position = 'absolute';
        input.style.left = `${Math.max(0, elementRect.left - canvasRect.left + canvasEl.scrollLeft - 4)}px`;
        input.style.top = `${Math.max(0, elementRect.top - canvasRect.top + canvasEl.scrollTop - 4)}px`;
        input.style.minWidth = `${Math.max(140, elementRect.width + 48)}px`;
        if (multiline) {
            input.style.height = `${Math.max(64, elementRect.height + 28)}px`;
        }
        canvasEl.appendChild(input);
        input.focus();
        if (!multiline) input.select();

        let done = false;
        const commit = (): void => {
            if (done) return;
            done = true;
            write(input.value);
            activeInline = null;
            input.remove();
            host.onCommit();
        };
        const cancel = (): void => {
            if (done) return;
            done = true;
            activeInline = null;
            input.remove();
            render();
        };
        activeInline = { commit };
        input.addEventListener('blur', commit);
        input.addEventListener('keydown', (keyEvent: KeyboardEvent) => {
            keyEvent.stopPropagation();
            if (keyEvent.key === 'Escape') {
                keyEvent.preventDefault();
                input.removeEventListener('blur', commit);
                cancel();
            } else if (
                keyEvent.key === 'Enter' &&
                (!multiline || keyEvent.ctrlKey || keyEvent.metaKey)
            ) {
                keyEvent.preventDefault();
                input.removeEventListener('blur', commit);
                commit();
            }
        });
    }

    // --- Public actions ------------------------------------------------------

    function deleteSelected(): void {
        const m = model();
        if (selectedPoint !== null && selectedCurve !== null) {
            const curve = m.curves[selectedCurve];
            if (curve && canRemovePoint(curve)) {
                removePoint(m, selectedCurve, curve.points.indexOf(selectedPoint));
                selectedPoint = null;
                host.onCommit();
                return;
            }
        }
        if (selectedCurve !== null) {
            if (removeCurve(m, selectedCurve)) {
                selectedCurve = null;
                selectedPoint = null;
                host.onCommit();
            }
        }
    }

    function clearSelection(): void {
        if (selectedCurve === null && selectedPoint === null) return;
        selectedCurve = null;
        selectedPoint = null;
        render();
    }

    function nudge(dx: number, dy: number): boolean {
        if (selectedPoint === null || selectedCurve === null) return false;
        const curve = model().curves[selectedCurve];
        if (curve === undefined || !curve.points.includes(selectedPoint)) return false;
        setPoint(model(), selectedCurve, selectedPoint, selectedPoint.x + dx, selectedPoint.y + dy);
        host.onCommit();
        return true;
    }

    return { render, deleteSelected, clearSelection, nudge };
}
