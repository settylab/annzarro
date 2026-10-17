/**
 * The dataset browser: the one dialog every way of choosing a dataset goes
 * through (#dataset-browser in templates/index.html). The logic that needs no
 * DOM is in dataset-browser-model.js and dataset-picker.js; main.js decides
 * what choosing a dataset does (`onChoose`) and supplies what the dialog reads
 * from the application (`services`).
 *
 * Layout: places (Recent, Pinned, the data directory and the admin roots, or a
 * restricted user's grants, Remote) | breadcrumb that turns into a path/URL
 * field | a native, sortable table | the details pane.
 *
 * Keyboard: the table is one tab stop with roving focus on the name buttons
 * (Up, Down, Home, End, PageUp, PageDown move; Enter opens, a folder is
 * entered; Left or Backspace goes to the parent folder, Right enters a
 * folder; printable keys do type-ahead on the names; `/` returns to the
 * search field; Ctrl or Cmd+L edits the path). Clicking a name opens it,
 * clicking elsewhere in a row selects it and fills the details pane.
 *
 * services (everything the dialog reads from the application):
 *   urls            {folder, search, details, lookup}
 *   me()            Promise of auth/me (null when it cannot be read)
 *   stored()        {recents, pins}: [{path, label, openedAt|pinnedAt}], newest first (the user is known)
 *   lookup(paths)   Promise of the server's answer for those paths (POST /datasets/lookup)
 *   togglePin(item) true when the item is now pinned
 *   probe(path)     Promise of probeStore(path)
 *   candidates(saved) Promise of the data directory's stores with `match` against the saved store
 *   currentPath()   the dataset open now, or null
 *   usedKeys()      Promise of the keys the open panels use ([{key, kind}])
 *   label(path)     how the interface names a dataset (relative to the data directory)
 *   nativeOpen      the desktop app's `openDatasetDialog(which)` (a function), or null
 *   nativeKinds     [undefined] where one dialog takes a file or a folder, ['h5ad', 'zarr'] where two buttons are needed
 *   isDesktop       whether this is the desktop app
 *   localMode       whether this server belongs to the one user at it
 *   copy(text)      Promise of copying text to the clipboard
 *   shortcut        {open, path} the platform's names of the chords ("Ctrl+O")
 */
import {
    pathFieldWording, splitByRanges, basename
} from './dataset-picker.js';
import { recentEntries } from './dataset-recents.js';
import {
    COLUMNS, SERVER_SORTS, FORMAT_CHIPS, CELL_BANDS, MODIFIED_BANDS,
    applyFilters, emptyFilters, filtersActive, searchRows, sortRows, ariaSort, nextSort, typeAheadIndex,
    buildPlaces, breadcrumbs, matchBadge, matchesView, rowDescription, countLabel, dateLabel, dateTimeLabel,
    openedLabel, formatLabel, countSummary, isRemote, missingKeys
} from './dataset-browser-model.js';

const PAGE = 200;
const DETAILS_DELAY_MS = 400;
const SEARCH_DELAY_MS = 300;
const TYPE_AHEAD_MS = 700;

const FILTER_SELECTS = {
    format: { label: 'Format', options: FORMAT_CHIPS.map(c => [c.key, c.label]) },
    cells: { label: 'Cells', options: CELL_BANDS.map(b => [b.key, b.label]) },
    modified: { label: 'Modified', options: MODIFIED_BANDS.map(b => [b.key, b.label]) }
};

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null && text !== '') node.textContent = text;
    return node;
}

/** Append `text` to `parent`, in <mark> where `ranges` say, with a <wbr> after each / _ . - so long names wrap there first. */
function appendWrapped(parent, text, ranges = []) {
    for (const part of splitByRanges(text, ranges)) {
        const holder = part.hit ? document.createElement('mark') : parent;
        for (const piece of part.text.split(/(?<=[/_.-])/)) {
            holder.appendChild(document.createTextNode(piece));
            holder.appendChild(document.createElement('wbr'));
        }
        if (part.hit) parent.appendChild(holder);
    }
}

function formatBytes(n) {
    if (!Number.isFinite(n)) return '';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let v = n;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

async function getJson(url, signal) {
    const response = await fetch(url, { signal });
    const body = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, body };
}

/** Whether typed text names a place on disk or a URL (offered as "Open <path>"), not a search for a name. */
export function looksLikePath(text) {
    const t = String(text || '').trim();
    return isRemote(t) || /^(\/|~\/|\.\.?\/|[A-Za-z]:[\\/])/.test(t);
}

/**
 * @param {Object} services - see the file's header
 * @returns {{open: Function, close: Function, isOpen: () => boolean}}
 */
