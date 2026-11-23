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
export function factorPalettes(p, info, kind) {
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
export function groupPalettes() {
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
export function withColors(holder, patch) {
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
export function withoutOverrides(holder, all = false) {
    return all ? withColors(holder, { palette: undefined, overrides: undefined, by: undefined }) : withColors(holder, { overrides: undefined });
}

/** How many colors the user has set by hand on `holder`. */
export const overrideCount = (holder) => (holder.colors && isObject(holder.colors.overrides)
    ? Object.values(holder.colors.overrides).filter(isColourString).length : 0);

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
    palette.addEventListener('change', () => commit(withColors(p, { palette: palette.value }), `palette ${palette.value || 'default'} for ${name}`));
    const reset = el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary cgrp-colors-reset', disabled: !p.colors,
        on: { click: () => commit(withoutOverrides(p, true), `reset colors of ${name}`) } }, 'Reset colors');
    return el('div', { class: 'cgrp-colors', role: 'group', aria: { label: 'Colors' } },
        el('div', { class: 'cgrp-colors__head', text: 'Colors' }),
        el('div', { class: 'cgrp-colors__line' }, el('label', { text: 'Palette ' }, palette), reset));
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
 *   `set` takes `{colors}` for the recipe (undefined when nothing is left)
 * @returns {{element: HTMLElement, paint: () => void}}
 */
export function groupColorsSection({ D, id, recipe, names, set }) {
    const { el } = D;
    const by = el('select', { class: 'form-select form-select-sm cgrp-color-by', id: `cgrp-colorby-${id}`, aria: { label: 'Color groups by' } });
    const palette = el('select', { class: 'form-select form-select-sm cgrp-group-palette', id: `cgrp-grouppal-${id}`, aria: { label: 'Palette of the groups' } });
    for (const o of groupPalettes()) palette.appendChild(el('option', { value: o.value, text: o.text }));
    const reset = el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary cgrp-group-reset' });
    const byLine = el('div', { class: 'cgrp-settings__line' }, el('label', { for: `cgrp-colorby-${id}`, text: 'Color groups by ' }), by);
    const paletteLine = el('div', { class: 'cgrp-settings__line' }, el('label', { for: `cgrp-grouppal-${id}`, text: 'Palette ' }), palette);
    const element = el('div', { class: 'cgrp-settings__colors', role: 'group', aria: { label: 'Colors' } },
        el('div', { class: 'cgrp-colors__head', text: 'Colors' }), byLine, paletteLine, el('div', { class: 'cgrp-settings__line' }, reset));
    const change = (patch, label) => set({ colors: patched(recipe().colors, patch) }, label);
    by.addEventListener('change', () => change({ by: by.value === 'own' ? undefined : Number(by.value) },
        by.value === 'own' ? 'color groups by their own palette' : `color groups by ${by.selectedOptions[0].textContent}`));
    palette.addEventListener('change', () => change({ palette: palette.value }, `group palette ${palette.value || 'default'}`));
    reset.addEventListener('click', () => set({ colors: withoutOverrides(recipe()).colors }, 'reset group colors'));

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
        const n = overrideCount(r);
        reset.textContent = `Reset group colors (${n})`;
        reset.disabled = n === 0;
    }

    return { element, paint };
}
