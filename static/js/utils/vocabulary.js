/**
 * The interface words of Cell Grouping, the Cell-Gene Plot and the count plot, in one place (UX 6.1).
 *
 * Every later step reads a word, a plural or a phrase from here and writes none as a literal, so a change of word is
 * one edit and the table of UX 6.1 has one home. Product strings use US spelling.
 *
 * `word` is the word for each concept, `plural` its plural, `never` the words the same table forbids for it (a test
 * checks that no word of `word` is on any such list). `phrase` builds the level and bin labels of SHR-9, so
 * the text of a label is not assembled anywhere else.
 */

const word = Object.freeze({
    factor: 'factor',
    level: 'level',
    group: 'group',
    grouping: 'grouping',
    set: 'set',
    statistic: 'statistic',
    aggregation: 'aggregation',
    scoreOption: 'score option',
    percentExpressing: '% expressing',
    fractionDetected: 'fraction detected',
    cellsShown: 'cells shown',
    notInAnyGroup: 'not in any group',
    smallGroup: 'small group',
    noValue: 'no value',
    split: 'split'
});

const plural = Object.freeze({
    factor: 'factors',
    level: 'levels',
    group: 'groups',
    grouping: 'groupings',
    set: 'sets',
    statistic: 'statistics',
    aggregation: 'aggregations',
    scoreOption: 'score options'
});

/** For each concept, the words the interface must never use for it. */
const never = Object.freeze({
    factor: Object.freeze(['partitioning', 'split', 'key']),
    level: Object.freeze(['partition', 'class']),
    group: Object.freeze(['cluster', 'subset', 'cell set']),
    grouping: Object.freeze(['cell set', 'clustering']),
    set: Object.freeze(['factor']),
    statistic: Object.freeze(['measure', 'metric']),
    aggregation: Object.freeze(['statistic']),
    scoreOption: Object.freeze(['statistic']),
    percentExpressing: Object.freeze(['fraction expressing']),
    cellsShown: Object.freeze(['visible', 'selected cells']),
    notInAnyGroup: Object.freeze(['other', 'excluded']),
    smallGroup: Object.freeze(['Other']),
    noValue: Object.freeze(['NA', 'NaN'])
});

/** The label of a level or a bin, from the name of its source and what it holds (SHR-9). */
const phrase = Object.freeze({
    smallGroups: (threshold) => `Small groups (under ${threshold} cells)`,
    other: (name) => `${name} other`,
    noValue: (name) => `${name} ${word.noValue}`,
    zero: (name) => `${name} = 0`,
    equals: (name, value) => `${name} = ${value}`,
    inTable: (title) => `in ${title}`,
    notInTable: (title) => `not in ${title}`,
    negated: (name) => `not ${name}`,
    qualified: (name, label) => `${name}=${label}`,
    below: (name, x) => `${name} < ${x}`,
    between: (name, lo, hi) => `${name} ${lo} to ${hi}`,
    atLeast: (name, x) => `${name} ≥ ${x}`,
    positiveBelow: (name, x) => `0 < ${name} < ${x}`,
    suffixed: (name, n) => `${name} (${n})`
});

/**
 * The words of the Cell-Gene Plot's values (UX 3.2 to 3.3): statistic names, the scale select and the titles it gives
 * a colour bar, the two lists of a gene-set row's aggregations, and the words of the CSV export.
 */
const cellGene = Object.freeze({
    statistic: Object.freeze({
        mean: 'Mean',
        pct_expressing: '% expressing',
        mean_expressing: 'Mean of expressing cells',
        sum: 'Sum',
        sd: 'SD',
        count: 'Cell count'
    }),
    /** The Scale select's options. */
    scaling: Object.freeze({
        none: 'None',
        var: '0 to 1 per gene',
        group: '0 to 1 per group',
        z_groups: 'z-score per gene, across groups',
        z_pooled: 'z-score per gene, against all grouped cells'
    }),
    /** What a colour bar or a CSV header says of the scaling. */
    scaled: Object.freeze({
        none: 'not scaled',
        var: 'scaled 0 to 1 per gene',
        group: 'scaled 0 to 1 per group',
        z_groups: 'z-score per gene, across groups',
        z_pooled: 'z-score per gene, against all grouped cells'
    }),
    aggregationHeading: Object.freeze({ summary: 'From the genes', score: 'From the score' }),
    /** The summaries' menu labels; a score kind's label is built from the score option by `aggregationOf`. */
    aggregation: Object.freeze({
        mean_of_means: "Mean of the genes' means",
        sum_of_means: "Sum of the genes' means",
        mean_of_zscores: "Mean of the genes' z-scores",
        mean_of_pct_expressing: "Mean of the genes' % expressing"
    }),
    aggregationHelp: Object.freeze({
        mean_of_means: "Each gene's mean in the group, averaged over the genes. Reads the genes once.",
        sum_of_means: "Each gene's mean in the group, added up.",
        mean_of_zscores: "Each gene's group mean as a z-score against all grouped cells, averaged.",
        mean_of_pct_expressing: "Each gene's % expressing in the group, averaged; 0 to 100.",
        score_mean: 'The signature\'s score for each cell, averaged over the group, as a cell plot colored by it would average. Computes the score.',
        score_pct_above: 'Share of the group\'s cells whose score is above the threshold; 0 to 100.'
    }),
    /** The label of a score kind for one score option, e.g. `z-score mean · X`. */
    scoreAggregation: Object.freeze({
        score_mean: (option) => `${option}, averaged`,
        score_pct_above: (option) => `% of cells with ${option} above`
    }),
    noExpressingCells: 'no expressing cells',
    csv: Object.freeze({ section: 'Section', row: 'Row', group: 'Group', cells: 'Cells', note: 'Note' })
});

/** "1 group", "28 groups", "1,204 levels". `noun` is a key of `word` that has a plural. */
function count(n, noun) {
    return `${n.toLocaleString('en-US')} ${n === 1 ? word[noun] : plural[noun]}`;
}

export const VOCABULARY = Object.freeze({ word, plural, never, phrase, count, cellGene });
