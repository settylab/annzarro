/**
 * The per-cell CSV of a grouping (GRP-18): one row a cell, its name and its group, on request and up to a million cells.
 *
 * It builds the file from what the page already holds or asks for once: the grouping's codes, read from the group store
 * as an export consumer (it only looks, so it is not counted in "used by"), and the names of the cells shown
 * (`DataManager.allCellNames`, the accessor a table export uses). Before the codes are asked for, the memory guard is
 * asked, through the provider's own check (`refusal`); a refusal, or a dataset past the limit, asks for nothing of any kind.
 * The text is built in chunks, with the page given a turn between them, so a million rows never freeze it, and it comes
 * back as parts for a Blob rather than one string.
 *
 * Nothing here reaches the page: the page's side comes in as `deps`, so the panel passes its own and a test passes fakes.
 */
import { csvField } from '../../utils/score-inspect.js';
import { PENDING } from '../../utils/host-binding.js';

/** The most cells a per-cell export is offered for (GRP-18). */
const CELL_EXPORT_LIMIT = 1000000;

/** Rows built before the page is given a turn. */
const ROWS_PER_CHUNK = 50000;

/** The consumer kind of a read that only looks: not counted as a user of the grouping (utils/consumer-kinds.js). */
const KIND = 'inspect-export';

const nextTurn = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Whether the export is offered for this many cells, and when it is not, why.
 * @param {{cells: number, words: Object}} p - `words.tooManyCells(limit)` says why
 * @returns {{enabled: boolean, reason: string}}
 */
function offer({ cells, words }) {
    return cells > CELL_EXPORT_LIMIT ? { enabled: false, reason: words.tooManyCells(CELL_EXPORT_LIMIT) } : { enabled: true, reason: '' };
}

/**
 * The CSV as parts: a header, then a row a cell. A cell in no group (the codes' missing value: 255 in one byte, 65535 in
 * two) reads `words.notInAnyGroup`.
 * @param {{names: ArrayLike<string>, codes: ArrayBufferView, groupNames: string[], words: Object, rowsPerChunk?: number,
 *   yieldTurn?: () => Promise<void>}} p - `codes` and `names` cover the same cells, in the same order
 * @returns {Promise<string[]>}
 */
async function buildCsv({ names, codes, groupNames, words, rowsPerChunk = ROWS_PER_CHUNK, yieldTurn = nextTurn }) {
    // each group's field, quoted once; a code with no group (the missing value, or one past the names) is the missing text
    const none = csvField(words.notInAnyGroup, { text: true });
    const fields = groupNames.map((name) => csvField(name, { text: true }));
    const n = codes.length;
    const parts = [`${csvField(words.cellName, { text: true })},${csvField(words.groupName, { text: true })}\n`];
    for (let from = 0; from < n; from += rowsPerChunk) {
        if (from > 0) await yieldTurn();
        const to = Math.min(n, from + rowsPerChunk);
        const rows = new Array(to - from);
        for (let i = from; i < to; i++) {
            const field = fields[codes[i]];
            rows[i - from] = `${csvField(names[i], { text: true })},${field === undefined ? none : field}`;
        }
        parts.push(`${rows.join('\n')}\n`);
    }
    return parts;
}

/**
 * The grouping's codes once they are there: resolves with the values, or null when the groups cannot be read (a state
 * that does not pass by itself: refused, failed, a loop). The read is let go of either way by the caller.
 */
function readCodes(handleOf) {
    return new Promise((resolve) => {
        let settled = false;
        const look = (snap) => {
            if (settled) return;
            if (snap.values && snap.values.codes) { settled = true; resolve(snap.values); } else if (!PENDING.includes(snap.state)) { settled = true; resolve(null); }
        };
        const handle = handleOf(look);
        look(handle.read());
    });
}

/**
 * The per-cell CSV of grouping `id`.
 * @param {Object} p
 * @param {string} p.id - the grouping's key
 * @param {{cells: () => number, refusal: (id: string) => (null|{why: string}), names: () => Promise<ArrayLike<string>>,
 *   sources: {watch: Function, namesOf: (id: string, reply: Object) => string[]}, panelId?: string, host?: HTMLElement}} p.deps
 *   - the page's side: how many cells are shown; the provider's memory-guard check (null when the codes fit or are held
 *   already); the names of the cells; the group sources (utils/group-host.js)
 * @param {Object} p.words - interface words (utils/vocabulary.js)
 * @returns {Promise<{ok: true, parts: string[]}|{ok: false, reason: string}>}
 */
// export-unused-ok: the entry below wraps it; cell-export.test.mjs drives it directly, with fake sources and no DOM
export async function exportCells({ id, deps, words, rowsPerChunk, yieldTurn }) {
    const gate = offer({ cells: deps.cells(), words });
    if (!gate.enabled) return { ok: false, reason: gate.reason };
    const refused = deps.refusal(id);
    if (refused) return { ok: false, reason: refused.why };
    let handle = null;
    try {
        const values = await readCodes((onChange) => {
            handle = deps.sources.watch(id, {
                consumer: { kind: KIND, role: 'export', panelId: deps.panelId, host: deps.host }, option: { codes: true },
                visible: () => true, onChange
            });
            return handle;
        });
        if (!values) return { ok: false, reason: words.failed };
        const names = await deps.names();
        if (names.length !== values.codes.length) return { ok: false, reason: words.failed };
        const parts = await buildCsv({ names, codes: values.codes, groupNames: deps.sources.namesOf(id, values.reply), words, rowsPerChunk, yieldTurn });
        return { ok: true, parts };
    } finally {
        if (handle) handle.release();
    }
}

/**
 * The export's entry beside "Export CSV": a button that builds the file and hands it over, a line that says why when it
 * could not, and `refresh()` for the panel's update (the entry is disabled, with its reason, past the limit).
 * @param {Object} p
 * @param {string} p.id - the grouping's key (the panel's id)
 * @param {Object} p.deps - as `exportCells`
 * @param {Object} p.words - `words.entry` is the label and `words.entryTitle` its hint, with `exportCells`'s words
 * @param {(name: string, parts: string[]) => void} p.download - hands the parts over as a file
 * @returns {{button: HTMLButtonElement, note: HTMLElement, refresh: () => void}}
 */
export function cellExportEntry({ id, deps, words, download }) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-sm btn-outline-secondary cgg__export-cells';
    button.textContent = words.entry;
    const note = document.createElement('span');
    note.className = 'cgg__export-say';
    note.setAttribute('role', 'status');
    note.hidden = true;
    let busy = false;

    const say = (text) => { note.textContent = text; note.hidden = !text; };

    function refresh() {
        const gate = offer({ cells: deps.cells(), words });
        button.disabled = !gate.enabled || busy;
        button.title = gate.enabled ? words.entryTitle : gate.reason;
    }

    button.addEventListener('click', async () => {
        if (busy) return;
        busy = true;
        say('');
        button.setAttribute('aria-busy', 'true');
        refresh();
        try {
            const out = await exportCells({ id, deps, words });
            if (out.ok) download('cells.csv', out.parts); else say(out.reason);
        } finally {
            busy = false;
            button.removeAttribute('aria-busy');
            refresh();
        }
    });
    refresh();
    return { button, note, refresh };
}
