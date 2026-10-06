/**
 * g:Profiler g:GOSt (biit.cs.ut.ee): enrichment over GO, KEGG, Reactome,
 * WikiPathways, TRANSFAC, miRTarBase, HPA, CORUM and HP in one request.
 *
 * Species by g:Profiler's organism id (hsapiens): from a built-in map for
 * common species, else from its organisms list (one request per page,
 * 180 KB). g:Profiler says which genes it could not map (`failed`) and
 * which were ambiguous; both are stated. Only documented request keys are
 * sent: unknown ones made it answer 500.
 */
import { ServiceError, parseError } from '../fetch-policy.js';
import { GPROFILER_ORGANISMS, MAX_URL_LENGTH } from '../links.js';
import { longTable, attribution, unmappedList, mappedCoverage } from './common.js';

const PROVIDER = Object.freeze({
    name: 'g:Profiler', host: 'biit.cs.ut.ee', home: 'https://biit.cs.ut.ee/gprofiler/', licence: '', maxConcurrent: 2
});

const BASE = 'https://biit.cs.ut.ee/gprofiler';

export const GPROFILER_SOURCES = Object.freeze([
    { value: 'GO:BP', label: 'GO biological process' }, { value: 'GO:MF', label: 'GO molecular function' },
    { value: 'GO:CC', label: 'GO cellular component' }, { value: 'KEGG', label: 'KEGG' },
    { value: 'REAC', label: 'Reactome' }, { value: 'WP', label: 'WikiPathways' },
    { value: 'TF', label: 'TRANSFAC (TF motifs)' }, { value: 'MIRNA', label: 'miRTarBase' },
    { value: 'HPA', label: 'Human Protein Atlas' }, { value: 'CORUM', label: 'CORUM complexes' },
    { value: 'HP', label: 'Human phenotype' }
]);

/** Terms with gene lists only up to this many genes (the lists grow with genes x terms). */
const EVIDENCE_MAX_GENES = 500;

let _organisms = null;     // the organisms list, once read this page

/** g:Profiler's organism id for a taxonomy id, or null when it has none. */
export async function organismFor(taxid, io) {
    const known = GPROFILER_ORGANISMS[String(taxid)];
    if (known) return known;
    if (!_organisms) {
        const list = await io.fetchJson(`${BASE}/api/util/organisms_list/`);
        if (!Array.isArray(list)) throw parseError('g:Profiler sent no organism list');
        _organisms = list;
    }
    const hits = _organisms.filter(o => String(o.taxonomy_id) === String(taxid) && typeof o.id === 'string');
    if (!hits.length) return null;
    // several entries are strains or projects of one species: the plain
    // one is genus initial + species epithet (sscrofa, not sstibetan)
    const plain = hits.find(o => {
        const [genus, species] = String(o.scientific_name || '').toLowerCase().split(/\s+/);
        return genus && species && o.id === genus[0] + species;
    });
    return (plain || hits.slice().sort((a, b) => a.id.length - b.id.length)[0]).id;
}

/** For tests: forget the organisms list. */
export function _resetOrganisms() {
    _organisms = null;
}

function gostUrl(organism, genes, sources) {
    if (!organism) return null;
    const url = `${BASE}/gost?organism=${encodeURIComponent(organism)}&query=${encodeURIComponent(genes.join('\n'))}`
        + (sources && sources.length ? `&sources=${encodeURIComponent(sources.join(','))}` : '');
    return url.length <= MAX_URL_LENGTH ? url : null;
}

