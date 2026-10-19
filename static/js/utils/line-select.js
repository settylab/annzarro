/**
 * The line-selection tool of the table panel: the arithmetic, with no DOM.
 *
 * The user draws a line on a plot with two points, mouse down (P1) and mouse
 * release (P2). The side to the RIGHT of the line, looking from P1 to P2 on
 * the screen, is filtered out of the table. A straight screen line is a
 * straight line in the data, y = m*x + b, so the filter is one condition on
 * the column y - m*x:
 *
 *   - the line cuts at b, and the table keeps `y - m*x <= b` or `>= b`,
 *     whichever is the side that is NOT on the right of the line;
 *   - a horizontal or vertical line needs no derived column: the condition is
 *     on the y or the x column itself.
 *
 * "Right" is the side the user sees. The pixel -> data map of an axis is
 * affine and may run backwards (a reversed axis) and y runs down the screen,
 * so the side is not taken from the sign of a slope: a test point on the
 * `f > b` side is mapped back to the screen and tested against the line
 * there. A reversed axis then needs no special case.
 *
 * m and b are rounded (PRECISION significant digits) before anything else
 * uses them, so the line previewed, the column and the condition are one line.
 *
 * Screen points in this file are pixels from the top left of the plot AREA.
 */

/** Significant digits kept of the slope and the intercept. */
export const PRECISION = 6;

/** Shortest screen distance, in pixels, between P1 and P2 that makes a line. */
export const MIN_LENGTH = 4;

/** `v` to PRECISION significant digits, as a number (never -0). */
export function round(v) {
    const r = +Number(v).toPrecision(PRECISION);
    return r === 0 ? 0 : r;
}

/** Number text for a name: the rounded number, with no exponent for ordinary sizes. */
export function numberText(v) {
    const r = round(v);
    const s = String(r);
    if (!/e/i.test(s)) return s;
    // 1e-7 -> 0.0000001, 1.5e21 stays
    return Math.abs(r) >= 1e-7 && Math.abs(r) < 1e21 ? r.toFixed(20).replace(/\.?0+$/, '') : s;
}

/**
 * Where P2 goes when Shift is held: the same distance from P1, at the nearest
 * multiple of 45 degrees. The axis directions are exact, so a snapped
 * horizontal or vertical line really has dy or dx of 0.
 * @param {{x: number, y: number}} p1
 * @param {{x: number, y: number}} p2
 * @returns {{x: number, y: number}}
 */
