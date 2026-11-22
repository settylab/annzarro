/**
 * Show as table (UX 7, CNT-23): the plotted table as an HTML table, for a reader who cannot read the plot. Its rows are
 * the CSV's (panels/cell-count/draw.js `countRows`, one column specification), so the table and the download never
 * differ. A grid can hold hundreds of thousands of rows; the table shows the first `TABLE_ROWS_MAX` and says that the
 * CSV has them all.
 */
import { VOCABULARY } from '../../utils/vocabulary.js';

const W = VOCABULARY.countPlot.table;

/** The most rows the table shows; the CSV has every row. */
const TABLE_ROWS_MAX = 2000;

/**
 * The table of the CSV's rows: its header, the rows it shows, and the sentence that says it is cut (null when not).
 * @param {Array<Array<*>>} rows - countRows: the header, then one row per combination of levels
 * @returns {{header: string[], rows: Array<Array<*>>, cut: (string|null)}}
 */
export function tableView(rows) {
    const body = rows.slice(1);
    const shown = body.length > TABLE_ROWS_MAX ? body.slice(0, TABLE_ROWS_MAX) : body;
    return { header: rows[0] || [], rows: shown, cut: shown.length < body.length ? W.cut(shown.length, body.length) : null };
}

const cellText = (v) => (v === null || v === undefined ? '' : String(v));

/**
 * The table's element: a caption, column headers with `scope="col"`, and the rows.
 * @param {Object} D - the DOM builder (gene-set-utilities/dom.js)
 * @param {ReturnType<typeof tableView>} view
 * @param {string} caption - the plot's title
 * @returns {HTMLElement}
 */
export function tableElement(D, view, caption) {
    const { el } = D;
    const table = el('table', { class: 'table table-sm ccnt-table__grid' },
        el('caption', { text: caption }),
        el('thead', {}, el('tr', {}, view.header.map((h) => el('th', { scope: 'col', text: cellText(h) })))),
        el('tbody', {}, view.rows.map((row) => el('tr', {}, row.map((v) => el('td', { text: cellText(v) }))))));
    return el('div', { class: 'ccnt-table__wrap' }, table, ...(view.cut ? [el('p', { class: 'ccnt-help ccnt-table__cut', text: view.cut })] : []));
}
