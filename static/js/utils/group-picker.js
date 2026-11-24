/**
 * The picker of one group of a grouping, shared by the Count Plot's "Group of a grouping" set and the Gene Plot's
 * Cell group source (UX 2.8). A grouping can have thousands of groups. The picker is always the normal dropdown with
 * every group listed, as every other select is; a long one also has a FILTER FIELD beside it that narrows the options
 * the dropdown shows as the user types. The select keeps its own `change` event and keyboard (arrow keys, type-ahead), so
 * everything that listens to it is unchanged, and a short list gets no field at all.
 *
 * The filter matches an entry's text (a group's displayed name, with the label the user gave it) and its `data-alt`
 * (its generated name, what the key is made of), case-insensitively, anywhere in the name. The empty "choose" entry
 * always stays; a section none of whose entries match shows no header. Enter chooses the first match; the Down arrow
 * goes to the select; Escape clears.
 *
 * `attachFilter` is called after the select is (re)filled; it is safe to call again, re-applies what is typed, and takes
 * the field away when the list is short again.
 */

/** A select with more entries than this (the empty "choose" entry not counted) gets the filter field. */
const FILTER_ABOVE = 50;

const norm = (text) => String(text || '').toLowerCase();

/** Whether an option is a hit for `query`: its text or its alternative name has it. The "choose" entry always stays. */
function hit(option, query) {
    if (option.value === '') return true;
    return norm(option.textContent).includes(query) || norm(option.dataset.alt).includes(query);
}

/**
 * Show the options that match what is typed; the rest are hidden from the dropdown (the chosen one too: the closed select
 * still shows it), and a section with no hit shows no header.
 */
function narrow(select, query) {
    const q = norm(query.trim());
    for (const option of select.options) {
        const found = !q || hit(option, q);
        option.hidden = !found;
        option.dataset.hit = q && found && option.value !== '' ? '1' : '';
    }
    for (const group of select.querySelectorAll('optgroup')) group.hidden = [...group.children].every((o) => o.hidden);
}

/**
 * Fill a select with entries in sections: loose entries first (the empty "choose" entry, a note), then each section as an
 * `<optgroup>` with its heading. An entry is `{value, text, alt?, disabled?, title?}`; `alt` is another name a filter
 * field finds it by. The chosen value is selected; the select is left alone when it already holds the same entries.
 * @param {HTMLSelectElement} select
 * @param {{loose?: Array<Object>, sections?: Array<{heading: string, entries: Array<Object>}>, chosen?: string}} content
 */
export function fillSections(select, { loose = [], sections = [], chosen = null }) {
    const make = (e) => {
        const o = new Option(e.text, e.value);
        o.disabled = !!e.disabled;
        if (e.title) o.title = e.title;
        if (e.alt && e.alt !== e.text) o.dataset.alt = e.alt;
        return o;
    };
    const wanted = JSON.stringify([loose, sections.map((g) => [g.heading, g.entries])]);
    // unchanged only when what it holds is still what was built (a loading line may have replaced it)
    if (select.__sections !== wanted || select.__built !== select.firstChild) {
        select.replaceChildren(...loose.map(make), ...sections.map((g) => {
            const group = document.createElement('optgroup');
            group.label = g.heading;
            group.append(...g.entries.map(make));
            return group;
        }));
        select.__sections = wanted;
        select.__built = select.firstChild;
    }
    if (chosen !== null) select.value = chosen;
    const picked = select.selectedOptions && select.selectedOptions[0];
    select.title = picked ? picked.textContent : '';
}

/**
 * Give a long group select its filter field.
 * @param {HTMLSelectElement} select - filled; its options may carry `data-alt`
 * @param {{above?: number, label?: string, placeholder?: string}} [opts]
 * @returns {HTMLInputElement|null} the field, or null when the select is short
 */
export function attachFilter(select, { above = FILTER_ABOVE, label = 'Group', placeholder = 'Filter' } = {}) {
    let field = select.__groupFilter || null;
    if (select.options.length - 1 <= above) {
        if (field) { field.remove(); select.__groupFilter = null; }
        for (const option of select.options) option.hidden = false;
        return null;
    }
    if (!field) {
        field = document.createElement('input');
        field.type = 'search';
        field.className = "form-control form-control-sm group-filter";
        field.autocomplete = 'off';
        field.placeholder = placeholder;
        field.setAttribute('aria-label', `${select.getAttribute('aria-label') || label}: filter`);
        field.dataset.axis = select.dataset.axis || '';
        field.addEventListener('input', () => narrow(select, field.value));
        field.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); select.focus(); return; }
            if (e.key === 'Escape') { field.value = ''; narrow(select, ''); return; }
            if (e.key !== 'Enter') return;
            e.preventDefault();
            const first = [...select.options].find((o) => o.dataset.hit === '1' && !o.disabled);
            if (first && select.value !== first.value) {
                select.value = first.value;
                select.dispatchEvent(new Event('change', { bubbles: true }));
            }
            field.value = '';
            narrow(select, '');
        });
        select.addEventListener('change', () => { field.value = ''; narrow(select, ''); });
        select.before(field);
        select.__groupFilter = field;
    }
    narrow(select, field.value);
    return field;
}
