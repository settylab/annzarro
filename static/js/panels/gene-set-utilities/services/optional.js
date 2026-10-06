/**
 * Sections that are off until the user turns them on (Sections menu):
 *
 *   - Enrichr (maayanlab.cloud): a second enrichment opinion over Enrichr's
 *     libraries (CellMarker, PanglaoDB, MSigDB Hallmark, ...). Enrichr
 *     STORES every list it is sent, under a sequential number anyone can
 *     read (checked 2026-10-05: a neighbouring number returned a stranger's
 *     list). So it is asked every page load, with that warning, and never
 *     remembered as "always".
 *   - Reactome (reactome.org): pathway over-representation, other species
 *     projected to human. Keeps the result under a guessable token: the same
 *     warning class as Enrichr.
 *   - Human Protein Atlas (proteinatlas.org): where the focused human gene
 *     is expressed (tissue and single-cell type specificity) and where in
 *     the cell.
 */
import { Coverage, GAP } from '../../../utils/coverage.js';
import { ServiceError, parseError } from '../fetch-policy.js';
import { attribution, longTable, geneButton, noneKnown } from './common.js';

// ---------------------------------------------------------------------------
// Enrichr

const ENRICHR = Object.freeze({
    name: 'Enrichr', host: 'maayanlab.cloud', home: 'https://maayanlab.cloud/Enrichr/', licence: '', maxConcurrent: 1
});

/** Library names as Enrichr's datasetStatistics listed them on 2026-10-05. */
export const ENRICHR_LIBRARIES = Object.freeze([
    { value: 'GO_Biological_Process_2025', label: 'GO Biological Process 2025' },
    { value: 'GO_Molecular_Function_2025', label: 'GO Molecular Function 2025' },
    { value: 'GO_Cellular_Component_2025', label: 'GO Cellular Component 2025' },
    { value: 'KEGG_2026', label: 'KEGG 2026' },
    { value: 'Reactome_Pathways_2024', label: 'Reactome Pathways 2024' },
    { value: 'WikiPathways_2024_Human', label: 'WikiPathways 2024 (human)' },
    { value: 'WikiPathways_2024_Mouse', label: 'WikiPathways 2024 (mouse)' },
    { value: 'MSigDB_Hallmark_2020', label: 'MSigDB Hallmark 2020' },
    { value: 'CellMarker_2024', label: 'CellMarker 2024' },
    { value: 'PanglaoDB_Augmented_2021', label: 'PanglaoDB Augmented 2021' }
]);

