/**
 * The Gene Set Analysis panel's state, as plain data. Pure: no DOM, no
 * DataManager, no PanelManager, no network, so Node tests cover all of it
 * (annzarro/tests/js/gene-set-state.test.mjs).
 *
 * What a section shows is decided by two values:
 *   - the snapshot: the genes the user ran on (the rows passing the source
 *     table's filter when Run was pressed), with the species and ID column;
 *   - a section's input key: a hash of everything its request depends on.
 * A section whose result was made for another key is stale: the result stays
 * on screen, dimmed, until a Run (or auto-update) fetches the new one. A
 * section never fetches by itself; the panel starts it (gene-set.js).
 */

// ---------------------------------------------------------------------------
// hashing

/** 32-bit FNV-1a of a string (UTF-16 code units), from `seed`. */
export function fnv1a(str, seed = 0x811c9dc5) {
    let h = seed >>> 0;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
}

const hex8 = (n) => (n >>> 0).toString(16).padStart(8, '0');

/** 64 bits of hash as 16 hex characters: two FNV-1a runs from different seeds. */
export function hash64(str) {
    return hex8(fnv1a(str)) + hex8(fnv1a(str, 0x01234567));
}

/**
 * A hash of a SET of strings: the same for any order and any repeats, and
 * different when one member differs. Computed in one pass, without sorting:
 * the members' hashes are combined commutatively (two sums and an xor) with
 * the number of distinct members. Called on every table redraw, so it must
 * stay O(n) at 30k genes.
 * @param {Iterable<string>} items
 * @returns {string}
 */
export function setHash(items) {
    const seen = new Set();
    let a = 0, b = 0, x = 0;
    for (const item of items || []) {
        const s = String(item);
        if (seen.has(s)) continue;
        seen.add(s);
        const h1 = fnv1a(s), h2 = fnv1a(s, 0x01234567);
        a = (a + h1) >>> 0;
        b = (b + Math.imul(h2, 0x9e3779b1)) >>> 0;
        x = (x ^ Math.imul(h1 ^ (h2 >>> 7), 0x85ebca6b)) >>> 0;
    }
    return `${seen.size.toString(36)}-${hex8(a)}${hex8(b)}${hex8(x)}`;
}

