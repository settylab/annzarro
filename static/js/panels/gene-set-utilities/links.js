/**
 * Links from a gene, or from the whole selection, to the resources that
 * describe it. Built locally from URL templates: making a link sends
 * nothing anywhere, so the Links section works offline, on a server with
 * external services turned off, and in the desktop app (which opens them in
 * the system browser). Pure, so Node tests check every href
 * (gene-set-links.test.mjs).
 *
 * The templates are the ones checked by hand on 2026-10-05 (each answered
 * 200 to a browser user agent, or was a bot wall that serves browsers). A
 * resource whose page needs an id the panel does not have (OMIM's MIM
 * number, a ZFIN id) has no link until the gene card (MyGene.info) supplies
 * it: a search URL that hits a captcha or a guessed URL is worse than none.
 */

const HUMAN = '9606', MOUSE = '10090', RAT = '10116', FISH = '7955', FLY = '7227', WORM = '6239';
const YEAST = ['559292', '4932'];

/** Longest link offered; longer ones are refused with the reason, never cut. */
export const MAX_URL_LENGTH = 8000;

/** g:Profiler's organism ids for common species (its organisms_list otherwise). */
export const GPROFILER_ORGANISMS = Object.freeze({
    '9606': 'hsapiens', '10090': 'mmusculus', '10116': 'rnorvegicus', '7955': 'drerio',
    '7227': 'dmelanogaster', '6239': 'celegans', '559292': 'scerevisiae', '3702': 'athaliana',
    '8364': 'xtropicalis', '9823': 'sscrofa', '9544': 'mmulatta', '9031': 'ggallus'
});

const KEGG_ORGS = Object.freeze({ '9606': 'hsa', '10090': 'mmu', '10116': 'rno', '7955': 'dre' });

const GENEMANIA_SLUGS = Object.freeze({
    '9606': 'homo-sapiens', '10090': 'mus-musculus', '10116': 'rattus-norvegicus',
    '7227': 'drosophila-melanogaster', '6239': 'caenorhabditis-elegans', '7955': 'danio-rerio',
    '559292': 'saccharomyces-cerevisiae', '4932': 'saccharomyces-cerevisiae', '3702': 'arabidopsis-thaliana'
});

const ALLIANCE_SPECIES = new Set([HUMAN, MOUSE, RAT, FISH, FLY, WORM, ...YEAST]);

const enc = encodeURIComponent;

const ENSEMBL_RE = /^(ENS[A-Z]*G\d{11}|FBgn\d{7}|WBGene\d{8})(\.\d+)?$/;

/** An Ensembl gene id without its version suffix (ENSG00000141510.16 -> ENSG00000141510). */
export function stripVersion(id) {
    const m = ENSEMBL_RE.exec(String(id || '').trim());
    return m ? m[1] : String(id || '').trim();
}

/**
 * What kind of ids a column holds, from a sample: Ensembl gene ids (with
 * the fly and worm ones Ensembl uses), Entrez ids (digits) or symbols. A
 * mix that is not 80 % one kind is 'unknown'.
 * @param {string[]} sample
 * @returns {'ensembl'|'entrez'|'symbol'|'unknown'}
 */
