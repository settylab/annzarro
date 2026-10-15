/**
 * How the desktop app decides what a path is and what to do with it, as pure
 * functions (no Electron; the file system is passed in) so
 * annzarro/tests/js/desktop-dataset-open.test.mjs can test them.
 * dataset-open.js does the I/O around them.
 *
 *   - classifyPath      .h5ad file, zarr store, plain folder, or not ours
 *   - pickOpenTarget    several items at once (a drop, a launch): open the first
 *   - recents           the persisted Open Recent list
 *   - argvPaths         the paths a launch or a second launch was asked to open
 *   - createOpenQueue   paths that arrive before the page can open them
 *   - fileMenuItems / menuTemplate   the File menu, per platform
 */
'use strict';

const RECENT_CAP = 10;
const NOT_A_DATASET = 'AnnZarro opens .zarr folders and .h5ad files.';

/** The last segment of a path, whatever its separators. */
function baseName(p) {
    return String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop();
}

/**
 * Whether a directory looks like a zarr store: the server's own rules
 * (annzarro/server/routes/dataset_folders.py is_store_dir) plus the root
 * metadata files of zarr 2 (.zgroup, .zattrs) and 3 (zarr.json).
 * `fs` is the subset of node:fs used: existsSync.
 */
function isStoreDir(dir, fs, join) {
    if (/\.zarr$/i.test(baseName(dir))) return true;
    const names = ['.zgroup', '.zarray', '.zattrs', 'zarr.json', 'X', 'obs', 'var', 'obsm', 'layers'];
    return names.some((n) => fs.existsSync(join(dir, n)));
}

/**
 * What a local path is, for opening.
 *   {kind: 'h5ad' | 'zarr' | 'folder' | 'other' | 'missing', path}
 * `other` is a file that is not an .h5ad (or a path that is neither file nor
 * folder); `folder` a directory that is not a store (the browser can open on
 * it as a place). Remote URLs are not ours to classify: the page opens them.
 */
function classifyPath(p, fs, join) {
    const path = String(p || '');
    if (!path) return { kind: 'missing', path };
    let st;
    try {
        st = fs.statSync(path);
    } catch (err) {
        return { kind: 'missing', path };
    }
    if (st.isDirectory()) {
        return { kind: isStoreDir(path, fs, join) ? 'zarr' : 'folder', path };
    }
    if (st.isFile() && /\.h5ad$/i.test(path)) return { kind: 'h5ad', path };
    return { kind: 'other', path };
}

/** The sentence to show for a path that cannot be opened, or null if it can. */
function refusal(classified) {
    const name = baseName(classified.path);
    if (classified.kind === 'missing') return `${name || 'That path'} does not exist (any more).`;
    if (classified.kind === 'other') return `${name} is not a dataset. ${NOT_A_DATASET}`;
    return null;
}

/** The first of several items to open, and how many are left unopened. */
function pickOpenTarget(paths) {
    const list = (paths || []).filter((p) => typeof p === 'string' && p);
    return { path: list[0] || null, extra: Math.max(0, list.length - 1) };
}

/** The line to tell the user when more than one item was handed over. */
function extraNotice(path, extra) {
    if (!extra) return null;
    return `Opening ${baseName(path)}. AnnZarro shows one dataset at a time, so the other ${extra === 1 ? 'item was' : `${extra} items were`} not opened.`;
}

// ── Open Recent ──────────────────────────────────────────────────────────

/** Parse the persisted list: an array of distinct non-empty strings, capped. */
function parseRecents(text, cap = RECENT_CAP) {
    let data;
    try {
        data = JSON.parse(text);
    } catch (err) {
        return [];
    }
    const list = Array.isArray(data) ? data : (data && Array.isArray(data.recent) ? data.recent : []);
    const out = [];
    for (const p of list) {
        if (typeof p === 'string' && p && !out.includes(p)) out.push(p);
    }
    return out.slice(0, cap);
}

/** `path` first, any earlier entry of it dropped, at most `cap` kept. */
function addRecent(list, path, cap = RECENT_CAP) {
    if (!path) return list.slice(0, cap);
    return [path, ...list.filter((p) => p !== path)].slice(0, cap);
}

function removeRecent(list, path) {
    return list.filter((p) => p !== path);
}

function serializeRecents(list) {
    return JSON.stringify({ recent: list }, null, 2);
}

/**
 * Menu labels for the list: the name, or the whole path where two entries
 * share a name.
 */
function recentLabels(list) {
    const count = new Map();
    for (const p of list) count.set(baseName(p), (count.get(baseName(p)) || 0) + 1);
    return list.map((p) => ({ path: p, label: count.get(baseName(p)) > 1 ? p : baseName(p) }));
}

// ── Launch arguments ─────────────────────────────────────────────────────

