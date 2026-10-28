/**
 * Copy the view with the hover text; paste it onto a panel.
 *
 * Pressing C over a point (utils/hover-copy.js) puts the hover text on the clipboard as
 * `text/plain`, as ever, and next to it a JSON "view descriptor" of the panel: which coordinates
 * its axes show and the range of each, for a 3D plot the camera too. Pasting (main.js) over a
 * panel applies it to that panel where it can: an axis showing the same coordinate as a copied
 * axis, in whichever position, takes that range; the other axes stay as they are.
 *
 * Axes are matched by what they show, never by position, so a copied x of UMAP_1 lands on a
 * target y that shows UMAP_1. A coordinate is {key, dim}: key "obsm:X_umap" with dim 0, or
 * "obs:total_counts" with no dim, or "layer:counts" with dim the gene (cell) it is read at.
 *
 * Descriptor (version 1):
 *   { schema: 'annzarro-view', version: 1,
 *     dataset: '/path/to/store.zarr',
 *     entity: { kind: 'cell'|'gene', id: 'name' } | null,   // the hovered point
 *     panel: 'cell-plot'|'gene-plot', dims: 2|3,
 *     axes: [{ axis: 'x'|'y'|'z', key, dim, range: [lo, hi] }],   // numeric axes only, lo < hi
 *     camera: { eye, center, up, projection } | null,        // 3D only
 *     aspect: { mode, ratio } | null }                       // 3D only; recorded, not applied
 *
 * Transport: a `copy` event handler sets `text/plain` and the custom type VIEW_MIME on the
 * clipboard (clipboard.js legacyCopy), so it works on plain http too. The JSON is never put in
 * `text/plain`. Pure functions here; the page glue is at the end.
 */

export const VIEW_MIME = 'application/x-annzarro-view+json';
export const VIEW_SCHEMA = 'annzarro-view';
export const VIEW_VERSION = 1;

const finitePair = (r) => Array.isArray(r) && r.length === 2 && r.every(v => typeof v === 'number' && Number.isFinite(v));

/**
 * What an axis field shows. The column of a matrix field is its dimension (a number for obsm and
 * varm); '' and undefined mean none.
 * @param {{type?: string, key?: string, column?: *}|null} field
 * @returns {{key: string, dim: (number|string|null)}|null}
 */
export function coordinateId(field) {
    if (!field || !field.type || field.key === undefined || field.key === null || field.key === '') return null;
    const col = field.column;
    let dim = null;
    if (col !== undefined && col !== null && col !== '') dim = /^\d+$/.test(String(col)) ? Number(col) : String(col);
    return { key: `${field.type}:${field.key}`, dim };
}

const sameCoordinate = (a, b) => a.key === b.key && String(a.dim) === String(b.dim);

/** The axis objects of a drawn graph, by letter: {x, y[, z]} of Plotly's _fullLayout. */
function layoutAxes(fl, is3d) {
    if (!fl) return {};
    const src = is3d ? fl.scene : fl;
    if (!src) return {};
    return { x: src.xaxis, y: src.yaxis, z: src.zaxis };
}

const numericRange = (ax) => ax && (ax.type === 'linear' || ax.type === undefined) && finitePair(ax.range)
    ? [Math.min(ax.range[0], ax.range[1]), Math.max(ax.range[0], ax.range[1])] : null;

/** The camera on screen of a 3D graph, as plain data. */
function readCamera(fl) {
    const scene = fl && fl.scene;
    let cam = scene && scene.camera;
    try {
        if (scene && scene._scene && typeof scene._scene.getCamera === 'function') cam = scene._scene.getCamera();
    } catch { /* the layout's camera stays */ }
    if (!cam || !cam.eye) return null;
    const v = (p) => (p ? { x: Number(p.x), y: Number(p.y), z: Number(p.z) } : undefined);
    const out = { eye: v(cam.eye), center: v(cam.center), up: v(cam.up) };
    if (cam.projection && cam.projection.type) out.projection = { type: String(cam.projection.type) };
    return out;
}

