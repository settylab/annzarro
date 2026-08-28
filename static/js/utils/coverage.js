/**
 * Coverage -- the value a panel must carry that says WHAT IS MISSING and WHY.
 *
 * ## Why this module exists
 *
 * On 2026-08-28 users reported that liver-met samples "show no celltype /
 * sample columns". The trace: for 10 of 33 datasets a categorical's
 * `categories` member is a zarr *group*, the reader raised, a bare `except`
 * returned `[], []`, and the API answered HTTP 200 with
 * `{"celltype": [], "sample": []}`. The UI drew a plot with nothing in it and
 * said nothing. Every layer reported success. Nobody -- not the user, not the
 * operator -- could tell "this column is legitimately empty" from "this column
 * failed to read" from "this column is not in this dataset".
 *
 * Repairing the reader does not fix that. A repaired reader still leaves the UI
 * silent the next time something legitimately has no data. The interface has to
 * answer the question on its own.
 *
 * ## The contract
 *
 * A `Coverage` is a plain, immutable description of how much of what the user
 * asked for actually made it onto the screen, plus a reason for every part that
 * did not. Every render surface takes one. Nothing renders without one.
 *
 * The default is LOUD, not silent: a surface handed `null`/`undefined` renders
 * `Coverage.unreported()` -- a visible "this panel does not report what it is
 * missing" badge. A future contributor who adds a render path and forgets to
 * describe its gaps therefore sees a defect in the UI immediately, instead of
 * shipping a clean plot that lies by omission. That inversion -- absence of
 * information is itself displayed -- is the whole mechanism. The static guard
 * in `annzarro/tests/static/test_no_silent_gap.py` keeps the chokepoint from
 * being routed around; this module makes forgetting it visible even if it is.
 *
 * This module is pure (no DOM, no Plotly, no fetch) so it runs under
 * `node --test`; see `annzarro/tests/js/coverage.test.mjs`. Rendering lives in
 * `static/js/utils/panel-surface.js`.
 */

/**
 * The reasons a plot or table can show less than the user asked for.
 *
 * These are exhaustive by construction: `UNREPORTED` is the catch-all for
 * "nobody said", so there is no silent residue. Anything a future contributor
 * fails to classify lands there and is displayed as such.
 */
export const GAP = Object.freeze({
    /** The column/key exists and legitimately carries no values. */
    EMPTY: 'empty',
    /** A read or request error occurred. The data may well exist. */
    FAILED: 'failed',
    /** Some entities were deliberately excluded (NaN, outlier, table filter). */
    FILTERED: 'filtered',
    /** The column/key does not exist for this dataset at all. */
    UNAVAILABLE: 'unavailable',
    /** The request hit a server-side cap (max_cells/max_genes per request). */
    CAPPED: 'capped',
    /** Nobody described this surface's coverage. A defect, rendered as one. */
    UNREPORTED: 'unreported'
});

/**
 * What a Coverage says about the ENTITIES on screen, as opposed to what it says
 * about the DATA describing them. `Coverage.merge` needs this distinction and
 * cannot infer it.
 *
 * A contributor that RESTRICTS decides which entities appear at all: an x/y/z
 * coordinate series (no coordinate, no point), a filter mask, a server cap. The
 * panel can only show a point where every restricting contributor has one, so
 * merging them takes the MINIMUM `shown`.
 *
 * A contributor that DESCRIBES is a property OF entities that appear anyway: a
 * colour column over a scatter Plotly draws regardless, a table column whose
 * 75,000 rows are on screen whether or not that one column could be read.
 * Taking its `shown` into the minimum states that nothing is on screen while
 * the user is looking at a full table -- the same class of lie, in the opposite
 * direction, as the silence this module exists to end.
 *
 * The default is RESTRICTS because a contributor nobody classified is more
 * safely assumed to gate the entities than to be incidental to them: that
 * errs toward saying too little is shown, which is visible and checkable,
 * rather than toward claiming a full panel over data that is not there.
 */
