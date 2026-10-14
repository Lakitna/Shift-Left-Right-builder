/**
 * The preset models shipped with the builder. This module is static DATA only — the type
 * contract, validation, and mutation helpers live in `model.ts`. Adding a preset means appending
 * an entry here without touching any logic. `data` is shared and immutable by convention: the
 * editor mutates models in place, so every application must go through `cloneModel()`.
 */

import { MODEL_VERSION, PALETTE, type GraphModel } from './model';

/** A named, complete model applied in one step. */
export interface GraphPreset {
    name: string;
    data: GraphModel;
}

export const PRESETS: GraphPreset[] = [
    {
        name: 'Schematic',
        data: {
            version: MODEL_VERSION,
            title: 'Shift-Left / Shift-Right',
            yAxisTitle: 'Test volume',
            numericAxis: false,
            phases: [
                { label: 'Pre-merge' },
                { label: 'Post-merge' },
                { label: 'Pre-release' },
                { label: 'Post-deploy' },
            ],
            curves: [
                {
                    label: 'Shift-left',
                    color: PALETTE[0],
                    notes: 'Quality moved earlier: unit, component and integration tests, code review and static checks before merge.',
                    smooth: true,
                    opacity: 0.5,
                    points: [
                        { x: 0, y: 6 },
                        { x: 12, y: 34 },
                        { x: 22, y: 80 },
                        { x: 34, y: 52 },
                        { x: 50, y: 20 },
                        { x: 70, y: 5 },
                        { x: 100, y: 0 },
                    ],
                },
                {
                    label: 'Traditional quality model',
                    color: PALETTE[1],
                    notes: 'A hardening phase concentrated just before release: system, regression and acceptance testing.',
                    smooth: true,
                    opacity: 0.5,
                    points: [
                        { x: 18, y: 0 },
                        { x: 38, y: 28 },
                        { x: 56, y: 86 },
                        { x: 70, y: 60 },
                        { x: 82, y: 22 },
                        { x: 100, y: 0 },
                    ],
                },
                {
                    label: 'Shift-right',
                    color: PALETTE[2],
                    notes: 'Quality in production: monitoring, canary releases, feature flags, real-user feedback and fast rollback.',
                    smooth: true,
                    opacity: 0.5,
                    points: [
                        { x: 40, y: 0 },
                        { x: 62, y: 10 },
                        { x: 80, y: 52 },
                        { x: 90, y: 74 },
                        { x: 100, y: 24 },
                    ],
                },
            ],
        },
    },
    {
        name: 'Detailed',
        data: {
            version: MODEL_VERSION,
            title: 'Shift-Left / Shift-Right (detailed)',
            yAxisTitle: 'Testing & quality effort',
            numericAxis: true,
            phases: [
                { label: 'Plan' },
                { label: 'Code' },
                { label: 'Build' },
                { label: 'Test' },
                { label: 'Release' },
                { label: 'Operate' },
            ],
            curves: [
                {
                    label: 'Shift-left',
                    color: PALETTE[0],
                    notes: 'Effort front-loaded: threat modeling and unit/component tests peak during Plan and Code, tapering after Test.',
                    smooth: true,
                    opacity: 0.45,
                    points: [
                        { x: 8, y: 95 },
                        { x: 25, y: 78 },
                        { x: 42, y: 52 },
                        { x: 58, y: 28 },
                        { x: 75, y: 10 },
                        { x: 92, y: 0 },
                    ],
                },
                {
                    label: 'Traditional quality model',
                    color: PALETTE[1],
                    notes: 'A dedicated Test gate dominates the middle of the cycle, with hardening carried into Release.',
                    smooth: true,
                    opacity: 0.45,
                    points: [
                        { x: 8, y: 15 },
                        { x: 25, y: 35 },
                        { x: 42, y: 60 },
                        { x: 58, y: 88 },
                        { x: 75, y: 45 },
                        { x: 92, y: 12 },
                    ],
                },
                {
                    label: 'Shift-right',
                    color: PALETTE[2],
                    notes: 'Effort grows after Release: observability, canary analysis and feedback loops keep quality work running in production.',
                    smooth: true,
                    opacity: 0.45,
                    points: [
                        { x: 8, y: 0 },
                        { x: 25, y: 6 },
                        { x: 42, y: 16 },
                        { x: 58, y: 34 },
                        { x: 75, y: 66 },
                        { x: 92, y: 92 },
                    ],
                },
            ],
        },
    },
    {
        name: 'Empty',
        data: {
            version: MODEL_VERSION,
            title: '',
            yAxisTitle: 'Test volume',
            numericAxis: false,
            phases: [{ label: 'Phase 1' }, { label: 'Phase 2' }],
            curves: [
                {
                    label: '',
                    color: PALETTE[0],
                    notes: '',
                    smooth: true,
                    opacity: 0.5,
                    points: [
                        { x: 0, y: 0 },
                        { x: 100, y: 0 },
                    ],
                },
            ],
        },
    },
];