export function snap45(p1, p2) {
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) return { x: p2.x, y: p2.y };
    const k = ((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8;
    const d = Math.SQRT1_2 * len;
    const dirs = [[len, 0], [d, d], [0, len], [-d, d], [-len, 0], [-d, -d], [0, -len], [d, -d]];
    return { x: p1.x + dirs[k][0], y: p1.y + dirs[k][1] };
}

/**
 * `p2` pulled back along its way from `p1` until it is inside the rectangle
 * [0, w] x [0, h]: the direction (a snapped one) is kept, the length is not.
 * @param {{x: number, y: number}} p1  inside the rectangle
 * @param {{x: number, y: number}} p2
 * @returns {{x: number, y: number}}
 */
export function fitInside(p1, p2, w, h) {
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    let t = 1;
    if (dx > 0) t = Math.min(t, (w - p1.x) / dx); else if (dx < 0) t = Math.min(t, -p1.x / dx);
    if (dy > 0) t = Math.min(t, (h - p1.y) / dy); else if (dy < 0) t = Math.min(t, -p1.y / dy);
    t = Math.max(0, t);
    return { x: p1.x + t * dx, y: p1.y + t * dy };
}

/**
 * The pixel <-> data map of one axis of a Plotly plot, from its layout:
 * `range` [r0, r1] over `length` pixels. An x axis runs left to right, a y
 * axis bottom to top (pixel 0 is the top, the range's second end). A reversed
 * axis has r0 > r1 and needs nothing more.
 * @param {number[]} range
 * @param {number} length  pixels of the plot area along the axis
 * @param {boolean} vertical  true for a y axis
 * @returns {{toData: function(number): number, toPx: function(number): number}}
 */
export function axisMap(range, length, vertical) {
    const [r0, r1] = range;
    const span = r1 - r0;
    return vertical
        ? { toData: (px) => r0 + (1 - px / length) * span, toPx: (v) => (1 - (v - r0) / span) * length }
        : { toData: (px) => r0 + (px / length) * span, toPx: (v) => ((v - r0) / span) * length };
}

/** > 0 when `q` is to the right of the way from `p1` to `p2` (screen: y down). */
export function crossRight(p1, p2, q) {
    return (p2.x - p1.x) * (q.y - p1.y) - (p2.y - p1.y) * (q.x - p1.x);
}

/**
 * The line two screen points define, as a condition on the data.
 *
 * @param {{x: number, y: number}} p1  mouse down, plot-area pixels
 * @param {{x: number, y: number}} p2  mouse release
 * @param {{toData: Function, toPx: Function}} xMap
 * @param {{toData: Function, toPx: Function}} yMap
 * @returns {{kind: 'horizontal'|'vertical'|'slope', value?: number, m?: number, b?: number,
 *            op: '<='|'>='}|null}  `op` is the condition that KEEPS the rest; null when
 *     the points are too close, or an axis has no extent
 */
export function lineCondition(p1, p2, xMap, yMap) {
    if (!(Math.hypot(p2.x - p1.x, p2.y - p1.y) >= MIN_LENGTH)) return null;
    const X1 = xMap.toData(p1.x), Y1 = yMap.toData(p1.y);
    const X2 = xMap.toData(p2.x), Y2 = yMap.toData(p2.y);
    if (![X1, Y1, X2, Y2].every(Number.isFinite)) return null;
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const eps = 1e-9 * Math.hypot(dx, dy);
    // a test point one data unit up the filtered variable, and where it is on screen:
    // right of the line = the side that is filtered out
    const removedWhenGreater = (q) => crossRight(p1, p2, q) > 0;

    if (Math.abs(dy) <= eps) {
        const test = { x: p1.x, y: yMap.toPx(Y1 + 1) };
        return { kind: 'horizontal', value: round(Y1), op: removedWhenGreater(test) ? '<=' : '>=' };
    }
    if (Math.abs(dx) <= eps) {
        const test = { x: xMap.toPx(X1 + 1), y: p1.y };
        return { kind: 'vertical', value: round(X1), op: removedWhenGreater(test) ? '<=' : '>=' };
    }
    const m = round((Y2 - Y1) / (X2 - X1));
    if (!Number.isFinite(m) || m === 0) return null;
    const b = round(Y1 - m * X1);
    // y - m*x = b at P1; one data unit up in y is on the f > b side
    const test = { x: p1.x, y: yMap.toPx(Y1 + 1) };
    return { kind: 'slope', m, b, op: removedWhenGreater(test) ? '<=' : '>=' };
}

/** The line drawn from the kept condition: a point on it and a direction, in data units. */
export function lineInData(cond, xMap, yMap) {
    if (cond.kind === 'horizontal') return { a: [xMap.toData(0), cond.value], b: [xMap.toData(1), cond.value] };
    if (cond.kind === 'vertical') return { a: [cond.value, yMap.toData(0)], b: [cond.value, yMap.toData(1)] };
    const x0 = xMap.toData(0), x1 = xMap.toData(1);
    return { a: [x0, cond.m * x0 + cond.b], b: [x1, cond.m * x1 + cond.b] };
}

/**
 * The line a condition describes, as two screen points (the rounded line, which
 * is what the table filters on; it differs from the mouse points by far less
 * than a pixel).
 */
export function lineOnScreen(cond, xMap, yMap) {
    const { a, b } = lineInData(cond, xMap, yMap);
    const p1 = { x: xMap.toPx(a[0]), y: yMap.toPx(a[1]) };
    const p2 = { x: xMap.toPx(b[0]), y: yMap.toPx(b[1]) };
    return [p1, p2];
}

/**
 * The part of the infinite line through p1 and p2 inside the rectangle
 * [0, w] x [0, h] (Liang-Barsky), or null when it misses it.
 * @returns {[{x: number, y: number}, {x: number, y: number}]|null}
 */
export function clipLine(p1, p2, w, h) {
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    let t0 = -Infinity, t1 = Infinity;
    for (const [p, q] of [[-dx, p1.x], [dx, w - p1.x], [-dy, p1.y], [dy, h - p1.y]]) {
        if (p === 0) {
            if (q < 0) return null;
        } else {
            const t = q / p;
            if (p < 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
        }
    }
    if (!(t0 < t1)) return null;
    return [{ x: p1.x + t0 * dx, y: p1.y + t0 * dy }, { x: p1.x + t1 * dx, y: p1.y + t1 * dy }];
}

/**
 * The polygon of the plot area on the RIGHT of the way from p1 to p2 (the side
 * a line filters out), by clipping the area's rectangle against the half plane.
 * Empty when the line leaves nothing on that side.
 * @returns {Array<{x: number, y: number}>}
 */
export function rightPolygon(p1, p2, w, h) {
    const side = (q) => crossRight(p1, p2, q);
    const poly = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
    const out = [];
    for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        const sa = side(a), sb = side(b);
        if (sa >= 0) out.push(a);
        if ((sa > 0 && sb < 0) || (sa < 0 && sb > 0)) {
            const t = sa / (sa - sb);
            out.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
        }
    }
    return out.length >= 3 ? out : [];
}

/** A column reference ({type, key, column}) without anything else a plot axis carries. */
export function columnRef(axis) {
    return { type: axis.type, key: axis.key, column: axis.column === undefined || axis.column === null ? '' : axis.column };
}

/** Whether two column references name the same column. */
export function sameColumn(a, b) {
    return a.type === b.type && a.key === b.key && String(a.column || '') === String(b.column || '');
}

/** The display name of a derived column: `UMAP_2 − 0.83·UMAP_1`, `y + 2·x` for a negative slope. */
export function derivedName(yName, xName, m) {
    const mag = numberText(Math.abs(m));
    return `${yName} ${m < 0 ? '+' : '−'} ${mag === '1' ? '' : mag + '·'}${xName}`;
}

/**
 * A derived column: y - m*x, a column of the table like any other (it lives in
 * the panel's `columns`, so a session, a panel set and a link carry it).
 * @param {{type: string, key: string, column: string}} y
 * @param {{type: string, key: string, column: string}} x
 * @param {number} m  already rounded
 * @param {function({type: string, key: string, column: string}): string} nameOf  a column's display name
 */
export function derivedColumn(y, x, m, nameOf) {
    return { type: 'derived', key: derivedName(nameOf(y), nameOf(x), m), column: '', expr: { y, x, m } };
}

/** Whether a table column is a derived one. */
export function isDerived(column) {
    return !!column && column.type === 'derived' && !!column.expr;
}

/** Whether two derived columns are the same expression. */
export function sameExpr(a, b) {
    return isDerived(a) && isDerived(b) && a.expr.m === b.expr.m
        && sameColumn(a.expr.y, b.expr.y) && sameColumn(a.expr.x, b.expr.x);
}

/**
 * The derived values y - m*x. A missing value (null, NaN) in either gives null.
 * @param {ArrayLike<number|null>} y
 * @param {ArrayLike<number|null>} x
 * @param {number} m
 * @returns {Array<number|null>}
 */
export function derivedValues(y, x, m) {
    const n = Math.min(y.length, x.length);
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
        const a = y[i], b = x[i];
        out[i] = typeof a === 'number' && typeof b === 'number' && Number.isFinite(a) && Number.isFinite(b)
            ? a - m * b : null;
    }
    return out;
}

