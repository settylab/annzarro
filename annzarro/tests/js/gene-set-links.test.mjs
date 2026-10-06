/**
 * The Gene Set Analysis panel's links (panels/gene-set-utilities/links.js).
 *
 * Links are made locally from templates, so they must be right by
 * construction: every href https and well-formed whatever the gene is
 * called, a resource only for the species it covers, and a whole-set link
 * that does not fit refused with the reason, never cut.
 *
 * Run:  node --test annzarro/tests/js/gene-set-links.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const L = await import('../../../static/js/panels/gene-set-utilities/links.js');

const HUMAN = { taxonomyId: '9606', speciesName: 'Homo sapiens', idType: 'symbol' };
const MOUSE = { taxonomyId: '10090', speciesName: 'Mus musculus', idType: 'symbol' };

const ODD = ['HLA-DRB1', 'C4A/C4B', 'Gm12345.1', 'MT-CO1', 'ENSG00000141510', 'gene with space', 'IGHV3-30+', 'Ca²⁺-ATPase', "5'-NT", 'a&b=c?d#e'];

test('every href is https, parses, and carries the gene encoded', () => {
    for (const sym of ODD) {
        for (const ctx of [HUMAN, MOUSE, { taxonomyId: '7955', speciesName: 'Danio rerio' }, { taxonomyId: '4932' }]) {
            for (const l of L.geneLinks(L.geneRecord(sym, 'symbol'), ctx)) {
                assert.ok(l.href.startsWith('https://'), l.href);
                const u = new URL(l.href);
                assert.equal(u.protocol, 'https:');
                // the gene is in the URL only encoded: & = ? # never split it
                if (/[&=?#]/.test(sym)) assert.ok(!l.href.includes(sym), `${l.resource}: ${l.href}`);
                assert.ok(decodeURIComponent(l.href.replace(/\+/g, ' ')).includes(sym)
                    || decodeURIComponent(l.href).includes(sym), `${l.resource} names ${sym}: ${l.href}`);
            }
        }
    }
});

test('resources by species: GeneCards and HPA for human, MGI for mouse, nothing species-bound for an unknown taxon', () => {
    const ids = (links) => links.map(l => l.resource);
    const human = ids(L.geneLinks(L.geneRecord('TP53', 'symbol'), HUMAN));
    for (const r of ['genecards', 'hpa', 'gtex', 'ncbi', 'uniprot', 'string', 'clinvar']) assert.ok(human.includes(r), r);
    assert.ok(!human.includes('mgi'));
    const mouse = ids(L.geneLinks(L.geneRecord('Trp53', 'symbol'), MOUSE));
    assert.ok(mouse.includes('mgi') && mouse.includes('alliance') && mouse.includes('archs4'));
    for (const r of ['genecards', 'hpa', 'gtex', 'omim', 'clinvar']) assert.ok(!mouse.includes(r), `${r} is human only`);
    const other = ids(L.geneLinks(L.geneRecord('abc1', 'symbol'), { taxonomyId: '1234567' }));
    assert.deepEqual(other.sort(), ['ncbi', 'pubmed', 'reactome', 'scholar', 'string', 'uniprot', 'wikipathways'].sort());
});

test('ids from the gene card turn searches into direct links; links that need a missing id are absent', () => {
    const plain = L.geneRecord('TP53', 'symbol');
    const byId = Object.fromEntries(L.geneLinks(plain, HUMAN).map(l => [l.resource, l.href]));
    assert.match(byId.ncbi, /gene\/\?term=TP53%5Bsym%5D%20AND%209606%5Btaxid%5D$/);
    assert.equal(byId.omim, undefined, 'no OMIM link without a MIM number');
    assert.equal(byId.ensembl, undefined, 'no Ensembl link without an Ensembl id');
    const card = L.geneRecord('TP53', 'symbol', { entrez: '7157', ensembl: 'ENSG00000141510', mim: '191170', uniprot: 'P04637', hgnc: '11998' });
    const direct = Object.fromEntries(L.geneLinks(card, HUMAN).map(l => [l.resource, l.href]));
    assert.equal(direct.ncbi, 'https://www.ncbi.nlm.nih.gov/gene/7157');
    assert.equal(direct.ensembl, 'https://www.ensembl.org/id/ENSG00000141510');
    assert.equal(direct.omim, 'https://www.omim.org/entry/191170');
    assert.equal(direct.uniprot, 'https://www.uniprot.org/uniprotkb/P04637/entry');
    assert.equal(direct.hpa, 'https://www.proteinatlas.org/ENSG00000141510-TP53');
    assert.equal(direct['hpa-sc'], 'https://www.proteinatlas.org/ENSG00000141510-TP53/single+cell');
    assert.equal(direct.kegg, 'https://www.kegg.jp/entry/hsa:7157');
    assert.equal(direct.alliance, 'https://www.alliancegenome.org/gene/HGNC%3A11998');
    const m = Object.fromEntries(L.geneLinks(L.geneRecord('Trp53', 'symbol', { mgi: 'MGI:98834' }), MOUSE).map(l => [l.resource, l.href]));
    assert.equal(m.mgi, 'https://www.informatics.jax.org/marker/MGI%3A98834');
    assert.match(L.geneLink('omim', plain, HUMAN).why, /MIM number/);
    assert.match(L.geneLink('mgi', plain, HUMAN).why, /does not cover this species/);
});

test('an Ensembl id column links by Ensembl id, without its version', () => {
    const rec = L.geneRecord('ENSG00000141510.16', 'ensembl');
    assert.equal(rec.ensembl, 'ENSG00000141510');
    const links = Object.fromEntries(L.geneLinks(rec, { ...HUMAN, idType: 'ensembl' }).map(l => [l.resource, l.href]));
    assert.equal(links.ensembl, 'https://www.ensembl.org/id/ENSG00000141510');
    assert.equal(links.opentargets, 'https://platform.opentargets.org/target/ENSG00000141510');
    assert.equal(links.genecards, undefined, 'GeneCards needs a symbol');
    assert.equal(L.geneRecord('FBgn0039044', 'ensembl').flybase, 'FBgn0039044');
});

test('detectIdType: Ensembl (human, mouse, fly, worm, versioned), Entrez, symbols, mixed', () => {
    assert.equal(L.detectIdType(['ENSG00000141510', 'ENSG00000135679.22']), 'ensembl');
    assert.equal(L.detectIdType(['ENSMUSG00000059552', 'ENSMUSG00000020184']), 'ensembl');
    assert.equal(L.detectIdType(['FBgn0039044', 'WBGene00000467']), 'ensembl');
    assert.equal(L.detectIdType(['7157', '4193']), 'entrez');
    assert.equal(L.detectIdType(['TP53', 'Mdm2', 'HLA-DRB1', 'C4A/C4B', 'MT-CO1']), 'symbol');
    assert.equal(L.detectIdType(['TP53', 'ENSG00000141510', '7157']), 'unknown');
    assert.equal(L.detectIdType([]), 'unknown');
});

test('whole-set links: encoded, refused with a reason when too long, never shortened', () => {
    const few = ['TP53', 'MDM2', 'ATM'];
    const links = Object.fromEntries(L.setLinks(few, HUMAN).map(l => [l.resource, l]));
    assert.equal(links.string.href, 'https://string-db.org/cgi/network?identifiers=TP53%0DMDM2%0DATM&species=9606');
    assert.equal(links.gprofiler.href, 'https://biit.cs.ut.ee/gprofiler/gost?organism=hsapiens&query=TP53%0AMDM2%0AATM');
    assert.match(links.ncbi.href, /TP53%5Bsym%5D%20OR%20MDM2%5Bsym%5D/);
    assert.equal(links.genemania.href, 'https://genemania.org/search/homo-sapiens/TP53/MDM2/ATM');
    assert.ok(links.pubmed.href);
    for (const l of Object.values(links)) assert.ok(!l.href || new URL(l.href).protocol === 'https:');
    const many = Array.from({ length: 1500 }, (_, i) => `GENE${i}`);
    const big = Object.fromEntries(L.setLinks(many, HUMAN).map(l => [l.resource, l]));
    assert.equal(big.ncbi.disabled, true);
    assert.match(big.ncbi.why, /1,500 genes make a NCBI Gene link of [\d,]+ characters/);
    assert.equal(big.ncbi.href, undefined, 'no cut-down link');
    assert.match(big.pubmed.why, /5 genes or fewer/);
    const huge = Array.from({ length: 2001 }, (_, i) => `G${i}`);
    assert.match(L.setLinks(huge, HUMAN).find(l => l.resource === 'string').why, /at most 2,000/);
    const ens = Object.fromEntries(L.setLinks(['ENSG00000141510'], { ...HUMAN, idType: 'ensembl' }).map(l => [l.resource, l]));
    assert.match(ens.ncbi.why, /needs gene symbols/);
    assert.ok(ens.string.href, 'STRING takes Ensembl ids');
    assert.match(Object.fromEntries(L.setLinks(few, { taxonomyId: '1234567', idType: 'symbol' }).map(l => [l.resource, l])).gprofiler.why, /not known here/);
    assert.deepEqual(L.setLinks([], HUMAN), []);
    // a configured STRING (a versioned host) is where its links go
    assert.ok(L.setLinks(few, { ...HUMAN, stringBase: 'https://version-12-5.string-db.org' })[0].href.startsWith('https://version-12-5.string-db.org/cgi/network?'));
});

test('default list columns per species, and a CSV of the links', () => {
    assert.deepEqual(L.defaultColumns('9606'), ['genecards', 'ncbi', 'ensembl', 'uniprot', 'string', 'hpa']);
    assert.ok(L.defaultColumns('10090').includes('mgi'));
    for (const tax of ['9606', '10090', '10116', '7955', '7227', '6239', '559292', '1234']) {
        const offered = new Set(L.columnChoices(tax).map(c => c.id));
        for (const c of L.defaultColumns(tax)) assert.ok(offered.has(c), `${c} offered for ${tax}`);
    }
    const csv = L.linksCsv([{ name: 'TP53', id: 'TP53', rec: L.geneRecord('TP53', 'symbol') }, { name: 'X,Y', id: 'X,Y', rec: L.geneRecord('X,Y', 'symbol') }],
        ['ncbi', 'omim'], HUMAN);
    const lines = csv.trim().split('\r\n');
    assert.equal(lines[0], 'gene,id,NCBI Gene,OMIM');
    assert.match(lines[1], /^TP53,TP53,https:\/\/www\.ncbi\.nlm\.nih\.gov\/gene\/\?term=TP53/);
    assert.ok(lines[1].endsWith(','), 'no OMIM link without a MIM number: an empty cell');
    assert.ok(lines[2].startsWith('"X,Y","X,Y",'));
});

test('safeHref refuses anything that is not https', () => {
    assert.equal(L.safeHref('javascript:alert(1)'), null);
    assert.equal(L.safeHref('http://example.org'), null);
    assert.equal(L.safeHref('https://example.org/x'), 'https://example.org/x');
    assert.equal(L.safeHref(null), null);
});
