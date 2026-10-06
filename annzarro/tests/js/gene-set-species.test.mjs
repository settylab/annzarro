/**
 * The dataset's species when nobody chose it (gene-set-utilities/species.js):
 * from an uns entry naming it, else from the Ensembl prefix of its gene ids.
 * Found on the preview of bm_aging.zarr (mouse): with no species chosen the
 * panel used the server's default, human, for mouse Ensembl ids.
 *
 * Run:  node --test annzarro/tests/js/gene-set-species.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const S = await import('../../../static/js/panels/gene-set-utilities/species.js');

test('Ensembl prefixes name the species, versions and all', () => {
    const cases = { ENSG00000141510: '9606', 'ENSG00000141510.16': '9606', ENSMUSG00000033845: '10090',
        ENSRNOG00000010756: '10116', ENSDARG00000035559: '7955', FBgn0039044: '7227', WBGene00000467: '6239',
        ENSGALG00000004216: '9031', ENSSSCG00000017971: '9823' };
    for (const [id, tax] of Object.entries(cases)) assert.equal(S.speciesOfId(id), tax, id);
    for (const id of ['TP53', 'Mrpl15', '7157', 'ENSEMBL', 'ENSGene', '']) assert.equal(S.speciesOfId(id), null, id);
});

test('the species of a column of ids: most of them, with a prefix; symbols or a mix give none', () => {
    const mouse = Array.from({ length: 95 }, (_, i) => `ENSMUSG000000${String(i).padStart(5, '0')}`);
    assert.equal(S.speciesFromIds([...mouse, 'Xist', 'mt-Co1', 'GFP', 'ERCC-00002', 'tdTomato']), '10090');
    assert.equal(S.speciesFromIds(['TP53', 'MDM2', 'Mrpl15']), null, 'symbols say nothing');
    assert.equal(S.speciesFromIds([...mouse.slice(0, 50), ...Array.from({ length: 50 }, (_, i) => `ENSG000001${String(i).padStart(5, '0')}`)]), null, 'a mix is not guessed');
    assert.equal(S.speciesFromIds([...mouse.slice(0, 10), ...Array.from({ length: 30 }, (_, i) => `G${i}`)]), null, 'too few ids have a prefix');
    assert.equal(S.speciesFromIds([]), null);
});

test('an uns value naming the species: taxonomy id, scientific or common name, ontology id', () => {
    assert.equal(S.speciesFromText('Mus musculus'), '10090');
    assert.equal(S.speciesFromText('mouse'), '10090');
    assert.equal(S.speciesFromText('Homo_sapiens'), '9606');
    assert.equal(S.speciesFromText(['human']), '9606');
    assert.equal(S.speciesFromText(10116), '10116');
    assert.equal(S.speciesFromText('7955'), '7955');
    assert.equal(S.speciesFromText('NCBITaxon:7227'), '7227');
    assert.equal(S.speciesFromText({ value: 'zebrafish' }), '7955');
    for (const v of ['unknown', '', null, undefined, {}, ['x'], 3.5]) assert.equal(S.speciesFromText(v), null, String(v));
    assert.deepEqual(S.UNS_SPECIES_KEYS.slice(-2), ['species', 'organism']);
});
