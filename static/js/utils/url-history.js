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
/** Changes of one control, or of one action settling, closer than this are one gesture. */
export const GESTURE_MS = 3000;

/**
 * Whether the next settled change starts a history entry.
 *
 * A change carries the key of the action that made it (main.js): one key per
 * control that takes repeated input (a slider, a number box, a text field) and
 * a new key for every discrete action (a click on a button, closing a panel,
 * the end of a split drag, a focused cell or gene). Changes with the same
 * key, less than `gestureMs` apart, are one gesture and share an entry; a
 * change with another key is another action and starts its own, however
 * soon it follows. A change with no key (nothing the user did) shares the
 * entry written less than `mergeMs` before.
 * @param {{mergeMs?: number, gestureMs?: number, landingMs?: number}} [options]
 * @returns {{decide: Function, written: Function, baseline: Function, landed: Function}}
 */
export function createHistoryPolicy({ mergeMs = MERGE_MS, gestureMs = GESTURE_MS, landingMs = LANDING_MS } = {}) {
    let seen = false;       // a first view was written
    let path = '';          // the dataset of the last written view
    let at = 0;             // when it was written
    let lastKey = null;     // the action that wrote it
    let landedAt = -Infinity; // when a history entry was last applied
    let continuing = false; // that write was forced by the maximum wait: the burst goes on

    return {
        /**
         * @param {{now: number, path: string, key?: *, acted?: boolean}} change
         *   path: the dataset of the new view ('' with none); key: the action
         *   that made it (null: none the user took); acted: the user acted
         *   since the last Back or Forward
         * @returns {'push'|'replace'}
         */
        decide({ now, path: next, key = null, acted = false }) {
            if (!seen) return 'replace';
            // panels settling after a Back or Forward are no new action
            if (now - landedAt < landingMs && !(acted && key !== null)) return 'replace';
            if (!path || !next) return 'replace';
            if (next !== path) return 'push';
            if (key !== null) {
                return key === lastKey && (continuing || now - at < gestureMs) ? 'replace' : 'push';
            }
            if (continuing) return 'replace';
            return now - at < mergeMs ? 'replace' : 'push';
        },
        /** The view was written (either way): remember when, by which action, and whether the burst goes on. */
        written({ now, path: next, key = null, capped = false }) {
            // the first write only puts the opening view in the address: no action of the user's to merge with
            at = seen ? now : -Infinity;
            seen = true;
            path = next || '';
            lastKey = key;
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
            at = -Infinity;
            lastKey = null;
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
    // where the plot is zoomed or turned is its own kind of change (viewOf): drawn by a relayout
    delete out.viewport2D;
    delete out.viewport3D;
    if (out.autoPointSize !== false) delete out.pointSize;
    if (out.autoPointOpacity !== false) delete out.pointOpacity;
    return out;
}

/**
 * The zoom or camera of a panel's saved settings, as a step compares it: ranges and camera only
 * (the fields they were made on are the panel's settings). Null when the plot is fitted.
 */
export function viewOf(config) {
  if (!config || typeof config !== 'object') return null;
  if (config.z) {
    const v = config.viewport3D;
    return v && v.eye ? { camera: { eye: v.eye, up: v.up, center: v.center } } : null;
  }
  const v = config.viewport2D;
  return v && (v.xrange || v.yrange) ? { x: v.xrange || null, y: v.yrange || null } : null;
}

/** Whether two panel settings put the plot at different zooms or camera positions. */
export function viewDiffers(a, b) {
  return stableStringify(viewOf(a)) !== stableStringify(viewOf(b));
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
    const views = [];
    const controls = [];
    const ids = new Set(collectTileIds(b.hierarchy || []));
    for (const id of ids) {
        const was = (a.panelConfigs || {})[id];
        const now = (b.panelConfigs || {})[id];
        if (stableStringify(comparable(was)) !== stableStringify(comparable(now))) panels.push(id);
        else if (viewDiffers(was, now)) views.push(id);
        const shown = (b.controlState || {})[id];
        if (shown !== undefined && shown !== (a.controlState || {})[id]) controls.push(id);
    }
    return { kind: 'panels', panels, views, controls };
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

/** The move that opens `id` in `next` from `cur` (arrangements), or null. */
function openOf(cur, next, id) {
    if (stableStringify(withoutTile(next, id)) !== stableStringify(cur)) return null;
    const last = next[next.length - 1];
    if (last && last.type === 'tile' && last.id === id) return { op: 'open', id, where: 'row' };
    const beside = paneBeside(next, id);
    return beside ? { op: 'open', id, where: 'pane', ...beside } : null;
}

/**
 * The moves a layout step is, when the app already animates each of them:
 * `close` (a panel closed; its sibling takes the room), `open` (a panel made
 * in a new row, or in a pane split off beside a panel) and `resize` (only
 * pane shares and row heights differ). One move is returned as it is, several
 * as `{op: 'multi', steps}` (closes first, then opens in an order each of which
 * can be made by hand); they play together. Null for anything else (a panel
 * moved, a hierarchy not made of such moves), which is rebuilt.
 *
 * @param {Object} from - the view on screen
 * @param {Object} to - the view of the history entry
 * @returns {Object|null}
 */
export function layoutStep(from, to) {
    const a = from && from.layout && from.layout.hierarchy;
    const b = to && to.layout && to.layout.hierarchy;
    if (!a || !b) return null;
    const before = new Set(collectTileIds(a));
    const after = new Set(collectTileIds(b));
    const removed = [...before].filter(id => !after.has(id));
    const added = [...after].filter(id => !before.has(id));
    const target = arrangement(b);
    let current = arrangement(a);
    if (!removed.length && !added.length) {
        return stableStringify(current) === stableStringify(target) ? { op: 'resize' } : null;
    }
    const steps = [];
    for (const id of removed) {
        current = withoutTile(current, id);
        steps.push({ op: 'close', id });
    }
    const without = (ids) => ids.reduce((nodes, id) => withoutTile(nodes, id), target);
    let pending = added;
    if (stableStringify(current) !== stableStringify(without(pending))) return null;
    while (pending.length) {
        let found = null;
        for (const id of pending) {
            const rest = pending.filter(other => other !== id);
            const candidate = without(rest);
            const step = openOf(current, candidate, id);
            if (step) { found = { step, rest, candidate }; break; }
        }
        if (!found) return null;
        steps.push(found.step);
        current = found.candidate;
        pending = found.rest;
    }
    return steps.length === 1 ? steps[0] : { op: 'multi', steps };
}

/** The pane shares of a hierarchy, in the order of its splits. */
function sharesOf(nodes) {
    const out = [];
    const walk = (node) => {
        if (node && node.type === 'split') {
            out.push(...(node.panes || []).map(p => (p && p.percentage) || 50));
            (node.children || []).forEach(walk);
        }
    };
    (nodes || []).forEach(walk);
    return out;
}

/**
 * Whether the view on screen is the view of a history entry: the same panels
 * in the same arrangement with the same control bars and (within a
 * few percent) split shares. (A panel's own settings are not compared: a panel
 * built from the entry's settings fills in defaults of its own.) After a step this must hold, whatever the way
 * there; if it does not, the entry's layout is built at once.
 *
 * @param {Object} live - the view on screen
 * @param {Object} target - the view of the history entry
 */
export function viewsMatch(live, target) {
    return viewMismatch(live, target) === null;
}

/** What differs between the view on screen and a history entry's view, as a short text; null when nothing does. */
export function viewMismatch(live, target) {
    const a = (live && live.layout) || {};
    const b = (target && target.layout) || {};
    if (stableStringify(arrangement(a.hierarchy)) !== stableStringify(arrangement(b.hierarchy))) return 'arrangement';
    for (const id of collectTileIds(b.hierarchy || [])) {
        const shown = (b.controlState || {})[id];
        if (shown !== undefined && shown !== (a.controlState || {})[id]) return `controls of ${id}`;
    }
    const x = sharesOf(a.hierarchy);
    const y = sharesOf(b.hierarchy);
    return x.length === y.length && x.every((v, i) => Math.abs(v - y[i]) <= 3) ? null : `shares ${x} vs ${y}`;
}

/**
 * Whether the view on screen holds a change the recorded view (the entry's) does not: other panels or
 * arrangement, other control bars or shares, other settings of a panel, another focused gene or cell.
 * Derived values (a point size that follows the plot area) are not changes.
 */
export function unrecordedChange(live, recorded) {
    if (viewMismatch(live, recorded) !== null) return true;
    const diff = diffViews(live, recorded, { samePath: true, sameSubset: true });
    // a layout diff here is only shares within the tolerance; settings are compared through the panels left over
    if (diff.kind === 'panels' && diff.views.length) return true;
    const was = (live.layout && live.layout.panelConfigs) || {};
    const now = (recorded && recorded.layout && recorded.layout.panelConfigs) || {};
    for (const id of collectTileIds((live.layout && live.layout.hierarchy) || [])) {
        if (now[id] && viewDiffers(was[id], now[id])) return true;
    }
    const settings = diff.kind === 'panels' ? diff.panels
        : collectTileIds((live.layout && live.layout.hierarchy) || []).filter(id => !(diff.keep || []).includes(id));
    if (settings.length) return true;
    const a = (live && live.constants) || {};
    const b = (recorded && recorded.constants) || {};
    return (a.focusedGene || '') !== (b.focusedGene || '') || (a.focusedCell || '') !== (b.focusedCell || '');
}
