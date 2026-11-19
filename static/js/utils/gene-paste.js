/**
 * Pasted and uploaded gene lists: reading, parsing and matching. Pure (no DOM),
 * so Node tests cover a table of formats (gene-paste.test.mjs). The browser
 * parses the text itself; nothing here sends a file anywhere.
 *
 * Reading:   readInput(text | bytes, {fileName})  -> {ok, text} or {ok: false, code, message}
 * Parsing:   parseGeneInput(text, options)         -> the names, and what the preview needs to
 *            let the user pick a table column or a GMT set
 * Matching:  matchGenes(names, options)            -> what would be added, and what would not
 *
 * Detection order (design 9.2): GMT, GRP, table, list. `readAs` overrides the guess.
 */
import { arrayMax } from './array-stats.js';
import { detectIdType, stripVersion } from '../panels/gene-set-utilities/links.js';
import { ID_COLUMN_PREFERENCE } from '../panels/gene-set-utilities/state.js';

/** The largest file or pasted text read, in bytes. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Genes a signature holds (design 5). */
export const DEFAULT_LIMIT = 2000;

/** How `readAs` is spelled, for the preview's menu. */
export const FORMATS = Object.freeze(['list', 'table', 'gmt', 'grp']);

export const MESSAGES = Object.freeze({
    tooBig: 'That file is larger than 10 MB. Paste or upload a shorter list.',
    excel: 'Excel files cannot be read here. Save the sheet as CSV first.',
    compressed: 'Compressed files cannot be read here. Unpack it and upload the text file.',
    binary: 'That does not look like a text file. Use a plain list, CSV, TSV, GMT or GRP file.'
});

const EXCEL_EXT = /\.(xlsx|xlsm|xlsb|xls|ods)$/i;

// ---------------------------------------------------------------------------
// reading

/** Remove a leading byte-order mark and unify the line endings to \n. */
export function normaliseText(text) {
    let s = String(text == null ? '' : text);
    if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
    return s.replace(/\r\n?/g, '\n');
}

/**
 * Turn what the user gave (a string, or the bytes of a file) into text.
 * Refuses Excel files by their signature or extension, files over the cap,
 * and binary content.
 * @param {string|ArrayBuffer|Uint8Array} input
 * @param {{fileName?: string, maxBytes?: number}} [opts]
 * @returns {{ok: true, text: string} | {ok: false, code: string, message: string}}
 */
export function readInput(input, opts = {}) {
    const maxBytes = opts.maxBytes || MAX_FILE_BYTES;
    const fileName = String(opts.fileName || '');
    if (typeof input === 'string') {
        if (input.length > maxBytes) return fail('too-big', MESSAGES.tooBig);
        return { ok: true, text: normaliseText(input) };
    }
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input || 0);
    if (bytes.length > maxBytes) return fail('too-big', MESSAGES.tooBig);
    if (EXCEL_EXT.test(fileName)) return fail('excel', MESSAGES.excel);
    // PK\x03\x04 is an xlsx (a zip); D0 CF 11 E0 is the old xls container.
    if (bytes[0] === 0x50 && bytes[1] === 0x4B && bytes[2] === 0x03 && bytes[3] === 0x04) return fail('excel', MESSAGES.excel);
    if (bytes[0] === 0xD0 && bytes[1] === 0xCF && bytes[2] === 0x11 && bytes[3] === 0xE0) return fail('excel', MESSAGES.excel);
    if (bytes[0] === 0x1F && bytes[1] === 0x8B) return fail('compressed', MESSAGES.compressed);
    let label = 'utf-8';
    if (bytes[0] === 0xFF && bytes[1] === 0xFE) label = 'utf-16le';
    else if (bytes[0] === 0xFE && bytes[1] === 0xFF) label = 'utf-16be';
    const text = new TextDecoder(label).decode(bytes);
    if (label === 'utf-8' && text.includes('\u0000')) return fail('binary', MESSAGES.binary);
    return { ok: true, text: normaliseText(text) };
}

function fail(code, message) { return { ok: false, code, message }; }

// ---------------------------------------------------------------------------
// tokens and delimited text

const QUOTES = '"\'“”‘’`';

/** A name without the quotes around it and without stray whitespace. */
export function cleanName(s) {
    let t = String(s == null ? '' : s).trim();
    let a = 0, b = t.length;
    while (a < b && QUOTES.includes(t[a])) a++;
    while (b > a && QUOTES.includes(t[b - 1])) b--;
    return t.slice(a, b).trim();
}

/** Lines without blank ones and without `#` comment lines. */
function contentLines(text) {
    return text.split('\n').filter(l => l.trim() !== '' && !l.trimStart().startsWith('#'));
}

/**
 * A flat list: split on newline, comma, semicolon, tab, space, pipe and any mix.
 * `#` comment lines are ignored.
 */
