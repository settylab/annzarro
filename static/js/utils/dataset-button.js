/**
 * The dataset button at the left of the dataset bar (#dataset-button): the one
 * control that names the open dataset and opens the dataset browser. It is a
 * view of DatasetState (utils/dataset-state.js) and holds no state itself.
 *
 *   none         dashed, "Open a dataset..." and the shortcut
 *   opening      "Opening <name>...", aria-busy
 *   open         the name (the path relative to the data directory, cut in the
 *                middle to fit) and a caret; the whole path is the tooltip
 *   nodata       a view without its dataset: "No data: <name>" and "Choose..."
 *   unavailable  the open dataset turned unreadable: "Not available: <name>"
 */
import { datasetName } from './dataset-state.js';
import { truncateDatasetLabel } from './dataset-label.js';

export { datasetName as datasetNameOf };

/** The words of the button and its accessible name for a state. */
export function buttonText(state) {
    const label = state.label || state.path || '';
    switch (state.status) {
        case 'opening': return { text: `Opening ${label}…`, aria: `Opening ${label}`, busy: true };
        case 'open': return { text: label, aria: `Dataset: ${label}. Change dataset`, busy: false };
        case 'nodata': return { text: `No data: ${label}`, aria: `No data: ${label}. Choose a dataset`, busy: false, action: 'Choose…' };
        case 'unavailable': return { text: `Not available: ${label}`, aria: `Not available: ${label}. Choose a dataset`, busy: false, action: 'Choose…' };
        default: return { text: 'Open a dataset…', aria: 'Open a dataset', busy: false };
    }
}

/**
 * @param {{button: HTMLElement, onOpen: () => void, shortcut: string}} o
 * @returns {{update: (state: Object) => void, refit: () => void}}
 */
export function mountDatasetButton({ button, onOpen, shortcut }) {
    const name = button.querySelector('.dataset-button-name');
    const hint = button.querySelector('.dataset-button-hint');
    const live = document.getElementById('dataset-status');
    const alert = document.getElementById('dataset-alert');
    let whole = '';
    if (hint) hint.textContent = shortcut;
    button.addEventListener('click', () => onOpen());

    let canvas = null;
    /** Cut the text to the room the button has (start and end kept), so that no CSS ellipsis has to. */
    function fit() {
        if (!name || !whole) return;
        name.textContent = whole;
        if (button.scrollWidth <= button.clientWidth + 1) return;
        const style = getComputedStyle(name);
        canvas = canvas || document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const measure = str => ctx.measureText(str).width;
        let room = name.clientWidth || 200;
        for (let i = 0; i < 8; i++) {
            name.textContent = truncateDatasetLabel(whole, room, measure);
            const over = button.scrollWidth - button.clientWidth;
            if (over <= 0) return;
            room -= Math.max(4, over);
        }
    }

    let lastAnnounced = '';
    function update(state, previous = null) {
        const words = buttonText(state);
        button.dataset.state = state.status;
        button.setAttribute('aria-label', words.aria);
        button.setAttribute('aria-busy', String(words.busy));
        button.title = state.path ? `${state.path}\n${words.action ? words.action : 'Change dataset'}` : `Open a dataset (${shortcut})`;
        const icon = button.querySelector('.dataset-button-icon');
        if (icon) icon.className = `fas ${words.busy ? 'fa-spinner dataset-spin' : state.status === 'nodata' || state.status === 'unavailable' ? 'fa-triangle-exclamation' : 'fa-database'} dataset-button-icon`;
        const action = button.querySelector('.dataset-button-action');
        if (action) action.textContent = words.action || '';
        whole = words.text;
        fit();
        // a screen reader hears what changed, not every keystroke: opening, opened, failed
        if (live && previous) {
            let said = '';
            if (state.status === 'opening') said = `Opening ${state.label}`;
            else if (state.status === 'open' && previous.status === 'opening') said = `Opened ${state.label}`;
            if (said && said !== lastAnnounced) { live.textContent = said; lastAnnounced = said; }
        }
        if (alert && (state.error || state.failed)) alert.textContent = (state.failed && state.failed.message) || state.error;
    }

    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => fit()).observe(button.parentElement || button);
    window.addEventListener('resize', fit);
    return { update, refit: fit };
}
