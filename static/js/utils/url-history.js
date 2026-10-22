/**
 * Back and Forward as a cheap undo of the view. Pure (no DOM, no history),
 * so Node tests cover it; main.js does the pushing and the applying.
 *
 * The address bar already follows the view (main.js _syncUrlNow, after the
 * view has been quiet for a moment). Each settled change either starts a new
 * history entry (push) or rewrites the current one (replace):
 *
 * - A BURST is one entry: a slider drag, spinner clicks, typing, or an action
 *   that sets several things one after another. The first settled change of a
 *   burst pushes, the rest replace that entry. Two settled changes less than
 *   `mergeMs` apart belong to one burst, and so does a change that follows a
 *   sync forced by the maximum wait (the user is still dragging).
 * - The first view of a tab, and the first dataset opened from the welcome
 *   screen, replace: Back from the first configuration leaves the app, as
 *   before, not to an empty page of ours.
 * - A different dataset pushes at once (Back returns to the previous dataset
 *   with the view it had).
 * - Pan and zoom are not in the address, so they never reach here: nothing
 *   to push, and the entry is not rewritten either.
 */

import { collectTileIds } from './deeplink.js';

/** Settled changes closer than this are one action. */
export const MERGE_MS = 1200;
/** After Back or Forward, panels still settle (normalise their settings): that is no new action. */
export const LANDING_MS = 3000;

/**
 * Whether the next settled change starts a history entry.
 * @param {{mergeMs?: number}} [options]
 * @returns {{decide: Function, applied: Function}}
 */
export function createHistoryPolicy({ mergeMs = MERGE_MS, landingMs = LANDING_MS } = {}) {
    let seen = false;       // a first view was written
    let path = '';          // the dataset of the last written view
    let at = 0;             // when it was written
    let landedAt = -Infinity; // when a history entry was last applied
    let continuing = false; // that write was forced by the maximum wait: the burst goes on

    return {
        /**
         * @param {{now: number, path: string, capped?: boolean}} change
         *   path: the dataset of the new view ('' with none); capped: this
         *   write comes from the maximum wait, not from a quiet moment
         * @returns {'push'|'replace'}
         */
        decide({ now, path: next }) {
            if (!seen) return 'replace';
            if (now - landedAt < landingMs) return 'replace';
            if (!path || !next) return 'replace';
            if (continuing) return 'replace';
            if (next !== path) return 'push';
            return now - at < mergeMs ? 'replace' : 'push';
        },
        /** The view was written (either way): remember when, and whether the burst goes on. */
        written({ now, path: next, capped = false }) {
            // the first write only puts the opening view in the address: no action of the user's to merge with
            at = seen ? now : -Infinity;
            seen = true;
            path = next || '';
            continuing = !!capped;
        },
        /** The address already holds this view (nothing to write): it is the entry the next change starts from. */
        baseline({ path: next }) {
            if (seen) return;
            seen = true;
            path = next || '';
        },
        /** A history entry was applied (Back, Forward): the next change is a new action. */
        landed({ now, path: next }) {
            seen = true;
            path = next || '';
            at = now - mergeMs;
            landedAt = now;
            continuing = false;
        }
    };
}

/** JSON with the keys of every object sorted: equal values give equal text. */
export function stableStringify(value) {
    return JSON.stringify(value, (key, v) => {
        if (v && typeof v === 'object' && !Array.isArray(v)) {
            const sorted = {};
            for (const k of Object.keys(v).sort()) sorted[k] = v[k];
            return sorted;
        }
        return v;
    });
}

/**
 * A panel's settings as a step compares them: a point size or opacity that follows the plot
 * area (auto) is derived from the panel's size, not chosen, so it is not a difference.
 */
function comparable(config) {
    if (!config || typeof config !== 'object') return config || null;
    const out = { ...config };
    if (out.autoPointSize !== false) delete out.pointSize;
    if (out.autoPointOpacity !== false) delete out.pointOpacity;
    return out;
}

/**
 * What a move to another view changes, from two views in the form
 * SessionManager.captureView returns. Decides how much the app redraws:
 *
 * - `reload`: the dataset or the cells shown differ: open the view as a link does
 * - `layout`: the arrangement of the panels differs (a panel opened or closed,
 *   a split moved): the layout is rebuilt around the panels that are kept (`keep`:
 *   same settings, not redrawn)
 * - otherwise only `panels` (ids whose settings differ) are rebuilt in place,
 *   `controls` (ids whose control bar shows or hides) are toggled, and
 *   `constants` (focused gene, cell, species) are set; the rest is untouched
 *
 * @param {Object} from - the view on screen
 * @param {Object} to - the view of the history entry
 * @param {{samePath: boolean, sameSubset: boolean}} context
 */