export const ROLE = Object.freeze({
    /** Decides which entities appear. Merged by MINIMUM `shown`. */
    RESTRICTS: 'restricts',
    /** Describes entities that appear regardless. Its `shown` is not a bound. */
    DESCRIBES: 'describes'
});

/**
 * Headline used when every entity IS on screen but something about them is
 * missing -- a failed colour column over a complete scatter, say. Saying
 * "75,000 of 75,000 shown" there is true and useless; the reason is the news.
 */
const REASON_HEADLINE = Object.freeze({
    [GAP.EMPTY]: 'Some values are empty',
    [GAP.FAILED]: 'Some data could not be read',
    [GAP.FILTERED]: 'Some points are hidden',
    [GAP.UNAVAILABLE]: 'Some data is not available for this dataset',
    [GAP.CAPPED]: 'The request hit a server limit',
    [GAP.UNREPORTED]: 'Coverage not reported'
});

/** Human-facing label per reason, used in the notice body. */
const GAP_LABEL = Object.freeze({
    [GAP.EMPTY]: 'no values',
    [GAP.FAILED]: 'failed to read',
    [GAP.FILTERED]: 'filtered out',
    [GAP.UNAVAILABLE]: 'not in this dataset',
    [GAP.CAPPED]: 'server limit reached',
    [GAP.UNREPORTED]: 'not reported'
});

/**
 * Severity rank. Higher wins when a Coverage carries several gaps, and decides
 * the badge colour. `UNREPORTED` outranks everything on purpose: it is a bug in
 * our own code and must never be masked by a data-level gap that happens to be
 * present on the same panel.
 */
const SEVERITY_RANK = Object.freeze({
    ok: 0,
    [GAP.FILTERED]: 1,
    [GAP.EMPTY]: 2,
    [GAP.UNAVAILABLE]: 2,
    [GAP.CAPPED]: 3,
    [GAP.FAILED]: 4,
    [GAP.UNREPORTED]: 5
});

/** Severity bucket used for styling; see `.coverage-notice--*` in styles.css. */
const SEVERITY_CLASS = Object.freeze({
    [GAP.FILTERED]: 'notice',
    [GAP.EMPTY]: 'warning',
    [GAP.UNAVAILABLE]: 'warning',
    [GAP.CAPPED]: 'warning',
    [GAP.FAILED]: 'error',
    [GAP.UNREPORTED]: 'unreported'
});

function fmt(n) {
    return typeof n === 'number' && isFinite(n) ? n.toLocaleString() : String(n);
}

function isReason(value) {
    return Object.values(GAP).includes(value);
}

/**
 * One reason a slice of the requested data is not on screen.
 *
 * @typedef {Object} Gap
 * @property {string} reason  One of `GAP.*`.
 * @property {string} detail  Free text shown to the user; say what and why.
 * @property {string} source  Where it applies, e.g. `obs.celltype`, `x-axis`.
 * @property {number|null} count  How many entities this gap accounts for.
 */

/**
 * An immutable description of what a panel is showing and what it is not.
 *
 * Construct via the static factories rather than `new`; they enforce the
 * invariants (frozen gaps, non-negative counts, known reasons).
 */
export class Coverage {
    /**
     * @param {Object} spec
     * @param {number|null} spec.shown  Entities actually rendered.
     * @param {number|null} spec.total  Entities the user asked for.
     * @param {string} spec.unit  'cells' | 'genes' | 'values' ...
     * @param {Gap[]} spec.gaps
     * @param {string} spec.role  One of `ROLE.*`; see the enum's docstring.
     */
    constructor({ shown = null, total = null, unit = 'values', gaps = [], role = ROLE.RESTRICTS } = {}) {
        this.shown = shown;
        this.total = total;
        this.unit = unit;
        this.role = (role === ROLE.DESCRIBES) ? ROLE.DESCRIBES : ROLE.RESTRICTS;
        this.gaps = Object.freeze(
            gaps.map(g => Object.freeze({
                reason: isReason(g.reason) ? g.reason : GAP.UNREPORTED,
                detail: g.detail || '',
                source: g.source || '',
                count: typeof g.count === 'number' ? g.count : null
            }))
        );
        Object.freeze(this);
    }