export function detectIdType(sample) {
    const ids = (sample || []).filter(s => typeof s === 'string' && s.trim()).slice(0, 200);
    if (!ids.length) return 'unknown';
    let ens = 0, num = 0, sym = 0;
    for (const raw of ids) {
        const s = raw.trim();
        if (ENSEMBL_RE.test(s)) ens++;
        else if (/^\d+$/.test(s)) num++;
        else if (/^[A-Za-z0-9][A-Za-z0-9._\-/:@()+' ]*$/.test(s) && /[A-Za-z]/.test(s)) sym++;
    }
    const need = Math.ceil(ids.length * 0.8);
    if (ens >= need) return 'ensembl';
    if (num >= need) return 'entrez';
    if (sym >= need) return 'symbol';
    return 'unknown';
}

/**
 * Everything known about a gene, for its links: the id the table holds
 * (by its type), plus what the gene card returned (MyGene.info xrefs).
 * @param {string} id
 * @param {string} idType
 * @param {Object} [xrefs] - {symbol, entrez, ensembl, uniprot, mim, hgnc, mgi, rgd, zfin, flybase, wormbase, sgd}
 */
export function geneRecord(id, idType, xrefs = {}) {
    const rec = {};
    const s = String(id || '').trim();
    if (idType === 'ensembl') {
        const e = stripVersion(s);
        if (e.startsWith('FBgn')) rec.flybase = e;
        else if (e.startsWith('WBGene')) rec.wormbase = e;
        rec.ensembl = e;
    } else if (idType === 'entrez') rec.entrez = s;
    else if (s) rec.symbol = s;
    for (const [k, v] of Object.entries(xrefs || {})) {
        if (v !== undefined && v !== null && v !== '' && rec[k] === undefined) rec[k] = String(v);
    }
    return rec;
}

const sp = (ctx) => String(ctx.taxonomyId || '');
const only = (...taxa) => (ctx) => taxa.includes(sp(ctx));
const stringBase = (ctx) => (ctx.stringBase || 'https://string-db.org').replace(/\/+$/, '');

/**
 * @typedef {{id: string, label: string, species?: (ctx) => boolean,
 *   gene: (rec: Object, ctx: Object) => string|null, needs?: string}} LinkResource
 * `needs` says what is missing when gene() gives no link (a tooltip).
 */
export const RESOURCES = Object.freeze([
    { id: 'mgi', label: 'MGI', species: only(MOUSE), needs: 'a symbol or MGI id',
        gene: (r) => (r.mgi ? `https://www.informatics.jax.org/marker/${enc(r.mgi)}`
            : r.symbol ? `https://www.informatics.jax.org/quicksearch/summary?queryType=exactPhrase&query=${enc(r.symbol)}` : null) },
    { id: 'rgd', label: 'RGD', species: only(RAT), needs: 'the RGD id (from the gene card)',
        gene: (r) => (r.rgd ? `https://rgd.mcw.edu/rgdweb/report/gene/main.html?id=${enc(r.rgd.replace(/^RGD:/, ''))}` : null) },
    { id: 'zfin', label: 'ZFIN', species: only(FISH), needs: 'the ZFIN id (from the gene card)',
        gene: (r) => (r.zfin ? `https://zfin.org/${enc(r.zfin.replace(/^ZFIN:/, ''))}` : null) },
    { id: 'flybase', label: 'FlyBase', species: only(FLY), needs: 'a symbol or FBgn id',
        gene: (r) => (r.flybase ? `https://flybase.org/reports/${enc(r.flybase)}`
            : r.symbol ? `https://flybase.org/search/symbol/${enc(r.symbol)}` : null) },
    { id: 'wormbase', label: 'WormBase', species: only(WORM), needs: 'the WBGene id',
        gene: (r) => (r.wormbase ? `https://wormbase.org/species/c_elegans/gene/${enc(r.wormbase)}` : null) },
    { id: 'sgd', label: 'SGD', species: only(...YEAST), needs: 'a symbol or SGD id',
        gene: (r) => (r.sgd ? `https://www.yeastgenome.org/locus/${enc(r.sgd.replace(/^SGD:/, ''))}`
            : r.symbol ? `https://www.yeastgenome.org/search?q=${enc(r.symbol)}&category=locus` : null) },
    { id: 'ncbi', label: 'NCBI Gene',
        gene: (r, ctx) => (r.entrez ? `https://www.ncbi.nlm.nih.gov/gene/${enc(r.entrez)}`
            : r.symbol ? `https://www.ncbi.nlm.nih.gov/gene/?term=${enc(`${r.symbol}[sym] AND ${sp(ctx)}[taxid]`)}`
                : r.ensembl ? `https://www.ncbi.nlm.nih.gov/gene/?term=${enc(r.ensembl)}` : null) },
    { id: 'ensembl', label: 'Ensembl', needs: 'an Ensembl id',
        gene: (r) => (r.ensembl ? `https://www.ensembl.org/id/${enc(r.ensembl)}` : null) },
    { id: 'uniprot', label: 'UniProt', needs: 'a symbol or UniProt accession',
        gene: (r, ctx) => (r.uniprot ? `https://www.uniprot.org/uniprotkb/${enc(r.uniprot)}/entry`
            : r.symbol ? `https://www.uniprot.org/uniprotkb?query=${enc(`gene_exact:${r.symbol}`)}+AND+organism_id:${enc(sp(ctx))}` : null) },
    { id: 'string', label: 'STRING',
        gene: (r, ctx) => {
            const id = r.symbol || r.ensembl || r.entrez;
            return id ? `${stringBase(ctx)}/cgi/network?identifiers=${enc(id)}&species=${enc(sp(ctx))}` : null;
        } },
    { id: 'genecards', label: 'GeneCards', species: only(HUMAN), needs: 'a symbol',
        gene: (r) => (r.symbol ? `https://www.genecards.org/cgi-bin/carddisp.pl?gene=${enc(r.symbol)}` : null) },
    { id: 'hpa', label: 'HPA', species: only(HUMAN),
        gene: (r) => (r.ensembl && r.symbol ? `https://www.proteinatlas.org/${enc(r.ensembl)}-${enc(r.symbol)}`
            : (r.symbol || r.ensembl) ? `https://www.proteinatlas.org/search/${enc(r.symbol || r.ensembl)}` : null) },
    { id: 'hpa-sc', label: 'HPA single cell', species: only(HUMAN), needs: 'the Ensembl id and symbol (from the gene card)',
        gene: (r) => (r.ensembl && r.symbol ? `https://www.proteinatlas.org/${enc(r.ensembl)}-${enc(r.symbol)}/single+cell` : null) },
    { id: 'gtex', label: 'GTEx', species: only(HUMAN), needs: 'a symbol',
        gene: (r) => (r.symbol ? `https://gtexportal.org/home/gene/${enc(r.symbol)}` : null) },
    { id: 'opentargets', label: 'Open Targets', species: only(HUMAN),
        gene: (r) => (r.ensembl ? `https://platform.opentargets.org/target/${enc(r.ensembl)}`
            : r.symbol ? `https://platform.opentargets.org/search?q=${enc(r.symbol)}` : null) },
    { id: 'omim', label: 'OMIM', species: only(HUMAN), needs: 'the MIM number (from the gene card)',
        gene: (r) => (r.mim ? `https://www.omim.org/entry/${enc(r.mim)}` : null) },
    { id: 'clinvar', label: 'ClinVar', species: only(HUMAN), needs: 'a symbol',
        gene: (r) => (r.symbol ? `https://www.ncbi.nlm.nih.gov/clinvar/?term=${enc(`${r.symbol}[gene]`)}` : null) },
    { id: 'kegg', label: 'KEGG', species: (ctx) => !!KEGG_ORGS[sp(ctx)], needs: 'the Entrez id (from the gene card)',
        gene: (r, ctx) => (r.entrez ? `https://www.kegg.jp/entry/${KEGG_ORGS[sp(ctx)]}:${enc(r.entrez)}` : null) },
    { id: 'reactome', label: 'Reactome', needs: 'a symbol',
        gene: (r, ctx) => (r.symbol ? `https://reactome.org/content/query?q=${enc(r.symbol)}`
            + (ctx.speciesName ? `&species=${enc(ctx.speciesName).replace(/%20/g, '+')}` : '') : null) },
    { id: 'wikipathways', label: 'WikiPathways', needs: 'a symbol',
        gene: (r) => (r.symbol ? `https://www.wikipathways.org/search.html?query=${enc(r.symbol)}` : null) },
    { id: 'alliance', label: 'Alliance', species: (ctx) => ALLIANCE_SPECIES.has(sp(ctx)), needs: 'a symbol or a MOD id',
        gene: (r, ctx) => {
            const curie = r.hgnc ? `HGNC:${r.hgnc.replace(/^HGNC:/, '')}` : r.mgi ? r.mgi
                : r.rgd ? `RGD:${r.rgd.replace(/^RGD:/, '')}` : r.zfin ? `ZFIN:${r.zfin.replace(/^ZFIN:/, '')}`
                    : r.flybase ? `FB:${r.flybase}` : r.wormbase ? `WB:${r.wormbase}`
                        : r.sgd ? `SGD:${r.sgd.replace(/^SGD:/, '')}` : null;
            if (curie) return `https://www.alliancegenome.org/gene/${enc(curie)}`;
            return r.symbol && ALLIANCE_SPECIES.has(sp(ctx))
                ? `https://www.alliancegenome.org/search?q=${enc(r.symbol)}&category=gene` : null;
        } },
    { id: 'harmonizome', label: 'Harmonizome', species: only(HUMAN), needs: 'a symbol',
        gene: (r) => (r.symbol ? `https://maayanlab.cloud/Harmonizome/gene/${enc(r.symbol)}` : null) },
    { id: 'archs4', label: 'ARCHS4', species: only(HUMAN, MOUSE), needs: 'a symbol',
        gene: (r) => (r.symbol ? `https://maayanlab.cloud/archs4/gene/${enc(r.symbol)}` : null) },
    { id: 'pubmed', label: 'PubMed', needs: 'a symbol',
        gene: (r) => (r.symbol ? `https://pubmed.ncbi.nlm.nih.gov/?term=${enc(`${r.symbol}[tiab]`)}` : null) },
    { id: 'scholar', label: 'Google Scholar', needs: 'a symbol',
        gene: (r) => (r.symbol ? `https://scholar.google.com/scholar?q=${enc(r.symbol)}` : null) }
]);

const RESOURCE_BY_ID = new Map(RESOURCES.map(r => [r.id, r]));

export function resourceById(id) {
    return RESOURCE_BY_ID.get(id) || null;
}

/** A resource applies to this species (one without a species test applies to all). */
export function appliesTo(resource, ctx) {
    return !resource.species || resource.species(ctx);
}

/** Only https URLs that parse leave this module. */
export function safeHref(href) {
    if (typeof href !== 'string' || !href.startsWith('https://')) return null;
    try {
        return new URL(href).protocol === 'https:' ? href : null;
    } catch {
        return null;
    }
}

/**
 * The links for one gene: every resource for the species that can link it.
 * @param {Object} rec - geneRecord()
 * @param {{taxonomyId: string, speciesName?: string, stringBase?: string}} ctx
 * @returns {Array<{resource: string, label: string, href: string}>}
 */
export function geneLinks(rec, ctx) {
    const out = [];
    for (const r of RESOURCES) {
        if (!appliesTo(r, ctx)) continue;
        const href = safeHref(r.gene(rec, ctx));
        if (href) out.push({ resource: r.id, label: r.label, href });
    }
    return out;
}

/** One gene's link for one resource: {href} or {why} (not this species, or an id missing). */
export function geneLink(resourceId, rec, ctx) {
    const r = resourceById(resourceId);
    if (!r) return { why: 'unknown resource' };
    if (!appliesTo(r, ctx)) return { why: `${r.label} does not cover this species` };
    const href = safeHref(r.gene(rec, ctx));
    return href ? { href } : { why: `${r.label} needs ${r.needs || 'another id'}` };
}

/** The list's default columns for a species (the user's choice replaces them). */
export function defaultColumns(taxonomyId) {
    const tax = String(taxonomyId || '');
    const common = ['ncbi', 'ensembl', 'uniprot', 'string'];
    if (tax === HUMAN) return ['genecards', ...common, 'hpa'];
    if (tax === MOUSE) return ['mgi', ...common, 'alliance'];
    if (tax === FLY) return ['flybase', ...common, 'alliance'];
    if (YEAST.includes(tax)) return ['sgd', ...common, 'alliance'];
    if (ALLIANCE_SPECIES.has(tax)) return [...common, 'alliance', 'pubmed'];
    return [...common, 'pubmed', 'scholar'];
}

/** The resources the list's column menu offers for a species. */
export function columnChoices(taxonomyId, speciesName = '') {
    const ctx = { taxonomyId, speciesName };
    return RESOURCES.filter(r => appliesTo(r, ctx)).map(r => ({ id: r.id, label: r.label }));
}

function capped(label, url, n) {
    if (url.length <= MAX_URL_LENGTH) return { href: safeHref(url) };
    return { disabled: true, why: `${n.toLocaleString('en-US')} genes make a ${label} link of ${url.length.toLocaleString('en-US')} characters; `
        + `links longer than ${MAX_URL_LENGTH.toLocaleString('en-US')} are not offered. Filter the table to fewer genes.` };
}

/**
 * Links for the whole selection: each {resource, label, href} or
 * {resource, label, disabled: true, why}. Nothing is shortened: a list that
 * does not fit a link says so.
 * @param {string[]} ids - as sent (the ID column's values)
 * @param {{taxonomyId: string, speciesName?: string, idType: string, stringBase?: string}} ctx
 */
export function setLinks(ids, ctx) {
    const n = ids.length;
    const tax = sp(ctx);
    const out = [];
    const add = (resource, label, result) => out.push({ resource, label, ...result });
    if (!n) return out;
    const symbols = ctx.idType === 'symbol';
    const notSymbols = { disabled: true, why: 'needs gene symbols; pick a symbol column under IDs' };
    add('string', 'STRING network', n > 2000
        ? { disabled: true, why: `${n.toLocaleString('en-US')} genes; STRING draws networks of at most 2,000` }
        : capped('STRING', `${stringBase(ctx)}/cgi/network?identifiers=${enc(ids.join('\r'))}&species=${enc(tax)}`, n));
    const gp = GPROFILER_ORGANISMS[tax];
    add('gprofiler', 'g:Profiler', gp
        ? capped('g:Profiler', `https://biit.cs.ut.ee/gprofiler/gost?organism=${enc(gp)}&query=${enc(ids.join('\n'))}`, n)
        : { disabled: true, why: `g:Profiler's name for taxon ${tax} is not known here; open g:Profiler and pick the organism` });
    add('ncbi', 'NCBI Gene', symbols
        ? capped('NCBI Gene', `https://www.ncbi.nlm.nih.gov/gene/?term=${enc(`(${ids.map(s => `${s}[sym]`).join(' OR ')}) AND ${tax}[taxid]`)}`, n)
        : notSymbols);
    add('uniprot', 'UniProt', symbols
        ? capped('UniProt', `https://www.uniprot.org/uniprotkb?query=${enc(`(${ids.map(s => `gene_exact:${s}`).join(' OR ')}) AND organism_id:${tax}`)}`, n)
        : notSymbols);
    const slug = GENEMANIA_SLUGS[tax];
    add('genemania', 'GeneMANIA', !symbols ? notSymbols : !slug
        ? { disabled: true, why: `GeneMANIA does not cover taxon ${tax}` }
        : capped('GeneMANIA', `https://genemania.org/search/${slug}/${ids.map(enc).join('/')}`, n));
    add('pubmed', 'PubMed (all together)', !symbols ? notSymbols : n > 5
        ? { disabled: true, why: `a search for papers naming all ${n.toLocaleString('en-US')} genes finds nothing useful; offered for 5 genes or fewer` }
        : capped('PubMed', `https://pubmed.ncbi.nlm.nih.gov/?term=${enc(ids.map(s => `${s}[tiab]`).join(' AND '))}`, n));
    return out;
}

/** CSV of the list's links (one row per gene, one column per resource). */
export function linksCsv(rows, columns, ctx) {
    const q = (v) => {
        const s = v === null || v === undefined ? '' : String(v);
        return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const head = ['gene', 'id', ...columns.map(c => (resourceById(c) || { label: c }).label)];
    const lines = [head.map(q).join(',')];
    for (const { name, id, rec } of rows) {
        lines.push([name, id, ...columns.map(c => geneLink(c, rec, ctx).href || '')].map(q).join(','));
    }
    return lines.join('\r\n') + '\r\n';
}
