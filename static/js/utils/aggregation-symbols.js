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

/** The statistics over a group's cells. */
export const STAT_SYMBOLS = Object.freeze({
    zscore_mean: sym('z', true), mean: sym('x', true), pct_expressing: sym('%'), mean_expressing: sym('x⁺', true), sum: sym('Σ'), sd: sym('σ')
});

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
