/**
 * The picker of one group of a grouping, shared by the Count Plot's "Group of a grouping" set and the Gene Plot's
 * Cell group colour (UX 2.8). A grouping can have 2,000 groups, which no `<select>` is pleasant with, so a select
 * holding more than `SEARCH_ABOVE` entries is hidden behind a search field: typing narrows the list (a native
 * `<datalist>`, so 2,000 entries cost nothing to draw) and choosing a name chooses it in the select, which keeps its
 * own `change` event and everything that listens to it. A short list stays the plain `<select>` it always was, with
 * nothing added.
 *
 * `attachSearch` is called after the select is (re)filled; it is safe to call again, and takes the field away when the
 * list is short again.
 */

/** A select with more entries than this (the empty "choose" entry not counted) is searched rather than scrolled. */
const SEARCH_ABOVE = 50;

/**
 * The entry a typed name stands for: an enabled option with that text, or null.
 * @param {HTMLSelectElement} select
 * @param {string} text
 */
function optionNamed(select, text) {
    return [...select.options].find((o) => o.value !== '' && !o.disabled && o.textContent === text) || null;
}

/** The text of the chosen entry, or '' when none is chosen. */
function chosenText(select) {
    const o = select.selectedOptions && select.selectedOptions[0];
    return o && o.value !== '' ? o.textContent : '';
}

let _serial = 0;

/**
 * Make `select` searchable when it is long. The select is hidden while the search field is shown.
 * @param {HTMLSelectElement} select
 * @param {{above?: number, label?: string, placeholder?: string}} [opts]
 * @returns {HTMLInputElement|null} the search field, or null when the select is short
 */
export function attachSearch(select, { above = SEARCH_ABOVE, label = 'Group', placeholder = 'Search groups' } = {}) {
    let field = select.__groupSearch || null;
    if (select.options.length - 1 <= above) {
        if (field) { field.__datalist.remove(); field.remove(); select.__groupSearch = null; }
        select.hidden = false;
        return null;
    }
    if (!field) {
        field = document.createElement('input');
        field.type = 'search';
        field.className = `${select.className} group-search`;
        field.autocomplete = 'off';
        field.placeholder = placeholder;
        field.setAttribute('aria-label', `${select.getAttribute('aria-label') || label}: search`);
        field.dataset.axis = select.dataset.axis || '';
        const list = document.createElement('datalist');
        list.id = `group-search-${++_serial}`;
        field.setAttribute('list', list.id);
        field.__datalist = list;
        // a name chosen or typed in full chooses it in the select; anything else goes back to what is chosen
        field.addEventListener('change', () => {
            const o = optionNamed(select, field.value);
            if (!o) { field.value = chosenText(select); return; }
            if (select.value !== o.value) {
                select.value = o.value;
                select.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });
        select.after(field, list);
        select.__groupSearch = field;
    }
    const names = [...select.options].filter((o) => o.value !== '' && !o.disabled).map((o) => o.textContent);
    const have = [...field.__datalist.children].map((o) => o.value);
    if (names.length !== have.length || names.some((n, i) => n !== have[i])) {
        field.__datalist.replaceChildren(...names.map((n) => { const o = document.createElement('option'); o.value = n; return o; }));
    }
    if (document.activeElement !== field) field.value = chosenText(select);
    select.hidden = true;
    return field;
}