export function diffViews(from, to, { samePath, sameSubset }) {
    if (!samePath || !sameSubset) return { kind: 'reload' };
    const a = (from && from.layout) || {};
    const b = (to && to.layout) || {};
    if (!to || !to.layout) return { kind: 'reload' };
    if (stableStringify(a.hierarchy || []) !== stableStringify(b.hierarchy || [])) {
        // the panels in both views with the same settings are kept as they are drawn
        const before = new Set(collectTileIds(a.hierarchy || []));
        const keep = collectTileIds(b.hierarchy || []).filter(id => before.has(id)
            && stableStringify(comparable((a.panelConfigs || {})[id])) === stableStringify(comparable((b.panelConfigs || {})[id])));
        return { kind: 'layout', keep };
    }
    const panels = [];
    const controls = [];
    const ids = new Set(collectTileIds(b.hierarchy || []));
    for (const id of ids) {
        const was = (a.panelConfigs || {})[id];
        const now = (b.panelConfigs || {})[id];
        if (stableStringify(comparable(was)) !== stableStringify(comparable(now))) panels.push(id);
        const shown = (b.controlState || {})[id];
        if (shown !== undefined && shown !== (a.controlState || {})[id]) controls.push(id);
    }
    return { kind: 'panels', panels, controls };
}

/** A layout node without the sizes a drag changes (a pane's share, a row's height) or a control bar. */
function withoutSizes(node) {
    if (!node || typeof node !== 'object') return node;
    const out = { ...node };
    delete out.height;
    delete out.controlsVisible;
    if (out.panes) out.panes = out.panes.map(() => ({}));
    if (out.children) out.children = out.children.map(withoutSizes);
    return out;
}

/** The nodes without the bottom chooser, which every layout has and no step changes. */
function arrangement(hierarchy) {
    return (hierarchy || []).filter(n => n && n.type !== 'selector').map(withoutSizes);
}

/** Nodes without the tile `id`; a split that loses one side is its other side. */
function withoutTile(nodes, id) {
    const out = [];
    for (const node of nodes) {
        if (node.type === 'tile') {
            if (node.id !== id) out.push(node);
        } else if (node.type === 'split') {
            const children = withoutTile(node.children || [], id);
            if (children.length === 1) out.push(children[0]);
            else out.push({ ...node, children });
        } else {
            out.push(node);
        }
    }
    return out;
}

/** The split holding the tile `id` as its second child beside a tile, or null. */
function paneBeside(nodes, id) {
    for (const node of nodes) {
        if (node.type !== 'split') continue;
        const [first, second] = node.children || [];
        if (second && second.type === 'tile' && second.id === id && first && first.type === 'tile') {
            return { sibling: first.id, direction: node.direction || 'horizontal' };
        }
        const inner = paneBeside(node.children || [], id);
        if (inner) return inner;
    }
    return null;
}

/**
 * The one move a layout step is, when it is one the app already animates:
 * `close` (a panel closed; its sibling takes the room), `open` (a panel made
 * in a new row, or in a pane split off beside a panel) or `resize` (only
 * pane shares and row heights differ). Null for anything else (several panels
 * at once, a panel moved), which is rebuilt.
 *
 * @param {Object} from - the view on screen
 * @param {Object} to - the view of the history entry
 * @returns {{op: 'close'|'resize', id?: string}|{op: 'open', id: string, where: 'row'}
 *     |{op: 'open', id: string, where: 'pane', sibling: string, direction: string}|null}
 */
export function layoutStep(from, to) {
    const a = from && from.layout && from.layout.hierarchy;
    const b = to && to.layout && to.layout.hierarchy;
    if (!a || !b) return null;
    const before = new Set(collectTileIds(a));
    const after = new Set(collectTileIds(b));
    const removed = [...before].filter(id => !after.has(id));
    const added = [...after].filter(id => !before.has(id));
    const now = stableStringify(arrangement(a));
    const next = arrangement(b);
    if (!removed.length && !added.length) {
        return now === stableStringify(next) ? { op: 'resize' } : null;
    }
    if (removed.length === 1 && !added.length) {
        return stableStringify(withoutTile(arrangement(a), removed[0])) === stableStringify(next)
            ? { op: 'close', id: removed[0] } : null;
    }
    if (added.length === 1 && !removed.length) {
        const id = added[0];
        if (stableStringify(withoutTile(next, id)) !== now) return null;
        const last = next[next.length - 1];
        if (last && last.type === 'tile' && last.id === id) return { op: 'open', id, where: 'row' };
        const beside = paneBeside(next, id);
        if (beside) return { op: 'open', id, where: 'pane', ...beside };
    }
    return null;
}