export const enrichr = {
    id: 'enrichr',
    version: '1',
    label: 'Enrichment',
    provider: ENRICHR,
    kind: 'set',
    defaultVisible: false,
    limits: { minGenes: 1, maxGenes: 3000 },
    timeoutMs: 30000,
    idTypes: ['symbol'],
    // Enrichr itself takes human and mouse symbols; Fly/Fish/Worm/YeastEnrichr are other sites
    supportsSpecies: (tax) => tax === '9606' || tax === '10090',
    privacy: { stores: 'public', text: 'Enrichr keeps every list it is sent, and anyone can read a list by its number: '
        + 'the genes you send become publicly viewable.' },
    params: {
        library: { type: 'enum', default: 'GO_Biological_Process_2025', label: 'Library', options: ENRICHR_LIBRARIES }
    },
    describeRequest: (input) => `${input.genes.length.toLocaleString('en-US')} gene symbols (stored by Enrichr, publicly readable)`,
    async fetch(input, io) {
        // one stored list per gene list, whatever the library
        const list = await io.memo(`enrichr-list:${input.genesHash}`, async (shared) => {
            const j = await shared.fetchJson('https://maayanlab.cloud/Enrichr/addList', {
                multipart: { list: input.genes.join('\n'), description: 'annzarro' } });
            if (!j || !j.userListId) throw parseError('Enrichr did not accept the list');
            return { userListId: j.userListId, shortId: String(j.shortId || '') };
        });
        const lib = input.params.library;
        const j = await io.fetchJson('https://maayanlab.cloud/Enrichr/enrich', { query: { userListId: list.userListId, backgroundType: lib } });
        if (!j || typeof j !== 'object' || !Array.isArray(j[lib])) {
            throw new ServiceError({ kind: 'http', status: 200, message: `Enrichr sent no results for library ${lib} (it may have been renamed)` });
        }
        const terms = j[lib].filter(Array.isArray).map(r => ({
            rank: Number(r[0]), term: String(r[1]), p: Number(r[2]), odds: Number(r[3]), combined: Number(r[4]),
            genes: Array.isArray(r[5]) ? r[5].map(String) : [], adjP: Number(r[6])
        }));
        return { ...list, library: lib, terms };
    },
    render(result, el, ctx) {
        const shown = result.terms;
        const significant = shown.filter(t => t.adjP < 0.05).length;
        el.append(ctx.el('div', { class: 'gs-result-head' }, ctx.el('span', {
            text: `${shown.length.toLocaleString('en-US')} terms in ${result.library}, ${significant.toLocaleString('en-US')} with adjusted p < 0.05` })),
        shown.length ? longTable(ctx, 'Enrichr enrichment',
            ['Term', { label: 'Overlap', cls: 'gs-num' }, { label: 'Odds ratio', cls: 'gs-num' }, { label: 'p (adj.)', cls: 'gs-num' }],
            shown.map(t => [{ text: t.term, title: t.genes.join(', ') }, { text: String(t.genes.length), cls: 'gs-num' },
                { text: Number.isFinite(t.odds) ? t.odds.toFixed(1) : '', cls: 'gs-num' }, { text: ctx.sci(t.adjP), cls: 'gs-num' }]), 'terms') : '',
        ctx.el('p', { class: 'gs-note gs-note--warn', text: `Enrichr stored this list as number ${result.userListId}; anyone can read it.` }),
        attribution(ctx, ENRICHR, "background: the library's genes (Enrichr takes no dataset background here)"));
    },
    openUrl: (input, result) => (result && result.shortId ? `https://maayanlab.cloud/Enrichr/enrich?dataset=${encodeURIComponent(result.shortId)}` : null),
    exportRows: (result) => ({
        columns: ['rank', 'term', 'p_value', 'odds_ratio', 'combined_score', 'adjusted_p_value', 'genes'],
        rows: result.terms.map(t => [t.rank, t.term, t.p, t.odds, t.combined, t.adjP, t.genes])
    })
};

// ---------------------------------------------------------------------------
// Reactome

const REACTOME = Object.freeze({
    name: 'Reactome', host: 'reactome.org', home: 'https://reactome.org', licence: 'CC BY 4.0', maxConcurrent: 1
});

/** Species Reactome infers pathways for, by the names it uses. */
export const REACTOME_SPECIES = Object.freeze({
    '9606': 'Homo sapiens', '10090': 'Mus musculus', '10116': 'Rattus norvegicus', '7955': 'Danio rerio',
    '7227': 'Drosophila melanogaster', '6239': 'Caenorhabditis elegans', '559292': 'Saccharomyces cerevisiae',
    '4932': 'Saccharomyces cerevisiae', '9031': 'Gallus gallus', '9823': 'Sus scrofa', '9913': 'Bos taurus',
    '9615': 'Canis familiaris', '8364': 'Xenopus tropicalis'
});

const PAGE = 50;

/**
 * Whether a failed request is Reactome's AnalysisService saying none of the
 * identifiers matched: HTTP 404 with its JSON error body
 * ({"code": 404, "reason": "Not Found", "messages": [...]}), not a bare 404.
 * @param {*} error
 */
export function isReactomeNoMatches(error) {
    if (!error || error.status !== 404 || typeof error.body !== 'string') return false;
    let j;
    try {
        j = JSON.parse(error.body);
    } catch {
        return false;
    }
    return !!j && typeof j === 'object' && Number(j.code) === 404 && Array.isArray(j.messages)
        && j.messages.some(m => /\b(no|not)\b.*\b(found|match)/i.test(String(m)));
}

