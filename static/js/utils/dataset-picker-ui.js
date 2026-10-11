/**
 * The dataset picker's DOM (#change-dataset-modal): search with a regex
 * toggle, sort, grouped rows (the full name wrapped, never cut), a lazy tree
 * of the data directory's folders, keyboard use and an incremental render.
 * The logic is in dataset-picker.js; main.js decides what choosing a row does.
 *
 * Focus stays in the search field; the arrow keys move a highlighted row
 * (aria-activedescendant), Enter opens it (or expands a folder).
 */
import {
    searchEntries, sortEntries, buildGroups, pageGroups, splitByRanges,
    countsLabel, modifiedLabel, searchParts, folderOf, entryMatches, basename
} from './dataset-picker.js';

const PAGE = 200;

/** Append `text` to `parent`, in `hit` spans where `ranges` say, with a <wbr> after each / _ . - so long names wrap there first. */
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

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
}

/**
 * Show the picker's rows in `dom.list` and wire its controls. Calling it
 * again (the modal is reused) replaces the earlier wiring.
 * @param {Object} o
 * @param {Object} o.dom - {list, tree, search, regexBtn, sortSel, searchError}
 * @param {Array} o.entries - listing entries with `match` (orderCandidates), unreadable ones with `error`
 * @param {string[]} o.recents - recent paths, newest first
 * @param {string|null} o.currentPath - the open dataset (marked)
 * @param {(path:string) => void} o.onChoose
 * @param {(folder:string, offset:number) => Promise<Object>} o.fetchFolder - the folder endpoint's body
 * @param {(query:string, regex:boolean, signal:AbortSignal) => Promise<Object>} [o.fetchSearch] - the search endpoint's body, for stores in folders not expanded
 * @param {number} [o.debounceMs] - quiet time before that search is sent
 * @param {string} [o.otherTitle]
 * @param {string} [o.emptyText]
 * @param {string} [o.query] - search text to start with
 * @returns {{focus: Function, render: Function}}
 */