/**
 * The view of a drawn graph.
 * @param {Object} gd  the Plotly graph (reads _fullLayout)
 * @param {Object} settings  the panel's settings (x, y, z fields)
 * @param {{dataset: string|null, entity?: Object|null, panel?: string}} meta
 * @returns {Object|null}  null when the graph has no coordinates to describe
 */
export function buildViewDescriptor(gd, settings, meta = {}) {
    if (!gd || !settings) return null;
    const is3d = !!settings.z;
    const axes = layoutAxes(gd._fullLayout, is3d);
    const out = [];
    for (const letter of is3d ? ['x', 'y', 'z'] : ['x', 'y']) {
        const id = coordinateId(settings[letter]);
        const range = numericRange(axes[letter]);
        if (id && range) out.push({ axis: letter, key: id.key, dim: id.dim, range });
    }
    if (!out.length) return null;
    const scene = is3d && gd._fullLayout ? gd._fullLayout.scene : null;
    return {
        schema: VIEW_SCHEMA, version: VIEW_VERSION,
        dataset: meta.dataset || null,
        entity: meta.entity || null,
        panel: meta.panel || null,
        dims: is3d ? 3 : 2,
        axes: out,
        camera: is3d ? readCamera(gd._fullLayout) : null,
        aspect: scene && scene.aspectmode ? { mode: String(scene.aspectmode), ratio: scene.aspectratio ? { ...scene.aspectratio } : null } : null
    };
}

/**
 * A descriptor from clipboard text (JSON), or null for anything else or a newer version.
 * @param {string} json
 */
export function parseView(json) {
    if (typeof json !== 'string' || !json || json.length > 65536) return null;
    let v;
    try { v = JSON.parse(json); } catch { return null; }
    if (!v || v.schema !== VIEW_SCHEMA || typeof v.version !== 'number' || v.version > VIEW_VERSION || !Array.isArray(v.axes)) return null;
    v.axes = v.axes.filter(a => a && ['x', 'y', 'z'].includes(a.axis) && typeof a.key === 'string' && finitePair(a.range));
    return v;
}

/**
 * The descriptor on a paste's clipboard: the custom type, else the `data-annzarro-view`
 * attribute of the HTML flavour (a browser that drops custom types).
 * @param {DataTransfer|null} data
 */
export function readView(data) {
    if (!data || typeof data.getData !== 'function') return null;
    let v = null;
    try { v = parseView(data.getData(VIEW_MIME)); } catch { /* none */ }
    if (v) return v;
    try {
        const html = data.getData('text/html');
        const m = html && /data-annzarro-view="([^"]*)"/.exec(html);
        if (m) {
            const raw = m[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
            return parseView(raw);
        }
    } catch { /* none */ }
    return null;
}

/** The HTML flavour: the hover text in a wrapper carrying the descriptor. */
export function viewHtml(text, view) {
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    return `<div data-annzarro-view="${esc(JSON.stringify(view))}">${esc(text).replace(/\n/g, '<br>')}</div>`;
}

/**
 * What to do with a descriptor on a target panel.
 * @param {Object} view  parsed descriptor
 * @param {{dataset: string|null, settings: Object, axes: Object}} target
 *   axes: per letter {numeric: boolean, flipped: boolean} of the graph drawn now
 * @returns {{status: 'applied'|'none'|'dataset', update: Object, applied: string[]}}
 */
