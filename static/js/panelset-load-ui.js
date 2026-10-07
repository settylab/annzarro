/**
 * The Load buttons of a panel set: one highlighted "Load" and small icon
 * buttons for its ablations (utils/panelset-load.js says what each does).
 * The Load dialog's cards, an uploaded file's card and the welcome list's
 * items all draw them here, so they look and behave the same.
 */
import { loadChoices, describeStatus, MODE_ICONS } from './utils/panelset-load.js';

const TIP = { trigger: 'hover focus', container: 'body', placement: 'top', customClass: 'load-tip',
    delay: { show: 250, hide: 0 } };

/**
 * A hover tooltip on `el` (Bootstrap's, so it also shows on a disabled
 * button and can be seen in a screenshot). `data-tip` keeps the text.
 */
export function setTip(el, text) {
    el.dataset.tip = text;
    el.setAttribute('aria-label', text);
    el.removeAttribute('title');
    const bs = window.bootstrap;
    if (!bs || !bs.Tooltip) { el.title = text; return; }
    const old = bs.Tooltip.getInstance(el);
    if (old) old.dispose();
    el.setAttribute('data-bs-title', text);
    new bs.Tooltip(el, TIP);
}

/** Remove every Load tooltip still on screen (its button was clicked or left the page). */
export function clearTips() {
    document.querySelectorAll('.tooltip.load-tip').forEach(t => t.remove());
}

/** Drop the tooltips of a card's buttons, pending ones too (a delayed show would draw a
 *  tooltip for a button that is gone or hidden). They come back with `restoreTips`. */
function suspendTips(root) {
    const bs = window.bootstrap;
    if (bs && bs.Tooltip) {
        root.querySelectorAll('[data-tip]').forEach(el => { const t = bs.Tooltip.getInstance(el); if (t) t.dispose(); });
    }
    clearTips();
}

function restoreTips(root) {
    root.querySelectorAll('[data-tip]').forEach(el => setTip(el, el.dataset.tip));
}

/** Withdraw an element's tooltip (before it is removed or clicked). */
export function hideTip(el) {
    const bs = window.bootstrap;
    const tip = bs && bs.Tooltip && bs.Tooltip.getInstance(el);
    if (tip) tip.hide();
}

function iconButton(mode, icon) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `btn btn-sm btn-outline-secondary load-icon-btn session-load-${mode}`;
    b.dataset.mode = mode;
    b.innerHTML = `<i class="fas ${icon}" aria-hidden="true"></i>`;
    return b;
}

/**
 * The status badge element for a card ("available here" / "not found here").
 * @returns {{el: HTMLElement, update: (status: Object|null) => void}}
 */
export function createDatasetBadge() {
    const el = document.createElement('span');
    el.className = 'session-dataset-badge';
    el.hidden = true;
    const update = (status) => {
        const d = describeStatus(status);
        el.hidden = !d.text;
        el.textContent = d.text;
        el.dataset.state = d.state;
        if (d.text) setTip(el, d.title);
    };
    return { el, update };
}

/**
 * Build the buttons.
 * @param {{compact?: boolean, getCurrent?: () => {hasCurrent: boolean, currentName: string},
 *          onLoad: (mode: string) => Promise<void>|void}} opts
 *   onLoad gets the mode of the button clicked (the primary's current one for "Load").
 *   getCurrent says whether a dataset is open now: asked whenever the buttons
 *   are shown or used (the welcome list is drawn before the first dataset opens).
 * @returns {{el: HTMLElement, update: (status: Object) => void,
 *            setReady: (promise: Promise) => void, setBusy: (busy: boolean) => void}}
 */
