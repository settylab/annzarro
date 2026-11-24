/**
 * Count Plot links stored with `mode: 'histogram'`, before the Histogram view folded into Bar (0.8.0): each with the
 * grid reply it draws from and the drawing options. count-histogram-figures.json holds the Plotly figure each drew as a
 * histogram (taken on the bundle before the fold, af5048f8); count-bar-overlay.test.mjs checks that the same link,
 * read as a Bar now, draws exactly that figure.
 */

const depth = (binning) => ({ source: { type: 'obs', key: 'depth' }, binning });
const cond = { source: { type: 'obs', key: 'condition' } };
const three = ['bin:0', 'bin:1', 'bin:2'];
const twoLevels = ['c:p', 'c:q'];

/** [name, stored config, axes of the reply, counts, inputs]: the drawing options are the config's (controls-model drawOptions). */
export const CASES = [
    ['plain', { x: depth({ method: 'equal_width', bins: 3 }) }, [{ levels: [...three, '@na'] }], [5, 8, 2, 7], ['x']],
    ['zero bin', { x: depth({ method: 'equal_width', bins: 3, zero_bin: true }) }, [{ levels: ['@zero', ...three], edges: [4, 14, 24, 34] }],
        [9, 5, 8, 2], ['x']],
    ['overlaid by a Color by', { x: depth({ method: 'equal_width', bins: 3 }), split: cond, arrangement: 'dodge' },
        [{ levels: three }, { levels: twoLevels }], [1, 2, 3, 4, 5, 6], ['x', 'split']],
    ['stacked by a Color by', { x: depth({ method: 'equal_width', bins: 3 }), split: cond },
        [{ levels: three }, { levels: twoLevels }], [1, 2, 3, 4, 5, 6], ['x', 'split']],
    ['overlaid, horizontal, log, labels', { x: depth({ method: 'equal_width', bins: 3 }), split: cond, arrangement: 'dodge', horizontal: true, log: true,
        labels: 'count' }, [{ levels: three }, { levels: twoLevels }], [1, 2, 3, 4, 5, 6], ['x', 'split']],
    ['log bins, even', { x: depth({ method: 'log', bins: 3 }) }, [{ levels: three, edges: [1, 10, 100, 1000] }], [1, 2, 3], ['x']],
    ['log bins, by value', { x: depth({ method: 'log', bins: 3 }), binSpacing: { x: 'value' } }, [{ levels: three, edges: [1, 10, 100, 1000] }],
        [1, 2, 3], ['x']],
    ['share within each X', { x: depth({ method: 'equal_width', bins: 3 }), split: cond, value: { kind: 'share', of: 'x' } },
        [{ levels: three }, { levels: twoLevels }], [1, 2, 3, 4, 5, 6], ['x', 'split']],
    ['integer by its values', { x: { source: { type: 'obs', key: 'n' }, binning: { method: 'categories' } } },
        [{ levels: ['c:1', 'c:2', 'c:3'], edges: [1, 2, 3], bins_made: 3, degenerate: false }], [4, 5, 6], ['x']]
];

const WORDS = {
    count: 'Cell count', fill: '% of cells in each bar', hoverCount: 'Cells', hoverShare: 'Share',
    share: (base) => `Share of ${base}`, measure: (stat, source, above) => `${stat} of ${source}${above === undefined ? '' : ` above ${above}`}`,
    topLevel: (name) => `Most frequent level of ${name}`
};

/** The grid reply in its contract form: every binned axis gets edges 0, 10, 20... unless it names its own. */
function withContract(axes, counts) {
    return {
        reply: { n_counted: counts.reduce((a, b) => a + b, 0), n_shown: counts.reduce((a, b) => a + b, 0),
            axes: axes.map((a) => {
                const bins = a.levels.filter((id) => id.startsWith('bin:')).length;
                const binned = bins ? { edges: Array.from({ length: bins + 1 }, (_, k) => k * 10), bins_made: bins, degenerate: false } : {};
                return { n_outside: [0, 0], ...binned, ...a };
            }) },
        counts, measures: null
    };
}

/**
 * The figure a stored link draws, through the page's own model and drawing: normalized, its table read from the reply,
 * then countFigure. Returned as JSON-safe data (what Plotly is given).
 */
export function drawCase({ M, D, K, theme }, [, stored, axes, counts, inputs]) {
    const config = M.normalizeCountPlot({ version: 1, mode: 'histogram', ...stored }).config;
    const table = M.countTable(config, M.readGrid(withContract(axes, counts)), inputs.map((input) => ({ input })));
    const figure = D.countFigure(config, table, {
        options: K.drawOptions(config), words: WORDS, inputNames: { x: 'depth', split: 'condition' }, palette: ['#111111', '#222222', '#333333'], theme, measureSource: 'score'
    });
    return { config, figure: JSON.parse(JSON.stringify(figure)) };
}
