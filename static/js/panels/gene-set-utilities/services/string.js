/**
 * STRING (string-db.org): functional enrichment, the protein network with
 * its PPI enrichment, and the focused gene's interaction partners.
 *
 * Pinned to a versioned host (integrations.string_db.base_url, default
 * https://version-12-5.string-db.org/api) so a result can be reproduced and
 * says which STRING made it. Every call identifies the caller
 * (caller_identity=annzarro, as STRING asks), is POSTed with the genes in
 * the body, and is paced one second apart (provider.minIntervalMs).
 *
 * The genes are first mapped to STRING ids (get_string_ids, limit 1): STRING
 * drops genes it does not know without saying so, so the mapping is what
 * tells the section how many it is showing. Networks are SVG with the
 * protein-structure thumbnails left out (block_structure_pics_in_bubbles=1:
 * 40 KB instead of 2 MB at 100 nodes), shown as <img src="blob:…">.
 */
import { ServiceError, parseError } from '../fetch-policy.js';
import { setHash } from '../state.js';
import { longTable, attribution, geneButton, unmappedList, apiHost, mappedCoverage } from './common.js';
import { MAX_URL_LENGTH } from '../links.js';

export const STRING_DEFAULT_API = 'https://version-12-5.string-db.org/api';

const PROVIDER = Object.freeze({
    name: 'STRING', host: 'string-db.org', home: 'https://string-db.org',
    licence: 'CC BY 4.0', minIntervalMs: 1000, maxConcurrent: 1
});

const CALLER = 'annzarro';

const SCORE_OPTIONS = [
    { value: 150, label: 'low (0.15)' }, { value: 400, label: 'medium (0.4)' },
    { value: 700, label: 'high (0.7)' }, { value: 900, label: 'highest (0.9)' }
];

/** STRING's category codes, in words. */
export const CATEGORY_LABELS = Object.freeze({
    Process: 'GO Process', Function: 'GO Function', Component: 'GO Component', KEGG: 'KEGG',
    RCTM: 'Reactome', WikiPathways: 'WikiPathways', Pfam: 'Pfam', InterPro: 'InterPro', SMART: 'SMART',
    Keyword: 'UniProt keyword', PMID: 'Publications', COMPARTMENTS: 'Compartments', TISSUES: 'Tissues',
    DISEASES: 'Diseases', HPO: 'Human phenotype', NetworkNeighborAL: 'Local network cluster',
    GWAS: 'GWAS Catalog', Hallmark: 'MSigDB Hallmark'
});

function api(input) {
    return ((input.services && input.services.string && input.services.string.api) || STRING_DEFAULT_API).replace(/\/+$/, '');
}

function web(input) {
    return api(input).replace(/\/api$/, '');
}

function provider(input) {
    const v = input && input.services && input.services.string && input.services.string.version;
    return v ? { ...PROVIDER, version: v } : PROVIDER;
}

function hostsFor(input) {
    return [apiHost(api(input), 'string-db.org')];
}

/**
 * The genes as STRING ids: [{query, stringId, preferredName}] for those it
 * knows, and the names it does not. Shared by the sections of one panel
 * for the same genes (io.memo).
 */
