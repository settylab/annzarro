/**
 * Opening datasets from the desktop app: the File menu, the native dialogs,
 * drag and drop, "Open With" / double click (macOS open-file, argv elsewhere),
 * the Open Recent list. The decisions are in dataset-open-logic.js; this file
 * does the I/O. The page opens a dataset when asked through
 * `window.annzarro.openDataset(path)` (static/js/utils/dataset-state.js, the
 * desktop contract); this module never reads a dataset itself.
 *
 * Dependencies are passed in, as updates.js does:
 *   app, dialog, Menu, log, getWindow, getPageUrl (the local server's URL or null)
 *   userDataDir     where recent-datasets.json lives
 *   platform        process.platform (tests)
 *   onMenuBuilt     called after the application menu was replaced (the
 *                   updater adds its items to the new one)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const logic = require('./dataset-open-logic');

const RECENT_FILE = 'recent-datasets.json';
// How long a call waits for the page to install window.annzarro.openDataset.
const PAGE_WAIT_MS = 30 * 1000;

function createDatasetOpener(deps) {
    const { app, dialog, Menu, log, getWindow, userDataDir, onMenuBuilt } = deps;
    const platform = deps.platform || process.platform;
    const recentFile = path.join(userDataDir, RECENT_FILE);
    let recents = [];

    const queue = logic.createOpenQueue((paths) => {
        const { path: first, extra } = logic.pickOpenTarget(paths);
        openFirst(first, extra).catch((err) => log.error(`Opening ${first} failed: ${err.message}`));
    });

    // ── Recent list ──────────────────────────────────────────────────────

    function loadRecents() {
        try {
            recents = logic.parseRecents(fs.readFileSync(recentFile, 'utf8'));
        } catch (err) {
            recents = [];
        }
    }

    function saveRecents() {
        try {
            fs.mkdirSync(path.dirname(recentFile), { recursive: true });
            fs.writeFileSync(recentFile, logic.serializeRecents(recents));
        } catch (err) {
            log.warn(`Could not save the recent datasets: ${err.message}`);
        }
    }

    function noteOpened(p) {
        recents = logic.addRecent(recents, p);
        saveRecents();
        app.addRecentDocument(p);
        buildMenu();
    }

    function forget(p) {
        recents = logic.removeRecent(recents, p);
        saveRecents();
        buildMenu();
    }

    function clearRecents() {
        recents = [];
        saveRecents();
        app.clearRecentDocuments();
        buildMenu();
    }

    // ── Talking to the page ──────────────────────────────────────────────

    /** Run `window.annzarro.openDataset(path)` in the page; it never rejects. */
    async function openInPage(p) {
        const win = getWindow();
        if (!win || win.isDestroyed()) return { ok: false, error: 'There is no window to open it in.' };
        const code = `(async () => {
            const t = Date.now();
            while (!(window.annzarro && window.annzarro.openDataset)) {
                if (Date.now() - t > ${PAGE_WAIT_MS}) return { ok: false, error: 'The page did not start.' };
                await new Promise((r) => setTimeout(r, 100));
            }
            return window.annzarro.openDataset(${JSON.stringify(p)});
        })()`;
        try {
            return await win.webContents.executeJavaScript(code);
        } catch (err) {
            return { ok: false, error: err.message };
        }
    }

    /**
     * Ask the page to open its dataset browser, optionally on a folder. Both
     * ways the page can listen: the IPC event behind window.api.onMenuOpenDataset
     * and the DOM event 'annzarro:open-dataset-browser' (cancelable; detail.path
     * is the folder). Resolves to whether a page listener took the event.
     */
    async function openBrowser(folder = null) {
        const win = getWindow();
        if (!win || win.isDestroyed()) return false;
        win.webContents.send('app:menu-open-dataset', folder);
        const detail = JSON.stringify({ path: folder });
        try {
            return await win.webContents.executeJavaScript(`(() => {
                const e = new CustomEvent('annzarro:open-dataset-browser', { detail: ${detail}, cancelable: true });
                document.dispatchEvent(e);
                return e.defaultPrevented;
            })()`);
        } catch (err) {
            return false;
        }
    }

    function tell(message, detail) {
        const win = getWindow();
        log.info(`Told the user: ${message}`);
        const options = { type: 'info', message, detail: detail || undefined, buttons: ['OK'] };
        const shown = win && !win.isDestroyed() ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options);
        shown.catch(() => {});
    }

    function setRepresented(p) {
        const win = getWindow();
        if (platform !== 'darwin' || !win || win.isDestroyed()) return;
        win.setRepresentedFilename(p || '');
    }

    // ── Opening ──────────────────────────────────────────────────────────

    /**
     * Validate a local path and have the page open it. Returns
     * {path, kind, result} (result: what the page answered) or, for a path
     * that is refused, {path, kind, error}. A plain folder goes to the
     * browser as a place when the page supports that.
     *   opts.allowFolder  a plain folder is a place to browse (the dialog),
     *                     not a mistake (a drop)
     */
    async function open(p, opts = {}) {
        const cls = logic.classifyPath(p, fs, path.join);
        if (cls.kind === 'missing') forget(cls.path);
        if (cls.kind === 'folder' && opts.allowFolder) {
            const handled = await openBrowser(cls.path);
            if (handled) return { path: cls.path, kind: 'folder', result: { ok: true, path: null, status: 'browsing', error: null } };
        }
        const error = logic.refusal(cls) || (cls.kind === 'folder' ? `${logic.baseName(cls.path)} is not a zarr store. ${logic.NOT_A_DATASET}` : null);
        if (error) {
            tell(error);
            return { path: cls.path, kind: cls.kind, error };
        }
        const result = await openInPage(cls.path);
        if (result && result.ok) {
            noteOpened(cls.path);
            setRepresented(cls.path);
        }
        return { path: cls.path, kind: cls.kind, result };
    }

    async function openFirst(first, extra) {
        const note = logic.extraNotice(first, extra);
        if (note) tell(note);
        return open(first);
    }

    /** One native dialog: `which` is 'h5ad', 'zarr' or undefined (macOS: either). */
    async function openDialog(which) {
        const win = getWindow();
        const options = logic.dialogOptions(which, platform);
        const picked = win && !win.isDestroyed()
            ? await dialog.showOpenDialog(win, options)
            : await dialog.showOpenDialog(options);
        if (picked.canceled || !picked.filePaths.length) return null;
        return open(picked.filePaths[0], { allowFolder: true });
    }

    /** Items dropped on the window: the first openable one; say if there were more. */
    async function openDropped(paths) {
        const list = (paths || []).filter((p) => typeof p === 'string' && p);
        if (!list.length) return null;
        const openable = list.find((p) => ['zarr', 'h5ad'].includes(logic.classifyPath(p, fs, path.join).kind));
        const first = openable || list[0];
        return openFirst(first, list.length - 1);
    }

    /** Paths from the OS (open-file, argv): held until the page can open them. */
    function openFromOs(paths) {
        queue.push(paths);
    }

    /** Re-read the open dataset through the page's own refresh control. */
    async function refreshDataset() {
        const win = getWindow();
        if (!win || win.isDestroyed()) return;
        await win.webContents.executeJavaScript(
            "(() => { const b = document.getElementById('refresh-dataset'); if (b) b.click(); })()").catch(() => {});
    }

    // ── Menu ─────────────────────────────────────────────────────────────

    const actions = {
        'open-browser': () => openBrowser(),
        'open-path': () => openDialog(undefined),
        'open-h5ad': () => openDialog('h5ad'),
        'open-zarr': () => openDialog('zarr'),
        'open-recent': (item) => open(item.path),
        'clear-recent': () => clearRecents(),
        refresh: () => refreshDataset(),
    };

    /** Descriptors from the logic become Electron menu items. */
    function toElectron(items) {
        return items.map((item) => {
            const out = { ...item };
            if (item.submenu) out.submenu = toElectron(item.submenu);
            if (item.action) {
                const run = actions[item.action];
                out.click = () => {
                    Promise.resolve(run(item)).catch((err) => log.error(`${item.action} failed: ${err.message}`));
                };
                delete out.action;
            }
            return out;
        });
    }

    function buildMenu() {
        const template = logic.menuTemplate({ platform, recents });
        const file = template.find((i) => i.label === 'File');
        file.submenu = toElectron(file.submenu);
        Menu.setApplicationMenu(Menu.buildFromTemplate(template));
        if (onMenuBuilt) onMenuBuilt();
    }

    function start() {
        loadRecents();
        buildMenu();
    }

    return {
        start,
        open,
        openDialog,
        openDropped,
        openFromOs,
        openBrowser,
        refreshDataset,
        setRepresented,
        markPageReady: () => queue.markReady(),
        markPageBusy: () => {
            queue.markBusy();
            setRepresented(null);
        },
        buildMenu,
        get recents() { return recents.slice(); },
    };
}

module.exports = { createDatasetOpener, RECENT_FILE };