export const gprofilerGost = {
    id: 'gprofiler-gost',
    version: '1',
    label: 'Enrichment',
    provider: PROVIDER,
    kind: 'set',
    defaultVisible: true,
    limits: { minGenes: 1, maxGenes: 3000 },
    supportsSpecies: (tax) => (GPROFILER_ORGANISMS[tax] ? true : 'unknown'),
    params: {
        sources: { type: 'multi', default: ['GO:BP', 'GO:MF', 'GO:CC', 'KEGG', 'REAC', 'WP'], label: 'Sources', options: GPROFILER_SOURCES },
        threshold: { type: 'number', default: 0.05, label: 'Significance', options: [0.05, 0.01, 0.001].map(v => ({ value: v, label: String(v) })) },
        correction: { type: 'enum', default: 'g_SCS', label: 'Correction',
            options: [{ value: 'g_SCS', label: 'g:SCS (g:Profiler default)' }, { value: 'false_discovery_rate', label: 'Benjamini-Hochberg FDR' },
                { value: 'bonferroni', label: 'Bonferroni' }] },
        background: { type: 'enum', default: 'dataset', label: 'Background',
            options: [{ value: 'dataset', label: "This dataset's genes" }, { value: 'genome', label: 'Annotated genes (g:Profiler default)' }] }
    },
    describeRequest: (input) => `${input.genes.length.toLocaleString('en-US')} gene ids and the species`
        + (input.params.background === 'dataset' && input.background ? `, plus the dataset's ${input.background.length.toLocaleString('en-US')} genes as the background` : ''),
    async fetch(input, io) {
        const organism = await organismFor(input.taxonomyId, io);
        if (!organism) {
            throw new ServiceError({ kind: 'species', message: `g:Profiler does not cover ${input.speciesName || `taxon ${input.taxonomyId}`}` });
        }
        const evidences = input.genes.length <= EVIDENCE_MAX_GENES;
        const body = {
            organism, query: input.genes, sources: input.params.sources,
            user_threshold: input.params.threshold, significance_threshold_method: input.params.correction,
            no_evidences: !evidences
        };
        // Entrez ids are bare numbers, which g:Profiler reads only with their namespace
        if (input.idType === 'entrez') body.numeric_namespace = 'ENTREZGENE_ACC';
        if (input.params.background === 'dataset' && input.background) {
            body.domain_scope = 'custom';
            body.background = input.background;
        }
        const j = await io.fetchJson(`${BASE}/api/gost/profile/`, { json: body });
        if (!j || !Array.isArray(j.result) || !j.meta) throw parseError('g:Profiler sent no result');
        const gm = j.meta.genes_metadata || {};
        const failed = Array.isArray(gm.failed) ? gm.failed.map(String) : [];
        const ambiguous = gm.ambiguous && typeof gm.ambiguous === 'object' ? Object.keys(gm.ambiguous) : [];
        // which input genes are in each term: intersections[i] is non-empty
        // when ensgs[i] is; ensgs map back to the query through `mapping`
        const q = gm.query && (gm.query.query_1 || Object.values(gm.query)[0]);
        const ensgs = q && Array.isArray(q.ensgs) ? q.ensgs : [];
        const back = new Map();
        if (q && q.mapping) for (const [name, list] of Object.entries(q.mapping)) for (const e of list || []) if (!back.has(e)) back.set(e, name);
        const terms = j.result.filter(r => r && r.native).map(r => ({
            source: String(r.source || ''), native: String(r.native), name: String(r.name || r.native),
            p: Number(r.p_value), termSize: Number(r.term_size), hits: Number(r.intersection_size), querySize: Number(r.query_size),
            genes: evidences && Array.isArray(r.intersections)
                ? r.intersections.map((ev, i) => (Array.isArray(ev) && ev.length ? back.get(ensgs[i]) || ensgs[i] : null)).filter(Boolean) : []
        }));
        return { organism, failed, ambiguous, terms, version: String(j.meta.version || ''), domain: body.domain_scope || 'annotated' };
    },
    coverage(result, input) {
        // ambiguous genes were used (g:Profiler's first match): said in the body
        return mappedCoverage(input.genes.length - result.failed.length, input.genes, result.failed, 'g:Profiler');
    },
    render(result, el, ctx) {
        const { input } = ctx;
        const head = result.terms.length
            ? `${result.terms.length.toLocaleString('en-US')} significant terms (${input.params.correction === 'g_SCS' ? 'g:SCS' : input.params.correction.replace(/_/g, ' ')} < ${input.params.threshold})`
            : `No term passes the threshold (${input.params.threshold}).`;
        el.append(ctx.el('div', { class: 'gs-result-head' }, ctx.el('span', { text: head })),
            result.terms.length ? longTable(ctx, 'g:Profiler enrichment',
                ['Source', 'Term', { label: 'Genes', cls: 'gs-num', title: 'Input genes in the term / genes in the term' }, { label: 'p (adj.)', cls: 'gs-num' }],
                result.terms.map(t => [t.source, { text: t.name, title: `${t.native}${t.genes.length ? `: ${t.genes.join(', ')}` : ''}` },
                    { text: `${t.hits} / ${t.termSize}`, cls: 'gs-num' }, { text: ctx.sci(t.p), cls: 'gs-num' }]), 'terms') : '',
            unmappedList(ctx, result.failed, 'g:Profiler') || '',
            result.ambiguous.length ? ctx.el('p', { class: 'gs-note', text: `Ambiguous (g:Profiler picked one gene for each): ${result.ambiguous.join(', ')}` }) : '',
            attribution(ctx, { ...PROVIDER, version: result.version }, `background: ${result.domain === 'custom' ? "this dataset's genes" : 'annotated genes'}`));
    },
    openUrl: (input, result) => gostUrl(result ? result.organism : GPROFILER_ORGANISMS[input.taxonomyId], input.genes, input.params.sources),
    exportRows: (result) => ({
        columns: ['source', 'term_id', 'term_name', 'p_value_adjusted', 'intersection_size', 'term_size', 'query_size', 'genes'],
        rows: result.terms.map(t => [t.source, t.native, t.name, t.p, t.hits, t.termSize, t.querySize, t.genes])
    })
};

export const GPROFILER_ADAPTERS = [gprofilerGost];