/**
 * A SearchBuilder condition (the shape getDetails() returns and `preDefined`
 * takes) of one number column.
 * @param {string} title  the column's title
 * @param {string} key  the column's data key
 * @param {'<='|'>='} op
 * @param {number} value
 */
export function numberCriterion(title, key, op, value) {
    return { condition: op, data: title, origData: key, type: 'num', value: [String(value)] };
}

/** True when two conditions are the same test. */
function sameCriterion(a, b) {
    return a && b && !a.criteria && !b.criteria && a.origData === b.origData
        && a.condition === b.condition && String((a.value || [])[0]) === String((b.value || [])[0]);
}

/**
 * The SearchBuilder configuration with one more condition, joined by an outer
 * AND: appended to an outer AND (or a single condition, whose logic means
 * nothing), the first condition of an empty filter, or, under an outer OR,
 * the whole of it wrapped in a group of that OR beside the new condition.
 * The same condition twice is added once.
 * @param {{criteria?: Array, logic?: string}|null|undefined} config
 * @param {Object} criterion
 * @returns {{criteria: Array, logic: string}}
 */
export function addCriterion(config, criterion) {
    const criteria = Array.isArray(config && config.criteria) ? config.criteria : [];
    const logic = config && config.logic === 'OR' ? 'OR' : 'AND';
    if (criteria.length === 0) return { criteria: [criterion], logic: 'AND' };
    if (criteria.some(c => sameCriterion(c, criterion))) return { criteria: criteria.slice(), logic };
    if (logic === 'AND' || criteria.length === 1) return { criteria: [...criteria, criterion], logic: 'AND' };
    return { criteria: [{ criteria: criteria.slice(), logic: 'OR' }, criterion], logic: 'AND' };
}

