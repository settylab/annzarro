/**
 * The dataset information button (#dataset-info, in the dataset bar) and its dialog (#dataset-info-modal).
 *
 * The button shows while a dataset is open and names no state of its own: it follows DatasetState
 * (the `datasetState` event). The dialog has three tabs, About (attribution), README and Structure;
 * the markup is in index.html, Bootstrap opens the dialog and switches the tabs, and each tab loads
 * its part from the server when it is first shown (utils/dataset-info.js draws it, with a
 * loading state and an error state that offers "Try again"). Shortly after a dataset opens, once
 * the first plot has had its turn, the parts are fetched in one request in idle time, so the tabs
 * show at once; a remote store's structure is left to the tab.
 */

/** How long after a dataset opens the parts are fetched, so the first plot's requests go first. */
export const PREFETCH_DELAY_MS = 1500;
import { createInfoLoader, drawAbout, drawReadme, drawStructure, isRemotePath, showPart, PARTS } from './dataset-info.js';

const DRAW = { about: drawAbout, readme: drawReadme, structure: drawStructure };

/** The dataset's name on one line: the start is cut with an ellipsis when it does not fit, the last characters (the file name's end) always show. */
export function setName(node, text, tail = 28) {
    node.textContent = '';
    if (text.length <= tail) {
        node.textContent = text;
        return;
    }
    const doc = node.ownerDocument;
    const head = doc.createElement('span');
    head.className = 'dataset-info-name-head';
    head.textContent = text.slice(0, -tail);
    const end = doc.createElement('span');
    end.className = 'dataset-info-name-tail';
    end.textContent = text.slice(-tail);
    node.append(head, end);
}

/** Runs `task` after `delay` ms, in an idle moment; returns what cancels it. */
function defaultSchedule(task, delay = PREFETCH_DELAY_MS) {
    let idle = null;
    const timer = setTimeout(() => {
        if (typeof requestIdleCallback === 'function') idle = requestIdleCallback(task, { timeout: 3000 });
        else task();
    }, delay);
    return () => {
        clearTimeout(timer);
        if (idle !== null && typeof cancelIdleCallback === 'function') cancelIdleCallback(idle);
    };
}

/**
 * @param {{url: string, state: () => Object, doc?: Document, loader?: Object, schedule?: Function}} options
 * @returns {{update: (state: Object) => void, loader: Object}}
 */
export function mountDatasetInfo({ url, state, doc = document, loader = createInfoLoader({ url }),
    schedule = defaultSchedule }) {
    const button = doc.getElementById('dataset-info');
    const modal = doc.getElementById('dataset-info-modal');
    if (!button || !modal) return { update() {}, loader };
    const title = doc.getElementById('dataset-info-name');
    const tabs = [...modal.querySelectorAll('[data-dsi-part]')];
    const panes = Object.fromEntries(tabs.map((tab) => [tab.dataset.dsiPart, doc.querySelector(tab.dataset.bsTarget)]));
    let prefetched = null;             // the path the parts were scheduled for
    let shownFor = null;               // the path the panes were drawn for
    const loaded = new Set();

    const path = () => {
        const s = state();
        return s && s.status === 'open' ? s.path : null;
    };
    function reset() {
        loaded.clear();
        for (const pane of Object.values(panes)) {
            const body = pane.querySelector('.dsi-body');
            body.textContent = '';
            body.removeAttribute('aria-busy');
        }
    }
    function ensure(part) {
        const now = path();
        if (!now) return;
        if (shownFor !== now) { reset(); shownFor = now; }
        if (loaded.has(part)) return;
        loaded.add(part);
        const body = panes[part].querySelector('.dsi-body');
        showPart(body, {
            loader, path: now, part, draw: DRAW[part], current: () => path() === now
        }).then((ok) => { if (!ok) loaded.delete(part); });
    }
    const activePart = () => {
        const active = tabs.find((tab) => tab.classList.contains('active'));
        return active ? active.dataset.dsiPart : 'about';
    };

    modal.addEventListener('show.bs.modal', () => {
        const s = state();
        setName(title, (s && (s.label || s.path)) || '');
        title.title = (s && s.path) || '';
        ensure(activePart());
    });
    for (const tab of tabs) tab.addEventListener('shown.bs.tab', () => ensure(tab.dataset.dsiPart));
    modal.addEventListener('hidden.bs.modal', () => button.focus());

    let cancelPrefetch = null;
    function stopPrefetch() {
        if (cancelPrefetch) cancelPrefetch();
        cancelPrefetch = null;
    }
    function prefetch(at) {
        stopPrefetch();
        const parts = isRemotePath(at) ? PARTS.filter((part) => part !== 'structure') : PARTS;
        cancelPrefetch = schedule(() => {
            cancelPrefetch = null;
            if (path() !== at) return;
            loader.loadAll(at, parts);
        });
    }

    function update(next) {
        const open = !!next && next.status === 'open';
        if (next && next.status === 'opening' && next.path) loader.forget(next.path);     // a refresh reads it again
        button.hidden = !open;
        if (open) {
            button.setAttribute('aria-label', 'Dataset information');
            button.title = 'Dataset information';
        }
        if (open && shownFor !== null && shownFor !== next.path) { reset(); shownFor = null; }
        if (!open) {
            reset(); shownFor = null;
            stopPrefetch(); prefetched = null;
            loader.pin(null);
            return;
        }
        if (prefetched !== next.path) {
            prefetched = next.path;
            loader.pin(next.path);
            prefetch(next.path);
        }
    }
    return { update, loader };
}