export function createLoadActions({ compact = false, getCurrent = () => ({}), onLoad }) {
    const el = document.createElement('div');
    el.className = 'load-actions' + (compact ? ' load-actions-compact' : '');
    const primary = document.createElement('button');
    primary.type = 'button';
    primary.className = 'btn btn-primary btn-sm session-load';
    primary.dataset.mode = 'full';
    primary.textContent = 'Load';
    el.appendChild(primary);
    const icons = document.createElement('div');
    icons.className = 'load-icons';
    const buttons = {};
    for (const mode of ['current', 'add', 'choose']) {
        buttons[mode] = iconButton(mode, MODE_ICONS[mode]);
        icons.appendChild(buttons[mode]);
    }
    // the old name of "Add to closed panels", kept for scripts that find it
    buttons.add.classList.add('session-add-closed');
    el.appendChild(icons);

    let ready = Promise.resolve();
    let busy = false;
    let last = null;
    let lastCurrent = '';

    const update = (status) => {
        last = status;
        const current = getCurrent();
        lastCurrent = JSON.stringify(current);
        const choices = loadChoices({ ...(status || {}), ...current });
        primary.dataset.mode = choices.primary.mode;
        primary.textContent = choices.primary.label;
        setTip(primary, choices.primary.title);
        primary.removeAttribute('aria-label');   // the visible label is its name
        for (const a of choices.actions) {
            const b = buttons[a.mode];
            b.hidden = !a.visible;
            b.setAttribute('aria-disabled', a.enabled ? 'false' : 'true');
            b.classList.toggle('load-off', !a.enabled);
            setTip(b, a.title);
        }
        el.dataset.status = status ? 'ready' : 'pending';
    };
    // what is open may have changed since the buttons were drawn
    let suspended = false;
    const refresh = () => {
        if (last && !busy && JSON.stringify(getCurrent()) !== lastCurrent) update(last);
    };
    // tooltips dropped while a load ran come back when the pointer returns
    const back = () => {
        if (suspended) { suspended = false; restoreTips(el); }
        refresh();
    };
    el.addEventListener('mouseenter', back);
    el.addEventListener('focusin', back);
    const onDataset = () => {
        if (!el.isConnected) {
            document.removeEventListener('datasetChanged', onDataset);
            document.removeEventListener('datasetCleared', onDataset);
            return;
        }
        refresh();
    };
    document.addEventListener('datasetChanged', onDataset);
    document.addEventListener('datasetCleared', onDataset);

    const click = async (button, fixedMode) => {
        if (busy) return;
        hideTip(button);
        // a click while the dataset is still being looked for waits for the answer
        await ready;
        refresh();
        const mode = fixedMode || primary.dataset.mode;
        // an icon that does not apply (its tooltip says why) does nothing
        if (fixedMode && button.getAttribute('aria-disabled') === 'true') return;
        // the mouse stays over a button that is disabled or gone while this loads
        suspendTips(el);
        suspended = true;
        try {
            await onLoad(mode);
        } finally {
            clearTips();
        }
    };
    primary.addEventListener('click', (e) => { e.stopPropagation(); click(primary, null); });
    for (const mode of Object.keys(buttons)) {
        buttons[mode].addEventListener('click', (e) => { e.stopPropagation(); click(buttons[mode], mode); });
    }
    update(null);

    return {
        el, update,
        setReady: (promise) => { ready = Promise.resolve(promise).catch(() => {}); },
        setBusy: (value) => {
            busy = value;
            el.classList.toggle('is-busy', value);
            [primary, ...Object.values(buttons)].forEach(b => { b.disabled = value; });
        }
    };
}

/**
 * The help ("?") popover: the three ways to load.
 * @returns {HTMLElement} the HTML of its body
 */
export function helpContent() {
    const wrap = document.createElement('div');
    wrap.className = 'load-help';
    wrap.innerHTML = `
        <ul class="load-help-list">
            <li><span class="btn btn-primary btn-sm load-help-load">Load</span>
                <span><b>Load</b> switches to the set's dataset and opens the panels that were open when
                it was saved, in their layout, as a share link would. Panels it replaces stay in the
                closed list.</span></li>
            <li><span class="btn btn-outline-secondary btn-sm load-icon-btn"><i class="fas ${MODE_ICONS.current}"></i></span>
                <span><b>Load on the current dataset</b> does the same on the dataset that is open.</span></li>
            <li><span class="btn btn-outline-secondary btn-sm load-icon-btn"><i class="fas ${MODE_ICONS.add}"></i></span>
                <span><b>Add panels closed</b> only adds the set's panels to the closed list; the dataset
                and the open panels stay.</span></li>
        </ul>
        <p><span class="session-dataset-badge" data-state="missing">not found here</span> means the set's dataset
        is not on this server: Load then uses the open dataset, and <i class="fas ${MODE_ICONS.choose}"></i>
        <b>Choose dataset</b> picks another.</p>`;
    return wrap;
}
