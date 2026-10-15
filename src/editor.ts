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

import { addBadge, svgEl } from './dom';
import { startGesture } from './gesture';
import {
    addCurve,
    addEvent,
    addPhase,
    canAddPhase,
    canRemoveCurve,
    canRemovePoint,
    clampCoord,
    clampOpacity,
    cloneModel,
    DEFAULT_OPACITY,
    insertPoint,
    MAX_OPACITY,
    MIN_OPACITY,
    moveCurve,
    nearestBoundaryX,
    nearestPhaseX,
    removeCurve,
    removeEvent,
    removePhase,
    removePoint,
    reorderCurve,
    reorderPhase,
    setEventX,
    setPoint,
    type Curve,
    type CurvePoint,
    type GraphModel,
} from './model';
import { PRESETS } from './presets';
import {
    calloutAnchor,
    curveAreaPath,
    curveLinePath,
    effectiveCurveSwatchColor,
    pointPx,
    renderGraphSvg,
    segmentMidpoint,
    type GraphGeom,
} from './render';
import { getActiveStyle } from './styleState';
import { isDarkMode } from './theme';
import { makeCheck, makeElement } from './ui';

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

/**
 * Selection is stored as a curve INDEX, but list mutations (remove, reorder) shift indices. These
 * two pure helpers are the only place that arithmetic lives, so every mutation site stays a
 * one-liner and the fixup rules cannot drift apart.
 */

/** The index `sel` takes after the item at `removed` leaves the list (null when it was removed). */
function afterRemove(sel: number | null, removed: number): number | null {
    if (sel === null || sel === removed) return null;
    return sel > removed ? sel - 1 : sel;
}

