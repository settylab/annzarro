/**
 * The entity card (aggregation-unify-080.md 11.2): one line for an item of a list the user orders and edits, as the Cell
 * Grouping's factors and the Cell-Gene Plot's sections are. Both panels make their cards here, so they look and behave alike:
 *
 *   [≡] [n] [title] [summary] [preview]   [controls…] [⋯]
 *   (a note line under it, when there is a note)
 *
 * The title, summary and preview give way in that order's reverse in a narrow tile (preview first). Clicking the head calls
 * `onOpen`; Alt+Up and Alt+Down on it, and dragging a card onto another, call `onMove(from, to)`. ⋯ is a menu of
 * ui/popover.js listing `menu.items`; with `rename` the first entry is Rename, which edits the title in place with
 * ui/inline-rename.js (✓ saves, ✕ and Escape cancel). The caller owns what each action does; this owns the markup.
 */
import { createPopover } from './popover.js';
import { inlineRename } from './inline-rename.js';

/**
 * @param {Object} o
 * @param {(tag: string, props?: Object, ...kids: any[]) => HTMLElement} o.el - the DOM helper (D.el)
 * @param {number} o.index - the position (shown as n + 1, and the target of a move)
 * @param {string} o.title
 * @param {string} [o.summary]
 * @param {string} [o.preview]
 * @param {string} [o.note] - a line under the card (a problem, a reason)
 * @param {boolean} [o.missing] - the card's source is gone: danger border
 * @param {string} [o.kind] - copied to `data-kind`
 * @param {string} [o.className] - classes a panel adds to the `<li>` (its own test hooks)
 * @param {string} o.dragType - the drag's data type: cards of one list only drop on each other
 * @param {string} [o.headLabel] - the head's accessible name
 * @param {string} [o.headTitle] - the head's tooltip
 * @param {HTMLElement[]} [o.controls] - the panel's own controls, between the head and ⋯
 * @param {{items: Array<{op: string, label: string, disabled?: boolean}>, label: string, onOp: (op: string) => void}} o.menu
 * @param {{onSave: (text: string) => void, label: string, active?: ?string, onDraft?: (text: ?string) => void}} [o.rename] - Rename,
 *   in place: from the menu, or by a double click on the title. The list that redraws its cards owns the edit in progress:
 *   `onDraft(text)` hears the text as it is typed (null when the editor is left) and a card built with `active` (the text so
 *   far) opens the editor again, so a redraw never takes it away
 * @param {() => void} [o.onOpen]
 * @param {(from: number, to: number) => void} [o.onMove]
 * @returns {{element: HTMLLIElement, head: HTMLElement, more: HTMLButtonElement, destroy: () => void}}
 */
