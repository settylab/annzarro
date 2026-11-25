/**
 * The symbols of the aggregations (axis-aggregate-picker-080): ONE small table, by the value of a signature's method
 * (utils/signature-options.js METHOD_INFO) and of a group's statistic (utils/group-statistics.js STATISTIC_INFO). Names and
 * order are those tables'; only the symbol is written here, so a method or statistic added to a table is given its symbol
 * here and nowhere else.
 *
 * A symbol is `{text, over}`: `over` draws a bar over the letter (x̄, z̄) with CSS, never with a combining
 * character, whose placement differs between fonts and runs into the next word.
 */

/** A symbol: a few characters, with an overline when `over`. */
const sym = (text, over = false) => Object.freeze({ text, over });

/** A signature's (and a gene table's) methods: z̄ reads "mean of z", so it is not mistaken for a plain z-score. */
export const SCORE_SYMBOLS = Object.freeze({
    zscore_mean: sym('z', true), mean: sym('x', true), sum: sym('Σ'), control_adjusted: sym('Δ'),
    detected: sym('n/N'), fraction_of_total: sym('%')
});

/** The statistics over a group's cells. `%⁺` is the share of cells expressing, `%` alone the signature method's share of the total. */
export const STAT_SYMBOLS = Object.freeze({
    zscore_mean: sym('z', true), mean: sym('x', true), pct_expressing: sym('%⁺'), mean_expressing: sym('x⁺', true), sum: sym('Σ'), sd: sym('σ')
});

/**
 * What the Cell-Gene Plot's Color, Size and Height choose from: the group statistics, Cell count (`n`) and, for Height,
 * "Same as Color" (`≡`).
 */
export const MEASURE_SYMBOLS = Object.freeze({ ...STAT_SYMBOLS, count: sym('n'), same: sym('\u2261') });

/**
 * How a one-row section's gene rows are combined (aggregation-unify-080.md 10.2): the mean of the gene rows (the default), their
 * sum, or their mean z-scored across groups. A score method shows its SCORE_SYMBOLS entry instead.
 */
export const ROW_SYMBOLS = Object.freeze({ rows_mean: sym('='), rows_sum: sym('+'), rows_z: sym('z\u2194') });

/** A symbol as plain text, for a plot's tick label (a bar is a combining macron there; the page draws it with CSS). */
export function plainSymbol(symbol) {
    return symbol.over ? `${symbol.text}\u0304` : symbol.text;
}

/** The element of a symbol: a span in the symbol column of the button and of the menu. */
export function symbolSpan(symbol, className = 'axis-agg-sym') {
    const span = document.createElement('span');
    span.className = symbol.over ? `${className} agg-sym--over` : className;
    if (symbol.over) {
        // the bar is the top border of the letters, so it sits right above them whatever the font
        const letters = document.createElement('span');
        letters.className = 'agg-over';
        letters.textContent = symbol.text;
        span.append(letters);
    } else {
        span.textContent = symbol.text;
    }
    return span;
}