export const reactome = {
    id: 'reactome',
    version: '1',
    label: 'Pathways',
    provider: REACTOME,
    kind: 'set',
    defaultVisible: false,
    limits: { minGenes: 1, maxGenes: 3000 },
    supportsSpecies: (tax) => !!REACTOME_SPECIES[tax],
    privacy: { stores: 'token', text: 'Reactome keeps the result, with the genes, under a token that can be guessed: '
        + 'others could read it.' },
    describeRequest: (input) => `${input.genes.length.toLocaleString('en-US')} gene ids (kept by Reactome under a guessable token)`,
    async fetch(input, io) {
        let j;
        try {
            j = await io.fetchJson('https://reactome.org/AnalysisService/identifiers/projection', {
                text: input.genes.join('\n'),
                query: { interactors: 'false', pageSize: PAGE, page: 1, sortBy: 'ENTITIES_PVALUE', order: 'ASC',
                    resource: 'TOTAL', species: REACTOME_SPECIES[input.taxonomyId] }
            });
        } catch (error) {
            // the AnalysisService's own 404 (a JSON error with messages) is
            // its answer that none of the ids matched; a 404 without it is
            // an address that is gone, and stays that failure
            if (isReactomeNoMatches(error)) throw noneKnown('Reactome', input);
            throw error;
        }
        if (!j || !j.summary || !Array.isArray(j.pathways)) throw parseError('Reactome sent no analysis');
        return {
            token: String(j.summary.token || ''), notFound: Number(j.identifiersNotFound) || 0, found: Number(j.pathwaysFound) || 0,
            pathways: j.pathways.map(p => ({ stId: String(p.stId), name: String(p.name),
                found: Number(p.entities && p.entities.found), total: Number(p.entities && p.entities.total),
                p: Number(p.entities && p.entities.pValue), fdr: Number(p.entities && p.entities.fdr) }))
        };
    },
    coverage(result, input) {
        // Reactome counts the ids it did not find but does not name them
        const n = input.genes.length;
        const shown = Math.max(0, n - result.notFound);
        if (shown >= n) return Coverage.complete(n, 'genes');
        return new Coverage({ shown, total: n, unit: 'genes', gaps: [{ reason: GAP.UNAVAILABLE, kind: 'unmapped',
            source: 'Reactome', count: n - shown, detail: 'Reactome does not say which' }] });
    },
    render(result, el, ctx) {
        const browser = result.token ? `https://reactome.org/PathwayBrowser/#/DTAB=AN&ANALYSIS=${result.token}` : null;
        el.append(ctx.el('div', { class: 'gs-result-head' }, ctx.el('span', {
            text: `${result.found.toLocaleString('en-US')} pathways with at least one gene`
                + (result.found > result.pathways.length ? `; the ${result.pathways.length} with the smallest p are listed here` : '') }),
        browser && result.found > result.pathways.length ? ctx.link(browser, `All ${result.found.toLocaleString('en-US')} in Reactome`) : ''),
        result.pathways.length ? longTable(ctx, 'Reactome pathway analysis',
            ['Pathway', { label: 'Entities', cls: 'gs-num', title: 'Reactome entities (genes, proteins, complexes) found / in the pathway' }, { label: 'FDR', cls: 'gs-num' }],
            result.pathways.map(p => [{ text: p.name, href: `https://reactome.org/content/detail/${encodeURIComponent(p.stId)}`, label: `${p.name} on Reactome` },
                { text: `${p.found} / ${p.total}`, cls: 'gs-num' }, { text: ctx.sci(p.fdr), cls: 'gs-num' }]), 'pathways') : '',
        attribution(ctx, REACTOME, ['background: genome only (Reactome takes no custom background)',
            ctx.input.taxonomyId !== '9606' ? 'projected to human pathways' : ''].filter(Boolean).join(' · ')));
    },
    openUrl: (input, result) => (result && result.token ? `https://reactome.org/PathwayBrowser/#/DTAB=AN&ANALYSIS=${result.token}` : null),
    exportRows: (result) => ({
        columns: ['pathway_id', 'pathway', 'genes_found', 'genes_in_pathway', 'p_value', 'fdr'],
        rows: result.pathways.map(p => [p.stId, p.name, p.found, p.total, p.p, p.fdr])
    })
};