/**
 * The paths a launch asked to open. `argv` is process.argv or the command
 * line of a second launch. Electron's own switches (--x) and the app path of
 * an unpackaged run (`electron .`) are not paths; neither is anything that
 * looks like a switch of Chromium's or macOS's (-psn_...).
 */
function argvPaths(argv, defaultApp) {
    const rest = (argv || []).slice(defaultApp ? 2 : 1);
    return rest.filter((a) => typeof a === 'string' && a && !a.startsWith('-') && !/^[a-z][a-z0-9+.-]*:\/\//i.test(a));
}

// ── Paths that arrive before the page is ready ───────────────────────────

/**
 * The paths asked for while the page cannot open them (the server is still
 * starting, the window is on the error page). `push` while not ready holds
 * them; `markReady` hands what is held to `flush(paths)` once, and later
 * pushes go straight through. `markBusy` holds again (a restart).
 */
function createOpenQueue(flush) {
    let ready = false;
    let held = [];
    return {
        push(paths) {
            const list = [].concat(paths).filter(Boolean);
            if (!list.length) return;
            if (ready) flush(list);
            else held.push(...list);
        },
        markReady() {
            ready = true;
            if (held.length) {
                const list = held;
                held = [];
                flush(list);
            }
        },
        markBusy() {
            ready = false;
        },
        get size() {
            return held.length;
        },
    };
}

// ── Menu ─────────────────────────────────────────────────────────────────

/**
 * The File menu's own items, as plain descriptors: {id, label, accelerator,
 * action, enabled, ...} (`action` names what main.js runs). macOS has one
 * dialog for a file or a folder; Windows and Linux cannot show one, so
 * they get an item each.
 */
function fileMenuItems({ platform, recents }) {
    const items = [
        { id: 'open-dataset', label: 'Open Dataset...', accelerator: 'CmdOrCtrl+O', action: 'open-browser' },
    ];
    if (platform === 'darwin') {
        items.push({ id: 'open-path', label: 'Open File or Folder...', accelerator: 'CmdOrCtrl+Shift+O', action: 'open-path' });
    } else {
        items.push({ id: 'open-h5ad', label: 'Open .h5ad File...', accelerator: 'CmdOrCtrl+Shift+O', action: 'open-h5ad' });
        items.push({ id: 'open-zarr', label: 'Open .zarr Folder...', action: 'open-zarr' });
    }
    const labelled = recentLabels(recents || []);
    const recentItems = labelled.length
        ? labelled.map((r) => ({ label: r.label, toolTip: r.path, action: 'open-recent', path: r.path }))
        : [{ label: 'No Recent Datasets', enabled: false }];
    recentItems.push({ type: 'separator' });
    recentItems.push({ id: 'clear-recent', label: 'Clear Menu', action: 'clear-recent', enabled: labelled.length > 0 });
    items.push({ id: 'open-recent', label: 'Open Recent', submenu: recentItems });
    items.push({ type: 'separator' });
    items.push({ id: 'refresh-dataset', label: 'Refresh Dataset', action: 'refresh' });
    return items;
}

/**
 * The application menu: the platform's standard menus around our File menu.
 * The in-app updates add their items to the app menu (macOS) or Help
 * (elsewhere) after this (updates.js installMenu).
 */
function menuTemplate({ platform, recents }) {
    const mac = platform === 'darwin';
    const file = [
        ...fileMenuItems({ platform, recents }),
        { type: 'separator' },
        mac ? { role: 'close' } : { role: 'quit' },
    ];
    return [
        ...(mac ? [{ role: 'appMenu' }] : []),
        { label: 'File', submenu: file },
        { role: 'editMenu' },
        { role: 'viewMenu' },
        { role: 'windowMenu' },
        { role: 'help', submenu: [] },
    ];
}

/** The dialog options for each way of choosing a path. */
function dialogOptions(which, platform) {
    if (which === 'h5ad') {
        return { title: 'Open .h5ad File', properties: ['openFile'], filters: [{ name: 'AnnData h5ad', extensions: ['h5ad'] }, { name: 'All Files', extensions: ['*'] }] };
    }
    if (which === 'zarr') {
        return { title: 'Open .zarr Folder', properties: ['openDirectory'] };
    }
    // macOS can show one dialog for both. Elsewhere a combination would show a folder picker only.
    if (platform === 'darwin') {
        return { title: 'Open File or Folder', properties: ['openFile', 'openDirectory'], filters: [{ name: 'AnnData h5ad', extensions: ['h5ad'] }, { name: 'All Files', extensions: ['*'] }] };
    }
    return dialogOptions('h5ad', platform);
}

module.exports = {
    RECENT_CAP,
    NOT_A_DATASET,
    baseName,
    isStoreDir,
    classifyPath,
    refusal,
    pickOpenTarget,
    extraNotice,
    parseRecents,
    addRecent,
    removeRecent,
    serializeRecents,
    recentLabels,
    argvPaths,
    createOpenQueue,
    fileMenuItems,
    menuTemplate,
    dialogOptions,
};