    /** Everything the user asked for is on screen. Renders no notice. */
    static complete(total, unit = 'values', role = ROLE.RESTRICTS) {
        return new Coverage({ shown: total, total, unit, gaps: [], role });
    }

    /**
     * Nobody described this surface. The loud default -- see the module header.
     * This is not an error state about the DATA; it is a defect in our code,
     * and it says so.
     */
    static unreported(unit = 'values') {
        return new Coverage({
            unit,
            gaps: [{
                reason: GAP.UNREPORTED,
                detail: 'this panel does not report what it is missing or why',
                source: ''
            }]
        });
    }

    /**
     * A surface showing nothing, for a stated reason.
     *
     * @param {string} reason  One of `GAP.*`.
     * @param {string} detail  Why, in the user's terms.
     * @param {Object} [opts]  `{ source, unit, total }`.
     */
    static missing(reason, detail, { source = '', unit = 'values', total = null, role = ROLE.RESTRICTS } = {}) {
        return new Coverage({
            shown: 0, total, unit, role,
            gaps: [{ reason, detail, source, count: total }]
        });
    }

    /**
     * A surface showing `shown` of `total`, for a stated reason.
     */
    static partial(shown, total, reason, detail, { source = '', unit = 'values', role = ROLE.RESTRICTS } = {}) {
        return new Coverage({
            shown, total, unit, role,
            gaps: [{
                reason, detail, source,
                count: (typeof total === 'number' && typeof shown === 'number')
                    ? Math.max(0, total - shown) : null
            }]
        });
    }

    /** Returns a new Coverage with one more gap. */
    withGap(reason, detail, source = '', count = null) {
        return new Coverage({
            shown: this.shown, total: this.total, unit: this.unit, role: this.role,
            gaps: [...this.gaps, { reason, detail, source, count }]
        });
    }

    /** Returns a new Coverage with the given role; see the `ROLE` docstring. */
    withRole(role) {
        if (this.role === role) return this;
        return new Coverage({
            shown: this.shown, total: this.total, unit: this.unit,
            gaps: this.gaps, role
        });
    }

    /**
     * This coverage describes a PROPERTY of entities that are on screen anyway
     * -- a colour column, a table column -- so its `shown` must not bound the
     * panel's. The reason it carries still surfaces; only the count changes.
     */
    asDescribing() { return this.withRole(ROLE.DESCRIBES); }

    /**
     * Combine the coverage of several series into the coverage of the panel
     * that draws them.
     *
     * `shown` is the MINIMUM across the contributors that RESTRICT which
     * entities appear, because a plot can only show a point where every such
     * series has a value: if x covers 75,000 cells and a y-axis cap covers
     * 10,000, the plot is honest at 10,000. Contributors that merely DESCRIBE
     * those entities do not enter the minimum -- see the `ROLE` docstring for
     * why taking them into it produced "No cells shown (of 75,000)" over a
     * fully populated table. `total` is the MAXIMUM across all of them,
     * because that is what the user asked for.
     *
     * When NOTHING restricts -- a table, whose columns all merely describe its
     * rows -- every entity is on screen, so `shown` is the total. The gaps
     * still travel, so the reason is stated; only the false count is gone.
     *
     * `UNREPORTED` survives merging (it is a gap like any other), so combining
     * a described series with an undescribed one does not launder the latter.
     *
     * The merged value RESTRICTS: its `shown` is a real entity count, so a
     * panel coverage re-merged with a filter mask bounds correctly.
     */
    static merge(coverages, unit = null) {
        const list = coverages.filter(Boolean);
        if (list.length === 0) return Coverage.unreported(unit || 'values');

        const restricting = list.filter(c => c.role !== ROLE.DESCRIBES);
        const shownVals = restricting.map(c => c.shown).filter(v => typeof v === 'number');
        const totalVals = list.map(c => c.total).filter(v => typeof v === 'number');
        const gaps = [];
        // Element-by-element, not `push(...c.gaps)`: spreading an identifier
        // into a call is the stack-overflow idiom this repo guards against
        // (annzarro/tests/static/test_no_unsafe_array_spread.py), and writing
        // it seven lines above the comment congratulating this module for
        // avoiding it would be the same generalisation failure it describes.
        for (const c of list) for (const g of c.gaps) gaps.push(g);

        // reduce(), not a spread into Math.min/Math.max: spreading an
        // identifier there is the stack-overflow idiom this repo already guards
        // against (annzarro/tests/static/test_no_unsafe_array_spread.py).
        // These arrays are short today, but writing the banned shape in the
        // module that exists to stop a defect class recurring is precisely the
        // mistake worth not making.
        const total = totalVals.length ? totalVals.reduce((a, b) => (b > a ? b : a)) : null;
        return new Coverage({
            shown: shownVals.length ? shownVals.reduce((a, b) => (b < a ? b : a)) : total,
            total,
            unit: unit || list[0].unit,
            gaps,
            role: ROLE.RESTRICTS
        });
    }