// ---------------------------------------------------------------------------
// Human Protein Atlas

const HPA = Object.freeze({
    name: 'Human Protein Atlas', host: 'www.proteinatlas.org', home: 'https://www.proteinatlas.org', licence: 'CC BY 4.0', maxConcurrent: 1
});

const HPA_COLUMNS = 'g,gs,eg,up,rnats,rnatd,rnascs,rnascd,scl';

const asList = (v) => (Array.isArray(v) ? v.map(String) : v ? [String(v)] : []);

export const hpa = {
    id: 'hpa',
    version: '1',
    label: 'Expression and location of the focused gene',
    provider: HPA,
    kind: 'gene',
    defaultVisible: false,
    limits: { minGenes: 1, maxGenes: 1 },
    idTypes: ['symbol', 'ensembl'],
    supportsSpecies: (tax) => tax === '9606',
    describeRequest: (input) => `the focused gene ${input.focus.id}`,
    async fetch(input, io) {
        const id = input.focus.id.replace(/\.\d+$/, '');
        const rows = await io.fetchJson('https://www.proteinatlas.org/api/search_download.php', {
            query: { search: id, format: 'json', columns: HPA_COLUMNS, compress: 'no' } });
        if (!Array.isArray(rows)) throw parseError('the Human Protein Atlas sent no list');
        // the search is fuzzy (TP53 also finds TP53INP1): only the gene itself
        const lc = id.toLowerCase();
        const row = rows.find(r => r && (String(r.Gene || '').toLowerCase() === lc || String(r.Ensembl || '') === id)) || null;
        if (!row) return { row: null };
        return { row: {
            gene: String(row.Gene), synonyms: asList(row['Gene synonym']), ensembl: String(row.Ensembl || ''), uniprot: asList(row.Uniprot),
            tissueSpecificity: String(row['RNA tissue specificity'] || ''), tissueDistribution: String(row['RNA tissue distribution'] || ''),
            cellSpecificity: String(row['RNA single cell type specificity'] || ''), cellDistribution: String(row['RNA single cell type distribution'] || ''),
            location: asList(row['Subcellular location'])
        } };
    },
    render(result, el, ctx) {
        const r = result.row;
        if (!r) {
            el.append(ctx.el('p', { text: `The Human Protein Atlas has no gene ${ctx.input.focus.id}.` }), attribution(ctx, HPA));
            return;
        }
        const page = r.ensembl ? `https://www.proteinatlas.org/${encodeURIComponent(r.ensembl)}-${encodeURIComponent(r.gene)}` : null;
        const line = (k, v) => (v ? ctx.el('div', { class: 'gs-card__row' }, ctx.el('span', { class: 'gs-card__key', text: k }), ctx.el('span', { text: v })) : '');
        el.append(ctx.el('div', { class: 'gs-card' },
            ctx.el('div', { class: 'gs-card__title' }, geneButton(ctx, r.gene), r.synonyms.length ? ` (${r.synonyms.join(', ')})` : ''),
            line('Tissues (RNA)', [r.tissueSpecificity, r.tissueDistribution].filter(Boolean).join('; ')),
            line('Single cell types (RNA)', [r.cellSpecificity, r.cellDistribution].filter(Boolean).join('; ')),
            line('Subcellular location', r.location.join(', ')),
            page ? ctx.el('div', {}, ctx.link(page, `${r.gene} on the Human Protein Atlas`), ' · ',
                ctx.link(`${page}/single+cell`, 'single cell types')) : ''),
        attribution(ctx, HPA));
    },
    openUrl: (input) => (input.focus ? `https://www.proteinatlas.org/search/${encodeURIComponent(input.focus.id)}` : null)
};

export const OPTIONAL_ADAPTERS = [enrichr, reactome, hpa];
