/**
 * The Colors of a grouping in the Cell Grouping panel (operator decision 33): a section of a factor's Edit pop-over (a
 * palette and a color for each level) and a section of Settings (what the groups are colored by, their palette, their
 * own colors). What the colors are is decided in utils/grouping-colours.js; this builds the controls and the new
 * recipe fields. Every change is one undo step of the panel, made by the caller, and asks nothing of the server.
 */
import { listAvailableColormaps } from '../plot-utilities/colors.js';
import { isColourString } from '../../utils/uns-palette.js';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** A colour as the #rrggbb an `<input type=color>` holds; black for text the browser cannot read as a colour. */
export function toHex(color) {
    if (typeof color !== 'string' || typeof document === 'undefined') return '#000000';
    const probe = document.createElement('canvas').getContext('2d');
    if (!probe) return '#000000';
    probe.fillStyle = '#000000';
    probe.fillStyle = color;
    const out = String(probe.fillStyle);
    return /^#[0-9a-f]{6}$/i.test(out) ? out : '#000000';
}

/**
 * The palettes a factor offers: its default first, then the named ones that suit it (sequential maps for bins,
 * discrete palettes for categories).
 * @param {{binning?: Object}} p - the factor
 * @param {{colors?: Object}} info - the reply's partitioning of it
 * @param {string} kind - the card's kind: categorical, grouping or binned
 * @returns {{value: string, text: string}[]} `value` '' is the default of the factor, which is not stored
 */
function factorPalettes(p, info, kind) {
    const lists = listAvailableColormaps();
    if (kind === 'binned') {
        return [{ value: '', text: 'Viridis (default)' }, ...(lists['Continuous Palettes'] || []).filter((n) => n !== 'viridis').map((n) => ({ value: n, text: n }))];
    }
    const own = info && isObject(info.colors) && Object.keys(info.colors).length > 0;
    const head = own
        ? [{ value: '', text: kind === 'grouping' ? 'Grouping colors' : 'Dataset colors' }, { value: 'default', text: 'Default' }]
        : [{ value: '', text: 'Default' }];
    return [...head, ...(lists['Discrete Palettes'] || []).map((n) => ({ value: n, text: n }))];
}

/** The palettes a grouping offers for its own colors. */
function groupPalettes() {
    const lists = listAvailableColormaps();
    return [{ value: '', text: 'Default' }, ...(lists['Discrete Palettes'] || []).map((n) => ({ value: n, text: n }))];
}

/** `colors` with `patch` applied (a value of undefined or '' removes the field); the recipe's normaliser drops what is left empty. */
function patched(colors, patch) {
    const out = { ...(isObject(colors) ? colors : {}) };
    for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === '' || (isObject(v) && !Object.keys(v).length)) delete out[k]; else out[k] = v;
    }
    return Object.keys(out).length ? out : undefined;
}

/** A partitioning or recipe with its `colors` changed by `patch`, the field left out when nothing is set. */
function withColors(holder, patch) {
    const next = { ...holder };
    const colors = patched(holder.colors, patch);
    if (colors) next.colors = colors; else delete next.colors;
    return next;
}

/** `holder` with the colour of one id (a level, a group) set. */
export function withOverride(holder, id, css) {
    const was = holder.colors && isObject(holder.colors.overrides) ? holder.colors.overrides : {};
    return withColors(holder, { overrides: { ...was, [id]: css } });
}

/** `holder` with every override removed (and with `all`, the palette and `by` too). */
function withoutOverrides(holder, all = false) {
    return all ? withColors(holder, { palette: undefined, overrides: undefined, by: undefined }) : withColors(holder, { overrides: undefined });
}

/**
 * A recipe's `groupOverrides` (decision 38) with the color of the group of generated name `name` set (or, with no `css`,
 * removed); the entry keeps its other fields (a label), and an entry left with nothing but its name goes. Undefined when
 * none is left.
 */
export function withGroupColor(recipe, name, css) {
    const list = Array.isArray(recipe.groupOverrides) ? recipe.groupOverrides : [];
    const at = list.findIndex((o) => o.name === name);
    const entry = { ...(at >= 0 ? list[at] : { name }) };
    if (css) entry.color = css; else delete entry.color;
    const next = list.filter((_, i) => i !== at);
    if (Object.keys(entry).length > 1) next.splice(at >= 0 ? at : next.length, 0, entry);
    return next.length ? next : undefined;
}

/**
 * A recipe's `groupOverrides` with the label of the group of generated name `name` set (an empty label clears it); the entry
 * keeps its colour, and an entry left with nothing but its name goes. Undefined when none is left.
 */