    /** True when there is nothing to tell the user. */
    get isComplete() {
        if (this.gaps.length > 0) return false;
        if (typeof this.shown === 'number' && typeof this.total === 'number') {
            return this.shown >= this.total;
        }
        // No gaps and no counts -- treat as complete only if a count was given.
        return typeof this.shown === 'number';
    }

    /** The dominant reason, or `'ok'`. */
    get worstReason() {
        let worst = 'ok';
        for (const g of this.gaps) {
            if ((SEVERITY_RANK[g.reason] ?? 0) > (SEVERITY_RANK[worst] ?? 0)) worst = g.reason;
        }
        if (worst === 'ok' && !this.isComplete) return GAP.FILTERED;
        return worst;
    }

    /** `'ok' | 'notice' | 'warning' | 'error' | 'unreported'` -- drives styling. */
    get severity() {
        const r = this.worstReason;
        return r === 'ok' ? 'ok' : (SEVERITY_CLASS[r] || 'warning');
    }

    /**
     * The one-line summary: "3,412 of 75,000 cells shown".
     * Returns `''` when there is nothing worth saying.
     */
    headline() {
        if (this.isComplete) return '';
        if (typeof this.shown === 'number' && typeof this.total === 'number'
            && this.shown < this.total) {
            if (this.shown === 0) return `No ${this.unit} shown (of ${fmt(this.total)})`;
            return `${fmt(this.shown)} of ${fmt(this.total)} ${this.unit} shown`;
        }
        // Every entity is on screen, but something about them is missing.
        return REASON_HEADLINE[this.worstReason] || 'Incomplete data shown';
    }

    /**
     * One explanatory line per gap: what is missing, and why.
     * This is the part the operator asked for -- the "why" is never dropped.
     */
    lines() {
        return this.gaps.map(g => {
            const where = g.source ? `${g.source}: ` : '';
            const label = GAP_LABEL[g.reason] || g.reason;
            const count = typeof g.count === 'number' && g.count > 0
                ? ` (${fmt(g.count)} ${this.unit})` : '';
            const why = g.detail ? ` -- ${g.detail}` : '';
            return `${where}${label}${count}${why}`;
        });
    }

    /** Everything a renderer needs, in one call. */
    describe() {
        return {
            severity: this.severity,
            reason: this.worstReason,
            headline: this.headline(),
            lines: this.lines(),
            complete: this.isComplete
        };
    }

    /** Compact form for logs, deep links and tests. */
    toJSON() {
        return {
            shown: this.shown, total: this.total, unit: this.unit,
            role: this.role, gaps: this.gaps
        };
    }
}

