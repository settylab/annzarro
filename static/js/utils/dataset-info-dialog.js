/**
 * The dataset information button (#dataset-info, in the dataset bar) and its dialog (#dataset-info-modal).
 *
 * The button shows while a dataset is open and names no state of its own: it follows DatasetState
 * (the `datasetState` event). The dialog has three tabs, About (attribution), README and Structure;
 * the markup is in index.html, Bootstrap opens the dialog and switches the tabs, and each tab loads
 * its part from the server only when it is first shown (utils/dataset-info.js draws it, with a
 * loading state and an error state that offers "Try again").
 */
import { createInfoLoader, drawAbout, drawReadme, drawStructure, showPart } from './dataset-info.js';

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

/**
 * @param {{url: string, state: () => Object, doc?: Document, loader?: Object}} options
 * @returns {{update: (state: Object) => void, loader: Object}}
 */
export function mountDatasetInfo({ url, state, doc = document, loader = createInfoLoader({ url }) }) {
    const button = doc.getElementById('dataset-info');
    const modal = doc.getElementById('dataset-info-modal');
    if (!button || !modal) return { update() {}, loader };
    const title = doc.getElementById('dataset-info-name');
    const tabs = [...modal.querySelectorAll('[data-dsi-part]')];
    const panes = Object.fromEntries(tabs.map((tab) => [tab.dataset.dsiPart, doc.querySelector(tab.dataset.bsTarget)]));
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

    function update(next) {
        const open = !!next && next.status === 'open';
        if (next && next.status === 'opening' && next.path) loader.forget(next.path);     // a refresh reads it again
        button.hidden = !open;
        if (open) {
            button.setAttribute('aria-label', 'Dataset information');
            button.title = 'Dataset information';
        }
        if (open && shownFor !== null && shownFor !== next.path) { reset(); shownFor = null; }
        if (!open) { reset(); shownFor = null; }
    }
    return { update, loader };
}