/** The index `sel` takes after the item at `from` is re-inserted at `to` (splice semantics). */
function afterMove(sel: number | null, from: number, to: number): number | null {
    if (sel === null) return null;
    if (sel === from) return to;
    if (from < to && sel > from && sel <= to) return sel - 1;
    if (from > to && sel >= to && sel < from) return sel + 1;
    return sel;
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

    /**
     * The toolbar is data-driven. Each segment declares when it is visible; each control registers
     * a `sync` closure that refreshes its enabled/checked/value state. `updateToolbar` just runs
     * the registrations, so adding a control is a local change in `buildToolbar`.
     */
    const toolbarSegments: {
        element: HTMLElement;
        /** Divider rendered before this segment (null for the first); hides with it. */
        divider: HTMLElement | null;
        visible(): boolean;
    }[] = [];
    const toolbarSyncs: (() => void)[] = [];

    buildToolbar();

    canvasEl.addEventListener('pointerdown', onPointerDown);
    canvasEl.addEventListener('dblclick', onDoubleClick);

    function model(): GraphModel {
        return host.getModel();
    }

    /** The editor accent (selection rings, handles, "+" badges) follows the style's canvas accent. */
    function accent(): string {
        const canvas = getActiveStyle().canvas;
        return (isDarkMode() ? canvas.dark : canvas.light).eventLabel;
    }

    // --- Toolbar -------------------------------------------------------------

    function buildToolbar(): void {
        toolbarEl.textContent = '';
        // Three segments separated by visual dividers: generic (always), curve (selection only),
        // graph (always). Within the curve segment, controls that cannot apply to the current
        // curve/selection are disabled rather than hidden, so nothing shifts.
        const segment = (visible: () => boolean = () => true): HTMLElement => {
            let divider: HTMLElement | null = null;
            if (toolbarSegments.length > 0) {
                divider = makeElement('div', 'tool-divider');
                toolbarEl.appendChild(divider);
            }
            const element = makeElement('div', 'tool-segment');
            toolbarEl.appendChild(element);
            toolbarSegments.push({ element, divider, visible });
            return element;
        };
        const group = (parent: HTMLElement): HTMLElement => {
            const el = makeElement('div', 'tool-group');
            parent.appendChild(el);
            return el;
        };
        const button = (
            parent: HTMLElement,
            label: string,
            title: string,
            onClick: () => void,
            enabled: () => boolean = () => true
        ): void => {
            const b = makeElement('button', { label, title, onClick });
            b.type = 'button';
            parent.appendChild(b);
            toolbarSyncs.push(() => (b.disabled = !enabled()));
        };
        const check = (
            parent: HTMLElement,
            caption: string,
            get: () => boolean,
            set: (checked: boolean) => void,
            enabled: () => boolean = () => true
        ): void => {
            const { label, input } = makeCheck(caption, set);
            parent.appendChild(label);
            toolbarSyncs.push(() => {
                input.checked = get();
                input.disabled = !enabled();
            });
        };
        const range = (
            parent: HTMLElement,
            spec: {
                caption: string;
                title: string;
                min: number;
                max: number;
                step: string;
                get(): number;
                setLive(value: number): void;
                commit(): void;
                enabled(): boolean;
            }
        ): void => {
            const wrap = makeElement('label', 'tool-range');
            const span = makeElement('span');
            span.textContent = spec.caption;
            const input = document.createElement('input');
            input.type = 'range';
            input.min = String(spec.min);
            input.max = String(spec.max);
            input.step = spec.step;
            input.title = spec.title;
            input.addEventListener('input', () => spec.setLive(Number(input.value)));
            input.addEventListener('change', spec.commit);
            wrap.append(span, input);
            parent.appendChild(wrap);
            toolbarSyncs.push(() => {
                input.value = String(spec.get());
                input.disabled = !spec.enabled();
            });
        };

        /** The selected curve, or undefined when nothing (or something stale) is picked. */
        const selected = (): Curve | undefined =>
            selectedCurve === null ? undefined : model().curves[selectedCurve];

        const segGeneric = segment();
        const gHistory = group(segGeneric);
        button(
            gHistory,
            '↶',
            'Undo (Ctrl+Z)',
            () => host.undo(),
            () => host.canUndo()
        );
        button(
            gHistory,
            '↷',
            'Redo (Ctrl+Y)',
            () => host.redo(),
            () => host.canRedo()
        );

        // Preset picker: applying replaces the whole model. The selection is cleared BEFORE the
        // replace — replaceModel renders immediately, and stale selection state would paint
        // handles on the new model's first curve.
        const presetSelect = document.createElement('select');
        presetSelect.title = 'Apply a preset';
        presetSelect.append(
            makeElement('option', '', 'Preset…'),
            ...PRESETS.map((preset, index) => makeElement('option', String(index), preset.name))
        );
        presetSelect.addEventListener('change', () => {
            const value = presetSelect.value;
            if (value === '') return;
            selectedCurve = null;
            selectedPoint = null;
            host.replaceModel(cloneModel(PRESETS[Number(value)].data));
            presetSelect.value = '';
        });
        segGeneric.appendChild(presetSelect);

        const segCurve = segment(() => selected() !== undefined);
        const gCurves = group(segCurve);
        button(
            gCurves,
            '🗑',
            'Delete selected curve',
            () => {
                if (selectedCurve !== null && removeCurve(model(), selectedCurve)) {
                    selectedCurve = null;
                    selectedPoint = null;
                    host.onCommit();
                }
            },
            () => selected() !== undefined && canRemoveCurve(model())
        );

        const gStyle = group(segCurve);
        check(
            gStyle,
            'Smooth',
            () => selected()?.smooth ?? false,
            (checked) => {
                const curve = selected();
                if (curve !== undefined) {
                    curve.smooth = checked;
                    host.onCommit();
                }
            }
        );
        range(gStyle, {
            caption: 'Opacity',
            title: 'Selected curve opacity',
            min: MIN_OPACITY,
            max: MAX_OPACITY,
            step: '0.05',
            get: () => selected()?.opacity ?? DEFAULT_OPACITY,
            setLive: (value) => {
                const curve = selected();
                if (curve === undefined || selectedCurve === null) return;
                curve.opacity = clampOpacity(value);
                updateCurveOpacity(selectedCurve);
                host.onLive();
            },
            commit: () => host.onCommit(),
            enabled: () => selected() !== undefined,
        });

        const gOrder = group(segCurve);
        button(
            gOrder,
            '⟨',
            'Send curve backward',
            () => {
                if (selectedCurve !== null && moveCurve(model(), selectedCurve, -1)) {
                    // Follow the moved curve so the selection stays on it.
                    selectedCurve = afterMove(selectedCurve, selectedCurve, selectedCurve - 1);
                    host.onCommit();
                }
            },
            () => selectedCurve !== null && selectedCurve > 0
        );
        button(
            gOrder,
            '⟩',
            'Bring curve forward',
            () => {
                if (selectedCurve !== null && moveCurve(model(), selectedCurve, 1)) {
                    selectedCurve = afterMove(selectedCurve, selectedCurve, selectedCurve + 1);
                    host.onCommit();
                }
            },
            () => selectedCurve !== null && selectedCurve < model().curves.length - 1
        );

        const segGraph = segment();
        const gToggles = group(segGraph);
        check(
            gToggles,
            'Snap to phases',
            () => snapEnabled,
            (checked) => {
                snapEnabled = checked;
            }
        );
        check(
            gToggles,
            'Numeric axis',
            () => model().numericAxis,
            (checked) => {
                model().numericAxis = checked;
                host.onCommit();
            }
        );
    }

    function updateToolbar(): void {
        for (const segment of toolbarSegments) {
            const visible = segment.visible();
            segment.element.style.display = visible ? '' : 'none';
            // A hidden segment takes its leading divider with it, so the row never shows a
            // dangling separator when the curve segment is collapsed.
            if (segment.divider !== null) {
                segment.divider.style.display = visible ? '' : 'none';
            }
        }
        for (const sync of toolbarSyncs) sync();
    }

    // --- Render --------------------------------------------------------------

    function render(): void {
        const m = model();
        if (selectedCurve !== null && (selectedCurve < 0 || selectedCurve >= m.curves.length)) {
            selectedCurve = null;
            selectedPoint = null;
        }
        const dark = isDarkMode();
        const result = renderGraphSvg(m, { style: getActiveStyle(), dark, editing: true });
        svg = result.svg;
        geom = result.geom; // the editor reuses the layout the SVG was built with
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
                        'stroke-width': g.style.curveStrokeWidth + 3,
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
                            r: g.style.pointRadius,
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
                    overlay.appendChild(
                        addBadge(mid.x, mid.y, acc, {
                            class: 'insert-handle',
                            'data-insert-x': midX,
                            'data-insert-y': midY,
                            'data-curve-index': selectedCurve,
                        })
                    );
                }
            }
        } else {
            handlePoints = [];
        }

        // "+" at the end of the phase row: WYSIWYG add-phase (append; drag to reposition).
        if (canAddPhase(m)) {
            overlay.appendChild(
                addBadge(g.plotX1 + 28, g.phaseLabelY - 5, acc, {
                    class: 'phase-add',
                    'data-phase-add': 1,
                })
            );
        }

        svg.appendChild(overlay);
    }

    // --- Live updates during a drag -----------------------------------------

    function updateCurvePaths(
        index: number
    ): { fill: SVGPathElement; line: SVGPathElement; hit: SVGPathElement } | null {
        if (svg === null) return null;
        const group = svg.querySelector(`.curves g[data-curve-index="${index}"]`);
        if (group === null) return null;
        // Query by class, not by child order: live repaints must not break if render.ts ever
        // adds or reorders a path inside the curve group.
        const fill = group.querySelector<SVGPathElement>('.curve-fill');
        const line = group.querySelector<SVGPathElement>('.curve-line');
        const hit = group.querySelector<SVGPathElement>('.curve-hit');
        if (fill === null || line === null || hit === null) return null;
        return { fill, line, hit };
    }

    /** Repaint a curve's geometry after a live point drag. */
    function updateCurve(index: number): void {
        if (geom === null) return;
        const curve = model().curves[index];
        const paths = updateCurvePaths(index);
        if (curve === undefined || paths === null) return;
        paths.fill.setAttribute('d', curveAreaPath(curve, geom));
        paths.line.setAttribute('d', curveLinePath(curve, geom));
    }

    function updateCurveColor(index: number): void {
        const curve = model().curves[index];
        const paths = updateCurvePaths(index);
        if (curve === undefined || paths === null || geom === null) return;
        paths.fill.setAttribute('fill', curve.color);
        // A picked color is a custom SOLID fill; styles with an ink outline keep their
        // stroked top edge in ink regardless of the fill.
        if (geom.style.stroke.curveOutline === 0) {
            paths.line.setAttribute('stroke', curve.color);
        }
        // The invisible hit band is a wide stroke too — keep it transparent so the hover
        // highlight never paints through it.
        paths.hit.setAttribute('stroke', 'transparent');
    }

    function updateCurveOpacity(index: number): void {
        const curve = model().curves[index];
        const paths = updateCurvePaths(index);
        if (curve === undefined || paths === null) return;
        paths.fill.setAttribute('fill-opacity', String(curve.opacity));
    }

    function repositionHandles(): void {
        if (svg === null || geom === null) return;
        const g = geom;
        svg.querySelectorAll<SVGCircleElement>('circle.point-handle').forEach((circle) => {
            const index = Number(circle.getAttribute('data-handle-index'));
            const point = handlePoints[index];
            if (point === undefined) return;
            const p = pointPx(point, g);
            circle.setAttribute('cx', String(p.x));
            circle.setAttribute('cy', String(p.y));
        });
    }

    /**
     * Repaint one event after a live drag: move its gate line, leader tick, baseline diamond, and
     * callout text to the event's current x. The callout anchor is recomputed with the same
     * `calloutAnchor` rule the renderer uses, so the label hugs the gate near the plot edges
     * instead of drifting away from it.
     */
    function updateEvent(index: number): void {
        if (svg === null || geom === null) return;
        const g = geom;
        const event = model().events[index];
        if (event === undefined) return;
        const px = g.toPx(event.x, 0).x;
        const { anchor, textX } = calloutAnchor(
            px,
            g.plotX0,
            g.plotX1,
            g.style.layout.eventCalloutMaxWidth
        );
        const dm = 5;
        const byY = g.baselineY;
        const line = svg.querySelector(`[data-event-line="${index}"]`);
        if (line !== null) {
            line.setAttribute('x1', String(px));
            line.setAttribute('x2', String(px));
        }
        const leader = svg.querySelector(`[data-event-leader="${index}"]`);
        if (leader !== null) {
            leader.setAttribute('x1', String(px));
            leader.setAttribute('x2', String(px));
        }
        const diamond = svg.querySelector(`[data-event-diamond="${index}"]`);
        if (diamond !== null) {
            diamond.setAttribute(
                'points',
                `${px},${byY - dm} ${px + dm},${byY} ${px},${byY + dm} ${px - dm},${byY}`
            );
        }
        svg.querySelectorAll(
            `text[data-event-index="${index}"], text[data-event-note="${index}"]`
        ).forEach((el) => {
            el.setAttribute('x', String(textX));
            el.setAttribute('text-anchor', anchor);
        });
    }

    // --- Pointer handling ----------------------------------------------------

    function svgPointToModel(clientX: number, clientY: number): CurvePoint | null {
        if (svg === null || geom === null) return null;
        const rect = svg.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return null;
        const ux = (clientX - rect.left) * (geom.width / rect.width);
        const uy = (clientY - rect.top) * (geom.height / rect.height);
        return geom.fromPx(ux, uy);
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

        const eventRemove = target.closest('[data-event-remove]');
        if (eventRemove !== null) {
            const index = Number(eventRemove.getAttribute('data-event-remove'));
            if (removeEvent(model(), index)) host.onCommit();
            return;
        }

        // "+" at the end of the event band: append an event and open its label for typing so the
        // new event is named right where it was added (mirrors "+ Add curve").
        if (target.closest('[data-event-add]') !== null) {
            const added = addEvent(model());
            if (added !== null) {
                host.onCommit();
                const index = model().events.indexOf(added);
                const label = svg?.querySelector(`text[data-event-index="${index}"]`);
                if (label instanceof SVGElement) startInline(label);
            }
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

        const eventText = target.closest('text[data-event-index]');
        if (eventText !== null) {
            // Event labels are click-to-edit AND drag-to-reposition (snap to the nearest phase
            // boundary with Shift or the "Snap to phases" toggle).
            startEventInteraction(
                Number(eventText.getAttribute('data-event-index')),
                eventText as SVGElement,
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
                selectedCurve = afterRemove(selectedCurve, index);
                if (selectedCurve === null) selectedPoint = null;
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

        startGesture(event, {
            onMove: (state) => {
                const mapped = svgPointToModel(state.event.clientX, state.event.clientY);
                if (mapped === null) return;
                const x =
                    state.event.shiftKey || snapEnabled
                        ? nearestPhaseX(mapped.x, model().phases.length)
                        : mapped.x;
                setPoint(model(), curveIndex, point, clampCoord(x), clampCoord(mapped.y));
                updateCurve(curveIndex);
                repositionHandles();
                host.onLive();
            },
            onEnd: () => host.onCommit(),
        });
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

        startGesture(event, {
            onMove: (state) => {
                const mapped = svgPointToModel(state.event.clientX, state.event.clientY);
                if (mapped === null) return;
                const dx = Math.max(-minX, Math.min(100 - maxX, mapped.x - start.x));
                for (const s of snapshot) s.point.x = clampCoord(s.x0 + dx);
                curve.points.sort((a, b) => a.x - b.x);
                updateCurve(curveIndex);
                repositionHandles();
                host.onLive();
            },
            onEnd: () => host.onCommit(),
        });
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
        const currentSvg = svg;

        const toSvg = (clientX: number, clientY: number): { x: number; y: number } => {
            const rect = currentSvg.getBoundingClientRect();
            return {
                x: (clientX - rect.left) * (g.width / rect.width),
                y: (clientY - rect.top) * (g.height / rect.height),
            };
        };

        startGesture(event, {
            threshold: 6,
            onMove: (state) => {
                const p = toSvg(state.event.clientX, state.event.clientY);
                element.setAttribute('x', String(Math.min(g.plotX1, Math.max(g.plotX0, p.x))));
            },
            onEnd: (state) => {
                // Releasing without dragging edits the label text.
                if (!state.moved) {
                    startInline(element);
                    return;
                }
                // Reorder to the phase tick nearest the release point.
                const p = toSvg(state.event.clientX, state.event.clientY);
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
            },
        });
        // Without preventDefault the browser's default focus handling blurs the inline editor
        // a plain click opens (same fix as the other edit fields).
        event.preventDefault();
    }

    /**
     * Click-vs-drag on an event label: releasing without dragging opens the inline text editor;
     * dragging moves the event along the timeline (snapping to the nearest phase BOUNDARY while
     * Shift is held or "Snap to phases" is on) and commits on release. The ✕ revealed on hover
     * (see render.ts) is the single way to remove an event.
     */
    function startEventInteraction(index: number, element: SVGElement, event: PointerEvent): void {
        const target = model().events[index];
        if (target === undefined) return;

        startGesture(event, {
            threshold: 6,
            onMove: (state) => {
                if (!state.moved) return;
                const mapped = svgPointToModel(state.event.clientX, state.event.clientY);
                if (mapped === null) return;
                const x =
                    state.event.shiftKey || snapEnabled
                        ? nearestBoundaryX(mapped.x, model().phases.length)
                        : mapped.x;
                target.x = clampCoord(x);
                updateEvent(index);
                host.onLive();
            },
            onEnd: (state) => {
                // Releasing without dragging edits the label + note.
                if (!state.moved) {
                    startInline(element);
                    return;
                }
                // Commit the final position (re-sorts the event list).
                setEventX(model(), target, target.x);
                host.onCommit();
            },
        });
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

        // Opening any swatch closes a previously stuck-open picker (programmatic clicks don't
        // toggle); clicking the *same* swatch again just closes it rather than reopening.
        if (activePicker !== null) {
            const sameSwatch = activePicker.index === index;
            const stale = activePicker.input;
            activePicker = null;
            stale.remove();
            if (sameSwatch) return;
        }

        const canvasRect = canvasEl.getBoundingClientRect();
        const box = swatch.getBoundingClientRect();
        // Scale between the SVG's user units and its rendered size (the canvas can scroll/zoom).
        const scale = box.width / geom.style.layout.legendSwatch;
        const overlaySize = Math.max(48, 30 * scale);
        const input = document.createElement('input');
        input.type = 'color';
        input.className = 'inline-color';
        // Seed from the color the swatch actually SHOWS: palette styles override the stored
        // curve color, and picking should start from what the user sees, not from stale data.
        const seed = curve.colorCustom === true
            ? curve.color
            : effectiveCurveSwatchColor(geom.style, curve, index, geom.dark);
        input.value = /^#[0-9a-f]{6}$/i.test(seed) ? seed : '#000000';
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
            curve.colorCustom = true;
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
     * slots: `data-curve-drag` carries the model index, mapped to its DOM slot here and back
     * through `reorderCurve` on release. Slot geometry comes from the layout captured once at drag
     * start, so the decision is pure arithmetic on the pointer delta and never disagrees with the
     * preview. Rows can have different heights (wrapped notes): the dragged row follows the
     * pointer 1:1, and neighbours shift by the dragged row's own slot size — exactly how much
     * space the vacated slot needs. The drop target advances one slot per crossed boundary of the
     * *original* stack (cumulative distance, not round()), so intermediate positions are reachable
     * for any row count. Release reorders the model once.
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
        const tops = geom.legendRows.map((row) => row.top);
        // Preview shift for neighbours equals the dragged row's own slot size.
        const shiftPx = Math.max(1, geom.legendRows[index].height);

        const startY = event.clientY;
        let currentTarget = index;

        // Cumulative pointer distance against each crossed boundary of the original stack: to land
        // k slots away the dragged row must travel the summed pitch between those slots.
        const targetFor = (clientY: number): number => {
            const dy = clientY - startY;
            let t = index;
            if (dy > 0) {
                while (t < tops.length - 1 && dy >= tops[t + 1] - tops[index]) t += 1;
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

        const resetPreview = (): void => {
            dragged.style.transform = '';
            dragged.classList.remove('dragging');
            blocks.forEach((block) => {
                if (block !== dragged) block.style.transform = '';
            });
            currentSvg.classList.remove('legend-dragging');
        };

        startGesture(event, {
            threshold: 4,
            onMove: (state) => {
                dragged.style.transform = `translateY(${state.dy}px)`;
                dragged.classList.add('dragging');
                applyPreview(targetFor(state.event.clientY));
            },
            onEnd: (state) => {
                resetPreview();
                if (!state.moved) return;
                const targetSlot = targetFor(state.event.clientY);
                if (targetSlot === index) return;
                // Display slots run front-to-back; the model array runs back-to-front, so moving a
                // curve to display slot `targetSlot` is an insert-before in reversed coordinates.
                const n = blocks.length;
                const from = n - 1 - index;
                const to = n - 1 - targetSlot;
                if (reorderCurve(model(), from, to)) {
                    // Keep selection glued to the same curve after the splice.
                    selectedCurve = afterMove(selectedCurve, from, to);
                    host.onCommit();
                }
            },
        });
        event.preventDefault();
    }

    // --- Inline text editing -------------------------------------------------

    /** Resolve a `data-edit-field` element to its current text and a writer for new text. */
    function fieldBinding(
        element: SVGElement
    ): { value: string; multiline: boolean; write: (next: string) => void } | null {
        const field = element.getAttribute('data-edit-field');
        if (field === null) return null;
        const m = model();
        switch (field) {
            case 'title':
                return { value: m.title ?? '', multiline: false, write: (v) => (m.title = v) };
            case 'yaxis':
                return {
                    value: m.yAxisTitle ?? '',
                    multiline: false,
                    write: (v) => (m.yAxisTitle = v),
                };
            case 'phase': {
                const index = Number(element.getAttribute('data-phase-index'));
                const phase = m.phases[index];
                if (phase === undefined) return null;
                return { value: phase.label, multiline: false, write: (v) => (phase.label = v) };
            }
            case 'event': {
                const index = Number(element.getAttribute('data-event-index'));
                const event = m.events[index];
                if (event === undefined) return null;
                // One block for the whole callout: first line is the label, the rest are the note.
                return {
                    value: event.note === '' ? event.label : `${event.label}\n${event.note}`,
                    multiline: true,
                    write: (v) => {
                        const newline = v.indexOf('\n');
                        event.label = newline === -1 ? v : v.slice(0, newline);
                        event.note = newline === -1 ? '' : v.slice(newline + 1);
                    },
                };
            }
            case 'curve-label': {
                const index = Number(element.getAttribute('data-curve-index'));
                const curve = m.curves[index];
                if (curve === undefined) return null;
                return { value: curve.label, multiline: false, write: (v) => (curve.label = v) };
            }
            case 'legend-block': {
                const index = Number(element.getAttribute('data-curve-index'));
                const curve = m.curves[index];
                if (curve === undefined) return null;
                // One block for the whole legend row: first line is the label, the rest are notes.
                return {
                    value: curve.notes === '' ? curve.label : `${curve.label}\n${curve.notes}`,
                    multiline: true,
                    write: (v) => {
                        const newline = v.indexOf('\n');
                        curve.label = newline === -1 ? v : v.slice(0, newline);
                        curve.notes = newline === -1 ? '' : v.slice(newline + 1);
                    },
                };
            }
            default:
                return null;
        }
    }

    function startInline(element: SVGElement): void {
        const binding = fieldBinding(element);
        if (binding === null) return;
        openInlineInput(element, binding.value, binding.multiline, binding.write);
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
