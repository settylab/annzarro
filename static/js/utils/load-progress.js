/**
 * What a link, a panel set or a dataset switch is doing, shown from the first frame.
 *
 * Three small parts, none of which covers or disables anything:
 *
 *  - `panelLabel(type, config)`: the name a tile gets before it is drawn
 *    ("Cell plot · UMAP · coloured by cell_type"), worked out from the saved settings.
 *  - A skeleton of the layout (`showSkeleton`): the tiles of the view to be opened, each with its
 *    name and a status line, in place of the welcome tile until the real tiles are built.
 *  - One load at a time (`begin` / `panelReady` / `end`): its overall line ("Opening link:
 *    fixture.zarr, 3 panels (1 ready)") goes in the dataset bar (#load-progress, a polite live
 *    region). A newer `begin` supersedes an older one; `end(token)` of a superseded load does
 *    nothing, so a late finish never clears the line of the load that replaced it.
 *
 * The per-panel status (`setTileStatus`) is by tile id, so the panels of a load that arrive later
 * (closed panels coming back, panels waiting for another) can report through the same calls.
 */

const TYPE_LABEL = {
    'cell-plot': 'Cell plot', 'gene-plot': 'Gene plot', 'cell-table': 'Cell table',
    'gene-table': 'Gene table', 'gene-set': 'Gene set analysis', 'gene-signature': 'Gene signature'
};

/** "X_umap" -> "UMAP", "X_pca" -> "PCA", other keys as they are. */
function embeddingName(key) {
    const k = String(key || '').replace(/^X_/, '');
    return k.length <= 5 ? k.toUpperCase() : k;
}

const axisKey = (a) => (a && a.key ? String(a.key) + (a.column ? `.${a.column}` : '') : '');

/**
 * The name of a panel to be opened, from its type and saved config.
 * @param {string} type
 * @param {Object} [config]
 * @returns {string}
 */
export function panelLabel(type, config = {}) {
    const parts = [TYPE_LABEL[type] || String(type || 'Panel')];
    const c = config || {};
    if (type === 'cell-plot' || type === 'gene-plot') {
        const x = c.x || null, y = c.y || null;
        if (x && y && x.type === 'obsm' && y.type === 'obsm' && x.key === y.key) parts.push(embeddingName(x.key));
        else if (axisKey(x) && axisKey(y)) parts.push(`${axisKey(x)} vs ${axisKey(y)}`);
        const colour = axisKey(c.color);
        if (colour) parts.push(`coloured by ${colour}`);
    }
    return parts.join(' · ');
}

/** The overall line of a load. @returns {string} */
export function describeLoad({ kind, name, total = 0, ready = 0 }) {
    const what = kind === 'set' ? 'Loading panel set' : kind === 'switch' ? 'Switching to' : 'Opening link';
    const head = kind === 'switch' ? `${what} ${name}…` : `${what}: ${name}`;
    if (!total) return head + (kind === 'switch' ? '' : '…');
    return `${head}, ${total} panel${total === 1 ? '' : 's'}${ready ? ` (${ready} ready)` : ''}`;
}

// -- the skeleton ---------------------------------------------------------------

const SKELETON_ID = 'load-skeleton';

function skeletonNode(node, tiles, doc) {
    if (!node || typeof node !== 'object') return null;
    if (node.type === 'tile' && node.id) {
        const t = tiles.get(node.id) || { label: node.id };
        const box = doc.createElement('div');
        box.className = 'az-skel-tile';
        box.dataset.skelId = node.id;
        box.innerHTML = '<div class="az-skel-name"></div><div class="az-skel-status"></div>';
        box.querySelector('.az-skel-name').textContent = t.label;
        box.querySelector('.az-skel-status').textContent = t.status || '';
        return box;
    }
    if (node.type === 'split' && Array.isArray(node.children)) {
        const box = doc.createElement('div');
        box.className = 'az-skel-split';
        box.style.flexDirection = node.direction === 'vertical' ? 'column' : 'row';
        node.children.forEach((child, i) => {
            const el = skeletonNode(child, tiles, doc);
            if (!el) return;
            const share = node.panes && node.panes[i] && node.panes[i].percentage;
            el.style.flex = `${share || 1} 1 0`;
            box.appendChild(el);
        });
        return box;
    }
    return null;
}

