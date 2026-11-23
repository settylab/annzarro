/**
 * The Cell-Gene Plot's clicks (0.8.0 step X7; CXG-15: "Clicking a gene focuses it. Clicking a group label offers Open
 * grouping.").
 *
 * - A dot or a heatmap cell of a gene row (Plotly's plotly_click on the matrix's own axes), or a gene's tick label,
 *   focuses that gene the way every panel does (the panel's `focus`, DataManager's focused gene, which the cell plots
 *   and the count plot follow). A one-row section's row, and a section with no gene in the dataset, is no gene: a click
 *   on it does nothing.
 * - A group's tick label offers Open grouping (GRP-17) in a small menu under the label, when the groups are a Cell
 *   Grouping's. With an obs column as the groups there is nothing to open, so nothing is offered.
 * - The focused gene's labels on the gene axis are drawn bold, again after each Plotly draw (a zoom redraws the ticks).
 *
 * Plotly's drag layers lie over the tick labels, so a label is found by where the click is: the main axes' tick groups
 * (`g.xtick`, `g.ytick`; a band's axes are `x90`… and never match) carry the tick's value as Plotly's datum. A label
 * thinned away at a narrow width is not drawn and cannot be clicked; the hover still names it.
 *
 * Cost: the drawing's rows are indexed once per drawing (a WeakMap on the model); a click looks up one row, and marking
 * walks the tick labels drawn, which the pixels bound, never the genes.
 */
import { VOCABULARY } from '../../utils/vocabulary.js';
import { rowCoordinates } from './draw-annotations.js';

/** The matrix's own axes; every band and legend is on an axis of its own. */
const MAIN_X = 'x';
const MAIN_Y = 'y';
/** A click this close to a label's box, in px, is on the label. */
const TICK_SLOP = 2;
const OPEN_GROUPING = `Open ${VOCABULARY.word.grouping}`;

/** model -> { rowAt: Map(axis position -> row), genes: (gene name | null)[] per row, positions: Map(gene -> Set) } */
const indexes = new WeakMap();

function indexOf(model) {
    let ix = indexes.get(model);
    if (ix) return ix;
    const { pos } = rowCoordinates(model.rows);
    const rowAt = new Map();
    const genes = new Array(pos.length).fill(null);
    const positions = new Map();
    for (let r = 0; r < pos.length; r++) {
        rowAt.set(pos[r], r);
        const row = model.rows[r];
        if (row.kind !== 'gene') continue;
        const name = row.label;
        genes[r] = name;
        if (!positions.has(name)) positions.set(name, new Set());
        positions.get(name).add(pos[r]);
    }
    ix = { rowAt, genes, positions };
    indexes.set(model, ix);
    return ix;
}

/** The gene of the row at a position of the gene axis, as a target; null for a one-row section, a gap or off the axis. */
function geneAt(model, at) {
    const ix = indexOf(model);
    const r = ix.rowAt.get(at);
    const gene = r === undefined ? null : ix.genes[r];
    return gene === null ? null : { gene };
}

/**
 * What a click on a point of the plot means: `{gene}` for a dot or a cell of a gene row, else null.
 * @param {{x: number, y: number, data?: {xaxis?: string, yaxis?: string}}|null} point - a Plotly click's point
 * @param {object|null} model - the drawing's model (draw.js), its rows carrying `kind`
 */
function targetOfPoint(point, model) {
    if (!point || !model) return null;
    const data = point.data || {};
    if ((data.xaxis && data.xaxis !== MAIN_X) || (data.yaxis && data.yaxis !== MAIN_Y)) return null;
    return geneAt(model, model.swap ? point.y : point.x);
}

/**
 * What a click on a tick label means: `{gene}` on the gene axis; `{group, label, grouping}` on the group axis when the
 * groups are the Cell Grouping `grouping`'s; else null.
 * @param {'x'|'y'} dim - the main axis the label is on
 * @param {number} value - the tick's value
 * @param {object|null} model
 * @param {string|null} grouping - the id of the Cell Grouping the groups are of, or null (an obs column)
 */
function targetOfTick(dim, value, model, grouping) {
    if (!model) return null;
    if (dim === (model.swap ? MAIN_Y : MAIN_X)) return geneAt(model, value);
    if (!grouping || !Number.isInteger(value) || !model.groups[value]) return null;
    return { group: value, label: model.groups[value].label, grouping };
}

/** The positions on the gene axis of a gene's rows (a gene may be in several sections). */
function focusedPositions(model, gene) {
    if (!model || gene === null || gene === undefined) return new Set();
    return indexOf(model).positions.get(gene) || new Set();
}

