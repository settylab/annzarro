/**
 * MyGene.info (mygene.info, v3): what each gene is, and the ids other
 * resources link by.
 *
 *   - mygene-mapping (the selection): every gene looked up by its symbol
 *     (or Ensembl / Entrez id), in batches of 1,000. Symbols it does not
 *     find are looked up again as aliases, and those matches are FLAGGED:
 *     an alias can be another gene's symbol (with species 9606 the mouse
 *     symbol Trp53 matched human TP53 through an alias), so they are never
 *     mixed silently with exact matches. Every gene not found is listed.
 *   - mygene-card (the focused gene): name, summary, location, aliases and
 *     the cross-references (Entrez, Ensembl, UniProt, MIM, HGNC, MGI, RGD,
 *     ZFIN, FlyBase, WormBase, SGD) that turn the Links section's searches
 *     into direct links.
 */
import { parseError } from '../fetch-policy.js';
import { attribution, geneButton, unmappedList, longTable, mappedCoverage } from './common.js';

const PROVIDER = Object.freeze({
    name: 'MyGene.info', host: 'mygene.info', home: 'https://mygene.info', licence: '', maxConcurrent: 2
});

const BASE = 'https://mygene.info/v3';
const BATCH = 1000;

const SCOPES = { symbol: 'symbol', ensembl: 'ensembl.gene', entrez: 'entrezgene', unknown: 'symbol,ensembl.gene,entrezgene' };

const MAP_FIELDS = 'symbol,name,entrezgene,ensembl.gene,type_of_gene';
const CARD_FIELDS = 'symbol,name,summary,entrezgene,ensembl.gene,uniprot.Swiss-Prot,MIM,HGNC,MGI,RGD,ZFIN,FLYBASE,WormBase,SGD,type_of_gene,alias,genomic_pos,map_location,taxid';

const first = (v) => (Array.isArray(v) ? v[0] : v);

/** The first Ensembl gene id of a hit (`ensembl` is an object or a list of them). */
export function ensemblOf(hit) {
    const e = hit && hit.ensembl;
    const list = Array.isArray(e) ? e : e ? [e] : [];
    for (const item of list) {
        const g = first(item && item.gene);
        if (typeof g === 'string' && g) return g;
    }
    return '';
}

/** The ids of a MyGene hit, keyed as links.js geneRecord takes them. */
export function xrefsOf(hit) {
    if (!hit) return {};
    const out = {
        symbol: hit.symbol, entrez: hit.entrezgene ?? hit._id, ensembl: ensemblOf(hit),
        uniprot: first(hit.uniprot && hit.uniprot['Swiss-Prot']), mim: first(hit.MIM), hgnc: first(hit.HGNC),
        mgi: first(hit.MGI), rgd: first(hit.RGD), zfin: first(hit.ZFIN), flybase: first(hit.FLYBASE),
        wormbase: first(hit.WormBase), sgd: first(hit.SGD)
    };
    for (const k of Object.keys(out)) {
        if (out[k] === undefined || out[k] === null || out[k] === '') delete out[k];
        else out[k] = String(out[k]);
    }
    return out;
}

/**
 * One batched lookup: POST /query with `scopes`, in chunks of 1,000.
 * Returns query -> {hit, hits} (hits counts how many genes matched it).
 */
async function lookup(io, ids, scopes, taxid) {
    const out = new Map();
    for (let i = 0; i < ids.length; i += BATCH) {
        const chunk = ids.slice(i, i + BATCH);
        const rows = await io.fetchJson(`${BASE}/query`, { form: {
            q: chunk.join(','), scopes, species: taxid, fields: MAP_FIELDS, dotfield: 'false' } });
        if (!Array.isArray(rows)) throw parseError('MyGene.info sent no list');
        for (const r of rows) {
            if (!r || typeof r.query !== 'string' || r.notfound) continue;
            const prev = out.get(r.query);
            if (prev) prev.hits++;
            else out.set(r.query, { hit: r, hits: 1 });
        }
    }
    return out;
}

