/**
 * The interface words of UX 6.1 live in utils/vocabulary.js and nowhere else (G6).
 *
 * Run:  node --test annzarro/tests/js/vocabulary.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const UTILS = path.join(here, '..', '..', '..', 'static', 'js', 'utils');
const { VOCABULARY: V } = await import('../../../static/js/utils/vocabulary.js');

test('every concept of the table in UX 6.1 has its word, its plural and the words it must never be given', () => {
    const concepts = {
        factor: 'factor', level: 'level', group: 'group', grouping: 'grouping', set: 'set', statistic: 'statistic',
        aggregation: 'aggregation', scoreOption: 'score option', fractionOfCells: 'Fraction of cells',
        fractionOfGenes: 'Fraction of genes', cellsShown: 'cells shown', notInAnyGroup: 'not in any group',
        smallGroup: 'small group', noValue: 'no value', split: 'split'
    };
    for (const [key, word] of Object.entries(concepts)) assert.equal(V.word[key], word, key);
    assert.deepEqual([V.plural.factor, V.plural.level, V.plural.group, V.plural.grouping],
        ['factors', 'levels', 'groups', 'groupings']);
    assert.ok(V.never.factor.includes('partitioning') && V.never.level.includes('class') && V.never.group.includes('cluster'));
    assert.ok(V.never.statistic.includes('metric') && V.never.noValue.includes('NaN') && V.never.cellsShown.includes('visible'));
});

test('a concept\'s own word is never on its own list of forbidden words', () => {
    for (const [concept, words] of Object.entries(V.never)) {
        assert.ok(V.word[concept], `${concept} has a word`);
        assert.ok(!words.map((w) => w.toLowerCase()).includes(V.word[concept].toLowerCase()), concept);
    }
});

test('count agrees with the number', () => {
    assert.equal(V.count(1, 'group'), '1 group');
    assert.equal(V.count(28, 'group'), '28 groups');
    assert.equal(V.count(0, 'factor'), '0 factors');
    assert.equal(V.count(1204, 'level'), '1,204 levels');
});

test('the level and bin phrases of SHR-9', () => {
    const P = V.phrase;
    assert.equal(P.smallGroups(10), 'Small groups (under 10 cells)');
    assert.equal(P.other('sample'), 'sample other');
    assert.equal(P.noValue('sample'), 'sample no value');
    assert.equal(P.zero('CD3E'), 'CD3E = 0');
    assert.equal(P.equals('CD3E', '1.2'), 'CD3E = 1.2');
    assert.equal(P.inTable('Table 1'), 'in Table 1');
    assert.equal(P.notInTable('Table 1'), 'not in Table 1');
    assert.equal(P.negated('is_doublet'), 'not is_doublet');
    assert.equal(P.qualified('treated', 'yes'), 'treated=yes');
    assert.equal(P.below('CD3E', '0.5'), 'CD3E < 0.5');
    assert.equal(P.between('CD3E', '0.5', '1.75'), 'CD3E 0.5 to 1.75');
    assert.equal(P.atLeast('CD3E', '1.75'), 'CD3E ≥ 1.75');
    assert.equal(P.positiveBelow('CD3E', '0.41'), '0 < CD3E < 0.41');
    assert.equal(P.suffixed('T cell', 2), 'T cell (2)');
});

test('no other module of this step writes an interface word as a literal', () => {
    const forbidden = ['no value', 'not in ', 'Small groups', ' other', '≥', '≤', ' to ', '(under', 'not in any group', 'small group'];
    const strings = /(['"`])(?:\\.|(?!\1)[^\\\n])*\1/g;
    for (const file of ['level-id.js', 'binning.js', 'cell-grouping.js']) {
        const source = fs.readFileSync(path.join(UTILS, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        for (const literal of source.match(strings) || []) {
            for (const word of forbidden) {
                assert.ok(!literal.toLowerCase().includes(word.toLowerCase()), `${file} writes ${literal}, which belongs in vocabulary.js`);
            }
        }
    }
});

test('every VOCABULARY.sourceType key is read somewhere (a label nothing shows is removed, G-SRC)', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { VOCABULARY } = await import('../../../static/js/utils/vocabulary.js');
    const root = new URL('../../../static/js/', import.meta.url).pathname;
    const files = [];
    const walk = (dir) => {
        for (const name of readdirSync(dir)) {
            if (name === 'vendor') continue;
            const path = join(dir, name);
            if (statSync(path).isDirectory()) walk(path); else if (name.endsWith('.js') && !path.endsWith('utils/vocabulary.js')) files.push(path);
        }
    };
    walk(root);
    const source = files.map((f) => readFileSync(f, 'utf8')).join('\n');
    for (const key of Object.keys(VOCABULARY.sourceType)) {
        assert.ok(new RegExp(`sourceType\\.${key}\\b`).test(source), `VOCABULARY.sourceType.${key} is read by no module`);
    }
});