/**
 * Show the tiles of `layout` as named boxes where the panels are about to be (inside `host`, the
 * tile container). Hides the container's other children until `dropSkeleton`.
 * @param {HTMLElement} host
 * @param {Object} layout - a view's layout ({hierarchy, panelConfigs})
 * @param {string} status - the first status line of every tile
 * @returns {number} tiles shown
 */
export function showSkeleton(host, layout, status = '') {
    dropSkeleton();
    if (!host || !layout || !Array.isArray(layout.hierarchy)) return 0;
    const doc = host.ownerDocument;
    const configs = layout.panelConfigs || {};
    const tiles = new Map();
    const walk = (n) => {
        if (!n) return;
        if (n.type === 'tile' && n.id) {
            const type = String(n.id).split('-').slice(0, -1).join('-');
            tiles.set(n.id, { label: panelLabel(type, configs[n.id]), status });
        }
        (n.children || []).forEach(walk);
    };
    layout.hierarchy.forEach(walk);
    if (!tiles.size) return 0;
    const root = doc.createElement('div');
    root.id = SKELETON_ID;
    root.className = 'az-skeleton';
    root.setAttribute('aria-hidden', 'true');
    for (const node of layout.hierarchy) {
        const el = skeletonNode(node, tiles, doc);
        if (!el) continue;
        const row = doc.createElement('div');
        row.className = 'az-skel-row';
        row.appendChild(el);
        root.appendChild(row);
    }
    host.insertBefore(root, host.firstChild);
    doc.body.classList.add('az-skeleton-on');
    return tiles.size;
}

/** Say what every skeleton tile (or the one with `id`) is doing. */
export function setSkeletonStatus(text, id = null) {
    if (typeof document === 'undefined') return;
    const root = document.getElementById(SKELETON_ID);
    if (!root) return;
    for (const tile of root.querySelectorAll('.az-skel-tile')) {
        if (id === null || tile.dataset.skelId === id) tile.querySelector('.az-skel-status').textContent = text;
    }
}

/** Remove the skeleton (the real tiles are being built, or the load ended). */
export function dropSkeleton() {
    if (typeof document === 'undefined') return;
    const root = document.getElementById(SKELETON_ID);
    if (root) root.remove();
    document.body.classList.remove('az-skeleton-on');
}

// -- one load at a time ----------------------------------------------------------

let current = null;     // {token, kind, name, total, ready:Set}
let nextToken = 0;

function paint() {
    if (typeof document === 'undefined') return;
    const el = document.getElementById('load-progress');
    if (!el) return;
    if (!current) { el.hidden = true; el.textContent = ''; return; }
    el.textContent = describeLoad({ ...current, ready: current.ready.size });
    el.hidden = false;
}

/**
 * A load starts; any load before it is superseded.
 * @param {{kind: 'link'|'set'|'switch', name: string, ids?: string[]}} load - ids: the tiles it opens
 * @returns {number} its token
 */
export function begin({ kind, name, ids = [] }) {
    current = { token: ++nextToken, kind, name, ids: new Set(ids), total: ids.length, ready: new Set() };
    paint();
    return current.token;
}

/** Whether `token` is still the load shown. */
export function isCurrent(token) {
    return !!current && current.token === token;
}

/** A panel of the load is drawn (or failed). */
export function panelReady(id) {
    if (!current || !current.ids.has(id)) return;
    current.ready.add(id);
    paint();
}

/** The load ended; does nothing for one that was superseded. */
export function end(token) {
    if (!isCurrent(token)) return;
    current = null;
    paint();
    dropSkeleton();
}

/** The load now shown (a copy), or null. */
export function currentLoad() {
    return current ? { kind: current.kind, name: current.name, total: current.total, ready: current.ready.size } : null;
}