export function withGroupLabel(recipe, name, label) {
    const list = Array.isArray(recipe.groupOverrides) ? recipe.groupOverrides : [];
    const at = list.findIndex((o) => o.name === name);
    const entry = { ...(at >= 0 ? list[at] : { name }) };
    if (label) entry.label = label; else delete entry.label;
    const next = list.filter((_, i) => i !== at);
    if (Object.keys(entry).length > 1) next.splice(at >= 0 ? at : next.length, 0, entry);
    return next.length ? next : undefined;
}

/** A recipe's `groupOverrides` without the entry of generated name `name` (Reset, Drop); undefined when none is left. */
export function withoutGroupOverride(recipe, name) {
    const next = (Array.isArray(recipe.groupOverrides) ? recipe.groupOverrides : []).filter((o) => o.name !== name);
    return next.length ? next : undefined;
}

/** A recipe's `groupOverrides` without the entries no current group (`generated` names) matches; undefined when none is left. */
export function withoutInactiveOverrides(recipe, generated) {
    const names = new Set(generated);
    const next = (Array.isArray(recipe.groupOverrides) ? recipe.groupOverrides : []).filter((o) => names.has(o.name));
    return next.length ? next : undefined;
}

/** A recipe's `groupOverrides` with every group's color removed, its labels kept; undefined when none is left. */
function withoutGroupColors(recipe) {
    const list = (Array.isArray(recipe.groupOverrides) ? recipe.groupOverrides : []).map((o) => {
        const out = { ...o };
        delete out.color;
        return out;
    }).filter((o) => Object.keys(o).length > 1);
    return list.length ? list : undefined;
}

/** A recipe's `groupOverrides` with every group's label removed, its colors kept; an entry left with neither goes. Undefined when none is left. */
// export-unused-ok: unit-tested helper of this module's own buttons
export function withoutGroupLabels(recipe) {
    const list = (Array.isArray(recipe.groupOverrides) ? recipe.groupOverrides : []).map((o) => {
        const out = { ...o };
        delete out.label;
        return out;
    }).filter((o) => Object.keys(o).length > 1);
    return list.length ? list : undefined;
}

/** How many groups the user has named by hand, active or not. */
// export-unused-ok: unit-tested helper of this module's own buttons
export const groupLabelCount = (recipe) => (Array.isArray(recipe.groupOverrides) ? recipe.groupOverrides.filter((o) => typeof o.label === 'string' && o.label !== '').length : 0);

/** A factor without the names given to its levels (a copy; its colors and levels stay). */
// export-unused-ok: unit-tested helper of this module's own buttons
export function withoutLevelLabels(p) {
    const out = { ...p };
    delete out.labels;
    return out;
}

/** How many groups' colors the user has set by hand, active or not. */
const groupColorCount = (recipe) => (Array.isArray(recipe.groupOverrides) ? recipe.groupOverrides.filter((o) => isColourString(o.color)).length : 0);

let paletteSerial = 0;

function selectOf(el, className, label, options, value) {
    const select = el('select', { class: `form-select form-select-sm ${className}`, aria: { label } });
    for (const o of options) select.appendChild(el('option', { value: o.value, text: o.text }));
    select.value = options.some((o) => o.value === value) ? value : '';
    return select;
}

/**
 * The Colors section of a factor's Edit pop-over: its palette and a reset. The color of each level is a swatch on its row
 * (`levelSwatch`).
 * @param {{D: Object, p: Object, info: Object, kind: string, commit: (next: Object, label: string) => void, name: string}} opts
 *   `commit` takes the factor's new partitioning and the undo label
 */
export function factorColorsSection({ D, p, info, kind, commit, name }) {
    const { el } = D;
    const palette = selectOf(el, 'cgrp-palette', `Palette of ${name}`, factorPalettes(p, info, kind), (p.colors && p.colors.palette) || '');
    palette.id = `cgrp-palette-${++paletteSerial}`;
    palette.addEventListener('change', () => commit(withColors(p, { palette: palette.value }), `palette ${palette.value || 'default'} for ${name}`));
    const reset = el('button', { type: 'button', class: 'btn btn-sm btn-link az-pop-reset cgrp-colors-reset', disabled: !p.colors,
        on: { click: () => commit(withoutOverrides(p, true), `reset colors of ${name}`) } }, 'Reset colors');
    const labelled = p.labels && Object.keys(p.labels).length;
    const resetNames = el('button', { type: 'button', class: 'btn btn-sm btn-link az-pop-reset cgrp-names-reset', disabled: !labelled,
        title: 'Back to the generated names of the levels; their colors stay',
        on: { click: () => commit(withoutLevelLabels(p), `reset level names of ${name}`) } }, 'Reset names');
    return el('details', { class: 'az-pop-section cgrp-colors', open: true },
        el('summary', { class: 'az-pop-section__title', text: 'Colors' }),
        el('div', { class: 'az-pop-section__body' },
            el('div', { class: 'az-pop-field' }, el('label', { class: 'az-pop-field__label', for: palette.id, text: 'Palette' }),
                el('span', { class: 'az-pop-field__control' }, palette)),
            el('div', { class: 'az-pop-section__foot' }, reset, resetNames)));
}