export async function mapToString(io, input, genes, genesHash) {
    return io.memo(`string-ids:${api(input)}:${input.taxonomyId}:${genesHash || setHash(genes)}`, async (shared) => {
        const rows = await shared.fetchJson(`${api(input)}/json/get_string_ids`, {
            form: { identifiers: genes.join('\r'), species: input.taxonomyId, limit: 1, echo_query: 1, caller_identity: CALLER },
            timeoutMs: genes.length > 5000 ? 60000 : undefined
        });
        if (!Array.isArray(rows)) throw parseError('STRING sent no id list');
        const byIndex = new Map();
        for (const r of rows) {
            if (!r || typeof r.stringId !== 'string') continue;
            const i = Number(r.queryIndex);
            if (Number.isInteger(i) && i >= 0 && i < genes.length && !byIndex.has(i)) {
                byIndex.set(i, { query: genes[i], stringId: r.stringId, preferredName: r.preferredName || genes[i] });
            }
        }
        const mapped = [...byIndex.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
        const unmapped = genes.filter((_, i) => !byIndex.has(i));
        return { mapped, unmapped };
    });
}

function noneFound(input) {
    return new ServiceError({ kind: 'http', status: 404,
        message: `STRING knows none of these ${input.genes.length.toLocaleString('en-US')} genes for taxon ${input.taxonomyId}` });
}

function mappingCoverage(result, input) {
    return mappedCoverage(result.mapped.length, input.genes, result.unmapped, 'STRING');
}

/** STRING's own page for these genes, when the link fits. */
function networkUrl(input, ids) {
    const url = `${web(input)}/cgi/network?identifiers=${encodeURIComponent(ids.join('\r'))}&species=${encodeURIComponent(input.taxonomyId)}`;
    return url.length <= MAX_URL_LENGTH ? url : null;
}

export const stringEnrichment = {
    id: 'string-enrichment',
    version: '1',
    label: 'Enrichment',
    provider: PROVIDER,
    hostsFor,
    kind: 'set',
    defaultVisible: true,
    limits: { minGenes: 1, maxGenes: 3000 },
    supportsSpecies: () => 'unknown',
    params: {
        background: { type: 'enum', default: 'genome', label: 'Background',
            options: [{ value: 'genome', label: 'Whole genome (STRING default)' },
                { value: 'dataset', label: "This dataset's genes" }] }
    },
    describeRequest: (input) => `${input.genes.length.toLocaleString('en-US')} gene ids and taxon ${input.taxonomyId}`
        + (input.params.background === 'dataset' && input.background ? `, plus the dataset's ${input.background.length.toLocaleString('en-US')} genes as the background` : ''),
    async fetch(input, io) {
        const { mapped, unmapped } = await mapToString(io, input, input.genes, input.genesHash);
        if (!mapped.length) throw noneFound(input);
        const form = { identifiers: mapped.map(m => m.stringId).join('\r'), species: input.taxonomyId, caller_identity: CALLER };
        let backgroundSize = null;
        if (input.params.background === 'dataset' && input.background) {
            const bg = await mapToString(io, input, input.background, input.backgroundHash);
            form.background_string_identifiers = bg.mapped.map(m => m.stringId).join('\r');
            backgroundSize = bg.mapped.length;
        }
        const rows = await io.fetchJson(`${api(input)}/json/enrichment`, { form });
        if (!Array.isArray(rows)) throw parseError('STRING sent no enrichment table');
        const terms = rows.filter(r => r && typeof r.term === 'string').map(r => ({
            category: String(r.category || ''), term: r.term, description: String(r.description || r.term),
            genes: Number(r.number_of_genes) || 0, background: Number(r.number_of_genes_in_background) || 0,
            fdr: Number(r.fdr), p: Number(r.p_value),
            names: Array.isArray(r.preferredNames) ? r.preferredNames.map(String) : []
        }));
        return { mapped, unmapped, terms, backgroundSize };
    },
    coverage: mappingCoverage,
    render(result, el, ctx) {
        const { input } = ctx;
        const cats = [...new Set(result.terms.map(t => t.category))];
        const body = ctx.el('div', { class: 'gs-result-body' });
        const summary = result.terms.length
            ? `${result.terms.length.toLocaleString('en-US')} enriched terms (FDR as STRING reports it)`
            : 'No term is enriched for these genes (STRING found none).';
        const select = cats.length > 1 ? ctx.el('select', { class: 'form-select form-select-sm gs-filter', aria: { label: 'Category' } },
            ctx.el('option', { value: '', text: `All categories (${result.terms.length})` }),
            cats.map(c => ctx.el('option', { value: c, text: `${CATEGORY_LABELS[c] || c} (${result.terms.filter(t => t.category === c).length})` }))) : null;
        const draw = () => {
            ctx.clear(body);
            const terms = select && select.value ? result.terms.filter(t => t.category === select.value) : result.terms;
            if (!terms.length) return;
            body.appendChild(longTable(ctx, 'STRING functional enrichment',
                ['Category', 'Term', { label: 'Genes', cls: 'gs-num', title: 'Genes of the input in the term / genes in the term' }, { label: 'FDR', cls: 'gs-num' }],
                terms.map(t => [CATEGORY_LABELS[t.category] || t.category,
                    { text: t.description, title: `${t.term}${t.names.length ? `: ${t.names.join(', ')}` : ''}` },
                    { text: `${t.genes} / ${t.background}`, cls: 'gs-num' }, { text: ctx.sci(t.fdr), cls: 'gs-num' }]), 'terms'));
        };
        if (select) select.addEventListener('change', draw);
        el.append(ctx.el('div', { class: 'gs-result-head' }, ctx.el('span', { text: summary }), select), body,
            unmappedList(ctx, result.unmapped, 'STRING') || '',
            attribution(ctx, provider(input), result.backgroundSize !== null
                ? `background: ${result.backgroundSize.toLocaleString('en-US')} of the dataset's genes` : 'background: whole genome'));
        draw();
    },
    openUrl: (input, result) => networkUrl(input, result ? result.mapped.map(m => m.stringId) : input.genes),
    exportRows: (result) => ({
        columns: ['category', 'term', 'description', 'genes_in_input', 'genes_in_background', 'p_value', 'fdr', 'genes'],
        rows: result.terms.map(t => [t.category, t.term, t.description, t.genes, t.background, t.p, t.fdr, t.names])
    })
};

export const stringNetwork = {
    id: 'string-network',
    version: '1',
    label: 'Network',
    provider: PROVIDER,
    hostsFor,
    kind: 'set',
    defaultVisible: true,
    limits: { minGenes: 1, maxGenes: 2000 },
    timeoutMs: 60000,
    supportsSpecies: () => 'unknown',
    params: {
        requiredScore: { type: 'number', default: 400, label: 'Minimum score', options: SCORE_OPTIONS },
        networkType: { type: 'enum', default: 'functional', label: 'Edges',
            options: [{ value: 'functional', label: 'functional and physical' }, { value: 'physical', label: 'physical only' }] },
        hideDisconnected: { type: 'bool', default: false, label: 'Hide unconnected genes' }
    },
    describeRequest: (input) => `${input.genes.length.toLocaleString('en-US')} gene ids and taxon ${input.taxonomyId}`,
    async fetch(input, io) {
        const { mapped, unmapped } = await mapToString(io, input, input.genes, input.genesHash);
        if (!mapped.length) throw noneFound(input);
        const ids = mapped.map(m => m.stringId).join('\r');
        const common = { identifiers: ids, species: input.taxonomyId, required_score: input.params.requiredScore,
            network_type: input.params.networkType, caller_identity: CALLER };
        const stats = await io.fetchJson(`${api(input)}/json/ppi_enrichment`, { form: common });
        const s = Array.isArray(stats) ? stats[0] : null;
        if (!s || typeof s !== 'object') throw parseError('STRING sent no PPI enrichment');
        const blob = await io.fetchBlob(`${api(input)}/svg/network`, { form: {
            ...common, block_structure_pics_in_bubbles: 1, hide_disconnected_nodes: input.params.hideDisconnected ? 1 : 0
        } });
        return {
            mapped, unmapped,
            stats: { nodes: Number(s.number_of_nodes), edges: Number(s.number_of_edges),
                expected: Number(s.expected_number_of_edges), p: Number(s.p_value),
                degree: Number(s.average_node_degree), clustering: Number(s.local_clustering_coefficient) },
            image: blob
        };
    },
    coverage: mappingCoverage,
    render(result, el, ctx) {
        const { input } = ctx;
        const st = result.stats;
        const alt = `STRING network, ${st.nodes.toLocaleString('en-US')} genes, ${st.edges.toLocaleString('en-US')} interactions`;
        const url = networkUrl(input, result.mapped.map(m => m.stringId));
        el.append(
            ctx.el('div', { class: 'gs-result-head' },
                ctx.el('span', { text: `${st.edges.toLocaleString('en-US')} interactions among ${st.nodes.toLocaleString('en-US')} genes; `
                    + `${Number.isFinite(st.expected) ? st.expected.toLocaleString('en-US') : '?'} expected at random, `
                    + `PPI enrichment p = ${ctx.sci(st.p)}` })),
            ctx.el('div', { class: 'gs-network' }, ctx.blobImage(new Blob([result.image], { type: 'image/svg+xml' }), alt)),
            url ? ctx.el('div', {}, ctx.link(url, 'Open the interactive network on STRING')) : '',
            unmappedList(ctx, result.unmapped, 'STRING') || '',
            attribution(ctx, provider(input), `score ≥ ${(input.params.requiredScore / 1000).toFixed(2)}`));
    },
    openUrl: (input, result) => networkUrl(input, result ? result.mapped.map(m => m.stringId) : input.genes)
};

export const stringPartners = {
    id: 'string-partners',
    version: '1',
    label: 'Interaction partners of the focused gene',
    provider: PROVIDER,
    hostsFor,
    kind: 'gene',
    defaultVisible: false,
    limits: { minGenes: 1, maxGenes: 1 },
    supportsSpecies: () => 'unknown',
    params: {
        limit: { type: 'number', default: 10, label: 'Partners', options: [10, 20, 50].map(v => ({ value: v, label: String(v) })) },
        requiredScore: { type: 'number', default: 400, label: 'Minimum score', options: SCORE_OPTIONS }
    },
    describeRequest: (input) => `the focused gene ${input.focus.id} and taxon ${input.taxonomyId}`,
    async fetch(input, io) {
        const rows = await io.fetchJson(`${api(input)}/json/interaction_partners`, { form: {
            identifiers: input.focus.id, species: input.taxonomyId, limit: input.params.limit,
            required_score: input.params.requiredScore, caller_identity: CALLER } });
        if (!Array.isArray(rows)) throw parseError('STRING sent no partner list');
        return { partners: rows.filter(r => r && r.preferredName_B).map(r => ({
            name: String(r.preferredName_B), self: String(r.preferredName_A || input.focus.id),
            score: Number(r.score), experiments: Number(r.escore), database: Number(r.dscore),
            textmining: Number(r.tscore), coexpression: Number(r.ascore) })) };
    },
    render(result, el, ctx) {
        const { input } = ctx;
        const f = (v) => (Number.isFinite(v) && v > 0 ? v.toFixed(2) : '');
        el.append(
            ctx.el('div', { class: 'gs-result-head' }, ctx.el('span', { text: result.partners.length
                ? `${result.partners.length} partners of ${result.partners[0].self}`
                : `STRING lists no partner of ${input.focus.id} at this score.` })),
            result.partners.length ? ctx.table(`Interaction partners of ${input.focus.id}`,
                ['Partner', { label: 'Score', cls: 'gs-num' }, { label: 'Experiments', cls: 'gs-num' },
                    { label: 'Databases', cls: 'gs-num' }, { label: 'Text mining', cls: 'gs-num' }, { label: 'Co-expression', cls: 'gs-num' }],
                result.partners.map(p => [geneButton(ctx, p.name), { text: f(p.score), cls: 'gs-num' },
                    { text: f(p.experiments), cls: 'gs-num' }, { text: f(p.database), cls: 'gs-num' },
                    { text: f(p.textmining), cls: 'gs-num' }, { text: f(p.coexpression), cls: 'gs-num' }])) : '',
            attribution(ctx, provider(input)));
    },
    openUrl: (input) => (input.focus ? networkUrl(input, [input.focus.id]) : null),
    exportRows: (result) => ({
        columns: ['partner', 'score', 'experiments', 'databases', 'textmining', 'coexpression'],
        rows: result.partners.map(p => [p.name, p.score, p.experiments, p.database, p.textmining, p.coexpression])
    })
};

export const STRING_ADAPTERS = [stringEnrichment, stringNetwork, stringPartners];