export function planView(view, target) {
    const none = { status: 'none', update: {}, applied: [] };
    if (!view || !target || !target.settings) return none;
    if (view.dataset && target.dataset && view.dataset !== target.dataset) return { status: 'dataset', update: {}, applied: [] };
    const settings = target.settings;
    const is3d = !!settings.z;
    const prefix = (l) => (is3d ? `scene.${l}axis` : `${l}axis`);
    const update = {};
    const applied = [];
    const same = [];            // target letters whose match sits at the same letter in the source
    for (const letter of is3d ? ['x', 'y', 'z'] : ['x', 'y']) {
        const id = coordinateId(settings[letter]);
        const info = target.axes && target.axes[letter];
        if (!id || !info || !info.numeric) continue;
        const hits = view.axes.filter(a => sameCoordinate(a, id));
        if (!hits.length) continue;
        const hit = hits.find(a => a.axis === letter) || hits[0];
        const lo = Math.min(hit.range[0], hit.range[1]), hi = Math.max(hit.range[0], hit.range[1]);
        update[`${prefix(letter)}.range`] = info.flipped && !is3d ? [hi, lo] : [lo, hi];
        applied.push(letter);
        if (hit.axis === letter) same.push(letter);
    }
    if (!applied.length) return none;
    // a camera looks at x, y, z of the source: kept only where all three axes are where they were
    if (is3d && view.dims === 3 && view.camera && view.camera.eye && same.length === 3) {
        const c = view.camera;
        update['scene.camera'] = { eye: c.eye, center: c.center || { x: 0, y: 0, z: 0 }, up: c.up || { x: 0, y: 0, z: 1 },
            ...(c.projection ? { projection: c.projection } : {}) };
    }
    return { status: 'applied', update, applied };
}

/** What a toast says about a plan. */
export function viewMessage(plan) {
    if (plan.status === 'dataset') return 'View not applied: copied from another dataset';
    if (plan.status === 'applied') return `View applied (${plan.applied.join(', ')}${plan.update['scene.camera'] ? ', camera' : ''})`;
    return 'No matching coordinates';
}

/**
 * Read a drawn graph as a plan's target.
 * @param {Object} gd
 */
export function describeTarget(gd, currentDataset = null) {
    const settings = gd && gd.__azSettings;
    if (!settings) return null;
    const is3d = !!settings.z;
    const ax = layoutAxes(gd._fullLayout, is3d);
    const axes = {};
    for (const l of ['x', 'y', 'z']) {
        axes[l] = { numeric: !!ax[l] && (ax[l].type === 'linear' || ax[l].type === undefined),
            flipped: !is3d && (l === 'x' ? settings.flipX : settings.flipY) === true };
    }
    return { dataset: gd.__azDrawnDataset || currentDataset, settings, axes };
}

/**
 * Apply a plan to a graph in one relayout.
 * @returns {Promise<void>}
 */
export function applyPlan(gd, plan, plotly = globalThis.Plotly) {
    if (plan.status !== 'applied' || !plotly) return Promise.resolve();
    return Promise.resolve(plotly.relayout(gd, plan.update));
}

// -- page glue --

/** The hovered point's name: the first line of the hover text (the cell or the gene). */
export function entityOf(text, tileId) {
    const id = String(text || '').split('\n')[0].trim();
    if (!id) return null;
    return { kind: /^gene-plot/.test(tileId || '') ? 'gene' : 'cell', id };
}

/** The descriptor for the graph a copy was made on, or null. */
export function descriptorFor(gd, text, currentDataset = null) {
    if (!gd || !gd.__azSettings) return null;
    const tile = typeof gd.closest === 'function' ? gd.closest('.tile') : null;
    const tileId = (tile && tile.dataset && tile.dataset.tileId) || '';
    const panel = /^(cell|gene)-plot/.exec(tileId);
    return buildViewDescriptor(gd, gd.__azSettings, {
        dataset: gd.__azDrawnDataset || currentDataset,
        entity: entityOf(text, tileId),
        panel: panel ? panel[0] : null
    });
}

/**
 * Follow the pointer; the returned function gives the graph of the panel under it, or null when
 * it is over anything else (the header, a boundary, the panel chooser, empty space) or outside the page.
 * @param {Document} [doc]
 * @returns {function(): ?HTMLElement}
 */
export function trackPointerPanel(doc = document) {
    let at = null;
    doc.addEventListener('pointermove', (e) => { at = [e.clientX, e.clientY]; }, { passive: true, capture: true });
    if (doc.documentElement) doc.documentElement.addEventListener('pointerleave', () => { at = null; });
    return () => {
        if (!at) return null;
        const el = doc.elementFromPoint(at[0], at[1]);
        const tile = el && typeof el.closest === 'function' ? el.closest('.tile:not(.tile-selector)') : null;
        return tile ? tile.querySelector('.js-plotly-plot') : null;
    };
}