export function createDatasetBrowser(services) {
    const root = document.getElementById('dataset-browser');
    const $ = id => document.getElementById(id);
    const dom = {
        title: $('dataset-browser-title'), banner: $('dataset-browser-banner'), search: $('dsb-search'), regex: $('dsb-regex'),
        searchError: $('dsb-search-error'), chips: $('dsb-chips'), places: $('dsb-places'), placesSelect: $('dsb-places-select'),
        crumbs: $('dsb-crumbs'), pathForm: $('dsb-pathform'), path: $('dsb-path'), pathOpen: $('dsb-path-open'),
        pathLabel: $('dsb-path-label'), pathError: $('dsb-path-error'), tableWrap: $('dsb-table-wrap'), details: $('dsb-details'),
        status: $('dsb-status'), native: $('dsb-open-native'), pathbar: $('dsb-pathbar'), hintPath: $('dsb-hint-path')
    };
    if (!root) return { open: async () => null, close() {}, isOpen: () => false };
    const modal = bootstrap.Modal.getOrCreateInstance(root);

    let S = null;                 // the state of the dialog while it is open
    let shown = false;
    let closing = false;
    let hiddenPromise = null;      // while the dialog is closing: settles when it has closed
    let returnFocus = null;
    let detailsTimer = null;
    let detailsAbort = null;
    let searchTimer = null;
    let searchAbort = null;
    let typeBuffer = '';
    let typeTimer = null;
    let statusTimer = null;
    const detailsCache = new Map();   // `${path}|${check}` -> body

    // ---- state ---------------------------------------------------------------------------

    function freshState(options) {
        return {
            mode: options.mode || 'change',
            pending: options.pending || null,
            onChoose: options.onChoose,
            me: null,
            places: [],
            placeId: 'root',
            folderRoot: '',                // the folder the place starts at
            folder: '',                    // the folder shown ('' = the place's root listing)
            listing: { entries: [], total: 0, more: false, offset: 0, loading: false, error: null, parent: null, rel: '', folder: '' },
            rootEntries: [],
            recents: [], pinsList: [],
            matchOf: new Map(),            // path -> entry with `match` (the stores like the view's)
            query: options.query || '',
            regex: false,
            filters: emptyFilters(),
            sort: null,                    // null: the default of the place
            limit: PAGE,
            remote: null,                  // the server's search: {key, entries, truncated, error}
            selected: null,
            focus: null,
            used: [],
            loadToken: 0,
            pathOpen: false,
            ready: false,
            searching: null
        };
    }

    const place = () => S.places.find(p => p.id === S.placeId) || S.places[0];
    const inFolderPlace = () => place().kind === 'folder';
    const searching = () => !!S.query;

    /** The sort in force: the user's, else the place's default. `server` says the server sorts it. */
    function effectiveSort() {
        if (S.sort) return { ...S.sort, server: inFolderPlace() && !searching() && SERVER_SORTS.includes(S.sort.key) };
        if (searching()) return { key: null, dir: 'asc', server: false };
        if (inFolderPlace()) return { key: 'name', dir: 'asc', server: true };
        if (place().kind === 'pinned') return { key: null, dir: 'asc', server: false };
        return { key: 'opened', dir: 'desc', server: false };
    }

    // ---- loading -------------------------------------------------------------------------

    function annotate(entry) {
        const hit = S.matchOf.get(entry.path);
        return hit && !entry.match ? { ...entry, match: hit.match, cmp: hit.cmp } : entry;
    }

    async function loadFolder({ reset = true } = {}) {
        const token = ++S.loadToken;
        const L = S.listing;
        if (reset) Object.assign(L, { entries: [], offset: 0, total: 0, more: false, error: null });
        L.loading = true;
        render();
        const sort = effectiveSort();
        const params = new URLSearchParams({ folder: S.folder, offset: String(L.offset) });
        if (sort.server) { params.set('sort', sort.key); params.set('order', sort.dir); }
        try {
            const { ok, body } = await getJson(`${services.urls.folder}?${params}`);
            if (token !== S.loadToken) return;
            if (!ok) throw new Error(body.error || 'The folder could not be listed');
            L.entries.push(...body.entries);
            L.offset += body.entries.length;
            L.total = body.total;
            L.more = !!body.more;
            L.parent = body.parent || null;
            L.rel = body.rel_path || '';
            L.folder = body.folder || S.folder;
            if (!S.folder && !S.rootEntries.length) S.rootEntries = body.entries.slice();
        } catch (e) {
            if (token !== S.loadToken) return;
            L.error = (e && e.message) || 'The folder could not be listed';
        }
        L.loading = false;
        render();
    }

    async function loadQuick() {
        const { recents, pins } = services.stored();
        const names = [...new Set([...recents.map(r => r.path), ...pins.map(p => p.path)])];
        let results = [];
        try { results = await services.lookup(names); } catch { /* shown by label */ }
        const byPath = new Map(names.map((p, i) => [p, results[i]]));
        const mk = (items, key) => {
            const entries = recentEntries(items, items.map(i => byPath.get(i.path)));
            return entries.map((entry, i) => ({ ...entry, kind: 'store', [key]: items[i][key === 'openedAt' ? 'openedAt' : 'pinnedAt'] }));
        };
        S.recents = mk(recents, 'openedAt');
        S.pinsList = mk(pins, 'pinnedAt');
    }

    function goPlace(id, { keepQuery = true } = {}) {
        const p = S.places.find(x => x.id === id);
        if (!p) return;
        S.placeId = p.id;
        S.limit = PAGE;
        S.selected = null;
        S.focus = null;
        if (!keepQuery) { S.query = ''; dom.search.value = ''; }
        S.sort = null;
        closePathField();
        if (p.kind === 'folder') {
            S.folderRoot = p.folder;
            S.folder = p.folder;
            loadFolder();
        } else {
            S.folder = '';
            S.listing.error = null;
        }
        scheduleSearch();
        render();
        // Remote has nothing to browse: it is for typing a URL, so the path field is open and has the focus
        if (p.kind === 'remote' && !baseRows().length) openPathField();
    }

    function goFolder(path) {
        S.folder = path;
        S.limit = PAGE;
        S.selected = null;
        S.focus = null;
        S.sort = S.sort && SERVER_SORTS.includes(S.sort.key) ? S.sort : null;
        closePathField();
        loadFolder();
        scheduleSearch();
    }

    // ---- search --------------------------------------------------------------------------

    const searchKey = () => `${S.regex ? 'regex' : 'substring'}:${S.folder}:${S.query}`;

    /** Ask the server for stores below the folder shown, once the typing pauses. */
    function scheduleSearch() {
        clearTimeout(searchTimer);
        if (searchAbort) searchAbort.abort();
        S.remote = null;
        S.searching = null;
        if (!S.query || looksLikePath(S.query)) return;
        const key = searchKey();
        let done;
        S.searching = new Promise(resolve => { done = resolve; });
        searchTimer = setTimeout(async () => {
            searchAbort = new AbortController();
            const params = new URLSearchParams({ q: S.query, mode: S.regex ? 'regex' : 'substring' });
            // the search stays inside the folder shown (the root listing searches everywhere)
            if (inFolderPlace() && S.folder) params.set('folder', S.folder);
            try {
                const { ok, body } = await getJson(`${services.urls.search}?${params}`, searchAbort.signal);
                if (key !== searchKey()) return done();
                if (!ok) throw new Error(body.error || 'The search failed');
                S.remote = { key, entries: body.results || [], truncated: !!body.truncated };
            } catch (e) {
                if (e && e.name === 'AbortError') return done();
                if (key !== searchKey()) return done();
                S.remote = { key, error: (e && e.message) || 'The search failed' };
            }
            done();
            render();
        }, SEARCH_DELAY_MS);
    }

    // ---- the rows ------------------------------------------------------------------------

    /** The rows of the place before the search, the chips and the sort. */
    function baseRows() {
        const p = place();
        if (p.kind === 'recent') return S.recents.slice();
        if (p.kind === 'pinned') return S.pinsList.slice();
        if (p.kind === 'remote') return S.recents.filter(r => isRemote(r.path));
        return S.listing.entries.map(e => annotate(e));
    }

    function currentRows() {
        let rows = baseRows();
        const found = searchRows(rows, S.query, { regex: S.regex });
        rows = found.rows;
        if (searching() && S.remote && S.remote.key === searchKey() && S.remote.entries) {
            // the server's matches below the folder, after what is listed here
            const have = new Set(rows.map(r => r.path));
            rows = rows.concat(S.remote.entries.filter(e => !have.has(e.path)).map(e => ({ ...annotate(e), kind: 'store' })));
        }
        rows = applyFilters(rows, S.filters);
        const sort = effectiveSort();
        if (!sort.server) rows = sortRows(rows, sort.key, sort.dir);
        else rows = sortRows(rows, null);     // the server's order, folders kept first
        return { rows, compiled: found.compiled };
    }

    // ---- rendering -----------------------------------------------------------------------

    function render() {
        if (!S) return;
        renderPlaces();
        renderChips();
        renderPathbar();
        renderTable();
        renderDetails(false);
        announceSoon();
    }

    function renderPlaces() {
        const p = place();
        dom.places.textContent = '';
        let group = null;
        const heading = { quick: 'Quick', roots: S.me && S.me.restricted ? 'Shared with you' : 'Places', remote: 'Remote' };
        const counts = { recent: S.recents.length, pinned: S.pinsList.length };
        let last = '';
        for (const item of S.places) {
            if (item.group !== last) {
                group = el('div', 'dsb-places-group');
                group.appendChild(el('h6', null, heading[item.group]));
                dom.places.appendChild(group);
                last = item.group;
            }
            const b = el('button', 'dsb-place');
            b.type = 'button';
            b.dataset.place = item.id;
            if (item.title) b.title = item.title;
            if (item.id === p.id) b.setAttribute('aria-current', 'true');
            const icon = el('i', `fas ${item.kind === 'recent' ? 'fa-clock' : item.kind === 'pinned' ? 'fa-star' : item.kind === 'remote' ? 'fa-globe' : 'fa-folder'}`);
            icon.setAttribute('aria-hidden', 'true');
            b.append(icon, el('span', 'dsb-place-label', item.label));
            if (counts[item.id]) b.appendChild(el('span', 'dsb-place-count', String(counts[item.id])));
            b.addEventListener('click', () => goPlace(item.id));
            group.appendChild(b);
        }
        dom.placesSelect.textContent = '';
        for (const item of S.places) {
            const o = new Option(item.label, item.id, false, item.id === p.id);
            dom.placesSelect.appendChild(o);
        }
        dom.placesSelect.value = p.id;
    }

    function renderChips() {
        dom.chips.textContent = '';
        const make = (key, value) => {
            const spec = FILTER_SELECTS[key];
            const select = el('select', 'form-select form-select-sm dsb-chip dsb-select');
            select.id = `dsb-filter-${key}`;
            select.setAttribute('aria-label', `${spec.label} filter`);
            select.appendChild(new Option(`${spec.label}: any`, ''));
            for (const [v, label] of spec.options) select.appendChild(new Option(label, v));
            select.value = value;
            select.classList.toggle('active', !!value);
            select.addEventListener('change', () => {
                if (key === 'format') { S.filters.formats.clear(); if (select.value) S.filters.formats.add(select.value); }
                else if (key === 'cells') { S.filters.cells.clear(); if (select.value) S.filters.cells.add(select.value); }
                else S.filters.modified = select.value;
                S.limit = PAGE;
                render();
            });
            dom.chips.appendChild(select);
        };
        make('format', [...S.filters.formats][0] || '');
        make('cells', [...S.filters.cells][0] || '');
        make('modified', S.filters.modified);
        if (S.viewMatches) {
            const b = el('button', 'btn btn-sm btn-outline-secondary dsb-chip dsb-toggle', 'Matches this view');
            b.type = 'button';
            b.id = 'dsb-filter-matches';
            b.setAttribute('aria-pressed', String(S.filters.matches));
            b.classList.toggle('active', S.filters.matches);
            b.addEventListener('click', () => { S.filters.matches = !S.filters.matches; S.limit = PAGE; render(); });
            dom.chips.appendChild(b);
        }
        const unreadable = baseRows().filter(r => r.error).length;
        if (unreadable) {
            const b = el('button', 'btn btn-sm btn-outline-secondary dsb-chip dsb-toggle', `Show unreadable (${unreadable})`);
            b.type = 'button';
            b.id = 'dsb-filter-unreadable';
            b.setAttribute('aria-pressed', String(S.filters.unreadable));
            b.classList.toggle('active', S.filters.unreadable);
            b.addEventListener('click', () => { S.filters.unreadable = !S.filters.unreadable; render(); });
            dom.chips.appendChild(b);
        }
    }

    function renderPathbar() {
        dom.crumbs.textContent = '';
        const p = place();
        const ol = el('ol', 'dsb-crumb-list');
        const add = (label, handler, current) => {
            const li = document.createElement('li');
            const b = el('button', 'dsb-crumb');
            b.type = 'button';
            b.textContent = label;
            if (current) b.setAttribute('aria-current', 'location');
            if (handler) b.addEventListener('click', handler);
            li.appendChild(b);
            ol.appendChild(li);
        };
        if (p.kind === 'folder') {
            const crumbs = breadcrumbs({ rootLabel: p.label, rootPath: p.folder, folder: S.listing.folder && S.folder ? S.listing.folder : S.folder, rel: S.listing.rel });
            crumbs.forEach((c, i) => add(c.label, i < crumbs.length - 1 ? () => (c.path === p.folder ? goPlace(p.id) : goFolder(c.path)) : null, i === crumbs.length - 1));
        } else {
            add(p.label, null, true);
        }
        dom.crumbs.appendChild(ol);
        const edit = el('button', 'dsb-crumb-edit');
        edit.type = 'button';
        edit.title = `Type a path or URL (${services.shortcut.path})`;
        edit.setAttribute('aria-label', 'Type a path or URL');
        edit.append(el('span', 'dsb-crumb-hint', `Type a path or URL: ${services.shortcut.path}`));
        edit.addEventListener('click', openPathField);
        dom.crumbs.appendChild(edit);
        dom.crumbs.hidden = S.pathOpen;
        dom.pathForm.hidden = !S.pathOpen;
    }

    function openPathField() {
        S.pathOpen = true;
        const words = pathFieldWording(S.me);
        dom.pathLabel.textContent = words.label;
        dom.path.placeholder = words.placeholder;
        dom.path.setAttribute('aria-label', words.label);
        dom.crumbs.hidden = true;
        dom.pathForm.hidden = false;
        dom.pathError.hidden = true;
        dom.path.value = '';
        dom.path.focus();
    }

    function closePathField() {
        if (!S) return;
        // the field is about to be hidden: keep the focus inside the dialog (a key chord needs it there)
        if (document.activeElement === dom.path) dom.search.focus();
        S.pathOpen = false;
        dom.pathForm.hidden = true;
        dom.crumbs.hidden = false;
        dom.pathError.hidden = true;
    }

    async function submitPath(text = null) {
        const typed = (text === null ? dom.path.value : text).trim();
        if (!typed) return;
        dom.pathError.hidden = true;
        // a store opens, a folder is entered
        const probe = await services.probe(typed);
        if (probe.ok) return choose(probe.path || typed);
        if (!isRemote(typed)) {
            const { ok, body } = await getJson(`${services.urls.folder}?folder=${encodeURIComponent(typed)}`);
            if (ok) {
                const pl = S.places.find(x => x.kind === 'folder' && (body.folder === x.folder || (x.folder && body.folder.startsWith(x.folder.replace(/\/+$/, '') + '/')))) || S.places.find(x => x.id === 'root');
                S.placeId = pl.id;
                S.folderRoot = pl.folder;
                S.query = ''; dom.search.value = '';
                closePathField();
                goFolder(body.folder);
                return;
            }
        }
        dom.pathError.textContent = probe.error || `${typed} could not be opened`;
        dom.pathError.hidden = false;
    }

    // ---- the table -----------------------------------------------------------------------

    function sortHeader(column, sort) {
        const th = document.createElement('th');
        th.scope = 'col';
        th.setAttribute('aria-sort', ariaSort(sort, column.key));
        th.className = `dsb-col-${column.key}` + (column.numeric ? ' dsb-num' : '');
        const b = el('button', 'dsb-sort');
        b.type = 'button';
        b.dataset.sort = column.key;
        b.append(el('span', null, column.label));
        const mark = el('span', 'dsb-sort-mark', sort && sort.key === column.key ? (sort.dir === 'desc' ? '▼' : '▲') : '');
        mark.setAttribute('aria-hidden', 'true');
        b.appendChild(mark);
        b.addEventListener('click', () => {
            S.sort = nextSort(sort && sort.key === column.key ? sort : null, column.key);
            S.limit = PAGE;
            // a column the server sorts is sorted before paging, so the folder is read again
            if (inFolderPlace() && !searching() && SERVER_SORTS.includes(S.sort.key)) loadFolder();
            else render();
        });
        th.appendChild(b);
        return th;
    }

    function emptyText() {
        const p = place();
        const restricted = !!(S.me && S.me.restricted);
        if (p.kind === 'recent') return 'Nothing opened yet. Datasets you open show up here.';
        if (p.kind === 'pinned') return 'Nothing pinned. Select a dataset and press Pin to keep it here.';
        if (p.kind === 'remote') {
            const hosts = (S.me && S.me.remote_allowlist) || [];
            return 'No remote stores opened yet. Type the URL of an s3://, gs:// or https:// zarr store in the field above'
                + (hosts.length ? `; this server opens only ${hosts.join(', ')}.` : '.');
        }
        if (restricted) return 'No datasets have been shared with you.';
        if (services.isDesktop) return `No datasets in ${p.label} yet. Use Open file or folder… to choose a .zarr folder or .h5ad file.`;
        if (services.localMode) return `No datasets in the ${p.label.toLowerCase()} yet. Put a .zarr folder or .h5ad file there, then press Refresh.`;
        return 'No datasets here. Ask your administrator to add some.';
    }

    function renderTable() {
        const wrap = dom.tableWrap;
        const hadFocus = wrap.contains(document.activeElement) ? (document.activeElement.closest('tr') || {}).dataset?.path : null;
        const sort = effectiveSort();
        const { rows: all, compiled } = currentRows();
        dom.searchError.hidden = !compiled.error;
        dom.searchError.textContent = compiled.error || '';
        const rows = all.slice(0, S.limit);
        wrap.textContent = '';
        const p = place();
        const L = S.listing;

        // a typed path or URL is offered as the first row
        const pathRow = searching() && looksLikePath(S.query);

        if (inFolderPlace() && L.error) {
            const box = el('div', 'dsb-state dsb-error');
            box.setAttribute('role', 'alert');
            box.append(el('span', null, L.error + ' '));
            const retry = el('button', 'btn btn-sm btn-outline-secondary', 'Retry');
            retry.type = 'button';
            retry.addEventListener('click', () => loadFolder());
            box.appendChild(retry);
            wrap.appendChild(box);
            return;
        }

        const table = el('table', 'table table-sm dsb-table');
        table.id = 'dsb-table';
        const caption = el('caption', 'visually-hidden');
        const where = p.kind === 'folder' ? (L.rel && L.rel !== '.' ? L.rel : p.label) : p.label;
        const by = sort.key ? `, sorted by ${COLUMNS.find(c => c.key === sort.key).label.toLowerCase()} ${sort.dir === 'desc' ? 'descending' : 'ascending'}` : '';
        caption.textContent = searching() ? `Datasets in ${where} matching ${S.query}${by}` : `Datasets in ${where}${by}`;
        table.appendChild(caption);
        const thead = document.createElement('thead');
        const hr = document.createElement('tr');
        for (const c of COLUMNS) hr.appendChild(sortHeader(c, sort));
        thead.appendChild(hr);
        table.appendChild(thead);
        const tbody = document.createElement('tbody');

        if (pathRow) {
            const tr = el('tr', 'dsb-row dsb-row-path');
            tr.dataset.kind = 'path';
            tr.dataset.path = S.query.trim();
            const th = el('th', 'dsb-namecell');
            th.scope = 'row';
            th.colSpan = COLUMNS.length;
            const b = el('button', 'dsb-name');
            b.type = 'button';
            b.append(el('i', 'fas fa-arrow-right me-1'), document.createTextNode(`Open ${S.query.trim()}`));
            b.addEventListener('click', () => submitPath(S.query));
            th.appendChild(b);
            tr.appendChild(th);
            tbody.appendChild(tr);
        }

        const focusPath = rows.some(r => r.path === S.focus) ? S.focus : (rows[0] && rows[0].path);
        rows.forEach((row, i) => tbody.appendChild(rowNode(row, compiled, row.path === focusPath, i)));
        table.appendChild(tbody);

        if (!rows.length && !pathRow && !L.loading) {
            const none = el('div', 'dsb-state');
            const filtered = filtersActive(S.filters) || searching();
            none.textContent = filtered ? 'No dataset matches the search and filters.' : emptyText();
            if (searching() && S.remote === null && S.searching) none.textContent = 'Searching subfolders…';
            wrap.appendChild(none);
            if (!filtered) { wrap.appendChild(table); table.classList.add('visually-hidden'); }
            else wrap.appendChild(table);
        } else {
            wrap.appendChild(table);
        }

        if (inFolderPlace() && L.loading) wrap.appendChild(el('div', 'dsb-state', 'Loading…'));
        const clientMore = all.length > S.limit;
        const serverMore = inFolderPlace() && !searching() && L.more;
        if (clientMore || serverMore) {
            const left = clientMore ? all.length - S.limit : L.total - L.offset;
            const more = el('button', 'btn btn-sm btn-link dsb-more', `Show more (${left} not shown)`);
            more.type = 'button';
            more.addEventListener('click', async () => {
                if (clientMore) S.limit += PAGE;
                else await loadFolder({ reset: false });
                render();
                const rowsNow = tbodyButtons();
                if (rowsNow.length) rowsNow[Math.min(rowsNow.length - 1, S.limit - PAGE)].focus();
            });
            wrap.appendChild(more);
        }
        if (S.remote && S.remote.error && searching()) wrap.appendChild(el('div', 'dsb-state text-danger', S.remote.error));
        if (S.remote && S.remote.truncated && searching()) wrap.appendChild(el('div', 'dsb-state', 'The search stopped at its limit; narrow it to see more.'));
        if (inFolderPlace() && !searching() && sort.key && !sort.server && L.more) {
            wrap.appendChild(el('div', 'dsb-state', `Sorted among ${L.offset} loaded.`));
        }
        if (hadFocus) {
            const again = tbodyButtons().find(b => b.closest('tr').dataset.path === hadFocus);
            if (again) again.focus();
        }
    }

    function tbodyButtons() {
        return [...dom.tableWrap.querySelectorAll('tbody .dsb-name')];
    }

    function rowNode(row, compiled, tabbable, index) {
        const tr = el('tr', 'dsb-row');
        tr.dataset.path = row.path;
        tr.dataset.kind = row.kind;
        if (row.error) tr.classList.add('dsb-unreadable');
        if (S.selected === row.path) tr.classList.add('selected');
        const th = el('th', 'dsb-namecell');
        th.scope = 'row';
        const nameLine = el('div', 'dsb-nameline');
        const name = el('button', 'dsb-name dataset-name');
        name.type = 'button';
        name.tabIndex = tabbable ? 0 : -1;
        const icon = el('i', row.kind === 'folder' ? 'fas fa-folder dsb-icon' : row.remote || isRemote(row.path) ? 'fas fa-globe dsb-icon' : 'fas fa-database dsb-icon');
        icon.setAttribute('aria-hidden', 'true');
        name.appendChild(icon);
        const label = row.name || basename(row.path);
        const text = el('span', 'dsb-name-text');
        const ranges = compiled.empty || compiled.error ? [] : compiled.ranges(label);
        appendWrapped(text, label, ranges);
        name.appendChild(text);
        if (row.error) name.setAttribute('aria-disabled', 'true');
        const describedBy = `dsb-desc-${index}`;
        name.setAttribute('aria-describedby', describedBy);
        if (S.selected === row.path) name.setAttribute('aria-current', 'true');
        name.addEventListener('click', (e) => { e.stopPropagation(); activate(row); });
        name.addEventListener('focus', () => { S.focus = row.path; });
        nameLine.appendChild(name);
        // below 1100 px the details pane is a sheet this button opens
        if (row.kind !== 'folder') {
            const info = el('button', 'dsb-info');
            info.type = 'button';
            info.setAttribute('aria-label', `Details of ${label}`);
            info.tabIndex = -1;
            const i = el('i', 'fas fa-circle-info');
            i.setAttribute('aria-hidden', 'true');
            info.appendChild(i);
            info.addEventListener('click', (e) => { e.stopPropagation(); select(row); root.classList.add('dsb-sheet'); });
            nameLine.appendChild(info);
        }
        if (row.is_link) nameLine.appendChild(el('span', 'dsb-badge dsb-badge-quiet', 'link'));
        if (row.path === services.currentPath()) nameLine.appendChild(el('span', 'dsb-badge dsb-badge-open', 'open'));
        const badge = matchBadge(row);
        if (badge) nameLine.appendChild(el('span', 'dsb-badge dsb-badge-match', badge));
        if (S.pinned && S.pinned.has(row.path)) {
            const star = el('i', 'fas fa-star dsb-pinned');
            star.title = 'Pinned';
            star.setAttribute('role', 'img');
            star.setAttribute('aria-label', 'Pinned');
            nameLine.appendChild(star);
        }
        th.appendChild(nameLine);
        // the folder a store lies in (search results, Recent), to tell stores of one name apart
        const rel = row.rel_path || '';
        const folder = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/') + 1) : '';
        if (folder && (searching() || place().kind !== 'folder')) {
            const relLine = el('div', 'dsb-rel dataset-name');
            relLine.title = row.path;
            appendWrapped(relLine, folder, compiled.empty || compiled.error ? [] : compiled.ranges(rel).filter(([a]) => a < folder.length).map(([a, b]) => [a, Math.min(b, folder.length)]));
            th.appendChild(relLine);
        } else if (!folder && isRemote(row.path)) {
            const relLine = el('div', 'dsb-rel dataset-name', row.path);
            relLine.title = row.path;
            th.appendChild(relLine);
        }
        if (row.error) th.appendChild(el('div', 'dsb-reason', row.error));
        const desc = el('span', 'visually-hidden', rowDescription(row));
        desc.id = describedBy;
        th.appendChild(desc);
        tr.appendChild(th);
        const cell = (cls, text, title) => { const td = el('td', cls, text); if (title) td.title = title; tr.appendChild(td); };
        const folderRow = row.kind === 'folder';
        cell('dsb-num', folderRow ? '' : countLabel(row.cells));
        cell('dsb-num', folderRow ? '' : countLabel(row.genes));
        cell('', folderRow ? '' : formatLabel(row.format));
        cell('', dateLabel(row.modified), row.modified ? dateTimeLabel(row.modified) : '');
        cell('', openedLabel(row.openedAt), row.openedAt ? dateTimeLabel(row.openedAt / 1000) : '');
        tr.addEventListener('click', () => select(row));
        tr.addEventListener('dblclick', () => activate(row));
        return tr;
    }

    // ---- choosing ------------------------------------------------------------------------

    function select(row) {
        if (!row) return;
        S.selected = row.path;
        S.focus = row.path;
        for (const tr of dom.tableWrap.querySelectorAll('tbody tr')) {
            const on = tr.dataset.path === row.path;
            tr.classList.toggle('selected', on);
            const b = tr.querySelector('.dsb-name');
            if (b) { if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); }
        }
        renderDetails(true);
    }

    /** Open a store, or enter a folder; an unreadable store only gets its reason shown. */
    function activate(row) {
        if (row.kind === 'folder') { goFolder(row.path); return; }
        if (row.error) { select(row); return; }
        choose(row.path);
    }

    async function choose(path) {
        if (!path || !S) return null;
        const onChoose = S.onChoose;
        hide();
        if (onChoose) await onChoose(path);
        return path;
    }

    // ---- the details pane ----------------------------------------------------------------

    function selectedRow() {
        if (!S || !S.selected) return null;
        return currentRows().rows.find(r => r.path === S.selected) || null;
    }

    /** What the listing already says of a row, in the shape of `/datasets/details`, for the first paint of the pane. */
    function listingMeta(row) {
        return {
            readable: !row.error, remote: isRemote(row.path), error: row.error || null, path: row.path, rel_path: row.rel_path || null,
            cells: row.cells, genes: row.genes, format: row.format, modified: row.modified, is_link: !!row.is_link, store_check: null
        };
    }

    /**
     * The details pane for the selected row. `force` draws it again (the selection or a pin changed); without it a pane
     * that already shows the selected row is left alone.
     */
    function renderDetails(force) {
        if (!S) return;
        const row = selectedRow();
        const key = row ? row.path : null;
        if (!force && S.detailsFor === key && (row || dom.details.firstChild)) return;
        S.detailsFor = key;
        clearTimeout(detailsTimer);
        if (detailsAbort) { detailsAbort.abort(); detailsAbort = null; }
        const pane = dom.details;
        pane.textContent = '';
        if (!row) {
            pane.appendChild(el('p', 'dsb-details-empty', 'Select a dataset to see what it holds.'));
            return;
        }
        const closeSheet = el('button', 'btn btn-sm btn-outline-secondary dsb-sheet-close', 'Close details');
        closeSheet.type = 'button';
        closeSheet.addEventListener('click', () => root.classList.remove('dsb-sheet'));
        pane.appendChild(closeSheet);
        pane.appendChild(el('h2', 'dsb-details-name', row.name || basename(row.path)));
        // The actions sit right under the name from the first paint and never move while the details arrive;
        // one that does not apply (Open for a store that cannot be opened) is disabled, not removed.
        const known = detailsCache.get(`${row.path}|0`) || null;
        const actions = el('div', 'dsb-actions');
        pane.appendChild(actions);
        const folder = row.kind === 'folder';
        const open = el('button', 'btn btn-sm btn-primary', folder ? 'Open folder' : 'Open');
        open.type = 'button';
        open.id = 'dsb-details-open';
        open.disabled = !folder && !!row.error;
        open.addEventListener('click', () => (folder ? goFolder(row.path) : choose(row.path)));
        actions.appendChild(open);
        const pinned = !folder && S.pinned.has(row.path);
        const pin = el('button', 'btn btn-sm btn-outline-secondary', pinned ? 'Unpin' : 'Pin');
        pin.type = 'button';
        pin.id = 'dsb-details-pin';
        pin.disabled = folder;
        pin.setAttribute('aria-pressed', String(pinned));
        pin.addEventListener('click', async () => {
            const now = services.togglePin({ path: row.path, label: services.label(row.path) });
            if (now) S.pinned.add(row.path); else S.pinned.delete(row.path);
            await loadQuick();
            S.detailsFor = undefined;
            render();
        });
        actions.appendChild(pin);
        const copy = el('button', 'btn btn-sm btn-outline-secondary', 'Copy path');
        copy.type = 'button';
        copy.id = 'dsb-details-copy';
        copy.addEventListener('click', async () => {
            const text = (known && known.path) || row.path;
            try { await services.copy(text); copy.textContent = 'Copied'; } catch { copy.textContent = 'Copy failed'; }
            setTimeout(() => { copy.textContent = 'Copy path'; }, 1500);
        });
        actions.appendChild(copy);
        if (folder) {
            pane.appendChild(el('p', 'dsb-details-path', row.path));
            return;
        }
        pane.appendChild(el('dl', 'dsb-fields'));
        pane.appendChild(el('div', 'dsb-details-body'));
        repaintDetails(row, known || listingMeta(row));
        if (!row.error) detailsTimer = setTimeout(() => loadDetails(row), known ? 0 : DETAILS_DELAY_MS);
    }

    async function loadDetails(row) {
        if (!S || S.selected !== row.path) return;
        const abort = detailsAbort = new AbortController();
        const url = (check) => `${services.urls.details}?path=${encodeURIComponent(row.path)}&check=${check}`;
        let meta = detailsCache.get(`${row.path}|0`);
        try {
            if (!meta) {
                const { ok, body } = await getJson(url(0), abort.signal);
                if (S.selected !== row.path || abort.signal.aborted) return;
                if (!ok) { showDetailsError(row, body.error || 'Not available'); return; }
                meta = body;
                detailsCache.set(`${row.path}|0`, meta);
            }
            repaintDetails(row, meta);
            // a local store is checked on its own (within the server's budget); a remote one on request
            if (!meta.remote && meta.readable && !detailsCache.has(`${row.path}|1`)) {
                const { ok, body } = await getJson(url(1), abort.signal);
                if (!S || S.selected !== row.path || abort.signal.aborted) return;
                if (ok) detailsCache.set(`${row.path}|1`, body);
            }
            if (S && S.selected === row.path && !abort.signal.aborted) repaintDetails(row, meta);
        } catch (e) {
            if (e && e.name === 'AbortError') return;
            if (S && S.selected === row.path) showDetailsError(row, (e && e.message) || 'The details could not be read');
        }
    }

    function showDetailsError(row, message) {
        const body = dom.details.querySelector('.dsb-details-body');
        if (!body) return;
        body.textContent = '';
        const p = el('p', 'dsb-reason', message);
        p.setAttribute('role', 'alert');
        body.appendChild(p);
    }

    function repaintDetails(row, meta) {
        const body = dom.details.querySelector('.dsb-details-body');
        const fields = dom.details.querySelector('.dsb-fields');
        if (!body || !fields) return;
        fields.textContent = '';
        body.textContent = '';
        const add = (term, value, cls) => {
            if (value === '' || value === null || value === undefined) return;
            fields.appendChild(el('dt', null, term));
            fields.appendChild(el('dd', cls || null, String(value)));
        };
        add('Path', meta.path === null || meta.path === undefined ? meta.rel_path : meta.path, 'dsb-details-path');
        add('Cells', countLabel(meta.cells));
        add('Genes', countLabel(meta.genes));
        add('Format', meta.format);
        add('Modified', meta.modified ? dateTimeLabel(meta.modified) : '');
        if (meta.size_bytes) add('File size', formatBytes(meta.size_bytes));
        if (meta.is_link && meta.link_target) add('Link to', meta.link_target, 'dsb-details-path');
        const badge = matchBadge(row);
        if (badge) add('This view', badge);
        if (!meta.readable) {
            const p = el('p', 'dsb-reason', meta.error || 'This store cannot be opened.');
            body.appendChild(p);
        }
        const chips = (title, items, total) => {
            if (!items || !items.length) return;
            const wrap = el('div', 'dsb-keys');
            wrap.appendChild(el('h3', null, `${title} (${total ?? items.length})`));
            const list = el('div', 'dsb-chiplist');
            for (const item of items.slice(0, 24)) list.appendChild(el('span', 'dsb-key', typeof item === 'string' ? item : item.name));
            if (items.length > 24 || (total && total > 24)) list.appendChild(el('span', 'dsb-key dsb-key-more', `+${(total || items.length) - 24}`));
            wrap.appendChild(list);
            body.appendChild(wrap);
        };
        chips('Obs', meta.obs_columns, meta.obs_columns_total);
        chips('Obsm', meta.obsm_keys, meta.obsm_total);
        chips('Layers', meta.layers_keys, meta.layers_total);
        // what the open panels use that this dataset lacks
        const missing = S.used && S.used.length && meta.readable && row.path !== services.currentPath() ? missingKeys(S.used, meta) : [];
        if (missing.length) {
            const warn = el('div', 'dsb-note dsb-note-warn');
            warn.id = 'dsb-missing-keys';
            warn.textContent = `The open panels use keys this dataset lacks: ${missing.map(m => `${m.key}: missing`).join(', ')}.`;
            body.appendChild(warn);
        }
        paintCheck(row, meta, body);
    }

    function paintCheck(row, meta, body) {
        const checked = detailsCache.get(`${row.path}|1`);
        const check = checked ? checked.store_check : meta.store_check;
        const box = el('div', 'dsb-check');
        box.id = 'dsb-check';
        if (!meta.readable) return;
        const sc = check || {};
        if (!sc.ran) {
            if (sc.reason === 'h5ad') box.textContent = sc.note || 'An .h5ad file is read whole: no chunk check applies.';
            else if (sc.reason === 'disabled') return;
            else if (sc.reason === 'unavailable') box.textContent = `The store check is not available${sc.error ? `: ${sc.error}` : ''}.`;
            else if (meta.remote) {
                const b = el('button', 'btn btn-sm btn-outline-secondary', 'Check chunking');
                b.type = 'button';
                b.id = 'dsb-check-run';
                b.addEventListener('click', async () => {
                    b.disabled = true;
                    b.textContent = 'Checking…';
                    try {
                        const { ok, body: result } = await getJson(`${services.urls.details}?path=${encodeURIComponent(row.path)}&check=1`);
                        if (ok) detailsCache.set(`${row.path}|1`, result);
                    } catch { /* shown below as not checked */ }
                    if (S && S.selected === row.path) repaintDetails(row, meta);
                });
                box.appendChild(b);
            } else {
                box.textContent = 'Checking the chunking…';
                box.dataset.state = 'checking';
            }
            body.appendChild(box);
            return;
        }
        const worst = sc.worst;
        const findings = sc.findings || [];
        box.classList.add(worst === 'warning' || worst === 'slow' ? 'dsb-note-warn' : 'dsb-note-ok', 'dsb-note');
        if (!findings.length) {
            box.textContent = sc.budget_reached ? `Checked part of the store in ${sc.budget_s} s: nothing found so far.` : 'Store check: no chunking problems found.';
        } else {
            const top = findings.slice().sort((a, b) => ['slow', 'warning', 'info'].indexOf(a.severity) - ['slow', 'warning', 'info'].indexOf(b.severity))[0];
            box.append(document.createTextNode(`Store check: ${top.summary}${findings.length > 1 ? ` (${findings.length} findings)` : ''} `));
            if (sc.docs) {
                const a = el('a', null, 'How to fix');
                a.href = sc.docs;
                a.target = '_blank';
                a.rel = 'noopener';
                box.appendChild(a);
            }
        }
        body.appendChild(box);
    }

    // ---- the banner and the footer -------------------------------------------------------

    function setBanner() {
        const banner = dom.banner;
        const lines = [];
        const pending = S.pending;
        const me = S.me || {};
        if (S.mode !== 'change' && pending) {
            const saved = pending.saved;
            const fp = saved && saved.fp;
            const counts = fp && Number.isFinite(fp.n_obs) ? ` (${fp.n_obs.toLocaleString('en-US')} cells x ${fp.n_var.toLocaleString('en-US')} genes)` : '';
            const was = saved ? services.label(saved.path) : (pending.missing || 'an unknown store');
            if (me.restricted) {
                lines.push(`This view was saved on ${was}, which is not available to you, or no longer exists. Its panels are kept. Choose a dataset to open them on.`);
                if (me.admin_contact) lines.push(`Ask ${me.admin_contact} for access.`);
            } else {
                lines.push(`This view was saved on ${was}${counts}` + (fp ? '.' : '; it records no fingerprint, so stores are matched by name only.'));
            }
        } else if (S.mode === 'change' && S.unavailableName) {
            lines.push(`${S.unavailableName} is not available to you, or no longer exists.`);
            if (me.admin_contact) lines.push(`Ask ${me.admin_contact} for access.`);
        }
        banner.textContent = '';
        banner.hidden = !lines.length;
        banner.classList.toggle('dsb-banner-warn', !!lines.length);
        lines.forEach(l => banner.appendChild(el('div', null, l)));
        banner.dataset.mode = S.mode;
    }

    function announceSoon() {
        clearTimeout(statusTimer);
        statusTimer = setTimeout(() => {
            if (!S) return;
            const { rows } = currentRows();
            const stores = rows.filter(r => r.kind === 'store').length;
            const folders = rows.filter(r => r.kind === 'folder').length;
            const sort = effectiveSort();
            const among = inFolderPlace() && !searching() && sort.key && !sort.server && S.listing.more ? S.listing.offset : null;
            let text = S.listing.loading && inFolderPlace() ? 'Loading…' : countSummary({ stores, folders, query: S.query, truncated: !!(S.remote && S.remote.truncated), sortedAmong: among });
            if (S.mode !== 'change' && S.me && S.me.restricted) text += '. Only datasets shared with you are listed.';
            dom.status.textContent = text;
        }, 200);
    }

    // ---- keyboard ------------------------------------------------------------------------

    function moveFocus(buttons, index) {
        const i = Math.max(0, Math.min(buttons.length - 1, index));
        const b = buttons[i];
        if (!b) return;
        buttons.forEach(x => { x.tabIndex = x === b ? 0 : -1; });
        b.focus();
        const row = currentRows().rows.find(r => r.path === b.closest('tr').dataset.path);
        if (row) select(row);
    }

    function onTableKey(e) {
        const button = e.target.closest && e.target.closest('.dsb-name');
        if (!button || e.ctrlKey || e.metaKey || e.altKey) return;
        const buttons = tbodyButtons();
        const index = buttons.indexOf(button);
        const path = button.closest('tr').dataset.path;
        const row = currentRows().rows.find(r => r.path === path);
        const step = { ArrowDown: 1, ArrowUp: -1, PageDown: 8, PageUp: -8 }[e.key];
        if (step) { e.preventDefault(); moveFocus(buttons, index + step); return; }
        if (e.key === 'Home') { e.preventDefault(); moveFocus(buttons, 0); return; }
        if (e.key === 'End') { e.preventDefault(); moveFocus(buttons, buttons.length - 1); return; }
        if (e.key === 'ArrowLeft' || e.key === 'Backspace') {
            if (inFolderPlace() && S.listing.parent && S.folder !== S.folderRoot) { e.preventDefault(); goFolder(S.listing.parent === undefined ? '' : S.listing.parent); }
            return;
        }
        if (e.key === 'ArrowRight') {
            if (row && row.kind === 'folder') { e.preventDefault(); goFolder(row.path); }
            return;
        }
        if (e.key === '/') { e.preventDefault(); dom.search.focus(); return; }
        if (e.key.length === 1 && !e.shiftKey || (e.key.length === 1 && e.shiftKey)) {
            clearTimeout(typeTimer);
            const rows = currentRows().rows;
            typeBuffer += e.key.toLowerCase();
            typeTimer = setTimeout(() => { typeBuffer = ''; }, TYPE_AHEAD_MS);
            const at = typeAheadIndex(rows, typeBuffer, index);
            if (at >= 0) { e.preventDefault(); moveFocus(buttons, at); }
        }
    }

    async function onSearchKey(e) {
        if (e.key === 'ArrowDown') {
            const buttons = tbodyButtons();
            if (buttons.length) { e.preventDefault(); moveFocus(buttons, Math.max(0, buttons.findIndex(b => b.tabIndex === 0))); }
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (!S.query) return;
            if (looksLikePath(S.query)) { await submitPath(S.query); return; }
            if (S.searching) await S.searching;
            if (!S) return;
            const rows = currentRows().rows.filter(r => !r.error);
            const first = rows.find(r => r.kind === 'store') || rows[0];
            if (first) activate(first);
        }
    }

    // ---- wiring --------------------------------------------------------------------------

    dom.search.addEventListener('input', () => {
        if (!S) return;
        S.query = dom.search.value;
        S.limit = PAGE;
        scheduleSearch();
        render();
    });
    dom.search.addEventListener('keydown', onSearchKey);
    dom.regex.addEventListener('click', () => {
        if (!S) return;
        S.regex = !S.regex;
        dom.regex.classList.toggle('active', S.regex);
        dom.regex.setAttribute('aria-pressed', String(S.regex));
        scheduleSearch();
        render();
        dom.search.focus();
    });
    dom.placesSelect.addEventListener('change', () => goPlace(dom.placesSelect.value));
    dom.tableWrap.addEventListener('keydown', onTableKey);
    dom.pathOpen.addEventListener('click', () => submitPath());
    dom.path.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); submitPath(); }
    });
    const nativeButtons = [dom.native];
    async function nativeClick(which) {
        if (!services.nativeOpen) return;
        let picked;
        try { picked = await services.nativeOpen(which); } catch { picked = null; }
        const path = typeof picked === 'string' ? picked : picked && picked.path;
        if (path) await choose(path);
    }
    dom.native.addEventListener('click', () => nativeClick(dom.native.dataset.which || undefined));

    // Escape closes the path field first, then the dialog
    root.addEventListener('keydown', (e) => {
        if (!S) return;
        if (e.key === 'Escape' && S.pathOpen) { e.preventDefault(); e.stopImmediatePropagation(); closePathField(); (tbodyButtons()[0] || dom.search).focus(); return; }
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'l') { e.preventDefault(); openPathField(); }
    }, true);
    root.addEventListener('shown.bs.modal', () => {
        shown = true;
        dom.search.focus();
        dom.search.select();
    });
    root.addEventListener('hidden.bs.modal', () => {
        shown = false;
        root.classList.remove('dsb-sheet');
        clearTimeout(searchTimer);
        clearTimeout(detailsTimer);
        if (searchAbort) searchAbort.abort();
        if (detailsAbort) detailsAbort.abort();
        const target = returnFocus && document.contains(returnFocus) ? returnFocus : document.getElementById('dataset-button');
        const resolve = S && S.resolve;
        S = null;
        if (target && target.focus) target.focus();
        if (resolve) resolve(null);
    });

    // The dialog is closing from the moment it starts to hide (Escape, the close button, a choice) until its `hidden`
    // event, which ends the state: a dialog opened in between must wait for that event, not be ended by it.
    root.addEventListener('hide.bs.modal', () => {
        closing = true;
        hiddenPromise = new Promise(resolve => root.addEventListener('hidden.bs.modal', () => { hiddenPromise = null; resolve(); }, { once: true }));
    });

    /** One "Open file or folder..." button, or on Windows and Linux one per kind (the system has no dialog for both). */
    function configureNative() {
        dom.native.hidden = !services.nativeOpen;
        for (const extra of nativeButtons.slice(1)) extra.remove();
        nativeButtons.length = 1;
        if (!services.nativeOpen) return;
        const kinds = services.nativeKinds || [undefined];
        if (kinds.length === 1) {
            dom.native.dataset.which = '';
            dom.native.innerHTML = '<i class="fas fa-folder-open" aria-hidden="true"></i> Open file or folder&hellip;';
            return;
        }
        const labels = { h5ad: 'Open .h5ad File\u2026', zarr: 'Open .zarr Folder\u2026' };
        kinds.forEach((kind, i) => {
            let b = dom.native;
            if (i > 0) {
                b = dom.native.cloneNode(true);
                b.id = `dsb-open-native-${kind}`;
                b.addEventListener('click', () => nativeClick(kind));
                dom.native.after(b);
                nativeButtons.push(b);
            }
            b.dataset.which = kind;
            b.innerHTML = `<i class="fas fa-folder-open" aria-hidden="true"></i> ${labels[kind]}`;
            b.classList.toggle('me-2', true);
        });
    }

    function hide() {
        if (shown || root.classList.contains('show')) modal.hide();
    }

    // ---- opening -------------------------------------------------------------------------

    /**
     * Show the browser.
     * @param {Object} [options]
     * @param {'change'|'view'|'set'} [options.mode] - change the dataset; choose one for a view that has none; choose one for a panel set
     * @param {{view?: Object, saved?: Object|null, missing?: string|null}} [options.pending] - the view being given a dataset
     * @param {(path: string) => Promise|void} options.onChoose
     * @param {string} [options.query] - search text to start with
     * @param {string} [options.unavailableName] - a dataset the user may not read (a revoked grant), named in the banner
     * @returns {Promise<null>} resolves when the dialog has closed
     */
    async function open(options = {}) {
        // one that is still closing has to finish first (its `hidden` event ends its state, not the new one's)
        if (S) hide();
        if (hiddenPromise) await hiddenPromise;
        closing = false;
        S = freshState(options);
        S.unavailableName = options.unavailableName || null;
        S.pinned = new Set();
        S.viewMatches = false;
        returnFocus = document.activeElement && document.activeElement !== document.body ? document.activeElement : document.getElementById('dataset-button');
        const closed = new Promise(resolve => { S.resolve = resolve; });
        dom.title.textContent = S.mode === 'change' ? 'Open a dataset' : S.mode === 'set' ? 'Choose a dataset for this panel set' : 'Choose a dataset for this view';
        dom.search.value = S.query;
        dom.regex.classList.remove('active');
        dom.regex.setAttribute('aria-pressed', 'false');
        configureNative();
        dom.hintPath.textContent = services.shortcut.path;
        dom.tableWrap.textContent = '';
        dom.tableWrap.appendChild(el('div', 'dsb-state', 'Loading…'));
        dom.details.textContent = '';
        dom.pathError.hidden = true;
        closePathField();
        S.places = buildPlaces({ me: null, rootEntries: [] });
        modal.show();
        const mine = S;
        const [me] = await Promise.all([services.me().catch(() => null)]);
        if (S !== mine) return closed;
        S.me = me;
        const stored = services.stored();
        S.pinned = new Set(stored.pins.map(p => p.path));
        setBanner();
        // the first page of the root listing: the admin roots and the grants are places
        const saved = (S.pending && S.pending.saved) || null;
        const [, candidates, used] = await Promise.all([
            loadQuick(),
            services.candidates(saved).catch(() => []),
            S.mode === 'change' ? services.usedKeys().catch(() => []) : Promise.resolve([])
        ]);
        if (S !== mine) return closed;
        S.used = used || [];
        for (const c of candidates || []) if (c.match && c.match !== 'other') S.matchOf.set(c.path, c);
        S.viewMatches = !!saved;
        S.filters.matches = false;
        S.folder = '';
        S.placeId = 'root';
        await loadFolder();
        if (S !== mine) return closed;
        S.places = buildPlaces({ me, rootEntries: S.rootEntries });
        const anyMatch = [...S.matchOf.values()].some(c => matchesView(c));
        // where to land: the stores that match a view without data, else Recent when there is any, else the data directory
        if (S.mode !== 'change' && anyMatch) S.filters.matches = true;
        const landOnRecent = !S.query && S.mode === 'change' && S.recents.length > 0;
        S.ready = true;
        scheduleSearch();
        if (options.startFolder) {
            // a folder the desktop app was handed: the place that holds it, then the folder itself
            const holder = S.places.find(p => p.kind === 'folder' && p.folder && options.startFolder.startsWith(p.folder.replace(/\/+$/, '') + '/'));
            if (holder) { S.placeId = holder.id; S.folderRoot = holder.folder; }
            goFolder(options.startFolder);
        } else if (landOnRecent) goPlace('recent');
        else render();
        return closed;
    }

    return { open, close: hide, isOpen: () => !!S && !closing };
}
