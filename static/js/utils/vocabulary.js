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
const fmt = (n) => Number(n).toLocaleString('en-US');

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
        zscore_mean: 'Z-score mean',
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
    /** Why a Scale option is disabled under a Color that is already a z-score (aggregation-unify-080, 2.2). */
    scaleWhy: Object.freeze({ zscore: 'Color is already a z-score.' }),
    /** What a statistic's values are in (a colour bar's second line, a hover). Only a z-score has one of its own. */
    unit: Object.freeze({ zscore_mean: 'SD' }),
    /** Said once when a link, or a change of Color, takes the Scale away (the colour is a z-score already). */
    scaleMoved: (was) => `Scale changed to None: Color is already a z-score, so ${was} would draw the same picture again.`,
    /** A gene with no spread over the dataset has no z-score. */
    constantGene: 'constant over all cells: no z-score',
    /** What the Size and Gene Plot lists say of z-score mean (consumers that cannot show it). */
    zscoreCannot: Object.freeze({
        size: 'Z-score mean is signed; dot size cannot show a sign. Use it for Color.',
        genes: 'Z-score mean of a cell group is not available in the Gene Plot yet: it needs every gene\'s mean and SD over all cells.',
        genesLayout: 'Z-score mean of a cell group needs a whole-layer read on this store\'s layout; coming with the moments cache.',
        table: 'Z-score mean is for cell groups; a table\'s cells are not yet scaled against the whole layer.',
        genesLayoutUnknown: 'Z-score mean of a cell group is offered once the layer\'s storage layout is known.'
    }),
    /** What a colour bar or a CSV header says of the scaling. */
    scaled: Object.freeze({
        none: 'not scaled',
        var: 'scaled 0 to 1 per gene',
        group: 'scaled 0 to 1 per group',
        z_groups: 'z-score per gene, across groups',
        z_pooled: 'z-score per gene, against all grouped cells'
    }),
    /**
     * The words of a one-row section's values (aggregation-unify-080.md 11): the set as one gene, by the rule of each
     * channel's statistic (cell-gene-model.js ROW_RULE).
     */
    rowStep: Object.freeze({
        name: Object.freeze({ rows_mean: 'Mean of the gene rows', rows_sum: 'Sum of the gene rows' }),
        /** A score where the step is named on its own (the CSV, the hover): "z-score mean score". */
        score: (method) => `${method} score`,
        /** Under % expressing the set is the share of cells expressing at least one gene (aggregation-unify-080.md 10.1a). */
        anyGeneHow: 'any gene',
        anyGene: (title, up, down, t, layer) => `% of cells expressing at least one of ${title}'s ${up} ${down > 0 && up > 0 ? 'up ' : ''}genes (> ${t}) \u00b7 ${layer}`,
        /** What a one-row section shows under each statistic, for its tooltip (the rule of cell-gene-model.js ROW_RULE). */
        reading: Object.freeze({
            mean: "the mean of the genes' means", zscore_mean: 'the z-score mean score of the set', pct_expressing: '% of cells expressing at least one gene',
            mean_expressing: "the mean of the genes' means over their expressing cells", sum: "the sum of the genes' sums", sd: "the mean of the genes' SDs",
            count: "the group's size", downMean: "the signature's mean score (up minus down)"
        }),
        /** The cell step of a score, in the legend. */
        cells: Object.freeze({
            zscore_mean: () => 'mean', mean: () => 'mean', sum: () => 'sum', sd: () => 'SD'
        }),
        /** The legend's and hover's name of a row's quantity: the two steps, in the order they are taken. */
        quantity: Object.freeze({
            rows: (stat, how) => `cells: ${stat}; genes: ${how}`,
            score: (method, cells) => `genes: ${method}; cells: ${cells}`
        }),
        how: Object.freeze({ rows_mean: 'mean', rows_sum: 'sum' })
    }),
    noExpressingCells: 'no expressing cells',
    /** A size legend whose dots are drawn smaller than the plot's, to fit their slot: 1 to `n` (draw.js sizeLegendParts). */
    legendScaled: (n) => `(legend scaled 1:${n})`,
    csv: Object.freeze({ section: 'Section', row: 'Row', group: 'Group', cells: 'Cells', note: 'Note',
        genesCombined: Object.freeze({ color: 'Color: genes combined by', size: 'Size: genes combined by' }) }),
    /** The 3D view (UX 6b, WP-12): the toggle, the Height measure, the scene's axes, the strip and the export. */
    view3d: Object.freeze({
        button: '3D',
        buttonHelp: 'Show the matrix as 3D bars: height and color, and in dots the footprint area for Size.',
        buttonOnHelp: 'Back to the 2D plot.',
        height: 'Height',
        sameAsColor: 'Same as Color',
        heightAsColor: 'Height: as Color',
        heightHelp: 'Same as Color draws the colors\' numbers, scaling included. A statistic of its own is drawn unscaled.',
        genes: 'Genes',
        groups: 'Groups',
        tag: '3D',
        leftOut: '3D does not draw dendrograms, strips, section brackets, totals or printed values.',
        offTag: '2D',
        resetCamera: 'Reset camera',
        svgOff: '3D exports as an image only.',
        /** Plot Options ▸ 3D labels: where the gene and group names stand, and which way they run. */
        labels: Object.freeze({
            heading: '3D labels',
            side: 'Side',
            sides: Object.freeze({ auto: 'Auto', fixed: 'Fixed' }),
            justify: 'Justify',
            justifies: Object.freeze({ auto: 'Auto', left: 'Left', right: 'Right', center: 'Center' }),
            rotation: 'Rotation',
            rotations: Object.freeze({ horizontal: 'Horizontal', along: 'Along the axis', across: 'Across the axis', angle: 'Angle' }),
            angle: 'Angle (°, clockwise)',
            padding: 'Padding (px)',
            sideHelp: 'Auto puts the gene and group names on the edges nearer you as the plot turns; Fixed keeps the edges they are on now.',
            help: 'Side Auto puts the names on the edges nearer you as the plot turns; Fixed keeps the edges they are on now. '
                + 'Justify Auto runs each name outward from the bars. Rotation Along the axis tilts the names with their edge as '
                + 'the plot turns. Padding is the gap between a name and its tick.'
        })
    }),
    /** What a narrow plot gave up so the matrix keeps its columns readable (panels/cell-gene/draw.js fitMatrix): the strip. */
    narrow: Object.freeze({
        tag: 'Narrow',
        totals: 'Totals hidden at this width.',
        dendrogram: "The groups' dendrogram hidden at this width.",
        legend: 'Legends narrowed at this width.'
    }),
    /**
     * Cluster ▾ and Plot Options (UX 3.1, 3.3, 3.4; panels/cell-gene/options.js): the menus' labels, the clustering's
     * sentences (CXG-24, CXG-25, Q2) and the scaling's help lines.
     */
    options: Object.freeze({
        cluster: 'Cluster ▾',
        plotOptions: 'Plot Options',
        clusterGenes: 'Cluster genes',
        clusterGroups: 'Cluster groups',
        off: 'Off',
        withinSections: 'Within sections',
        all: 'All',
        within: (factor) => `Within ${factor}`,
        summary: (linkage, distance) => `${linkage} linkage, ${distance}, on the values as displayed.`,
        /** The Linkage select's entries, and the linkage as the summary names it. */
        linkage: Object.freeze({ complete: 'complete', average: 'average', ward: 'Ward (Euclidean distance only)' }),
        linkageName: Object.freeze({ complete: 'Complete', average: 'Average', ward: 'Ward' }),
        distance: Object.freeze({ correlation: 'Pearson correlation', euclidean: 'Euclidean' }),
        wardSwitched: 'Ward needs Euclidean distance, so Distance is now Euclidean.',
        wardOnly: 'Ward needs Euclidean distance.',
        undo: 'Undo',
        leftOut: (n, noun) => `${fmt(n)} ${n === 1 ? noun : `${noun}s`} not clustered: too few values in common, or constant. They are at the end.`,
        /** The status strip's tag when the clustering left rows or groups out; its pop-over gives the sentences. */
        notClusteredTag: 'Partly clustered',
        tooMany: (title, n, limit) => `Not clustered: ${title} has ${fmt(n)} rows; clustering stops at ${fmt(limit)}.`,
        heading: Object.freeze({
            dots: 'Dots', colors: 'Colors', sections: 'Sections', labels: 'Labels', clustering: 'Clustering', legend: 'Legend', totals: 'Totals'
        }),
        /** Plot Options ▸ Dots: the largest dot as a share of its cell, the smallest in px. */
        largestDotOfCell: 'Largest dot (% of cell)',
        smallestDotPx: 'Smallest dot (px)',
        /** Largest dot of a link saved before the dots filled their cells: its px, until the slider is moved. */
        largestPx: (px) => `${fmt(px)} px (saved)`,
        rangeWhat: Object.freeze({ color: 'Color', size: 'Size', height: 'Height' }),
        sizeMin: 'Size min',
        sizeMax: 'Size max',
        outlineColor: 'Dot outline color',
        outlineWidth: 'Dot outline width (px)',
        dotOpacity: 'Dot opacity',
        colorScale: 'Color scale',
        min: 'Min',
        max: 'Max',
        center: 'Center',
        centerDiverging: 'A center applies to a diverging color scale.',
        printValues: 'Print values in cells',
        gap: 'Gap between sections',
        gapUnit: 'cell',
        sectionTitles: 'Show section titles',
        geneLabels: 'Gene labels',
        groupLabels: 'Group labels',
        plotTitle: 'Plot title',
        colorTitle: 'Color bar title',
        sizeTitle: 'Size legend title',
        linkageLabel: 'Linkage',
        distanceLabel: 'Distance',
        dendrograms: 'Dendrograms',
        colorBar: 'Color bar',
        sizeLegend: 'Size legend',
        strips: 'Strip legend',
        totals: 'Cells per group',
        /** The band of each group in its own colour, beside the factors' strips, and its switch in Plot Options. */
        groupBand: 'Group',
        colorStrips: 'Color strips',
        colorStripsChoice: Object.freeze({ factors: 'Factors', group: 'Group', none: 'None' }),
        sortGroups: 'Sort groups by size',
        scalingNote: 'Groups with no value are skipped; a constant gene gives 0.',
        pooledNote: 'A one-row section has no pooled cells of its own, so it is z-scored across its own groups.',
        csv: 'Download CSV',
        /** The strips' legend, past the levels it has room for. */
        more: (n) => `+ ${fmt(n)} more`,
        // 0.8.0 WP-2: Cluster ▾, Color ▾ and Plot Options as pop-overs (design note options-ux-080, decisions c to g)
        colorMenu: 'Color ▾',
        popoverTitle: Object.freeze({ cluster: 'Cluster', color: 'Color', plotOptions: 'Plot Options' }),
        reverse: 'Reverse',
        dendrogramGenes: 'Genes',
        dendrogramGroups: 'Groups',
        exportHeading: 'Export',
        resetColor: 'Reset',
        resetColorHelp: 'The color scale, its direction and range, and the dot sizes go back to their defaults.'
    }),
    /**
     * What the plot says in each of its states (UX 3.5; SHR-27, SHR-32, SHR-47, SHR-48, CXG-17, CXG-19, CXG-27):
     * panels/cell-gene/states.js words its notices, its checklist and its strip with these alone. No string names a
     * command (N3).
     */
    states: Object.freeze({
        checklist: Object.freeze({
            label: 'To draw this plot', groups: 'Choose groups', genes: 'Add genes', groupsButton: 'Groups ▾', genesButton: 'Add genes ▾'
        }),
        genes: (n) => `${n.toLocaleString('en-US')} ${n === 1 ? 'gene' : 'genes'}`,
        rows: (n) => `${n.toLocaleString('en-US')} ${n === 1 ? 'row' : 'rows'}`,
        million: 'million',
        billion: 'billion',
        grouping: (cells) => `Grouping ${cells} cells…`,
        reading: (genes, done, total) => `Reading ${genes}${total > 0 ? `: ${done.toLocaleString('en-US')} of ${total.toLocaleString('en-US')}` : ''}`,
        waiting: 'Waiting for the server.',
        waitingFor: (title) => `Waiting for ${title} to finish.`,
        held: (edits, duration) => `Showing the previous plot. ${edits === 1 ? '1 change' : `${edits.toLocaleString('en-US')} changes`} not applied.` +
            `${duration ? ` ${duration.charAt(0).toUpperCase()}${duration.slice(1)}.` : ''}`,
        ask: (genes, cells, duration, values) => `Reading ${genes} over ${cells} cells: up to ${duration} (${values} stored values).`,
        refusedCost: (duration) => `Would take ${duration}, so it was not run.`,
        costWayOut: 'Use fewer genes, a smaller subset, or a layer stored by gene (CSC).',
        refusedCsr: (layer, genes, n, duration) => `${layer} is stored by cell (CSR), so ${genes} ${n === 1 ? 'means' : 'mean'} reading the whole matrix: ${duration}.`,
        csrWayOut: 'A copy of the layer stored by gene (CSC) makes this fast; see the documentation.',
        tooLarge: (groups, rows, cells, limit) => `${groups} × ${rows} = ${cells} cells of the matrix; the limit is ${limit}.`,
        tooLargeWayOut: 'Remove a section or use fewer groups.',
        oneCell: `One cell per group: ${word.percentExpressing} is 0 or 100.`,
        failed: (reason) => `Could not be computed: ${reason}.`,
        noAnswer: 'the server stopped responding',
        matrix: (groups, rows) => `${groups} × ${rows}`,
        noValue: (n) => `${n.toLocaleString('en-US')} ${n === 1 ? 'cell of the matrix has' : 'cells of the matrix have'} ${word.noValue}`,
        buttons: Object.freeze({
            compute: 'Compute', fewer: 'Fewer genes', update: 'Update', retry: 'Retry', heatmap: 'Show as Heatmap',
            cancel: (sharers) => (sharers > 1 ? `Cancel for ${sharers} plots` : 'Cancel')
        }),
        tags: Object.freeze({
            computing: 'Computing…', queued: 'Plot queued', awaiting: 'Not computed', refused: 'Plot refused', tooLarge: 'Too large',
            failed: 'Plot failed', held: 'Out of date', noSize: 'No size', notDrawn: 'Not drawn'
        }),
        /** Plotly threw while drawing: the figure is cleared and the next change draws it afresh. */
        notDrawn: (why) => `The plot could not be drawn (${why}). Change a setting to draw it again.`
    }),
    /**
     * Color and Size sources (WP-4, FB-2a, decision 31): each measure's `statistic of layer above threshold`, every
     * statistic and layer listed, and the limit counted in values (finding 9).
     */
    sources: Object.freeze({
        of: 'of',
        above: 'above',
        threshold: 'expressed above',
        thresholdHelp: 'A cell counts as expressing above this value.',
        /**
         * The threshold box on a grouping axis (decision 35): empty follows the grouping's Expressed above, shown as the
         * placeholder; a typed value overrides it for this plot.
         */
        thresholdAuto: (value) => `auto (grouping: ${value})`,
        thresholdFollows: (title, value) => `Follows ${title}'s Expressed above (${value}). Type a value to override it for this plot.`,
        thresholdOverrides: (title, value) => `Overrides ${title} (above ${value}). Clear to follow it.`,
        /** "3 genes on 2 layers": genes (in words) read on `n` layers, or at `n` thresholds. */
        geneReads: (genes, n, cause) => (cause === 'layers' ? `${genes} on ${n} layers` : cause === 'thresholds' ? `${genes} at ${n} thresholds` : genes),
        tooManyValues: (groups, features, values, limit) => `${groups} × ${features} = ${values} values; the limit is ${limit}.`,
        features: (n) => `${n.toLocaleString('en-US')} ${n === 1 ? 'value per group' : 'values per group'}`,
        readTwice: Object.freeze({
            layers: (n) => `Color and Size read different layers, so each gene is read ${n === 2 ? 'twice' : `${n} times`}.`,
            thresholds: (n) => `Color and Size use different thresholds, so each gene is read ${n === 2 ? 'twice' : `${n} times`}.`
        }),
        tooManyValuesWayOut: 'Remove a section, use fewer groups, or read Color and Size on one layer.'
    })
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
    arrangement: Object.freeze({ stack: 'Stacked', dodge: 'Side by side', overlay: 'Overlaid', fill: '100%' }),
    /** Why an arrangement does not apply (its title, where it is disabled). */
    arrangementRefused: Object.freeze({
        dodgeBins: 'Bins of a number cannot sit side by side. Overlaid shows each level over the others.'
    }),
    /** Why a view cannot draw the X (the Mode select's title of a disabled view). */
    viewRefused: Object.freeze({ histogramNumeric: 'Histogram needs a numeric axis.' }),
    /** What a switch of view by the X axis type says, once. */
    viewSwitched: Object.freeze({
        toHistogram: 'A number as X: shown as Histogram. Bar shows its bins as categories.',
        toBar: 'Histogram needs a numeric axis: shown as Bar.',
        fallback: 'Histogram needs a numeric axis, so this plot is drawn as Bar.'
    }),
    /** The entries of Height and Color (UX 4.5), and the help line of each. */
    value: Object.freeze({
        none: 'None',
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
        none: 'One color for every bar.',
        countUpset: 'Each bar colored by its cells, on the color scale.',
        count: 'Cells in the bar.',
        countColor: 'Cells in the rectangle.',
        share: 'As percent.',
        heatmapShare: 'As percent: of the row, of the column, of the total.',
        stat: 'A statistic of the source below, over the cells of the bar.',
        zscore: "The bar's mean against all counted cells.",
        topLevel: `Colors each rectangle by its commonest ${word.level}.`
    }),
    labels: Object.freeze({ none: 'None', count: 'Count', share: 'Share', measure: capital(word.statistic) }),
    /** A Venn's own controls (next to a pie's Labels and Names): what its regions print, the set names, and area by count. */
    venn: Object.freeze({
        labels: Object.freeze({ both: 'Count and share', count: 'Count', share: 'Share', none: 'None' }),
        names: 'Names', namesTitle: 'Print each set\'s letter and name beside its circle (the whole name is in its hover)',
        area: 'Area reflects counts',
        areaTitle: 'Draw each circle\'s area in proportion to its set and each overlap\'s in proportion to the cells in both (exact for two sets, approximate for three; a region with no cells may vanish)'
    }),
    /** A pie's slices: their names, and their colours (continuous for bins of a number, the level palette for categories). */
    slices: Object.freeze({
        names: 'Names', namesTitle: 'Print each slice\'s name on it (a slice under 3% shows it in its hover only)',
        colours: 'Slice colors', continuous: 'Continuous', levels: 'Level palette',
        refused: 'Slices that are categories have no order to color by; bins of a number do.',
        byCentre: 'Slices take the color of their bin\'s center. The bar shows the numbers.',
        byOrder: 'These bins are drawn evenly (log, equal-count or manual), so slices take the color of their bin\'s order: each bin is one step.',
        barCentre: (name) => `${name} (bin center)`, barOrder: (name) => `${name} (bin order)`
    }),
    buttons: Object.freeze({
        sort: 'Sort by height', reverse: 'Reverse', horizontal: 'Horizontal', options: 'Plot Options', ring: 'Ring', log: 'Log count axis',
        fade: 'Fade by its share', csv: 'Download CSV', chooseLevels: `Choose ${plural.level}`, undo: 'Undo',
        adjust: 'Smoothing', bySize: 'Scale curves by level size'
    }),
    /**
     * The 3D view (UX 6b, WP-11): the toolbar's `3D` toggle, the Height row, why 3D is not offered, what the strip says and
     * Plot Options' 3D section.
     */
    view3d: Object.freeze({
        button: '3D',
        buttonHelp: 'Show the plot as 3D bars: the colors as they are, the height of each bar from its own source.',
        buttonOnHelp: 'Back to the 2D plot.',
        heightRow: '3D height',
        sameAs: (what) => `Same as ${what}`,
        heightHelp: 'Same as the color draws the color\'s numbers as heights. A count, a share or a statistic can be the height instead.',
        hoverHeight: 'Height',
        tag: '3D',
        offTag: '2D',
        leftOut: '3D does not draw printed values, a log count axis, horizontal bars, arrangements or the fade by share.',
        resetCamera: 'Reset camera',
        svgOff: '3D exports as an image only.',
        refused: Object.freeze({
            mode: '3D is for the 2D histogram, the heatmap and the bar plot with a Color by.',
            needSplit: '3D needs a Color by: the bars stand over X and Color by.',
            layers: 'A 2D histogram with a Color by is drawn in layers. 3D draws it without the Color by.'
        }),
        options: Object.freeze({
            section: '3D', footprint: 'Bar footprint (share of the cell)', lighting: 'Lighting', box: 'Axis box', zTitle: 'Height title'
        })
    }),
    /** The layers of a 2D density, each a box of Plot Options. */
    layers: Object.freeze({
        image: 'Density as opacity', imageOne: 'Density as color scale', lines: 'Isolines', fill: 'Filled isolines', points: 'Cell points',
        last: 'At least one layer stays on: with none, nothing would be drawn.'
    }),
    adjustProblem: 'Enter a number from 0.1 to 10.',
    /**
     * The Display pop-over (WP-6a, renamed: it holds how the data is drawn, not only its color): the colour map, Reverse, the
     * range (of the colour scale, or of a density), the palette of a Color by's levels, and the Cell points' size and opacity.
     */
    colour: Object.freeze({
        button: 'Display', title: 'Display', map: 'Map', reverse: 'Reverse', min: 'Min', max: 'Max', center: 'Center', auto: 'auto',
        densityRange: 'Density range', points: 'Cell points', pointSize: 'Size', pointOpacity: 'Opacity', pointFade: 'Density as opacity',
        palette: 'Level palette', paletteDefault: 'Default', reset: 'Reset',
        problem: 'Enter a number, or leave it empty for automatic.',
        centerNote: 'Center has no effect while both Min and Max are set.'
    }),
    /** The inputs a mode does not read, still stored (CNT-6, UX 4.2). */
    kept: (items) => `Kept for other modes: ${items.join(' · ')}`,
    /** The compact binning line of a numeric input (UX 4.4). */
    bins: (parts) => `Bins: ${parts.join(' · ')}`,
    empty: Object.freeze({ choose_x: 'Choose X to count cells.', choose_y: 'Choose Y to count cells.', choose_sets: `Add two or more ${plural.set}.` }),
    needsNumeric: (mode, input, name) => `${mode} needs a numeric ${input}. ${name} is categorical.`,
    tooManySets: 'Venn shows 2 or 3 sets.',
    notDrawn: (mode) => `${mode} is not available in this build.`,
    counting: (n) => `Counting ${n.toLocaleString('en-US')} cells…`,
    /** A plan refused before any request (UX 4.3): the count and the limit; `colorsAs` names a mode in "… colors up to". */
    limit: Object.freeze({
        levels: (name, n, mode, max) => `${name} has ${fmt(n)} ${plural.level}; ${mode} shows up to ${fmt(max)}.`,
        bins: (name, n, mode, max) => `${name} has ${fmt(n)} bins; ${mode} shows up to ${fmt(max)}.`,
        pair: (names, counts, mode, limits) => `${names[0]} × ${names[1]} is ${fmt(counts[0])} × ${fmt(counts[1])}; ${mode} shows up to ${fmt(limits[0])} × ${fmt(limits[1])}.`,
        colorBy: (name, n, mode, max) => `Color by ${name} has ${fmt(n)} ${plural.level}; ${mode} colors up to ${fmt(max)}.`,
        colorsAs: Object.freeze({ histogram: 'a histogram', density: 'a density', hist2d: '2D histogram', density2d: '2D density' }),
        sets: (mode, max) => `${mode} shows up to ${fmt(max)} ${plural.set}.`,
        grid: (mode, n, max) => `${mode} would count ${fmt(n)} cells of a grid; it counts up to ${fmt(max)}.`
    }),
    /** What a notice of the route's states calls a count (utils/source-notices.js `describeSource`). */
    notice: Object.freeze({
        thing: 'count', source: 'count', result: 'count', Computing: 'Counting', found: 'cells',
        act: Object.freeze({ to: 'count', ing: 'counting' }), computing: 'Counting…', off: 'Cell Count Plot is turned off on this server.'
    }),
    /** Choose levels when an input's levels, asked for alone, cannot be listed. */
    levelsList: Object.freeze({
        tooMany: (name, n, max) => `${name} has ${fmt(n)} ${plural.level} that hold a cell; Choose ${plural.level} lists up to ${fmt(max)}.`,
        notRead: (name, message) => `The ${plural.level} of ${name} could not be read${message ? `: ${String(message).replace(/[.\s]+$/, '')}` : ''}.`,
        retry: 'Retry'
    }),
    /** The way out of a refusal or of an input the mode cannot use (UX 4.2, 4.3). */
    wayOut: Object.freeze({ bin: 'Bin it', levels: `Choose ${plural.level}`, removeSplit: 'Remove Color by', showAs: (mode) => `Show as ${mode}` }),
    /** The status strip (CNT-22, UX 4.7), its parts joined by `join`. */
    strip: Object.freeze({
        counted: (n) => `${fmt(n)} cells counted`,
        noValue: (n, name) => `${fmt(n)} without a value for ${name}`,
        outside: (n) => `${fmt(n)} outside the range`,
        leftOut: (n) => `${fmt(n)} in ${plural.level} left out`,
        join: ' · '
    }),
    /** Save as grouping (CNT-7, UX 4.7). */
    saveGrouping: Object.freeze({
        button: `Save as ${word.grouping}`,
        title: `Save as ${word.grouping}`,
        factors: (names, groups) => `${capital(plural.factor)}: ${names.join(', ')}. ${count(groups, 'group')}.`,
        binned: (name, n) => `${name} (${fmt(n)} bins)`,
        clamp: (n) => `${n === 1 ? '1 cell' : `${fmt(n)} cells`} outside the range will go into the end bins (a ${word.grouping} keeps every cell).`,
        overGroups: (n, max) => `Would make ${fmt(n)} ${plural.group}; a ${word.grouping} holds up to ${fmt(max)}. Use fewer bins first.`,
        overBins: (name, n, max) => `${name} has ${fmt(n)} bins; a ${word.factor} of a ${word.grouping} holds up to ${fmt(max)}. Use fewer bins first.`,
        cancel: 'Cancel',
        save: 'Save'
    }),
    /** A 2D density drawn on the cell locations: the strip's notice and why it is refused. */
    points: Object.freeze({
        label: 'Cell points',
        all: (drawn, total) => `Cells drawn as points: ${drawn.toLocaleString('en-US')} of ${total.toLocaleString('en-US')}.`,
        sample: (drawn, loaded, total) => `Cells drawn as points: ${drawn.toLocaleString('en-US')} of a random sample of ${loaded.toLocaleString('en-US')} of the ${total.toLocaleString('en-US')} cells.`,
        tooMany: (total, limit) => `Cell points load the position of every cell, and ${total.toLocaleString('en-US')} cells are more than the ${limit.toLocaleString('en-US')} it takes. Turn on a subset to use them.`,
        source: (input) => (input === 'split' ? 'Cell points take a Color by that is an obs column of categories.'
            : `Cell points take the ${input.toUpperCase()} axis from an obs column, an embedding or a gene.`),
        loading: 'Loading cell locations…',
        failed: (why) => `Cell points could not be loaded: ${why}`
    }),
    /** A density's sentences (CNT-10, UX 4.4): in Plot Options and the strip. */
    density: Object.freeze({
        axis: 'Density',
        axisBySize: 'Density, scaled by level size',
        bandwidth: (hs, adjust, dims) => `Bandwidth ${hs.join(' and ')} (Scott's rule × ${adjust})${dims === 2 ? ', per axis; it ignores correlation between X and Y' : ''}.`,
        range: (outside) => `Range from the 0.1st to the 99.9th percentile: ${outside === 0 ? 'all cells are counted'
            : `${outside.toLocaleString('en-US')} ${outside === 1 ? 'cell outside is' : 'cells outside are'} not counted`}.`,
        floor: 'Bandwidth raised to the grid\'s resolution.'
    })
});