export const mygeneMapping = {
    id: 'mygene-mapping',
    version: '1',
    label: 'Gene lookup',
    provider: PROVIDER,
    kind: 'set',
    defaultVisible: true,
    limits: { minGenes: 1, maxGenes: 5000 },
    supportsSpecies: () => 'unknown',
    params: {
        aliases: { type: 'bool', default: true, label: 'Look up symbols not found as aliases (flagged)' }
    },
    describeRequest: (input) => `${input.genes.length.toLocaleString('en-US')} gene ids and taxon ${input.taxonomyId}`,
    async fetch(input, io) {
        const exact = await lookup(io, input.genes, SCOPES[input.idType] || SCOPES.unknown, input.taxonomyId);
        const missing = input.genes.filter(g => !exact.has(g));
        let alias = new Map();
        if (input.params.aliases && missing.length && (input.idType === 'symbol' || input.idType === 'unknown')) {
            alias = await lookup(io, missing, 'alias', input.taxonomyId);
        }
        const rows = input.genes.map(q => {
            const e = exact.get(q), a = alias.get(q);
            const m = e || a;
            if (!m) return { query: q, match: 'none' };
            const h = m.hit;
            return { query: q, match: e ? 'exact' : 'alias', symbol: String(h.symbol || ''), name: String(h.name || ''),
                entrez: String(h.entrezgene ?? h._id ?? ''), ensembl: ensemblOf(h), type: String(h.type_of_gene || ''),
                others: m.hits - 1 };
        });
        return { rows };
    },
    coverage(result, input) {
        const missing = result.rows.filter(r => r.match === 'none').map(r => r.query);
        return mappedCoverage(input.genes.length - missing.length, input.genes, missing, 'MyGene.info');
    },
    render(result, el, ctx) {
        const rows = result.rows;
        const exact = rows.filter(r => r.match === 'exact').length;
        const alias = rows.filter(r => r.match === 'alias');
        const none = rows.filter(r => r.match === 'none').map(r => r.query);
        const several = rows.filter(r => r.others > 0).length;
        el.append(
            ctx.el('div', { class: 'gs-result-head' }, ctx.el('span', { text: [
                `${exact.toLocaleString('en-US')} of ${rows.length.toLocaleString('en-US')} found by ${ctx.input.idType === 'symbol' ? 'symbol' : 'id'}`,
                alias.length ? `${alias.length.toLocaleString('en-US')} only as an alias (flagged)` : '',
                none.length ? `${none.length.toLocaleString('en-US')} not found` : '',
                several ? `${several.toLocaleString('en-US')} matched more than one gene (the best match is shown)` : ''
            ].filter(Boolean).join('; ') })),
            alias.length ? ctx.el('p', { class: 'gs-note gs-note--warn', text:
                `Matched only through an alias, so possibly another gene: ${alias.map(r => `${r.query} → ${r.symbol}`).join(', ')}` }) : '',
            rows.length > none.length ? longTable(ctx, 'MyGene.info gene lookup',
                ['Gene', 'Symbol', 'Name', 'Entrez', 'Ensembl', 'Match'],
                rows.filter(r => r.match !== 'none').map(r => [geneButton(ctx, ctx.nameOf ? ctx.nameOf(r.query) : r.query), r.symbol, r.name,
                    r.entrez, r.ensembl, r.match === 'alias' ? { text: 'alias', cls: 'gs-flag', title: 'Not this symbol: found as an alias of another gene' }
                        : (r.others ? { text: `exact (+${r.others})`, title: `${r.others} other genes also match` } : 'exact')]), 'genes') : '',
            unmappedList(ctx, none, 'MyGene.info') || '',
            attribution(ctx, PROVIDER));
    },
    exportRows: (result) => ({
        columns: ['query', 'match', 'symbol', 'name', 'entrez', 'ensembl', 'type_of_gene'],
        rows: result.rows.map(r => [r.query, r.match, r.symbol || '', r.name || '', r.entrez || '', r.ensembl || '', r.type || ''])
    })
};