/**
 * Classify an array of values already in hand, given how many were expected.
 *
 * Both surfaces that show a column -- the plot and the cell/gene table -- must
 * reach the SAME verdict from the SAME values, or the two panels on one page
 * contradict each other about one server response. That happened: the table
 * carried its own transcription of this logic, which is how a column absent
 * from the dataset came to be reported as a failed read on one panel and as
 * "not in this dataset" on the other. This is the single implementation;
 * `classifyColumn` calls it after deciding presence, and the table calls it
 * directly for the paths that have no response body to inspect.
 *
 * @param {Object} spec
 * @param {Array} spec.values
 * @param {number|null} spec.expected  Known entity count (cells or genes).
 * @param {string} spec.unit  'cells' | 'genes'.
 * @param {string} spec.source  Label for the notice, e.g. `obs.celltype`.
 * @param {string} spec.role  One of `ROLE.*`; see the enum's docstring.
 * @returns {Coverage}
 */
export function classifyValues({ values, expected = null, unit = 'values', source = '', role = ROLE.RESTRICTS } = {}) {
    const n = Array.isArray(values) ? values.length : 0;
    const opts = { source, unit, total: expected, role };

    if (n === 0) {
        // Present but empty. If the dataset has entities, a healthy column the
        // reader CAN read has exactly that many values -- every obs column is
        // aligned to `n_obs` by AnnData's definition -- so this is a failed
        // read, NOT a legitimately empty column. (An AnnData nullable dtype is
        // stored as a `{values, mask}` group and does come back zero-length
        // while the column is healthy; the reader genuinely cannot read it, so
        // "the server could not read it" is still the right sentence.)
        if (typeof expected === 'number' && expected > 0) {
            return Coverage.missing(
                GAP.FAILED,
                'the column is listed by this dataset but returned no values; '
                + 'the server could not read it',
                opts
            );
        }
        return Coverage.missing(GAP.EMPTY, 'the column exists and has no values', opts);
    }

    // An all-blank column draws a wall of "N/A" (table) or an uncoloured
    // scatter (plot) and reads exactly like real data. Full scan, not a
    // sample: a sampled verdict here would be a confident guess. `.every`
    // short-circuits on the first non-null, so the healthy case costs one
    // comparison.
    if (values.every(v => v === null || v === undefined)) {
        return Coverage.missing(
            GAP.EMPTY,
            'every entry in this column is blank (nothing was available to fill it)',
            opts
        );
    }

    if (typeof expected === 'number' && expected > 0 && n < expected) {
        return Coverage.partial(
            n, expected, GAP.FAILED,
            `only ${fmt(n)} of ${fmt(expected)} values came back; the read was incomplete`,
            { source, unit, role }
        );
    }

    return Coverage.complete(typeof expected === 'number' ? expected : n, unit, role);
}

/**
 * Classify one column of an `/api/v1/data/obs` or `/data/var` response.
 *
 * This encodes the server's ACTUAL, MEASURED semantics (annzarro @ zarr 3.1.6,
 * live probe 2026-08-28 against `/api/v1/data/obs`):
 *
 *   - a requested column that does NOT exist is silently dropped: the response
 *     is `200 {"data": {}}` with the key ABSENT
 *     (`zarr_reader.get_obs_var` filters `column_names` by group membership);
 *   - a column that FAILED to read comes back as the key PRESENT with `[]`
 *     (`get_obs_var`'s per-column `except` sets `result['data'][col] = []`);
 *   - a healthy column comes back with exactly `n_obs` values.
 *
 * So key-absent vs key-present-but-short is the discriminator between
 * "not in this dataset" and "failed to read", and it needs no reader change.
 * Everything past that presence test is `classifyValues`, so the table -- which
 * once carried its own copy of it -- cannot drift from the plot again.
 *
 * The response body is REQUIRED, not the extracted array: extracting
 * `response.data[column]` first collapses key-absent and key-present-empty into
 * the same `undefined`, destroying the discriminator before it can be applied.
 * That is exactly what the table used to do.
 *
 * @param {Object} spec
 * @param {string} spec.column  The column name that was requested.
 * @param {Object} spec.response  The parsed JSON body.
 * @param {number|null} spec.expected  Known entity count (cells or genes).
 * @param {string} spec.unit  'cells' | 'genes'.
 * @param {string} spec.source  Label for the notice, e.g. `obs.celltype`.
 * @param {string} spec.role  One of `ROLE.*`; see the enum's docstring.
 * @returns {Coverage}
 */