export function createEntityCard({ el, index, title, summary = '', preview = '', note = '', missing = false, kind, className = '', dragType,
    headLabel, headTitle = '', controls = [], menu, rename = null, onOpen = null, onMove = null }) {
    let destroyed = false;
    let openTimer = null;
    // a click opens the source; a double click renames, so the open waits for the second click of a double (the system's interval)
    const head = el('button', { type: 'button', class: 'az-card__head', aria: headLabel ? { label: headLabel } : {}, title: headTitle || undefined,
        on: { click: () => {
                if (!onOpen) return;
                if (!rename) { onOpen(); return; }
                clearTimeout(openTimer);
                openTimer = setTimeout(() => { if (!destroyed) onOpen(); }, 250);
            },
            keydown: (e) => {
                if (!onMove || !e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
                e.preventDefault();
                onMove(index, index + (e.key === 'ArrowUp' ? -1 : 1));
            } } },
    el('span', { class: 'az-card__grip', aria: { hidden: 'true' }, text: '≡' }),
    el('span', { class: 'az-card__pos', text: String(index + 1) }),
    el('span', { class: 'az-card__title', text: title, on: { dblclick: () => { if (rename) { clearTimeout(openTimer); startRename(title, true); } } } }),
    el('span', { class: 'az-card__summary', text: summary }),
    el('span', { class: 'az-card__preview', text: preview }));
    const more = el('button', { type: 'button', class: 'btn btn-sm btn-link az-card__more', aria: { label: menu.label } }, '⋯');
    const bar = el('div', { class: 'az-card__bar' }, head, ...controls, el('span', { class: 'az-card__menu-wrap' }, more));
    const li = el('li', { class: `az-card${missing ? ' is-missing' : ''}${className ? ` ${className}` : ''}`, draggable: 'true',
        data: { index, ...(kind ? { kind } : {}) } },
    bar, el('div', { class: 'az-card__note', role: 'note', hidden: !note, text: note }));

    /** The title edited in place, where the head is: the shared editor (ui/inline-rename.js), saving once. */
    function startRename(value, report) {
        const box = el('div', { class: 'az-card__rename' });
        const draft = (text) => { if (!destroyed && rename.onDraft) rename.onDraft(text); };
        const editor = inlineRename({ el, value,
            classes: { input: 'form-control form-control-sm az-card__rename-input', ok: 'btn btn-sm btn-outline-success az-card__rename-ok', cancel: 'btn btn-sm btn-outline-secondary az-card__rename-cancel' },
            labels: { field: `${rename.label}: new name`, ok: `Save the new name of ${title}`, cancel: `Cancel renaming ${title}`, hint: 'Enter saves, Escape cancels. Empty restores the source\'s name.' },
            onInput: (text) => draft(text),
            // a card that was drawn over (its list redrew) leaves nothing behind: the list's draft stands and the new card opens it again
            onSave: (text) => { if (destroyed) return; draft(null); finish(); if (text.trim() !== title) rename.onSave(text); },
            onCancel: () => { if (destroyed) return; draft(null); finish(); } });
        function finish() { box.remove(); head.hidden = false; head.focus({ preventScroll: true }); }
        box.append(editor.input, editor.ok, editor.cancel);
        editor.attach(box);
        head.hidden = true;
        head.after(box);
        if (report) draft(value);
        // a card drawn with an edit in progress is not in the page yet: focus once it is
        const focus = () => { if (editor.input.isConnected) { editor.input.focus(); editor.input.setSelectionRange(editor.input.value.length, editor.input.value.length); } else if (!destroyed) setTimeout(focus, 0); };
        if (editor.input.isConnected) { editor.input.focus(); editor.input.select(); } else setTimeout(focus, 0);
    }

    const items = [...(rename ? [{ op: 'rename', label: 'Rename', disabled: false }] : []), ...menu.items];
    // Rename starts once the menu has closed: closing gives the focus back to ⋯, and an editor opened before that would lose it at once,
    // which a click-away takes for a way out (it saved and closed "briefly")
    let renameWanted = false;
    const pop = createPopover({ anchor: more, name: 'card-menu', title: menu.label, menu: true,
        render: (body) => {
            for (const { op, label, disabled } of items) {
                body.appendChild(el('button', { type: 'button', role: 'menuitem', class: 'az-card__op', data: { op }, disabled: !!disabled,
                    on: { click: () => { if (op === 'rename') renameWanted = true; else menu.onOp(op); } } }, label));
            }
        },
        onClose: () => { if (renameWanted) { renameWanted = false; if (!destroyed) startRename(title, true); } } });

    li.addEventListener('dragstart', (e) => { e.dataTransfer.setData(dragType, String(index)); e.dataTransfer.effectAllowed = 'move'; });
    li.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes(dragType)) e.preventDefault(); });
    li.addEventListener('drop', (e) => {
        const from = Number(e.dataTransfer.getData(dragType));
        if (!Number.isInteger(from) || from === index) return;
        e.preventDefault();
        if (onMove) onMove(from, index);
    });
    if (rename && rename.active !== undefined && rename.active !== null) startRename(rename.active, false);
    return { element: li, head, more, destroy: () => { destroyed = true; clearTimeout(openTimer); pop.destroy(); } };
}