function cardQuery(input) {
    const id = input.focus.id;
    if (input.idType === 'entrez' || /^\d+$/.test(id)) return { q: `entrezgene:${id}` };
    if (input.idType === 'ensembl' || /^ENS[A-Z]*G\d{11}/.test(id)) return { q: `ensembl.gene:${id.replace(/\.\d+$/, '')}` };
    return { q: `symbol:"${id.replace(/"/g, '')}"`, alias: `alias:"${id.replace(/"/g, '')}"` };
}

export const mygeneCard = {
    id: 'mygene-card',
    version: '1',
    label: 'Focused gene',
    provider: PROVIDER,
    kind: 'gene',
    defaultVisible: true,
    limits: { minGenes: 1, maxGenes: 1 },
    supportsSpecies: () => 'unknown',
    describeRequest: (input) => `the focused gene ${input.focus.id} and taxon ${input.taxonomyId}`,
    async fetch(input, io) {
        const { q, alias } = cardQuery(input);
        const ask = (query) => io.fetchJson(`${BASE}/query`, { query: { q: query, species: input.taxonomyId, fields: CARD_FIELDS, size: 3 } });
        let j = await ask(q);
        let match = 'exact';
        if (j && Array.isArray(j.hits) && !j.hits.length && alias) {
            j = await ask(alias);
            match = 'alias';
        }
        if (!j || !Array.isArray(j.hits)) throw parseError('MyGene.info sent no hits');
        const hit = j.hits[0] || null;
        return { match: hit ? match : 'none', hit, others: Math.max(0, (Number(j.total) || j.hits.length) - 1), xrefs: xrefsOf(hit) };
    },
    render(result, el, ctx) {
        const { input } = ctx;
        const h = result.hit;
        if (!h) {
            el.append(ctx.el('p', { text: `MyGene.info has no gene ${input.focus.id} for taxon ${input.taxonomyId}.` }), attribution(ctx, PROVIDER));
            return;
        }
        const pos = first(h.genomic_pos);
        const where = h.map_location ? `chr ${h.map_location}` : pos && pos.chr ? `chr ${pos.chr}` : '';
        const aliases = Array.isArray(h.alias) ? h.alias : h.alias ? [h.alias] : [];
        const x = result.xrefs;
        const ids = [['Entrez', x.entrez], ['Ensembl', x.ensembl], ['UniProt', x.uniprot], ['HGNC', x.hgnc], ['MIM', x.mim],
            ['MGI', x.mgi], ['RGD', x.rgd], ['ZFIN', x.zfin], ['FlyBase', x.flybase], ['WormBase', x.wormbase], ['SGD', x.sgd]]
            .filter(([, v]) => v);
        el.append(
            result.match === 'alias' ? ctx.el('p', { class: 'gs-note gs-note--warn',
                text: `${input.focus.id} is not a ${input.speciesName || 'this species'} symbol; this is ${h.symbol}, which has it as an alias. It may be another gene.` }) : '',
            ctx.el('div', { class: 'gs-card' },
                ctx.el('div', { class: 'gs-card__title' }, ctx.el('b', { text: String(h.symbol || input.focus.id) }), ' ', String(h.name || '')),
                ctx.el('div', { class: 'gs-card__meta', text: [h.type_of_gene, where, aliases.length ? `also ${aliases.slice(0, 8).join(', ')}${aliases.length > 8 ? ', …' : ''}` : '']
                    .filter(Boolean).join(' · ') }),
                h.summary ? ctx.el('details', { class: 'gs-card__summary' }, ctx.el('summary', { text: 'Summary (RefSeq)' }), ctx.el('p', { text: String(h.summary) })) : '',
                ids.length ? ctx.el('div', { class: 'gs-card__ids', text: ids.map(([k, v]) => `${k} ${v}`).join(' · ') }) : '',
                result.others ? ctx.el('div', { class: 'gs-note', text: `${result.others} other gene${result.others === 1 ? '' : 's'} also matched; the best match is shown.` }) : ''),
            attribution(ctx, PROVIDER, 'the Links section uses these ids'));
    }
};

export const MYGENE_ADAPTERS = [mygeneMapping, mygeneCard];