/**
 * Install the clicks on a drawn plot.
 * @param {HTMLElement} area - the positioned element around the plot; the offer opens in it
 * @param {object} ctx
 * @param {object} ctx.D - makeDom's helpers
 * @param {HTMLElement} ctx.plot - Plotly's graph div
 * @param {() => object|null} ctx.drawn - the model of the drawing shown, or null
 * @param {() => string|null} ctx.grouping - the Cell Grouping the groups are of, or null
 * @param {(id: string) => void} ctx.open - Open grouping: shows the grouping's panel
 * @param {(gene: string) => void} ctx.focus - focuses a gene
 * @param {() => string|null} ctx.focused - the focused gene
 * @returns {{update(): void, destroy(): void}}
 */
function mount(area, ctx) {
    const { plot, D } = ctx;
    let model = null;
    let offered = null;

    const heading = D.el('div', { class: 'cgene-add-heading' });
    const item = D.el('button', { type: 'button', role: 'menuitem', class: 'cgene-add-item', on: { click: openOffered } }, OPEN_GROUPING);
    const menu = D.el('div', { class: 'cgene-add-menu cgene-group-menu', role: 'menu', hidden: true,
        on: { keydown: (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } } } }, heading, item);
    area.appendChild(menu);

    function close() {
        offered = null;
        menu.hidden = true;
    }

    function openOffered() {
        const target = offered;
        close();
        if (target) ctx.open(target.grouping);
    }

    /** The offer under the label's box. A second click on the same label (Plotly repeats a click) keeps it open. */
    function offer(target, box) {
        offered = target;
        heading.textContent = target.label;
        menu.setAttribute('aria-label', target.label);
        const frame = area.getBoundingClientRect();
        menu.style.top = `${Math.round(box.bottom - frame.top + TICK_SLOP)}px`;
        menu.style.left = `${Math.max(0, Math.round(box.left - frame.left))}px`;
        menu.hidden = false;
        const room = area.clientWidth - menu.offsetWidth;
        if (room >= 0 && menu.offsetLeft > room) menu.style.left = `${room}px`;
        item.focus();
    }

    /** The tick label of a main axis under a point of the page: its axis, value and box. */
    function tickAt(x, y) {
        for (const dim of [MAIN_X, MAIN_Y]) {
            for (const g of plot.querySelectorAll(`g.${dim}tick`)) {
                const box = g.getBoundingClientRect();
                if (x < box.left - TICK_SLOP || x > box.right + TICK_SLOP || y < box.top - TICK_SLOP || y > box.bottom + TICK_SLOP) continue;
                const datum = g.__data__;
                if (datum && typeof datum.x === 'number') return { dim, value: datum.x, box };
            }
        }
        return null;
    }

    function onClick(e) {
        const drawn = ctx.drawn();
        if (!drawn) return;
        const hit = tickAt(e.clientX, e.clientY);
        const target = hit ? targetOfTick(hit.dim, hit.value, drawn, ctx.grouping()) : null;
        if (!target) return;
        e.__azCellGeneLabel = true;
        if (target.gene !== undefined) {
            close();
            ctx.focus(target.gene);
        } else {
            offer(target, hit.box);
        }
    }

    function onPoint(event) {
        const target = targetOfPoint(event && event.points ? event.points[0] : null, ctx.drawn());
        if (target) ctx.focus(target.gene);
    }

    function onDocumentClick(e) {
        if (menu.hidden || e.__azCellGeneLabel || menu.contains(e.target)) return;
        close();
    }

    /** Bold the focused gene's labels: the tick labels drawn, a few tens however many genes. */
    function mark() {
        const drawn = ctx.drawn();
        if (!drawn) return;
        const at = focusedPositions(drawn, ctx.focused());
        for (const g of plot.querySelectorAll(`g.${drawn.swap ? MAIN_Y : MAIN_X}tick`)) {
            const text = g.querySelector('text');
            if (text) text.style.fontWeight = g.__data__ && at.has(g.__data__.x) ? 'bold' : '';
        }
    }

    function detachPlotly() {
        if (typeof plot.removeListener !== 'function') return;
        plot.removeListener('plotly_click', onPoint);
        plot.removeListener('plotly_afterplot', mark);
    }

    plot.addEventListener('click', onClick);
    document.addEventListener('click', onDocumentClick);
    document.addEventListener('focusedGeneChanged', mark);

    return {
        /** A paint: a new drawing gets the Plotly listeners (a purge drops them) and its mark; the same drawing, nothing. */
        update() {
            const drawn = ctx.drawn();
            if (drawn === model) return;
            model = drawn;
            close();
            if (!drawn || typeof plot.on !== 'function') return;
            detachPlotly();
            plot.on('plotly_click', onPoint);
            plot.on('plotly_afterplot', mark);
            mark();
        },
        destroy() {
            detachPlotly();
            plot.removeEventListener('click', onClick);
            document.removeEventListener('click', onDocumentClick);
            document.removeEventListener('focusedGeneChanged', mark);
            menu.remove();
            model = null;
        }
    };
}

/** The clicks part of the panel (panels/cell-gene.js PARTS.clicks); the mapping is held apart, for its tests. */
export const CLICKS_PART = Object.freeze({ mount, targetOfPoint, targetOfTick, focusedPositions });