export function mountDatasetPicker({ dom, entries, recents, currentPath, onChoose, fetchFolder, fetchSearch = null, debounceMs = 300, otherTitle, emptyText = 'No datasets in the data directory.', query = '' }) {
    const { list, tree, search, regexBtn, sortSel, searchError } = dom;
    const state = { regex: false, sort: 'best', limit: PAGE, active: -1, tree: new Map(), remote: null };
    let remoteTimer = null;
    let remoteAbort = null;
    let rows = [];            // the navigable rows, in DOM order

    search.value = query;
    sortSel.value = 'best';
    regexBtn.classList.remove('active');
    regexBtn.setAttribute('aria-pressed', 'false');
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', 'Datasets');
    search.setAttribute('aria-controls', list.id);

    const sameStore = (a, b) => !!a && !!b && a === b;

    function storeRow(entry, compiled, { nested = false } = {}) {
        const row = el('div', 'change-dataset-item' + (nested ? ' change-dataset-nested' : ''));
        row.setAttribute('role', nested ? 'treeitem' : 'option');
        row.dataset.path = entry.path;
        row.dataset.match = entry.match || '';
        const label = el('div', 'change-dataset-label');
        const { name, rel } = searchParts(entry);
        const folder = folderOf(entry);
        const nameRanges = compiled.empty || compiled.error ? [] : compiled.ranges(name);
        const nameLine = el('div', 'change-dataset-name dataset-name');
        appendWrapped(nameLine, name, nameRanges);
        if (sameStore(entry.path, currentPath)) nameLine.appendChild(el('span', 'badge text-bg-primary ms-2 change-dataset-current', 'current'));
        label.appendChild(nameLine);
        if (folder) {
            // a quiet second line: the folder, to tell two stores of one name apart
            const relRanges = compiled.empty || compiled.error ? [] : compiled.ranges(rel).filter(([a]) => a < folder.length)
                .map(([a, b]) => [a, Math.min(b, folder.length)]);
            const relLine = el('div', 'change-dataset-rel dataset-name');
            relLine.title = rel;
            appendWrapped(relLine, folder, relRanges);
            label.appendChild(relLine);
        }
        const bits = [countsLabel(entry), entry.format, modifiedLabel(entry), entry.is_link ? 'link' : '']
            .filter(Boolean);
        const fields = entry.cmp && entry.cmp.level === 'fields' && entry.cmp.changes && entry.cmp.changes.length
            ? `fields differ: ${entry.cmp.changes.slice(0, 3).join('; ')}` : '';
        if (fields) bits.push(fields);
        if (bits.length) label.appendChild(el('div', 'change-dataset-meta', bits.join(' · ')));
        if (entry.error) {
            row.classList.add('change-dataset-unreadable');
            row.setAttribute('aria-disabled', 'true');
            label.appendChild(el('div', 'change-dataset-reason', entry.error));
            row.appendChild(label);
            return row;
        }
        const button = el('button', 'btn btn-sm btn-outline-primary', 'Open');
        button.type = 'button';
        button.tabIndex = -1;
        button.addEventListener('click', (e) => { e.stopPropagation(); onChoose(entry.path); });
        row.addEventListener('click', () => onChoose(entry.path));   // anywhere on the row, as the button
        row.append(label, button);
        return row;
    }

    function folderRow(folder, node, depth) {
        const row = el('div', 'change-dataset-folder');
        row.setAttribute('role', 'treeitem');
        row.setAttribute('aria-expanded', String(node.open));
        row.dataset.folder = folder.path;
        row.style.setProperty('--depth', depth);
        const caret = el('span', 'change-dataset-caret', node.open ? '▾' : '▸');
        caret.setAttribute('aria-hidden', 'true');
        const name = el('span', 'change-dataset-folder-name');
        appendWrapped(name, folder.name);
        row.append(caret, name);
        if (folder.is_link) row.appendChild(el('span', 'change-dataset-meta ms-2', 'link'));
        row.addEventListener('click', () => toggleFolder(folder.path));
        return row;
    }

    async function toggleFolder(path) {
        const node = state.tree.get(path) || { open: false, loaded: false, entries: [], offset: 0, more: false, total: 0 };
        state.tree.set(path, node);
        node.open = !node.open;
        if (node.open && !node.loaded) await loadFolder(path, node);
        render();
    }

    async function loadFolder(path, node) {
        node.loading = true;
        node.error = null;
        render();
        try {
            const page = await fetchFolder(path, node.offset);
            node.entries.push(...page.entries);
            node.offset += page.entries.length;
            node.more = !!page.more;
            node.total = page.total;
            node.loaded = true;
        } catch (e) {
            node.error = (e && e.message) || 'The folder could not be listed';
            node.open = false;
        }
        node.loading = false;
    }

    function treeRows(container, path, compiled, depth) {
        const node = state.tree.get(path);
        if (!node || !node.open) return;
        const folders = node.entries.filter(e => e.kind === 'folder');
        const stores = sortEntries(searchEntries(node.entries.filter(e => e.kind === 'store'), search.value, { regex: state.regex }).entries, state.sort);
        for (const f of folders) {
            container.appendChild(folderRow(f, state.tree.get(f.path) || { open: false }, depth));
            treeRows(container, f.path, compiled, depth + 1);
        }
        for (const s of stores) {
            const row = storeRow(s, compiled, { nested: true });
            row.style.setProperty('--depth', depth);
            container.appendChild(row);
        }
        if (node.loading) container.appendChild(el('div', 'change-dataset-status', 'Loading...'));
        if (node.loaded && !node.entries.length) container.appendChild(el('div', 'change-dataset-status', `No datasets in ${path || 'the data directory'}`));
        if (node.more) {
            const more = el('button', 'btn btn-sm btn-link change-dataset-more', `Show more (${node.total - node.offset} left in this folder)`);
            more.type = 'button';
            more.addEventListener('click', async () => { await loadFolder(path, node); render(); });
            container.appendChild(more);
        }
    }

    function render() {
        const found = searchEntries(entries, search.value, { regex: state.regex });
        searchError.hidden = !found.error;
        searchError.textContent = found.error || '';
        const sorted = buildGroups(found.entries, { recents, otherTitle })
            .map(g => ({ ...g, entries: g.key === 'recent' ? g.entries : sortEntries(g.entries, state.sort) }));
        const page = pageGroups(sorted, state.limit);
        const activePath = rows[state.active] && (rows[state.active].dataset.path || rows[state.active].dataset.folder);
        list.textContent = '';
        for (const g of page.groups) {
            const group = el('div', 'change-dataset-group');
            group.setAttribute('role', 'group');
            group.setAttribute('aria-label', g.title);
            group.appendChild(el('h6', null, g.title));
            for (const entry of g.entries) group.appendChild(storeRow(entry, found));
            list.appendChild(group);
        }
        if (page.remaining > 0) {
            const more = el('button', 'btn btn-sm btn-link change-dataset-more', `Show ${Math.min(PAGE, page.remaining)} more (${page.remaining} not shown)`);
            more.type = 'button';
            more.addEventListener('click', () => { state.limit += PAGE; render(); });
            list.appendChild(more);
        }
        if (!page.groups.length && (found.empty || !fetchSearch)) {
            const none = found.entries.length === 0 && entries.length > 0
                ? 'No dataset matches the search.' : emptyText;
            list.appendChild(el('div', 'change-dataset-status', none));
        }
        // stores of folders not expanded, found by the server (a search with text)
        const remote = state.remote && state.remote.key === remoteKey() ? state.remote : null;
        if (!found.empty && !found.error && fetchSearch) {
            const local = new Set(entries.map(e => e.path));
            const rows = remote && remote.entries ? remote.entries.filter(e => !local.has(e.path)) : [];
            const group = el('div', 'change-dataset-group');
            group.setAttribute('role', 'group');
            group.setAttribute('aria-label', 'In subfolders');
            group.appendChild(el('h6', null, 'In subfolders'));
            if (!remote) group.appendChild(el('div', 'change-dataset-status', 'Searching subfolders...'));
            else if (remote.error) group.appendChild(el('div', 'change-dataset-status text-danger', remote.error));
            else {
                for (const entry of rows) group.appendChild(storeRow(entry, found));
                if (!rows.length) group.appendChild(el('div', 'change-dataset-status', 'No match in subfolders.'));
                if (remote.truncated) group.appendChild(el('div', 'change-dataset-status', 'The search stopped at its limit; narrow it to see more.'));
            }
            list.appendChild(group);
        }
        // the data directory's folders, expanded lazily one at a time
        tree.textContent = '';
        tree.setAttribute('role', 'tree');
        tree.setAttribute('aria-label', 'Browse folders');
        const treeBox = el('div', 'change-dataset-group');
        treeBox.appendChild(el('h6', null, 'Browse folders'));
        const rootNode = state.tree.get('') || { open: false };
        treeBox.appendChild(folderRow({ path: '', name: 'Data directory' }, rootNode, 0));
        if (state.tree.get('') && state.tree.get('').error) treeBox.appendChild(el('div', 'change-dataset-status text-danger', state.tree.get('').error));
        treeRows(treeBox, '', found, 1);
        tree.appendChild(treeBox);

        rows = [...document.querySelectorAll('#' + list.id + ' .change-dataset-item:not(.change-dataset-unreadable), #' + tree.id + ' .change-dataset-item, #' + tree.id + ' .change-dataset-folder')];
        rows.forEach((r, i) => { r.id = `${list.id}-row-${i}`; });
        const keep = activePath ? rows.findIndex(r => (r.dataset.path || r.dataset.folder) === activePath) : -1;
        setActive(keep >= 0 ? keep : (search.value && rows.length ? 0 : -1), false);
    }

    const remoteKey = () => `${state.regex ? 'regex' : 'substring'}:${search.value}`;

    /** Ask the server for stores in folders not expanded, once the typing pauses. */
    function scheduleRemote() {
        clearTimeout(remoteTimer);
        if (remoteAbort) remoteAbort.abort();
        state.remote = null;
        if (!fetchSearch || !search.value || searchEntries([], search.value, { regex: state.regex }).error) return;
        const key = remoteKey();
        remoteTimer = setTimeout(async () => {
            remoteAbort = new AbortController();
            try {
                const body = await fetchSearch(search.value, state.regex, remoteAbort.signal);
                if (key !== remoteKey()) return;
                state.remote = { key, entries: body.results || [], truncated: !!body.truncated };
            } catch (e) {
                if (e && e.name === 'AbortError') return;
                if (key !== remoteKey()) return;
                state.remote = { key, error: (e && e.message) || 'The search failed' };
            }
            render();
        }, debounceMs);
    }

    function setActive(index, scroll = true) {
        state.active = index;
        rows.forEach((r, i) => {
            const on = i === index;
            r.classList.toggle('active', on);
            r.setAttribute('aria-selected', String(on));
        });
        if (index >= 0 && rows[index]) {
            search.setAttribute('aria-activedescendant', rows[index].id);
            if (scroll && rows[index].scrollIntoView) rows[index].scrollIntoView({ block: 'nearest' });
        } else {
            search.removeAttribute('aria-activedescendant');
        }
    }

    search.oninput = () => { state.limit = PAGE; state.active = -1; scheduleRemote(); render(); };
    search.onkeydown = (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!rows.length) return;
            const step = e.key === 'ArrowDown' ? 1 : -1;
            setActive(state.active < 0 ? (step > 0 ? 0 : rows.length - 1) : (state.active + step + rows.length) % rows.length);
        } else if (e.key === 'Enter') {
            const row = rows[state.active];
            if (!row) return;
            e.preventDefault();
            if (row.dataset.path) onChoose(row.dataset.path);
            else toggleFolder(row.dataset.folder);
        }
    };
    regexBtn.onclick = () => {
        state.regex = !state.regex;
        scheduleRemote();
        regexBtn.classList.toggle('active', state.regex);
        regexBtn.setAttribute('aria-pressed', String(state.regex));
        render();
        search.focus();
    };
    sortSel.onchange = () => { state.sort = sortSel.value; render(); };

    scheduleRemote();
    render();
    return { focus: () => search.focus(), render };
}
