/**
 * A last session (utils/last-sessions.js) as an entry of the panel set
 * lists: the welcome screen's "Load Saved Panel Set" and the Load Panel Set
 * dialog. It says when it was autosaved, its dataset and panel count, and
 * whether it did not finish loading; Restore opens it, and one that did not
 * finish also offers "Restore with the default subset". Nothing is drawn
 * until one of them is pressed.
 */
import { sessionLabel, sessionSummary, unfinishedText } from './last-sessions.js';

function el(tag, attrs = {}, text = '') {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (k === 'class') node.className = v;
        else node.setAttribute(k, v);
    }
    if (text) node.textContent = text;
    return node;
}

/**
 * @param {Object} session - a listed last session (SessionManager.listSessions: name, entry, isLastSession)
 * @param {number} index - its place among the last sessions (0: the newest)
 * @param {Object} opts
 * @param {string} opts.className - 'session-item' (welcome) or 'session-card' (dialog)
 * @param {Function} opts.restore - ({defaultSubset}) => Promise<{status, message}>
 * @param {Function} [opts.forget] - () => void; the entry is removed
 * @param {Function} [opts.done] - called after a restore that opened (the dialog closes)
 * @returns {HTMLElement}
 */
export function lastSessionElement(session, index, { className, restore, forget = null, done = null }) {
    const entry = session.entry;
    const root = el('div', { class: `${className} last-session${entry.unfinished ? ' last-session--unfinished' : ''}`,
        'data-session-name': session.name, 'data-last-session': entry.key });
    const label = sessionLabel(entry, index);
    const info = el('div', { class: 'last-session__info' });
    const title = el('div', { class: 'last-session__title' });
    title.appendChild(el('span', { class: 'truncate-text', title: label }, label));
    info.appendChild(title);
    info.appendChild(el('div', { class: 'last-session__summary truncate-text', title: sessionSummary(entry) }, sessionSummary(entry)));
    if (entry.unfinished) {
        const warn = el('div', { class: 'last-session__unfinished', role: 'note' });
        warn.appendChild(el('i', { class: 'fas fa-exclamation-triangle', 'aria-hidden': 'true' }));
        warn.appendChild(document.createTextNode(` ${unfinishedText(entry.unfinished)}`));
        info.appendChild(warn);
    }
    root.appendChild(info);
    const preview = el('div', { class: 'session-card-preview', 'data-session-name': session.name });
    preview.innerHTML = '<div class="panel-preview-loading"><i class="fas fa-spinner fa-pulse"></i></div>';
    root.appendChild(preview);

    const note = el('div', { class: 'last-session__note', role: 'status' });
    const actions = el('div', { class: 'last-session__actions' });
    const buttons = [];
    const run = async (defaultSubset) => {
        note.textContent = '';
        buttons.forEach(b => { b.disabled = true; });
        try {
            const result = await restore({ defaultSubset });
            if (result && result.status && result.status !== 'success' && result.status !== 'no-data') {
                note.textContent = result.message || 'The session was not restored.';
            } else if (done) {
                done();
            }
        } finally {
            if (root.isConnected) buttons.forEach(b => { b.disabled = false; });
        }
    };
    const main = el('button', { type: 'button', class: `btn btn-sm ${entry.unfinished ? 'btn-outline-primary' : 'btn-primary'} last-session-restore`,
        title: 'Open this session as it was autosaved' }, 'Restore');
    main.addEventListener('click', (e) => { e.stopPropagation(); run(false); });
    buttons.push(main);
    if (entry.unfinished) {
        const fewer = el('button', { type: 'button', class: 'btn btn-sm btn-primary last-session-restore-default',
            title: "Open this session on the dataset's default subset (fewer cells) instead of the cells it was saved with" },
        'Restore with the default subset');
        fewer.addEventListener('click', (e) => { e.stopPropagation(); run(true); });
        buttons.push(fewer);
        actions.appendChild(fewer);
    }
    actions.appendChild(main);
    if (forget) {
        const x = el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary last-session-forget',
            title: 'Forget this session (removed from this browser)', 'aria-label': 'Forget this session' });
        x.appendChild(el('i', { class: 'fas fa-trash-alt', 'aria-hidden': 'true' }));
        x.addEventListener('click', (e) => { e.stopPropagation(); forget(); root.remove(); });
        actions.appendChild(x);
    }
    root.appendChild(actions);
    root.appendChild(note);
    return root;
}
