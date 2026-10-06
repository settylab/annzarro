/**
 * Species for the Gene Set Analysis panel: a local list searched as you
 * type (no request), a taxonomy id typed directly, and, only when the user
 * asks for it, NCBI Taxonomy's suggestions for a name the list lacks (ENA's
 * when NCBI does not answer).
 *
 * The species is the dataset's, not the panel's: picking one calls
 * DataManager.setTaxonomyId, which share links and panel sets already save
 * (constants.taxonomyId).
 */
import { fetchWithPolicy } from './fetch-policy.js';

/** The species the panel knows without asking anyone. */
export const SPECIES = Object.freeze([
    { taxid: '9606', name: 'Homo sapiens', common: 'human', aliases: ['man'] },
    { taxid: '10090', name: 'Mus musculus', common: 'mouse', aliases: ['house mouse'] },
    { taxid: '10116', name: 'Rattus norvegicus', common: 'rat', aliases: ['Norway rat'] },
    { taxid: '7955', name: 'Danio rerio', common: 'zebrafish', aliases: [] },
    { taxid: '7227', name: 'Drosophila melanogaster', common: 'fruit fly', aliases: ['fly'] },
    { taxid: '6239', name: 'Caenorhabditis elegans', common: 'nematode', aliases: ['worm', 'C. elegans'] },
    { taxid: '559292', name: 'Saccharomyces cerevisiae S288C', common: "baker's yeast", aliases: ['yeast'] },
    { taxid: '3702', name: 'Arabidopsis thaliana', common: 'thale cress', aliases: ['arabidopsis'] },
    { taxid: '8364', name: 'Xenopus tropicalis', common: 'tropical clawed frog', aliases: ['frog'] },
    { taxid: '9823', name: 'Sus scrofa', common: 'pig', aliases: [] },
    { taxid: '9544', name: 'Macaca mulatta', common: 'rhesus macaque', aliases: ['macaque'] },
    { taxid: '9031', name: 'Gallus gallus', common: 'chicken', aliases: [] }
]);

const BY_ID = new Map(SPECIES.map(s => [s.taxid, s]));

/** Names learned this session from NCBI for taxa outside the list. */
const _learned = new Map();

/** The species for a taxonomy id: the list's, one learned this session, or a bare id. */
export function speciesOf(taxid) {
    const id = String(taxid || '');
    return BY_ID.get(id) || _learned.get(id) || { taxid: id, name: '', common: '', aliases: [] };
}

export function learnSpecies(entry) {
    if (entry && /^\d+$/.test(String(entry.taxid)) && !BY_ID.has(String(entry.taxid))) {
        _learned.set(String(entry.taxid), { taxid: String(entry.taxid), name: entry.name || '', common: entry.common || '', aliases: [] });
    }
}

/** "Homo sapiens (human) · 9606", or "taxon 4932" when the name is not known. */
export function speciesLabel(taxid) {
    const s = speciesOf(taxid);
    if (!s.name) return `taxon ${s.taxid}`;
    return `${s.name}${s.common ? ` (${s.common})` : ''} · ${s.taxid}`;
}

/**
 * The local list's matches for what was typed: by scientific name, common
 * name, alias or id. All digits is also offered as a taxonomy id as typed.
 * @returns {Array<{name: string, taxid: string, kind: 'local'|'id'|'remote-ask'}>}
 */
export function searchSpecies(query, { remoteAllowed = true } = {}) {
    const q = String(query || '').trim().toLowerCase();
    const items = [];
    for (const s of [...SPECIES, ..._learned.values()]) {
        const hay = [s.name, s.common, ...(s.aliases || []), s.taxid].map(v => String(v).toLowerCase());
        if (!q || hay.some(h => h.includes(q))) items.push({ name: speciesLabel(s.taxid), taxid: s.taxid, kind: 'local' });
    }
    if (/^\d+$/.test(q) && !items.some(i => i.taxid === q)) {
        items.unshift({ name: `Taxonomy id ${q}`, taxid: q, kind: 'id' });
    }
    if (remoteAllowed && q.length >= 3 && !/^\d+$/.test(q)) {
        items.push({ name: `Search NCBI Taxonomy for "${String(query).trim()}"…`, taxid: '', kind: 'remote-ask', query: String(query).trim() });
    }
    return items;
}

/** What was typed, as a taxonomy id, when it is one (digits, or "… · 9606"). */
export function parseTaxid(text) {
    const s = String(text || '').trim();
    if (/^\d+$/.test(s)) return s;
    const m = /·\s*(\d+)\s*$/.exec(s);
    return m ? m[1] : null;
}