/** The sets of a Venn or UpSet (UX 4.6, CNT-5, CNT-12): the set list, Add set and an UpSet's own options. */
const countSets = Object.freeze({
    add: `Add ${word.set}`,
    /** The kinds Add set offers, in its order. */
    kinds: Object.freeze({
        table: 'Cell table…', boolean: 'Boolean column…', levels: 'Levels of a column…', condition: 'Condition on a number…',
        group: `${capital(word.group)} of a ${word.grouping}…`
    }),
    tooMany: (max) => `UpSet shows up to ${max} ${plural.set}.`,
    cells: (n) => `${n.toLocaleString('en-US')} cells`,
    noValue: (n) => `${n.toLocaleString('en-US')} without a value, counted as out`,
    universe: (shown, none) => `Universe: the ${shown.toLocaleString('en-US')} ${word.cellsShown}. ${none.toLocaleString('en-US')} are in no ${word.set}.`,
    /** A set's row text when it has no name of its own. */
    levels: (column, labels) => `${column} is ${labels.join(', ')}`,
    /** The comparisons of a condition, as a row writes them. */
    ops: Object.freeze({ '>': '>', '>=': '≥', '<': '<', '<=': '≤' }),
    condition: (name, op, value, layer) => `${name} ${op} ${value}${layer ? ` (${layer})` : ''}`,
    group: (grouping, name) => `${grouping}: ${name}`,
    follows: '(follows the bin)',
    deleted: 'deleted',
    choose: 'Choose…',
    computingGroups: `Computing ${plural.group}…`,
    noGroups: `No ${plural.group} yet.`,
    tooManyCategories: (n, max) => `${n.toLocaleString('en-US')} categories; a ${word.set} picks from up to ${max.toLocaleString('en-US')}. Use a condition or a ${word.grouping}.`,
    needsNumber: 'Choose a numeric source.',
    needsValue: 'Enter a number.',
    buttons: Object.freeze({
        more: `More for this ${word.set}`, remove: 'Remove', rename: 'Rename', chooseAnother: 'Choose another',
        definition: `Change what the ${word.set} is`, colour: (name) => `Color of ${name}`, saveName: 'Save the name', cancel: 'Cancel'
    }),
    setTitle: (letter) => `${capital(word.set)} ${letter}`,
    shareTitle: `Share of the ${word.cellsShown}`,
    renameHint: 'Double-click to rename. Enter saves, Escape cancels, Tab saves and moves to the next set.',
    renameLabel: `Name of the ${word.set}`,
    /** An UpSet's own options (UX 4.2): Sort, Show top, Minimum size. */
    sort: 'Sort',
    sortBy: Object.freeze({ size: 'By size', degree: 'By degree' }),
    top: 'Show top',
    minSize: 'Minimum size',
    topProblem: (max) => `Enter a whole number from 1 to ${max.toLocaleString('en-US')}.`,
    minSizeProblem: 'Enter a whole number, 0 or more.'
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
    /** Under a refusal by cost: the limit of the confirm tier, from the estimate's `max_s` (SHR-32). */
    overLimit: (minutes) => `The limit is ${minutes.toLocaleString('en-US')} ${minutes === 1 ? 'minute' : 'minutes'}.`,
    /** ... and the way out, by the store's refusal reason (utils/derived-store.js). */
    wayOut: Object.freeze({
        score_too_expensive: 'Use fewer genes.',
        groups_too_expensive: `Use fewer genes or ${plural.group}, or a subset.`
    }),
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

/**
 * The words of the per-cell export of a Cell Grouping (GRP-18): its entry and hint, the two column headers, the text of a
 * cell in no group, and the reasons it gives when it is disabled or cannot be done. panels/cell-grouping/cell-export.js
 * reads them as its `words`.
 */
const cellExport = Object.freeze({
    entry: 'Export cells',
    entryTitle: 'Download each cell and its group as CSV',
    cellName: 'Cell name',
    groupName: 'Group name',
    notInAnyGroup: capital(word.notInAnyGroup),
    tooManyCells: (limit) => `Exporting each cell works up to ${limit.toLocaleString('en-US')} cells.`,
    failed: 'The cells could not be exported: the groups could not be read'
});

/**
 * What a menu of source types and a column chooser's tab call a source a panel makes, beside the dataset's own obs,
 * obsm, obsp and layers (whose AnnData names stay). Never the provider's type id.
 */
/** What an aggregation is called; its symbols are utils/aggregation-symbols.js's, its names the method tables' labels. */
const aggregation = Object.freeze({
    label: 'Aggregation',
    sections: Object.freeze({ genes: 'Genes', cells: 'Cells', signatures: 'Gene signatures', tables: 'Gene tables', groupings: 'Cell groupings', cellTables: 'Cell tables' })
});

const sourceType = Object.freeze({ score: 'Gene score', grouping: 'Cell Grouping', groupStat: 'Cell group', tableStat: 'Cell table', groupStatTab: 'Cell groupings' });

/** Show as table (UX 7): a plot's CSV rows as an HTML table, in every plot that offers it (count plot, Cell-Gene Plot). */
const table = Object.freeze({
    show: 'Show as table',
    hide: 'Hide table',
    cut: (shown, all) => `Showing the first ${fmt(shown)} of ${fmt(all)} rows; Download CSV has them all.`
});

/**
 * The 3D view's refusal (UX 6b): one base sentence and a hint per panel, so each panel names what to reduce.
 * `tooMany(max, count, hint)` reads "3D draws at most 40,000 bars; this plot has 262,144. Use fewer bins."
 */
const view3d = Object.freeze({
    tooManyBase: (max, count) => `3D draws at most ${fmt(max)} bars; this plot has ${fmt(count)}.`,
    hint: Object.freeze({ bins: 'Use fewer bins.', matrix: 'Use fewer genes or groups.' }),
    tooMany: (max, count, hint = 'bins') => `${view3d.tooManyBase(max, count)} ${view3d.hint[hint] || view3d.hint.bins}`
});

/** The range boxes' words (ui/range-boxes.js): Min and Max boxes of one scale, auto with the value drawn, a reset. */
const range = Object.freeze({
    auto: 'auto',
    smallest: 'smallest',
    largest: 'largest',
    reset: '\u21BA',
    resetHelp: (what) => `Back to auto: ${what ? `${what.toLowerCase()} ` : ''}limits follow the drawn values`,
    problem: 'Enter a number, or leave it empty for automatic.',
    follows: (end, value) => `Follows the drawn values (${end} ${value}). Type a value to override it for this plot.`,
    followsNone: 'Follows the drawn values. Type a value to override it for this plot.',
    fixed: (value) => `Overrides the drawn values (set to ${value}). Clear to follow them.`
});

/**
 * The Cell Plot's and Gene Plot's own words (WP-5b): the 3D toggle reads "3D", as in the Cell-Gene and Cell Count Plots'
 * toolbars (operator, 2026-11-23); its title says what it does.
 */
const plotPanel = Object.freeze({
    view3d: '3D',
    view3dHelp: 'Show the plot in 3D: adds a Z row',
    view3dOnHelp: 'The plot is in 3D; click to go back to 2D'
});

export const VOCABULARY = Object.freeze({ aggregation, plotPanel, range, view3d, word, plural, never, phrase, count, cellGene, countPlot, countSets, cellExport, progress, reasons, table, sourceType });
