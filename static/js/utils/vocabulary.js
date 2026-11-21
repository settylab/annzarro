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

const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1);

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
    suffixed: (name, n) => `${name} (${n})`,
    /** The palette that is a source's own colours: "The grouping's colors". */
    ownColors: (thing) => `The ${thing}'s colors`,
    /** A grouping that cannot be computed yet: "'Grouping 3' has no factors yet." */
    noFactors: (name) => `${name} has no ${plural.factor} yet.`
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

/**
 * What a notice says while a computation waits or runs (SHR-47, SHR-48, UX 3.5): the server's place for it and the
 * time left. The page never names whose a job ahead is unless it is its own; these are the fallback sentences.
 */
const progress = Object.freeze({
    ahead: (n) => `Waiting for the server: ${n.toLocaleString('en-US')} ${n === 1 ? 'computation' : 'computations'} ahead.`,
    sharing: (n) => `Sharing the server with ${n.toLocaleString('en-US')} other ${n === 1 ? 'computation' : 'computations'}.`,
    left: (duration, sharing) => `${duration} left${sharing ? ' while sharing' : ''}`,
    keepWorking: `${capital(plural.grouping)} and counts keep working.`,
    // a control that waits for the page to finish starting before it acts (a panel set's Load)
    loading: 'Loading…'
});

/**
 * The sentence a notice says for a reason the server gives (the engine's limits, E6a's route, E6b's busy wait), and
 * whether trying again can help: a limit gives the same answer every time, so it offers no Retry.
 */
const reasons = Object.freeze({
    too_many_measures: Object.freeze({ retry: false,
        text: `It asks for more ${plural.statistic} at once than one computation takes. Use fewer ${plural.statistic}.` }),
    too_many_thresholds: Object.freeze({ retry: false,
        text: 'It compares one gene with more thresholds than one computation takes. Use fewer thresholds for that gene.' }),
    range_too_wide: Object.freeze({ retry: false,
        text: 'Its values span more than a number can hold, so no bin width fits. Set a range, or leave out the extreme values.' }),
    unsupported_column: Object.freeze({ retry: false,
        text: 'It reads a column whose values are not numbers, categories or text (dates, for example). Use another column.' }),
    too_many_values: Object.freeze({ retry: false,
        text: `It asks for too many values at once (${plural.group} times genes and ${plural.statistic}). Use fewer ${plural.group} or fewer genes.` }),
    too_many_partitionings: Object.freeze({ retry: false,
        text: `It has more ${plural.factor} than a ${word.grouping} holds. Remove a ${word.factor}.` }),
    obsp_too_large: Object.freeze({ retry: false,
        text: 'A row of an obsp matrix can be a source for up to 1M cells. Use a subset of up to 1M cells, or an obs or obsm column.' }),
    set_length_mismatch: Object.freeze({ retry: true,
        text: `A ${word.set} no longer matched the ${word.cellsShown}; they changed while it was sent. Try again.` }),
    read_busy: Object.freeze({ retry: true,
        text: 'The server was busy with other computations and could not start this one in time. Try again in a moment.' })
});

/** "1 group", "28 groups", "1,204 levels". `noun` is a key of `word` that has a plural. */
function count(n, noun) {
    return `${n.toLocaleString('en-US')} ${n === 1 ? word[noun] : plural[noun]}`;
}

export const VOCABULARY = Object.freeze({ word, plural, never, phrase, count, cellGene, progress, reasons });