/**
 * NCBI Taxonomy's suggestions for a name (ENA's when NCBI fails). Sends
 * only what was typed. Rejects with a ServiceError when both fail.
 * @param {string} query
 * @param {{fetchImpl: Function, setTimeout: Function, clearTimeout: Function, now: Function, signal?: AbortSignal}} deps
 * @returns {Promise<Array<{name: string, taxid: string, kind: 'remote', sci: string, common: string}>>}
 */
export async function remoteSpeciesSearch(query, deps) {
    const opts = { ...deps, timeoutMs: 10000, as: 'json' };
    const init = { method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer', mode: 'cors' };
    const q = encodeURIComponent(String(query).trim());
    let list;
    try {
        const j = await fetchWithPolicy(`https://api.ncbi.nlm.nih.gov/datasets/v2/taxonomy/taxon_suggest/${q}`, init, opts);
        list = ((j && j.sci_name_and_ids) || []).map(e => ({ taxid: String(e.tax_id), sci: e.sci_name || '', common: e.common_name || '', rank: e.rank || '' }));
    } catch (error) {
        if (error && error.kind === 'aborted') throw error;
        const j = await fetchWithPolicy(`https://www.ebi.ac.uk/ena/taxonomy/rest/suggest-for-search/${q}?limit=10`, init, opts);
        list = (Array.isArray(j) ? j : []).map(e => ({ taxid: String(e.taxId), sci: e.scientificName || '', common: e.commonName || e.displayName || '', rank: e.rank || '' }));
    }
    return list.filter(e => /^\d+$/.test(e.taxid)).slice(0, 20).map(e => ({
        name: `${e.sci}${e.common ? ` (${e.common})` : ''} · ${e.taxid}`, taxid: e.taxid, kind: 'remote', sci: e.sci, common: e.common
    }));
}

/** Ensembl gene id prefixes (and the fly and worm ids Ensembl uses) by species. */
export const ENSEMBL_PREFIXES = Object.freeze([
    ['ENSMUSG', '10090'], ['ENSRNOG', '10116'], ['ENSDARG', '7955'], ['ENSGALG', '9031'], ['ENSSSCG', '9823'],
    ['ENSMMUG', '9544'], ['ENSXETG', '8364'], ['ENSBTAG', '9913'], ['ENSCAFG', '9615'], ['FBgn', '7227'],
    ['WBGene', '6239'], ['ENSG', '9606']
]);

/** The species of one gene id, from its Ensembl prefix (ENSG + 11 digits is human), or null. */
export function speciesOfId(id) {
    const s = String(id || '').trim();
    for (const [prefix, tax] of ENSEMBL_PREFIXES) {
        if (s.startsWith(prefix) && /^\d/.test(s.slice(prefix.length))) return tax;
    }
    return null;
}

/**
 * The species most of `ids` belong to by their Ensembl prefix (80 % of the
 * ids that have one, and at least half of all), or null for symbols or a mix.
 * @param {string[]} ids
 * @returns {string|null} taxonomy id
 */
export function speciesFromIds(ids) {
    const counts = new Map();
    let n = 0;
    for (const id of ids || []) {
        if (typeof id !== 'string' || !id.trim()) continue;
        n++;
        const tax = speciesOfId(id);
        if (tax) counts.set(tax, (counts.get(tax) || 0) + 1);
    }
    let best = null, top = 0, prefixed = 0;
    for (const [tax, c] of counts) {
        prefixed += c;
        if (c > top) { best = tax; top = c; }
    }
    return best && top >= 0.8 * prefixed && prefixed >= 0.5 * n ? best : null;
}

/** uns keys that may name the dataset's species, most specific first. */
export const UNS_SPECIES_KEYS = Object.freeze(['taxonomy_id', 'taxid', 'tax_id', 'ncbi_taxonomy_id', 'species', 'organism']);

/**
 * A species from a free text value (an uns entry): a taxonomy id, or a
 * scientific or common name of the local list ("Mus musculus", "mouse",
 * "human", "homo_sapiens", "NCBITaxon:10090").
 * @returns {string|null} taxonomy id
 */
export function speciesFromText(value) {
    let v = Array.isArray(value) ? value[0] : value;
    if (v && typeof v === 'object') v = v.value ?? v.name ?? null;
    if (typeof v === 'number' && Number.isInteger(v) && v > 0) return String(v);
    if (typeof v !== 'string') return null;
    const s = v.trim().toLowerCase().replace(/^ncbitaxon:/, '').replace(/[_]+/g, ' ');
    if (/^\d+$/.test(s)) return s;
    for (const sp of SPECIES) {
        const names = [sp.name, sp.common, ...(sp.aliases || [])].map(x => x.toLowerCase());
        if (names.includes(s) || s === sp.name.toLowerCase().split(' ').slice(0, 2).join(' ')) return sp.taxid;
    }
    return null;
}