export function parseList(text) {
    const out = [];
    for (const line of contentLines(normaliseText(text))) {
        for (const tok of line.split(/[\s,;|]+/)) {
            const n = cleanName(tok);
            if (n) out.push(n);
        }
    }
    return out;
}

/** GRP: one gene per line; `#` lines are comments. A line holds the whole name. */
export function parseGrp(text) {
    const out = [];
    for (const line of contentLines(normaliseText(text))) {
        const n = cleanName(line);
        if (n) out.push(n);
    }
    return out;
}

/** GMT: one set per line, tab-separated: name, description, genes... */
export function parseGmt(text) {
    const sets = [];
    for (const line of contentLines(normaliseText(text))) {
        const f = line.split('\t');
        if (f.length < 3) continue;
        const genes = f.slice(2).map(cleanName).filter(Boolean);
        sets.push({ name: cleanName(f[0]) || `Set ${sets.length + 1}`, description: cleanName(f[1]), genes });
    }
    return sets;
}

/**
 * Delimiter-separated rows with quotes ("a,b", "" for a quote, a newline inside quotes).
 * @param {string} text normalised
 * @param {string} delim one character
 * @returns {string[][]}
 */
export function parseDelimited(text, delim) {
    const rows = [];
    let row = [], field = '', quoted = false, i = 0;
    const n = text.length;
    const endRow = () => {
        row.push(field);
        field = '';
        if (!(row.length === 1 && row[0].trim() === '')) rows.push(row);
        row = [];
    };
    while (i < n) {
        const c = text[i];
        if (quoted) {
            if (c === '"') {
                if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
                quoted = false; i++; continue;
            }
            field += c; i++; continue;
        }
        if (c === '"' && field.trim() === '') { quoted = true; field = ''; i++; continue; }
        if (c === delim) { row.push(field); field = ''; i++; continue; }
        if (c === '\n') { endRow(); i++; continue; }
        field += c; i++;
    }
    if (field !== '' || row.length) endRow();
    return rows.filter(r => !(r.length === 1 && r[0].trimStart().startsWith('#')));
}

// ---------------------------------------------------------------------------
// detection

/** The format the text is read as unless the user says otherwise. */
export function detectFormat(text, fileName = '') {
    const t = normaliseText(text);
    const name = String(fileName || '').toLowerCase();
    if (/\.gmt$/.test(name)) return 'gmt';
    if (/\.grp$/.test(name)) return 'grp';
    const lines = contentLines(t);
    if (!lines.length) return 'list';
    const tabCounts = lines.map(l => l.split('\t').length);
    // GMT: every line has name, description and genes; one set, or sets of differing sizes
    // (rows of equal width read as a table, which "Read as" can override).
    if (tabCounts.every(c => c >= 3)) {
        if (lines.length > 1 && new Set(tabCounts).size > 1) return 'gmt';
        // one line is a tab-separated list unless it reads like a set: NAME_WITH_UNDERSCORES, then a URL or NA
        const f = lines[0].split('\t');
        if (lines.length === 1 && (f[0].includes('_') || /^(https?:|na$)/i.test(f[1].trim()))) return 'gmt';
    }
    const first = t.split('\n').find(l => l.trim() !== '');
    if (first && first.trimStart().startsWith('#')) return 'grp';
    const forced = /\.(csv|tsv)$/.test(name);
    if (lines.length >= 2 && tabCounts[0] >= 2 && tabCounts.every(c => c === tabCounts[0])) return 'table';
    if (lines.length >= 2) {
        const rows = parseDelimited(t, ',');
        const w = rows[0] ? rows[0].length : 0;
        if (w >= 2 && rows.length >= (forced ? 2 : 3) && rows.every(r => r.length === w)) return 'table';
    }
    if (forced && lines.length >= 2) return 'table';
    return 'list';
}

const NUMERIC = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
const HEADER_NAMES = new Set([...ID_COLUMN_PREFERENCE.flat(), 'gene', 'genes', 'id', 'ids', 'marker', 'markers', 'feature', 'features']);

/** Whether the first row of a table looks like column names. */
export function guessHeader(rows) {
    if (!rows.length) return false;
    const first = rows[0].map(c => c.trim());
    if (first.some(c => HEADER_NAMES.has(c.toLowerCase()))) return true;
    if (first.some(c => NUMERIC.test(c))) return false;
    return rows.slice(1, 50).some(r => r.some(c => NUMERIC.test(c.trim())));
}

/**
 * The gene column of a table. By name (ID_COLUMN_PREFERENCE order), then, when `score`
 * is given, the column whose values match most; with neither, the first column.
 * @param {string[][]} rows rows without the header
 * @param {string[]|null} headerRow
 * @param {(values: string[]) => number} [score] how many of these values the dataset knows
 * @returns {number}
 */