export function classifyColumn({ column, response, expected = null, unit = 'values', source = '', role = ROLE.RESTRICTS }) {
    const label = source || column;
    const data = (response && response.data) || {};
    const present = Object.prototype.hasOwnProperty.call(data, column);

    if (!present) {
        return Coverage.missing(
            GAP.UNAVAILABLE,
            `the column "${column}" does not exist in this dataset`,
            { source: label, unit, total: expected, role }
        );
    }

    return classifyValues({
        values: data[column], expected, unit, source: label, role
    });
}

/**
 * Turn a rejected request into a Coverage, preserving the server's reason.
 *
 * `DataManager._fetchWithCache` attaches the parsed error body as `error.data`
 * and the HTTP status as `error.status`, so a `reason` code added server-side
 * arrives here intact. When the server sends no code we fall back to the status
 * and then to the message -- never to silence.
 *
 * @param {Error} error
 * @param {Object} [opts] `{ unit, source, total }`
 * @returns {Coverage}
 */
export function classifyError(error, { unit = 'values', source = '', total = null, role = ROLE.RESTRICTS } = {}) {
    const body = (error && error.data) || {};
    const serverReason = body.reason;
    const message = (error && error.message) || 'unknown error';

    if (serverReason === 'cap_exceeded') {
        return Coverage.missing(GAP.CAPPED, message, { source, unit, total, role });
    }
    if (serverReason === 'not_found') {
        return Coverage.missing(GAP.UNAVAILABLE, message, { source, unit, total, role });
    }
    // A cap rejection from a server that predates the `reason` field still has
    // to be classified, so recognise its wording too rather than mislabelling
    // it a read failure.
    if (/too many (?:cells|genes) requested/i.test(message)) {
        return Coverage.missing(GAP.CAPPED, message, { source, unit, total, role });
    }
    return Coverage.missing(GAP.FAILED, message, { source, unit, total, role });
}

/**
 * Turn the plot's existing filter statistics into a Coverage gap list.
 *
 * `createFilterMask` already counts NaN/outlier/table-filtered points; until
 * now those counts only reached an optional collapsed widget. Routing them
 * through Coverage puts them on the plot itself, in the same voice as every
 * other reason.
 *
 * @param {Object} filterStats  As produced by `createFilterMask`.
 * @param {string} unit  'cells' | 'genes'.
 * @returns {Coverage}
 */
export function classifyFilterStats(filterStats, unit = 'values') {
    if (!filterStats) return Coverage.unreported(unit);

    const total = typeof filterStats.total === 'number' ? filterStats.total : null;
    const gaps = [];
    const add = (count, source, detail) => {
        if (count > 0) gaps.push({ reason: GAP.FILTERED, detail, source, count });
    };

    add(filterStats.xNaN, 'x-axis', 'points with no x value');
    add(filterStats.yNaN, 'y-axis', 'points with no y value');
    add(filterStats.zNaN, 'z-axis', 'points with no z value');
    if (filterStats.hideNaNActive) {
        add(filterStats.colorNaN, 'colour', 'points with no colour value (hide-NaN is on)');
    }
    if (filterStats.hideOutliersActive) {
        add(filterStats.colorOutliers, 'colour', 'points outside the colour range (hide-outliers is on)');
    }
    if (filterStats.tableFilterActive) {
        add(filterStats.tableFiltered, 'table filter', 'points not in the linked table');
    }

    const hidden = typeof filterStats.filtered === 'number' ? filterStats.filtered : null;
    const shown = (total !== null && hidden !== null) ? Math.max(0, total - hidden) : total;

    if (gaps.length === 0) return Coverage.complete(total, unit);
    return new Coverage({ shown, total, unit, gaps });
}