/** JSON with object keys sorted, so equal params give equal strings. */
export function stableStringify(value) {
    if (value === undefined) return 'null';
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    return `{${Object.keys(value).sort().filter(k => value[k] !== undefined)
        .map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

/**
 * Everything a section's request depends on, hashed: the adapter and its
 * version, the genes (for a set section) or the focused gene (for a gene
 * section), the species, the ID column, the section's params, the
 * background's hash when the dataset's genes are the background, and the
 * service's configured address (another STRING version is another result).
 * @param {{id:string, version:string, kind:'set'|'gene'}} adapter
 * @param {{genesHash?:string, focusId?:string|null, taxonomyId:string,
 *   idColumn:string, params?:Object, backgroundHash?:string|null, service?:string}} parts
 * @returns {string}
 */
export function inputKey(adapter, parts) {
    const payload = adapter.kind === 'gene' ? `gene:${parts.focusId ?? ''}` : `set:${parts.genesHash ?? ''}`;
    return hash64([adapter.id, adapter.version, payload, String(parts.taxonomyId ?? ''),
        String(parts.idColumn ?? ''), stableStringify(parts.params || {}),
        parts.backgroundHash ? `bg:${parts.backgroundHash}` : '', parts.service || ''].join('\u0001'));
}

// ---------------------------------------------------------------------------
// the source table

/**
 * What a source Gene Table offers now. Mirrors the plots' read of a table
 * filter (plot-make.js updateTableEntities): an open table gives row indexes
 * into the dataset's genes (currentEntries), a closed one the names that
 * passed when it closed (closedSelection.passing), or nothing (restored
 * closed from a panel set).
 * @param {Object|null|undefined} table - the PanelManager panel
 * @param {{open: boolean, geneNames: ArrayLike<string>}} ctx
 * @returns {{status: 'missing'|'waiting'|'open'|'closed'|'closed-unknown',
 *   names: string[]|null, title: string}}
 */
export function readTableSelection(table, { open, geneNames }) {
    if (!table) return { status: 'missing', names: null, title: '' };
    const title = (typeof table.getTitle === 'function' && table.getTitle()) || '';
    if (open && typeof table.isReady === 'function' && !table.isReady()) {
        return { status: 'waiting', names: null, title };
    }
    const cfg = (typeof table.getConfig === 'function' && table.getConfig()) || {};
    if (open) {
        const names = [];
        const entries = Array.isArray(cfg.currentEntries) ? cfg.currentEntries : [];
        for (const i of entries) {
            const name = geneNames && (typeof geneNames.at === 'function' ? geneNames.at(i) : geneNames[i]);
            if (typeof name === 'string' && name) names.push(name);
        }
        return { status: 'open', names, title };
    }
    if (cfg.closedSelection && cfg.closedSelection.passing) {
        return { status: 'closed', names: Array.from(cfg.closedSelection.passing), title };
    }
    return { status: 'closed-unknown', names: null, title };
}

/**
 * The ids a selection sends: the names themselves for the var index, else
 * each name's value in the ID column. A gene without a value (empty, NaN)
 * is counted, not sent; a repeated id is sent once.
 * @param {string[]} names
 * @param {{idColumn: string, idOf?: (name: string) => *}} opts
 * @returns {{genes: string[], names: string[], missingIds: number, duplicates: number}}
 */
export function selectionIds(names, { idColumn, idOf }) {
    const genes = [], kept = [], seen = new Set();
    let missingIds = 0, duplicates = 0;
    for (const name of names || []) {
        let id = idColumn === '_index' || !idOf ? name : idOf(name);
        if (typeof id === 'number' && Number.isFinite(id)) id = String(id);
        if (typeof id !== 'string' || !id.trim() || id === 'nan' || id === 'NaN') { missingIds++; continue; }
        id = id.trim();
        if (seen.has(id)) { duplicates++; continue; }
        seen.add(id);
        genes.push(id);
        kept.push(name);
    }
    return { genes, names: kept, missingIds, duplicates };
}

/**
 * The snapshot a Run takes: what is sent, and what it was taken from.
 * @returns {Object} frozen
 */
export function makeSnapshot({ genes, names, missingIds = 0, duplicates = 0, sourceId, sourceTitle,
    sourceStatus = 'open', taxonomyId, speciesName = '', idColumn, takenAt }) {
    return Object.freeze({
        genes: Object.freeze(genes.slice()), names: Object.freeze(names.slice()),
        missingIds, duplicates, count: genes.length, hash: setHash(genes),
        sourceId, sourceTitle, sourceStatus, taxonomyId: String(taxonomyId), speciesName, idColumn,
        takenAt
    });
}

/**
 * Why the snapshot no longer describes the panel's input, if it does not:
 * the table's selection, the species or the ID column changed.
 * @param {Object|null} snapshot
 * @param {{hash: string|null, count: number, taxonomyId: string, speciesName?: string,
 *   idColumn: string, sourceId: string}} current
 * @returns {null|{reasons: string[], text: string}}
 */
export function panelStaleness(snapshot, current) {
    if (!snapshot) return null;
    const reasons = [];
    const parts = [];
    if (current.sourceId !== snapshot.sourceId) {
        reasons.push('source');
        parts.push('The source table changed');
    } else if (current.hash !== null && current.hash !== snapshot.hash) {
        reasons.push('selection');
        parts.push(`Selection changed: "${snapshot.sourceTitle}" now has ${fmt(current.count)} gene${current.count === 1 ? '' : 's'}; results are for ${fmt(snapshot.count)}`);
    }
    if (String(current.taxonomyId) !== String(snapshot.taxonomyId)) {
        reasons.push('species');
        parts.push(`Species changed to ${current.speciesName || `taxon ${current.taxonomyId}`}`);
    }
    if (current.idColumn !== snapshot.idColumn) {
        reasons.push('idColumn');
        parts.push(`IDs changed to ${current.idColumn}`);
    }
    return reasons.length ? { reasons, text: parts.join('; ') } : null;
}

export function fmt(n) {
    return Number(n || 0).toLocaleString('en-US');
}

// ---------------------------------------------------------------------------
// a section's run

/** A section that has not run. */
export function idleRun() {
    return { status: 'idle', key: null, lastInputHash: null, result: null, error: null,
        startedAt: null, finishedAt: null, token: 0, prev: null, retryAt: null, cached: false };
}

/** Start: a new token, so a reply to an earlier start is dropped. */
export function startRun(run, key, now) {
    const prev = run.status === 'loading' ? run.prev : { status: run.status, lastInputHash: run.lastInputHash };
    return { ...run, status: 'loading', key, token: run.token + 1, prev, startedAt: now, retryAt: null };
}

/** A reply. Ignored unless it answers the current start. */
export function resolveRun(run, token, result, now, { cached = false } = {}) {
    if (token !== run.token || run.status !== 'loading') return run;
    return { ...run, status: 'ok', lastInputHash: run.key, result, error: null, finishedAt: now,
        prev: null, retryAt: null, cached };
}

/**
 * A failure. Ignored unless it answers the current start. An abort (the run
 * was superseded or its section hidden) is not a failure: the section goes
 * back to what it showed before.
 */
export function rejectRun(run, token, error, now) {
    if (token !== run.token || run.status !== 'loading') return run;
    if (error && error.kind === 'aborted') return cancelRun(run);
    return { ...run, status: 'error', lastInputHash: run.key, error, finishedAt: now, prev: null, retryAt: null };
}

/** Undo a start (hidden, superseded): the previous status, and later replies dropped. */
export function cancelRun(run) {
    if (run.status !== 'loading') return run;
    const prev = run.prev || { status: 'idle', lastInputHash: null };
    return { ...run, status: prev.status, lastInputHash: prev.lastInputHash, token: run.token + 1,
        prev: null, retryAt: null };
}

/**
 * Compare a settled section with the key it should show now: another key
 * makes it stale (its result stays, dimmed); its own key again (species
 * flipped back) makes it fresh again.
 */
export function settleRun(run, expectedKey) {
    if (run.status === 'loading' || run.status === 'idle' || !run.lastInputHash) return run;
    if (expectedKey && run.lastInputHash !== expectedKey) {
        return run.status === 'stale' ? run : { ...run, status: 'stale' };
    }
    if (run.status === 'stale') return { ...run, status: run.error ? 'error' : 'ok' };
    return run;
}

/** Does this section need a fetch to show `key`? */
export function needsFetch(run, key) {
    if (!key) return false;
    if (run.status === 'loading') return run.key !== key;
    return run.status === 'idle' || run.lastInputHash !== key || run.status === 'error' || run.status === 'stale';
}

// ---------------------------------------------------------------------------
// blocked before any request

/**
 * Why a section must not send this input, decided before any request:
 * the error a section shows instead of fetching, or null. Never trims the
 * list to fit: an enrichment of the first 2,000 of 2,412 genes is a
 * different statistic, and nobody would know.
 * @param {Object} adapter
 * @param {{genes: string[], focus: Object|null, taxonomyId: string, speciesName: string, idType: string}} input
 * @returns {null|{kind: string, message: string}}
 */
export function blockedReason(adapter, input, { force = false } = {}) {
    const label = `${adapter.provider.name} ${adapter.label.toLowerCase()}`;
    if (adapter.kind === 'gene') {
        if (!input.focus || !input.focus.id) {
            return { kind: 'unfocused', message: 'No gene is focused: click a gene in a table, or in the Links list below.' };
        }
    } else {
        const n = input.genes.length;
        if (n === 0) return { kind: 'empty', message: 'The source table has no rows passing its filter.' };
        const min = adapter.limits.minGenes || 1;
        if (n < min) {
            return { kind: 'empty', message: `${fmt(n)} gene${n === 1 ? '' : 's'}; ${label} needs at least ${fmt(min)}.` };
        }
        // over the limit: not sent, unless the user asks to try anyway (the
        // service then answers for itself, and its refusal is shown as is)
        if (n > adapter.limits.maxGenes && !force) {
            return { kind: 'capped', message: `${fmt(n)} genes; ${label} accepts at most ${fmt(adapter.limits.maxGenes)}. `
                + 'Filter the table to fewer genes, or try anyway.' };
        }
    }
    let supported;
    try {
        supported = adapter.supportsSpecies(String(input.taxonomyId));
    } catch {
        supported = 'unknown';
    }
    if (supported === false) {
        const sp = input.speciesName ? `${input.speciesName} (taxon ${input.taxonomyId})` : `taxon ${input.taxonomyId}`;
        return { kind: 'species', message: `${adapter.provider.name} does not cover ${sp}.` };
    }
    if (adapter.idTypes && input.idType && input.idType !== 'unknown' && !adapter.idTypes.includes(input.idType)) {
        const names = { symbol: 'gene symbols', ensembl: 'Ensembl ids', entrez: 'Entrez ids' };
        return { kind: 'idtype', message: `${adapter.provider.name} needs ${adapter.idTypes.map(t => names[t] || t).join(' or ')}; `
            + `the ID column holds ${names[input.idType] || input.idType}. Pick another column under IDs.` };
    }
    return null;
}

// ---------------------------------------------------------------------------
// gene identifiers

/** How the values of the ID column are read; 'auto' looks at them. */
export const ID_TYPES = Object.freeze(['auto', 'symbol', 'ensembl', 'entrez']);

/**
 * The var columns that usually hold gene identifiers, best first: ids
 * before names, as the operator asked (gene_id; gene_ensembl_id, ensembl_id,
 * gene_ids; gene_name; gene_symbol, symbol), each with common variants
 * (feature_id, feature_name as cellxgene writes them, ...). Case-insensitive.
 */
export const ID_COLUMN_PREFERENCE = Object.freeze([
    ['gene_id', 'geneid', 'feature_id'],
    ['gene_ensembl_id', 'ensembl_id', 'gene_ids', 'ensembl_gene_id', 'ensembl', 'gene_ensembl', 'ensembl_ids',
        // the model organisms' own ids (WormBase WBGene..., FlyBase FBgn...)
        'wbgene', 'wbgene_id', 'wormbase_id', 'fbgn', 'flybase_id'],
    ['gene_name', 'gene_names', 'genename', 'feature_name', 'name'],
    ['gene_symbol', 'gene_symbols', 'symbol', 'symbols', 'hgnc_symbol', 'mgi_symbol']
]);

/**
 * The ID column a panel set to 'auto' uses: the first var column in
 * ID_COLUMN_PREFERENCE order, else the var index ('_index').
 * @param {string[]} columns - the dataset's var columns
 */
export function pickIdColumn(columns) {
    const byLower = new Map();
    for (const c of columns || []) if (typeof c === 'string' && !byLower.has(c.toLowerCase())) byLower.set(c.toLowerCase(), c);
    for (const group of ID_COLUMN_PREFERENCE) {
        for (const name of group) if (byLower.has(name)) return byLower.get(name);
    }
    return '_index';
}

/** A deep link's consent, kept only when well formed: {selection, hosts}. */
export function readLinkConsent(c) {
    if (!c || typeof c !== 'object' || typeof c.selection !== 'string' || !c.selection || !Array.isArray(c.hosts)) return null;
    const hosts = [...new Set(c.hosts.filter(h => typeof h === 'string' && /^[a-z0-9.-]+$/i.test(h)))].slice(0, 16);
    return hosts.length ? { selection: c.selection, hosts } : null;
}

// ---------------------------------------------------------------------------
// persisted settings

/** The keys getConfig() writes, and nothing else (see configOf). */
export const CONFIG_KEYS = Object.freeze(['id', 'title', 'tableFilter', 'idColumn', 'idType', 'consent', 'autoUpdate',
    'sections', 'sectionOrder', 'links', 'controlsVisible']);

/**
 * A param value checked against its spec; the default when it does not fit.
 * @returns {{value: *, ok: boolean}}
 */
export function checkParam(spec, value) {
    if (value === undefined) return { value: spec.default, ok: true };
    switch (spec.type) {
    case 'number': {
        const v = Number(value);
        const okRange = Number.isFinite(v) && (spec.min === undefined || v >= spec.min)
            && (spec.max === undefined || v <= spec.max)
            && (!spec.options || spec.options.some(o => Number(o.value ?? o) === v));
        return okRange ? { value: v, ok: true } : { value: spec.default, ok: false };
    }
    case 'enum': {
        const values = (spec.options || []).map(o => (typeof o === 'object' ? o.value : o));
        return values.includes(value) ? { value, ok: true } : { value: spec.default, ok: false };
    }
    case 'multi': {
        const values = (spec.options || []).map(o => (typeof o === 'object' ? o.value : o));
        if (!Array.isArray(value) || !value.every(v => values.includes(v))) return { value: spec.default.slice(), ok: false };
        return { value: values.filter(v => value.includes(v)), ok: true };
    }
    case 'bool':
        return typeof value === 'boolean' ? { value, ok: true } : { value: spec.default, ok: false };
    default:
        return { value: spec.default, ok: false };
    }
}

/** An adapter's params from a stored object: every key valid, unknown keys dropped. */
export function checkParams(specs, stored, warn = () => {}) {
    const out = {};
    const given = stored && typeof stored === 'object' ? stored : {};
    for (const [name, spec] of Object.entries(specs || {})) {
        const { value, ok } = checkParam(spec, given[name]);
        if (!ok) warn(`${name}: ${JSON.stringify(given[name])} is not a valid value; using ${JSON.stringify(spec.default)}`);
        out[name] = Array.isArray(value) ? value.slice() : value;
    }
    return out;
}

/**
 * The panel's settings from a stored config (a share link, a panel set,
 * the panel's own defaults). Never throws: a link made by a build with
 * other sections gets defaults for the new ones, keeps the ones this build
 * does not know (so a round trip through this build loses nothing), and
 * replaces invalid params with defaults.
 * @param {Object} stored
 * @param {Object[]} adapters - in registry order
 * @param {(msg: string) => void} [warn]
 */
export function normalizeConfig(stored, adapters, warn = () => {}) {
    const cfg = stored && typeof stored === 'object' ? stored : {};
    const sections = {};
    const given = cfg.sections && typeof cfg.sections === 'object' ? cfg.sections : {};
    for (const [id, s] of Object.entries(given)) {
        if (s && typeof s === 'object') sections[id] = { visible: !!s.visible, params: s.params && typeof s.params === 'object' ? { ...s.params } : {} };
    }
    for (const adapter of adapters) {
        const s = sections[adapter.id];
        sections[adapter.id] = {
            visible: s ? s.visible : !!adapter.defaultVisible,
            params: checkParams(adapter.params, s && s.params, (m) => warn(`${adapter.id} ${m}`))
        };
    }
    if (!sections.links) sections.links = { visible: true, params: {} };
    // Links first: made here, never stale, and they follow the focus
    const known = ['links', ...adapters.map(a => a.id)];
    const order = Array.isArray(cfg.sectionOrder) ? cfg.sectionOrder.filter(id => typeof id === 'string') : [];
    const sectionOrder = [...new Set([...order.filter(id => known.includes(id) || sections[id]), ...known])];
    const links = cfg.links && typeof cfg.links === 'object' ? cfg.links : {};
    return {
        tableFilter: typeof cfg.tableFilter === 'string' && cfg.tableFilter ? cfg.tableFilter : 'none',
        // 'auto': the first var column named like gene ids or names (pickIdColumn)
        idColumn: typeof cfg.idColumn === 'string' && cfg.idColumn ? cfg.idColumn : 'auto',
        // 'auto': from the values (Ensembl-like, digits, else symbols)
        idType: ID_TYPES.includes(cfg.idType) ? cfg.idType : 'auto',
        consent: readLinkConsent(cfg.consent),
        autoUpdate: cfg.autoUpdate === true,
        sections,
        sectionOrder,
        links: {
            // null: the species' default columns (links.js defaultColumns)
            columns: Array.isArray(links.columns) ? links.columns.filter(c => typeof c === 'string').slice(0, 12) : null,
            listOpen: links.listOpen === true
        }
    };
}

/**
 * What the panel saves: an explicit list of keys. Never the snapshot, the
 * results, the errors or a consent: a share link must not carry one person's
 * gene list or a third party's results, and must stay short. A param at its
 * default is left out (normalizeConfig puts the default back).
 * @param {{id, title, settings, controlsVisible?, adapters?: Object[]}} opts
 */
export function configOf({ id, title, settings, controlsVisible, adapters = [] }) {
    const specs = new Map(adapters.map(a => [a.id, a.params || {}]));
    const sections = {};
    for (const [sid, sec] of Object.entries(settings.sections)) {
        const spec = specs.get(sid);
        const params = {};
        for (const [k, v] of Object.entries(sec.params || {})) {
            if (!spec || !spec[k] || stableStringify(v) !== stableStringify(spec[k].default)) params[k] = JSON.parse(JSON.stringify(v));
        }
        sections[sid] = { visible: !!sec.visible, params };
    }
    const out = {
        id, title,
        tableFilter: settings.tableFilter,
        idColumn: settings.idColumn,
        idType: settings.idType,
        autoUpdate: !!settings.autoUpdate,
        sections,
        sectionOrder: settings.sectionOrder.slice(),
        links: { columns: settings.links.columns ? settings.links.columns.slice() : null, listOpen: !!settings.links.listOpen }
    };
    if (settings.consent) out.consent = { selection: settings.consent.selection, hosts: settings.consent.hosts.slice() };
    if (controlsVisible !== undefined) out.controlsVisible = !!controlsVisible;
    return out;
}