export function pickGeneColumn(rows, headerRow, score) {
    const width = arrayMax([1, headerRow ? headerRow.length : 0, ...rows.slice(0, 200).map(r => r.length)]);
    const byName = [];
    if (headerRow) {
        const lower = headerRow.map(h => h.trim().toLowerCase());
        const order = ID_COLUMN_PREFERENCE.flat();
        const extras = ['gene', 'genes', 'marker', 'markers', 'feature', 'features', 'id'];
        for (const nm of [...order, ...extras]) {
            const idx = lower.indexOf(nm);
            if (idx >= 0 && !byName.includes(idx)) byName.push(idx);
        }
    }
    if (typeof score === 'function') {
        const best = (cols) => {
            let pick = -1, top = 0;
            for (const c of cols) {
                const n = score(rows.slice(0, 5000).map(r => cleanName(r[c] || '')).filter(Boolean));
                if (n > top) { pick = c; top = n; }
            }
            return pick;
        };
        // among the columns named like genes the one the dataset knows most of (ids before symbols on a tie),
        // else any column the dataset knows
        const named = best(byName);
        if (named >= 0) return named;
        const any = best(Array.from({ length: width }, (_, i) => i));
        if (any >= 0) return any;
    }
    return byName.length ? byName[0] : 0;
}

// ---------------------------------------------------------------------------
// the whole parse

/**
 * Parse text the way the preview needs.
 * @param {string} text normalised or raw text
 * @param {Object} [o]
 * @param {string} [o.fileName]
 * @param {'auto'|'list'|'table'|'gmt'|'grp'} [o.readAs]
 * @param {'auto'|boolean} [o.header] table: first row is names
 * @param {number|null} [o.column] table: gene column (null = pick)
 * @param {number} [o.setIndex] gmt: which set
 * @param {(values: string[]) => number} [o.score] table: dataset matches in a column
 * @returns {{format: string, detected: string, names: string[], empty: boolean, table?: Object, sets?: Object[], setIndex?: number}}
 */
export function parseGeneInput(text, o = {}) {
    const t = normaliseText(text);
    const detected = t.trim() === '' ? 'list' : detectFormat(t, o.fileName);
    const readAs = o.readAs && o.readAs !== 'auto' ? o.readAs : detected;
    const base = { format: readAs, detected, names: [], empty: t.trim() === '' };
    if (base.empty) return base;
    if (readAs === 'list') return { ...base, names: parseList(t) };
    if (readAs === 'grp') return { ...base, names: parseGrp(t) };
    if (readAs === 'gmt') {
        const sets = parseGmt(t);
        const setIndex = Math.min(Math.max(o.setIndex | 0, 0), Math.max(sets.length - 1, 0));
        return { ...base, sets, setIndex, names: sets.length ? sets[setIndex].genes : [] };
    }
    // table
    const lines = contentLines(t);
    const delimiter = lines.length && lines.every(l => l.includes('\t')) ? '\t'
        : (lines.some(l => l.includes(',')) ? ',' : '\t');
    const all = parseDelimited(t, delimiter);
    const header = o.header === true || o.header === false ? o.header : guessHeader(all);
    const headerRow = header && all.length ? all[0].map(c => cleanName(c)) : null;
    const rows = header ? all.slice(1) : all;
    const width = arrayMax([1, headerRow ? headerRow.length : 0, ...all.slice(0, 200).map(r => r.length)]);
    const column = Number.isInteger(o.column) && o.column >= 0 && o.column < width
        ? o.column : pickGeneColumn(rows, headerRow, o.score);
    const columns = Array.from({ length: width }, (_, i) => (headerRow && headerRow[i]) || `Column ${i + 1}`);
    const names = rows.map(r => cleanName(r[column] || '')).filter(Boolean);
    return { ...base, names, table: { delimiter, header, columns, column, sample: all.slice(0, header ? 6 : 5) } };
}

// ---------------------------------------------------------------------------
// matching

const indexCache = new WeakMap();

/** Name lookups of a dataset's genes: exact, and by lower case. Cached per array. */
export function buildIndex(geneNames) {
    let idx = indexCache.get(geneNames);
    if (idx) return idx;
    const exact = new Set();
    const lower = new Map();
    for (const g of geneNames) {
        if (exact.has(g)) continue;
        exact.add(g);
        const k = g.toLowerCase();
        const list = lower.get(k);
        if (list) list.push(g); else lower.set(k, [g]);
    }
    idx = { exact, lower };
    indexCache.set(geneNames, idx);
    return idx;
}

const MONTH = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)';
const EXCEL_DATE = new RegExp(`^(\\d{1,2}-${MONTH}|${MONTH}-\\d{1,2})$`, 'i');

