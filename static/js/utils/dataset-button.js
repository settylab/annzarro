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
 *
 * Beside it sits the back button (#dataset-back): after a switch it names the
 * dataset that was open before and opens it again, which is itself a switch,
 * so the two datasets toggle.
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
 * What the back button offers after a switch from `before` to `after`: the
 * dataset that was open (or opening) before, or null when nothing was, when
 * the switch did not end on an open dataset, or when it was not a switch.
 */
export function backOffer(before, after) {
    if (!before || !after || !before.path || before.path === after.path) return null;
    if (before.status !== 'open' && before.status !== 'opening') return null;
    if (after.status !== 'open' || !after.path) return null;
    return { path: before.path, name: datasetName(before), from: after.path };
}

/** The words of the back button for an offer (also its tooltip: the button shows no text). */
export function backText(offer) {
    return `Back to ${offer.name}`;
}

/**
 * @param {{button: HTMLElement, onOpen: () => void, shortcut: string}} o
 * @returns {{update: (state: Object) => void, refit: () => void}}
 */
export function mountDatasetButton({ button, onOpen, shortcut, back = null, onBack = null }) {
    const name = button.querySelector('.dataset-button-name');
    const hint = button.querySelector('.dataset-button-hint');
    const live = document.getElementById('dataset-status');
    const alert = document.getElementById('dataset-alert');
    let whole = '';
    if (hint) hint.textContent = shortcut;
    button.addEventListener('click', () => onOpen());

    // the back button follows the offer while the dataset it was made for is the open one
    let offer = null;
    function showBack(state) {
        if (!back) return;
        // another dataset opened by something that is not a user's switch (a link, a panel set): the offer is stale
        if (offer && state.status === 'open' && state.path !== offer.from) offer = null;
        const shown = !!offer && state.status === 'open' && state.path === offer.from;
        back.hidden = !shown;
        if (shown) {
            back.title = backText(offer);
            back.setAttribute('aria-label', backText(offer));
        } else {
            back.removeAttribute('title');
            back.removeAttribute('aria-label');
        }
    }
    if (back) back.addEventListener('click', () => { if (offer && onBack) onBack(offer); });

    let canvas = null;
    /** Cut the text to the room the button has (start and end kept), so that no CSS ellipsis has to. */
    function fit() {
        if (!name || !whole) return;
        name.textContent = whole;
        const over = () => name.scrollWidth - name.clientWidth;
        if (over() <= 0) return;
        const style = getComputedStyle(name);
        canvas = canvas || document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const measure = str => ctx.measureText(str).width;
        let room = name.clientWidth || 200;
        for (let i = 0; i < 8; i++) {      // the canvas is a model of the DOM: check it, and tighten if it was off
            name.textContent = truncateDatasetLabel(whole, room, measure);
            const left = over();
            if (left <= 0) return;
            room -= Math.max(4, left);
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
        showBack(state);
        // a failed open is announced by its error toast (role=alert); the button says what cannot be opened
        if (alert && state.status === 'unavailable' && state.error) alert.textContent = state.error;
    }

    // Refit when the room changes: the window, or another item of the bar (the format appears) squeezing the button.
    let queued = false;
    const refit = () => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => { queued = false; fit(); });
    };
    if (typeof ResizeObserver !== 'undefined') {
        const observer = new ResizeObserver(refit);
        observer.observe(button);
        if (button.parentElement) observer.observe(button.parentElement);
    }
    window.addEventListener('resize', refit);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(refit);
    /** Offer the way back (or withdraw it with null) for the state now open. */
    function setBack(next, state) {
        offer = next;
        showBack(state);
    }
    return { update, refit, setBack };
}