/**
 * The swatch of a level's row: a native color picker showing the level's color; choosing one is the level's own color.
 * @param {{D: Object, id: string, label: string, colour: string, pick: (css: string) => void}} opts
 */
export function levelSwatch({ D, id, label, colour, pick }) {
    const input = D.el('input', { type: 'color', class: 'cgrp-level-color', value: toHex(colour), data: { id },
        title: `Set the color of ${label}`, aria: { label: `Color of ${label}` } });
    input.addEventListener('change', () => pick(input.value));
    return input;
}

/**
 * The Colors section of Settings: what the groups are colored by (several factors), their palette, and the reset of
 * the colors set by hand. Shown for a grouping of two factors or more; a grouping of one has its factor's colors.
 * @param {{D: Object, id: string, recipe: () => Object, names: () => string[], set: (patch: Object, label: string) => void}} opts
 *   `set` takes `{colors}` or `{groupOverrides}` for the recipe (undefined when nothing is left)
 * @returns {{element: HTMLElement, paint: () => void}}
 */
export function groupColorsSection({ D, id, recipe, names, set }) {
    const { el } = D;
    const by = el('select', { class: 'form-select form-select-sm cgrp-color-by', id: `cgrp-colorby-${id}`, aria: { label: 'Color groups by' } });
    const palette = el('select', { class: 'form-select form-select-sm cgrp-group-palette', id: `cgrp-grouppal-${id}`, aria: { label: 'Palette of the groups' } });
    for (const o of groupPalettes()) palette.appendChild(el('option', { value: o.value, text: o.text }));
    const reset = el('button', { type: 'button', class: 'btn btn-sm btn-link az-pop-reset cgrp-group-reset' });
    const resetNames = el('button', { type: 'button', class: 'btn btn-sm btn-link az-pop-reset cgrp-group-names-reset',
        title: 'Back to the generated names of the groups; their colors stay' });
    const fieldOf = (label, control) => el('div', { class: 'az-pop-field' },
        el('label', { class: 'az-pop-field__label', for: control.id, text: label }), el('span', { class: 'az-pop-field__control' }, control));
    const byLine = fieldOf('Color groups by', by);
    const paletteLine = fieldOf('Palette', palette);
    const element = el('details', { class: 'az-pop-section cgrp-settings__colors', open: true },
        el('summary', { class: 'az-pop-section__title', text: 'Colors' }),
        el('div', { class: 'az-pop-section__body' }, byLine, paletteLine, el('div', { class: 'az-pop-section__foot' }, reset, resetNames)));
    const change = (patch, label) => set({ colors: patched(recipe().colors, patch) }, label);
    by.addEventListener('change', () => change({ by: by.value === 'own' ? undefined : Number(by.value) },
        by.value === 'own' ? 'color groups by their own palette' : `color groups by ${by.selectedOptions[0].textContent}`));
    palette.addEventListener('change', () => change({ palette: palette.value }, `group palette ${palette.value || 'default'}`));
    reset.addEventListener('click', () => set({ groupOverrides: withoutGroupColors(recipe()) }, 'reset group colors'));

    resetNames.addEventListener('click', () => set({ groupOverrides: withoutGroupLabels(recipe()) }, 'reset group names'));

    function paint() {
        const r = recipe();
        const factors = names();
        element.hidden = false;
        byLine.hidden = paletteLine.hidden = factors.length < 2;
        if (document.activeElement !== by) {
            by.textContent = '';
            by.appendChild(el('option', { value: 'own', text: 'Own palette' }));
            factors.forEach((n, i) => by.appendChild(el('option', { value: String(i), text: n })));
            const k = r.colors && Number.isInteger(r.colors.by) && r.colors.by < factors.length ? String(r.colors.by) : 'own';
            by.value = k;
        }
        palette.value = (r.colors && r.colors.palette) || '';
        palette.disabled = by.value !== 'own';
        const n = groupColorCount(r);
        reset.textContent = `Reset group colors (${n})`;
        reset.disabled = n === 0;
        const named = groupLabelCount(r);
        resetNames.textContent = `Reset group names (${named})`;
        resetNames.disabled = named === 0;
    }

    return { element, paint };
}
