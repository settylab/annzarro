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
 * The words of the Cell Count Plot (UX 4.1 to 4.5): its modes, the labels of its rows, the entries of Height and Color,
 * the titles a value axis and a hover take, and the CSV headers. `count`, `fill`, `hoverCount`, `hoverShare`, `share`,
 * `measure` and `topLevel` are what panels/cell-count/draw.js reads as its `words`. (`measure` is the code's name for a
 * statistic of a per-cell source; the interface says "statistic".)
 */
const countPlot = Object.freeze({
    count: 'Cells',
    fill: '% of cells in each bar',
    hoverCount: 'Cells',
    hoverShare: 'Share',
    /** A value axis of shares, by its base (plan 1.6 share bases), with the inputs' names. */
    share: (base, names = {}) => {
        switch (base) {
            case 'x': case 'column': return `% within each ${names.x || 'X'}`;
            case 'split': return `% within each ${names.split || 'color'}`;
            case 'row': return `% within each ${names.y || 'Y'}`;
            default: return `% of ${word.cellsShown}`;
        }
    },
    /** A value axis of a statistic of a source ("Mean of Mrpl15 · logged_counts"). */
    measure: (stat, source, above) => {
        switch (stat) {
            case 'sum': return `Sum of ${source}`;
            case 'pct_above': return `% of cells with ${source} above ${above === undefined ? 0 : above}`;
            case 'sd': return `SD of ${source}`;
            case 'zscore': return `z-score of ${source}`;
            default: return `Mean of ${source}`;
        }
    },
    topLevel: (name) => `Most frequent ${word.level} of ${name}`,
    csv: Object.freeze({ count: 'Cells', share: 'Share', measure: capital(word.statistic) }),
    /** The Mode select: its groups in order, each with its modes (UX 4.1). */
    modeGroups: Object.freeze([
        Object.freeze({ label: 'Counts', modes: Object.freeze(['bar', 'histogram', 'pie']) }),
        Object.freeze({ label: 'Two inputs', modes: Object.freeze(['hist2d', 'heatmap']) }),
        Object.freeze({ label: 'Smoothed', modes: Object.freeze(['density', 'density2d']) }),
        Object.freeze({ label: 'Sets', modes: Object.freeze(['venn', 'upset']) })
    ]),
    modes: Object.freeze({
        bar: 'Bar', histogram: 'Histogram', pie: 'Pie', hist2d: '2D histogram', heatmap: 'Heatmap',
        density: 'Density', density2d: '2D density', venn: 'Venn', upset: 'UpSet'
    }),
    /** The labels of the rows (UX 4.1); a pie's X is its slices. */
    rows: Object.freeze({
        mode: 'Mode', x: 'X', y: 'Y', split: 'Color by', slices: 'Slices', height: 'Height', color: 'Color', labels: 'Labels',
        sets: capital(plural.set), factor: 'Of', source: 'Of', above: 'Above'
    }),
    arrangement: Object.freeze({ stack: 'Stacked', dodge: 'Side by side', fill: '100%', overlay: 'Overlaid' }),
    /** The entries of Height and Color (UX 4.5), and the help line of each. */
    value: Object.freeze({
        count: 'Count',
        share: Object.freeze({
            all: `Share of all ${word.cellsShown}`, x: 'Share within each X', split: 'Share within each color',
            row: 'Share of the row', column: 'Share of the column', total: 'Share of the total'
        }),
        stat: Object.freeze({ mean: 'Mean of…', sum: 'Sum of…', pct_above: '% above…', sd: 'SD of…', zscore: 'z-score of…' }),
        topLevel: `Most frequent ${word.level} of…`,
        groups: Object.freeze({ share: 'Share', stat: capital(word.statistic) })
    }),
    valueHelp: Object.freeze({
        count: 'Cells in the bar.',
        countColor: 'Cells in the rectangle.',
        share: 'As percent.',
        heatmapShare: 'As percent: of the row, of the column, of the total.',
        stat: 'A statistic of the source below, over the cells of the bar.',
        zscore: "The bar's mean against all counted cells.",
        topLevel: `Colors each rectangle by its commonest ${word.level}.`
    }),
    labels: Object.freeze({ none: 'None', count: 'Count', share: 'Share', measure: capital(word.statistic) }),
    buttons: Object.freeze({
        sort: 'Sort by height', reverse: 'Reverse', horizontal: 'Horizontal', options: 'Plot Options', ring: 'Ring', log: 'Log count axis',
        fade: 'Fade by its share', csv: 'Download CSV', chooseLevels: `Choose ${plural.level}`, undo: 'Undo'
    }),
    /** The inputs a mode does not read, still stored (CNT-6, UX 4.2). */
    kept: (items) => `Kept for other modes: ${items.join(' · ')}`,
    /** The compact binning line of a numeric input (UX 4.4). */
    bins: (parts) => `Bins: ${parts.join(' · ')}`,
    empty: Object.freeze({ choose_x: 'Choose X to count cells.', choose_y: 'Choose Y to count cells.', choose_sets: `Add two or more ${plural.set}.` }),
    needsNumeric: (mode, input, name) => `${mode} needs a numeric ${input}. ${name} is categorical.`,
    tooManySets: 'Venn shows 2 or 3 sets.',
    notDrawn: (mode) => `${mode} is not available in this build.`,
    counting: (n) => `Counting ${n.toLocaleString('en-US')} cells…`
});

/**
 * What a notice says while a computation waits or runs (SHR-47, SHR-48, UX 3.5): the server's place for it and the
 * time left. The page never names whose a job ahead is unless it is its own; these are the fallback sentences.
 */
const progress = Object.freeze({
    ahead: (n) => `Waiting for the server: ${n.toLocaleString('en-US')} ${n === 1 ? 'computation' : 'computations'} ahead.`,
    sharing: (n) => `Sharing the server with ${n.toLocaleString('en-US')} other ${n === 1 ? 'computation' : 'computations'}.`,
    left: (duration, sharing) => `${duration} left${sharing ? ' while sharing' : ''}`,
    keepWorking: `${capital(plural.grouping)} and counts keep working.`
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

export const VOCABULARY = Object.freeze({ word, plural, never, phrase, count, cellGene, countPlot, progress, reasons });