/** A gene name Excel turned into a date (1-Mar for MARCH1), as the text it left. */
export function looksLikeExcelDate(name) { return EXCEL_DATE.test(String(name).trim()); }

/**
 * Match names to a dataset's genes, in the design's order: exact, same name ignoring case
 * (when exactly one gene fits), identifier (`idToName`), else unmatched.
 * @param {string[]} names
 * @param {Object} o
 * @param {string[]} o.geneNames the dataset's gene names
 * @param {Iterable<string>} [o.currentGenes] genes already selected
 * @param {number} [o.limit]
 * @param {boolean} [o.matchCase] do not match ignoring case
 * @param {Map<string,string>} [o.idToName] gene id (version stripped) to name
 */
export function matchGenes(names, o) {
    const { exact, lower } = buildIndex(o.geneNames || []);
    const limit = o.limit || DEFAULT_LIMIT;
    const current = new Set(o.currentGenes || []);
    const idToName = o.idToName || null;
    const seen = new Set(), resolved = new Set();
    const toAdd = [], caseMatches = [], idMatches = [], unmatched = [], ambiguous = [];
    let duplicates = 0, alreadySelected = 0, exactCount = 0, total = 0;
    for (const raw of names) {
        const name = cleanName(raw);
        if (!name) continue;
        total++;
        if (seen.has(name)) { duplicates++; continue; }
        seen.add(name);
        let gene = null, kind = null, many = false;
        if (exact.has(name)) { gene = name; kind = 'exact'; }
        else {
            if (!o.matchCase) {
                const c = lower.get(name.toLowerCase());
                if (c && c.length === 1) { gene = c[0]; kind = 'case'; } else if (c && c.length > 1) many = true;
            }
            if (!gene && idToName) {
                const g = idToName.get(name) || idToName.get(stripVersion(name));
                if (g && exact.has(g)) { gene = g; kind = 'id'; }
            }
        }
        if (!gene) {
            unmatched.push(name);
            if (many) ambiguous.push(name);
            continue;
        }
        if (resolved.has(gene)) { duplicates++; continue; }
        resolved.add(gene);
        if (kind === 'case') caseMatches.push({ input: name, gene });
        else if (kind === 'id') idMatches.push({ input: name, gene });
        else exactCount++;
        if (current.has(gene)) alreadySelected++; else toAdd.push(gene);
    }
    const resulting = current.size + toAdd.length;
    const result = {
        total, toAdd, alreadySelected, duplicates, exactCount, caseMatches, idMatches, unmatched, ambiguous,
        matched: toAdd.length + alreadySelected, limit, resulting, overLimit: resulting > limit, warnings: []
    };
    result.warnings = mismatchWarnings(result, o);
    return result;
}

function mismatchWarnings(r, o) {
    const out = [];
    const geneNames = o.geneNames || [];
    if (r.unmatched.length && r.unmatched.length * 2 >= r.total - r.duplicates) {
        const kind = detectIdType(r.unmatched);
        const datasetKind = detectIdType(geneNames.slice(0, 200));
        if (kind === 'ensembl' && datasetKind !== 'ensembl' && !o.idToName) {
            out.push({ code: 'ensembl', text: 'These look like Ensembl ids, but this dataset uses gene symbols and has no id column to translate them.' });
        } else if (kind === 'entrez' && datasetKind !== 'entrez' && !o.idToName) {
            out.push({ code: 'entrez', text: 'These look like Entrez ids, but this dataset uses gene symbols and has no id column to translate them.' });
        }
    }
    if (r.caseMatches.length && r.caseMatches.length > r.exactCount) {
        out.push({ code: 'species', text: 'Most matches differ only in case, so these may come from another species. Names were matched, not orthologs.' });
    }
    const dates = r.unmatched.filter(looksLikeExcelDate);
    if (dates.length) {
        out.push({ code: 'excel-date', text: `${dates.slice(0, 3).join(', ')} may be ${dates.length === 1 ? 'a gene name' : 'gene names'} changed by Excel.` });
    }
    if (r.ambiguous.length) {
        out.push({ code: 'ambiguous', text: `${r.ambiguous.length} ${r.ambiguous.length === 1 ? 'name fits' : 'names fit'} several genes when case is ignored, so ${r.ambiguous.length === 1 ? 'it was' : 'they were'} not matched. Use the exact spelling, or tick Match case.` });
    }
    return out;
}

/** How many of `values` are genes of the dataset, by exact or by case-insensitive name. For `score`. */
export function countKnown(values, geneNames) {
    const { exact, lower } = buildIndex(geneNames);
    let n = 0;
    for (const v of values) if (exact.has(v) || lower.has(v.toLowerCase())) n++;
    return n;
}
