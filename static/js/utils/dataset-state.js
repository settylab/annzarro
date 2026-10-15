/**
 * The current dataset, in one place.
 *
 * Everything that shows or asks for "the dataset" (the dropdown, the tab
 * title, the refresh button, the recently opened list, the desktop app) reads
 * this state and subscribes to it, and everything that opens a dataset goes
 * through `open()`. No control holds the state itself: a control is a view of
 * it, so a control can be replaced without touching what opens or restores a
 * dataset.
 *
 * State: `{path, label, status, error, failed}`
 *   - `path`: the dataset opening or open (null with none)
 *   - `label`: how the interface names it (the path relative to the data
 *     directory, a remote URL as it is)
 *   - `status`: `none` | `opening` | `open` | `nodata` (a view without its
 *     dataset) | `unavailable` (the open dataset turned unreadable)
 *   - `error`: why the last open did not end `open`, else null
 *   - `failed`: `{path, message}` while the state is back on the dataset that
 *     was open after an open of `path` failed (a typed path the server
 *     refused), else null
 *
 * `open(path, {source})` runs the application's load path (registered once
 * with `setOpener`; main.js). `source` says who asked, and only the user's own
 * choices are recorded as recently opened (`isUserSource`):
 *   `user`      the dataset box, the picker, a typed path, the folder button
 *   `external`  the desktop app (File menu, dialog, drop, OS), a user choice
 *   `autosave`  the previous session restored
 *   `link`      a share link (?dataset_path=)
 *   `view`      a panel set or view naming its dataset
 *   `default`   opened at start because nothing else was asked
 *   `refresh`   the refresh button, re-reading the open dataset
 *
 * Desktop contract (`window.annzarro`, installed by main.js)
 * ----------------------------------------------------------
 * The desktop app, which owns the native dialogs, menus and drops, hands the
 * page a path to open by running `window.annzarro.openDataset(path)` in the
 * page (webContents.executeJavaScript, or a preload that forwards an IPC
 * message to it). The path is absolute, or a URL. It resolves, once the
 * dataset is open or the open failed, to `{ok, path, status, error}` (the
 * state after the call); it never rejects. A call made while the page is still
 * starting waits for the start to finish (`window.annzarro.ready`), so that
 * the restored session does not replace the dataset that was asked for.
 * `window.annzarro.getDataset()` returns the state now.
 */

export const STATUSES = ['none', 'opening', 'open', 'nodata', 'unavailable'];

/** Sources that are the user's own choice (recorded as recently opened). */
export const USER_SOURCES = ['user', 'external'];

export function isUserSource(source) {
    return USER_SOURCES.includes(source);
}

const NONE = Object.freeze({ path: null, label: '', status: 'none', error: null, failed: null });

/** The last segment of a path or URL: what a tab or a window is titled by. */
export function datasetName(state) {
    const path = String((state && state.path) || '');
    const last = path.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
    return last || (state && state.label) || path;
}

/**
 * The text of the browser tab and the window: "<dataset> · <app name>" while
 * a dataset is opening or open, the app name otherwise.
 */
export function documentTitle(state, appName = 'AnnZarro') {
    const app = appName || 'AnnZarro';
    if (!state || !state.path || (state.status !== 'opening' && state.status !== 'open')) return app;
    return `${datasetName(state)} · ${app}`;
}

/** A new, independent state (the application uses the shared `DatasetState`; tests make their own). */
export function createDatasetState() {
    let state = NONE;
    let opener = null;
    const listeners = new Set();

    function emit(previous) {
        for (const listener of [...listeners]) {
            try {
                listener(state, previous);
            } catch (e) {
                console.error('Dataset state subscriber failed:', e);
            }
        }
    }

    const same = (a, b) => a.path === b.path && a.label === b.label && a.status === b.status
        && a.error === b.error && a.failed === b.failed;

    return {
        /** A copy of the state now. */
        get: () => ({ ...state }),

        /**
         * Call `listener(state, previous)` on every change. Returns the
         * function that stops it. `{immediate: true}` also calls it now.
         */
        subscribe(listener, { immediate = false } = {}) {
            listeners.add(listener);
            if (immediate) listener({ ...state }, { ...state });
            return () => listeners.delete(listener);
        },

        /**
         * Change the state (the load path calls this as it goes; nothing else
         * should). Unmentioned fields keep their value, except `error` and
         * `failed`, which a change clears unless it names them. Subscribers
         * are called only if something changed.
         */
        set(patch) {
            const previous = state;
            const next = { ...state, error: null, failed: null, ...patch };
            if (!STATUSES.includes(next.status)) throw new Error(`Unknown dataset status ${next.status}`);
            if (next.status === 'none') Object.assign(next, { path: null, label: '' });
            if (same(previous, next)) return;
            state = Object.freeze(next);
            emit(previous);
        },

        /** Register what `open` runs: `(path, {source}) => Promise`. */
        setOpener(fn) {
            opener = fn;
        },

        /**
         * Open `path`. Resolves when the load path has finished (the state
         * then says whether it worked); rejects only when no opener is set.
         */
        async open(path, { source = 'user' } = {}) {
            if (!opener) throw new Error('No dataset can be opened yet');
            if (!path) return this.get();
            await opener(path, { source });
            return this.get();
        }
    };
}

/** The application's dataset state. */
export const DatasetState = createDatasetState();