/** Levels of groups in a SearchBuilder configuration: 1 for conditions only. */
export function configDepth(config) {
    const walk = (node) => (node && Array.isArray(node.criteria)
        ? 1 + Math.max(0, ...node.criteria.map(walk)) : 0);
    return Math.max(1, walk(config));
}

/**
 * Why a plot cannot take a line, or null when it can. Everything the tool
 * needs of a plot is in this one place, so the warning on hover and the
 * drawing agree.
 * @param {Object} p
 * @param {boolean} p.drawn  the plot has been drawn
 * @param {boolean} p.is3d
 * @param {string} p.xType  Plotly axis type
 * @param {string} p.yType
 * @param {string} p.xSource  the x axis's data source type (obs, obsm, ...)
 * @param {string} p.ySource
 * @param {string[]} p.tableSources  the source types the table has columns of
 * @param {string} p.xLabel
 * @param {string} p.yLabel
 * @returns {string|null}
 */
export function plotRefusal({ drawn, is3d, xType, yType, xSource, ySource, tableSources, xLabel, yLabel }) {
    if (!drawn) return 'This plot is not drawn yet.';
    if (is3d) return 'Line selection needs a 2D plot: this plot is 3D.';
    const bad = (type, label, axis) => {
        if (type === 'log') {
            return `The ${axis} axis (${label}) is logarithmic: a straight line on the screen is not a straight line in the values.`;
        }
        if (type !== 'linear') return `The ${axis} axis (${label}) is not numerical.`;
        return null;
    };
    const why = bad(xType, xLabel, 'x') || bad(yType, yLabel, 'y');
    if (why) return `${why} Line selection needs a numerical x and y axis.`;
    for (const [src, label, axis] of [[xSource, xLabel, 'x'], [ySource, yLabel, 'y']]) {
        if (!tableSources.includes(src)) return `The ${axis} axis (${label}) is not something this table has columns of.`;
    }
    return null;
}
