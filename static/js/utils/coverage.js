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
    /**
     * The view needs a selection the user has not made yet -- an obsp/varp or
     * layer column is defined RELATIVE to a focused cell or gene, and none is
     * focused.
     *
     * This is its own reason rather than a flavour of UNAVAILABLE because the
     * two differ in every way that matters to a reader: nothing is missing from
     * the dataset, nothing failed, and the fix is one click rather than a data
     * problem. Folding it into UNAVAILABLE produced the literal sentence
     * "not in this dataset -- no cell is focused", which is incoherent. It is
     * the lowest severity for the same reason: it is benign and
     * self-correcting.
     */
    UNFOCUSED: 'unfocused',
    /** The request hit a server-side cap (max_cells/max_genes per request). */
    CAPPED: 'capped',
    /**
     * Cells the cell subset (or its current part) does not show. Not loaded
     * at all, so no filter counts them; `withOutside` adds them to the total.
     */
    OUTSIDE: 'outside',
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
    [GAP.OUTSIDE]: 'Some cells are not in the subset',
    [GAP.UNAVAILABLE]: 'Some data is not available for this dataset',
    [GAP.UNFOCUSED]: 'Nothing is focused yet',
    [GAP.CAPPED]: 'The request hit a server limit',
    [GAP.UNREPORTED]: 'Coverage not reported'
});

/** Human-facing label per reason, used in the notice body. */
const GAP_LABEL = Object.freeze({
    [GAP.EMPTY]: 'no values',
    [GAP.FAILED]: 'failed to read',
    [GAP.FILTERED]: 'filtered out',
    [GAP.OUTSIDE]: 'not loaded',
    [GAP.UNAVAILABLE]: 'not in this dataset',
    [GAP.UNFOCUSED]: 'needs a focused selection',
    [GAP.CAPPED]: 'server limit reached',
    [GAP.UNREPORTED]: 'not reported'
});

/** A label that says more than its reason's, for a gap of this kind. */
const KIND_LABEL = Object.freeze({
    mode: 'not available in large-plot mode',
    // a categorical column with more categories than can be coloured by
    // (utils/categories.js): nothing failed and nothing is missing
    categories: 'too many categories to colour by',
    // the gene set panel's external services: ids a service does not know,
    // a request that failed, a request not made (species, limit, turned off)
    unmapped: 'not found by the service',
    request: 'request failed',
    unsupported: 'not covered by the service',
    'over-limit': "over the service's limit",
    disabled: 'external services are turned off',
    declined: 'not sent: declined for this service'
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
    [GAP.OUTSIDE]: 1,
    [GAP.UNFOCUSED]: 1,
    [GAP.EMPTY]: 2,
    [GAP.UNAVAILABLE]: 2,
    [GAP.CAPPED]: 3,
    [GAP.FAILED]: 4,
    [GAP.UNREPORTED]: 5
});

/** Severity bucket used for styling; see `.coverage-notice--*` in styles.css. */
const SEVERITY_CLASS = Object.freeze({
    [GAP.FILTERED]: 'notice',
    [GAP.OUTSIDE]: 'notice',
    [GAP.UNFOCUSED]: 'notice',
    [GAP.EMPTY]: 'warning',
    [GAP.UNAVAILABLE]: 'warning',
    [GAP.CAPPED]: 'warning',
    [GAP.FAILED]: 'error',
    [GAP.UNREPORTED]: 'unreported'
});

function fmt(n) {
    return typeof n === 'number' && isFinite(n) ? n.toLocaleString() : String(n);
}

/**
 * A count and its noun, singular for one: "1 gene", "2 genes". Units are
 * plural nouns ('cells', 'genes', 'values'); `format` writes the number.
 * @param {number} n
 * @param {string} unit
 * @param {(n: number) => string} [format]
 * @returns {string}
 */
export function countNoun(n, unit, format = fmt) {
    const noun = n === 1 && typeof unit === 'string'
        ? unit.replace(/ies$/, 'y').replace(/s$/, '') : unit;
    return `${format(n)} ${noun}`;
}

function isReason(value) {
    return Object.values(GAP).includes(value);
}

/** A value that occupies a slot but carries nothing. See `classifyValues`. */
function isBlank(v) {
    return v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v));
}

/**
 * One reason a slice of the requested data is not on screen.
 *
 * @typedef {Object} Gap
 * @property {string} reason  One of `GAP.*`.
 * @property {string} detail  Free text shown to the user; say what and why.
 * @property {string} source  Where it applies, e.g. `obs.celltype`, `x-axis`.
 * @property {number|null} count  How many entities this gap accounts for.
 * @property {string} kind  What undoes it, for the status strip: 'outside',
 *   'coords', 'table', 'nan', 'outliers', 'mode' (a limit of large-plot
 *   mode), or '' (nothing the panel can undo).
 * @property {string[]|null} names  The entities by name, when known: the
 *   breakdown lists every one of them (the detail stays a short summary).
 * @property {boolean} hides  Whether those entities are off the screen. A gap
 *   of a DESCRIBES contributor (a colour column) does not hide its points.
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
                count: typeof g.count === 'number' ? g.count : null,
                hides: this.role === ROLE.DESCRIBES ? false : g.hides !== false,
                kind: g.kind || '',
                // every entity the gap is about, by name, when it names them
                // (the genes a service did not know); the breakdown lists them all
                names: Array.isArray(g.names) ? Object.freeze(g.names.map(String)) : null
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

    /**
     * Returns a new Coverage that also counts `count` entities the subset (or
     * its part) does not show: they join the total, and a gap says why. The
     * total is then the dataset's, as the header's "Cells: 50 of 200" is.
     * @param {number} count
     * @param {string} detail  e.g. 'not in part 2 of 4'
     */
    withOutside(count, detail) {
        if (!(count > 0)) return this;
        return new Coverage({
            shown: this.shown,
            total: typeof this.total === 'number' ? this.total + count : this.total,
            unit: this.unit, role: this.role,
            gaps: [{ reason: GAP.OUTSIDE, detail, source: 'subset', count, kind: 'outside' }, ...this.gaps]
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
     * That is a different condition from "something restricts and did not say
     * how much": a restricting contributor with `shown === null`
     * (`Coverage.unreported()` is one by construction). It used to vanish from
     * the minimum and land in the same `: total` arm, so a panel whose only
     * statement was that a read failed came out as "every entity is on
     * screen" (settylab/annzarro#37). A minimum over the contributors that
     * spoke is only an UPPER bound when one did not, so `shown` is then
     * unknown -- `null`, except at zero, which no count is below -- and a gap
     * says so if no contributor already does.
     *
     * `total` stays the maximum over ALL contributors, describing ones
     * included. A colour or table column that expected more entities than any
     * restricting series counted is the only evidence that the difference is
     * missing; taking the total over the restrictors alone would drop that
     * evidence and report the panel complete. The disagreement is stated as a
     * gap rather than left as a bare count with no reason under it.
     *
     * `UNREPORTED` survives merging (it is a gap like any other), so combining
     * a described series with an undescribed one does not launder the latter.
     *
     * The merged value RESTRICTS: its `shown` is a real entity count (or
     * `null`), so a panel coverage re-merged with a filter mask bounds
     * correctly.
     */
    static merge(coverages, unit = null) {
        const list = coverages.filter(Boolean);
        if (list.length === 0) return Coverage.unreported(unit || 'values');

        const restricting = list.filter(c => c.role !== ROLE.DESCRIBES);
        const shownVals = restricting.map(c => c.shown).filter(v => typeof v === 'number');
        const declined = restricting.length - shownVals.length;
        const totalVals = list.map(c => c.total).filter(v => typeof v === 'number');
        const restrictTotals = restricting.map(c => c.total).filter(v => typeof v === 'number');
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
        const max = (vals) => vals.reduce((a, b) => (b > a ? b : a));
        const total = totalVals.length ? max(totalVals) : null;
        const resolvedUnit = unit || list[0].unit;
        let shown;
        if (restricting.length === 0) {
            shown = total;
        } else if (declined > 0) {
            // ... unless the contributors that spoke already bound it at zero:
            // no count is below that, so "nothing is shown" stays exact.
            shown = (shownVals.length && shownVals.some(v => v === 0)) ? 0 : null;
            // A contributor that declined AND gave no reason would leave the
            // panel with an unknown count and nothing saying so.
            if (restricting.some(c => typeof c.shown !== 'number' && c.gaps.length === 0)) {
                gaps.push({
                    reason: GAP.UNREPORTED,
                    detail: `how many ${resolvedUnit} are on screen was not reported`,
                    source: '', count: null
                });
            }
        } else {
            shown = shownVals.reduce((a, b) => (b < a ? b : a));
            const counted = restrictTotals.length ? max(restrictTotals) : null;
            if (counted !== null && total !== null && total > counted) {
                gaps.push({
                    reason: GAP.UNREPORTED,
                    detail: `the series on this panel disagree about how many ${resolvedUnit} `
                        + `there are (${fmt(counted)} drawn from, ${fmt(total)} expected); `
                        + 'nothing reports why the rest are missing',
                    source: '', count: total - counted
                });
            }
        }
        return new Coverage({
            shown,
            total,
            unit: resolvedUnit,
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
        if (this.gaps.length && this.gaps.every(g => g.kind === 'categories')) return 'Not coloured: too many categories';
        return REASON_HEADLINE[this.worstReason] || 'Incomplete data shown';
    }

    /**
     * One explanatory line per gap: what is missing, and why.
     * This is the part the operator asked for -- the "why" is never dropped.
     */
    lines() {
        return this.gaps.map(g => {
            const where = g.source ? `${g.source}: ` : '';
            const label = KIND_LABEL[g.kind] || GAP_LABEL[g.reason] || g.reason;
            const count = typeof g.count === 'number' && g.count > 0
                ? ` (${countNoun(g.count, this.unit)})` : '';
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
        // Present but empty. Every obs column is aligned to `n_obs` by
        // AnnData's definition, so on a dataset with entities a healthy column
        // the reader CAN read has exactly that many values: this is a failed
        // read, NOT a legitimately empty column.
        //
        // "the reader CAN read" is load-bearing rather than a hedge. An AnnData
        // nullable dtype (`nullable-integer`, `nullable-boolean`,
        // `nullable-string-array`) is stored as a `{values, mask}` GROUP, and a
        // reader that slices it as an array gets nothing -- a healthy column
        // arriving zero-length, which would make this inference false. That is
        // repaired upstream of here: `zarr_reader._read_member` reads such a
        // group through its two children (settylab/annzarro#26), and
        // `annzarro/tests/core/test_nullable_encodings.py::
        // test_masked_entries_become_none` measures a nullable column reading
        // back at full length with masked entries as null. An encoding the
        // reader cannot read no longer arrives here at all: a group with no
        // known encoding used to be caught in `get_obs_var` and served as `[]`
        // at 200 (two obs columns of a served dataset, settylab/annzarro#41);
        // it is now `400 unsupported_type`, and a failed read `500
        // read_failed`, both classified by `classifyError`. So the premise
        // holds, and if a future encoding does not read, the right fix is in
        // the reader -- not a softer sentence here.
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
    // short-circuits on the first real value, so the healthy case costs one
    // comparison.
    //
    // NaN counts as blank, and that is not defensive coding. The plot's
    // obsp/varp/layer arms normalise null -> NaN to preserve array length
    // BEFORE classification (`plot-make.js`), so a check for null/undefined
    // alone is defeated by the caller's own preprocessing: the table saw
    // "every entry in this column is blank" and the plot, from the same data,
    // rendered an empty scatter and said NOTHING. That is the 2026-08-28
    // symptom surviving inside the fix for it.
    if (values.every(isBlank)) {
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
 * This encodes the server's semantics for a `200` body (measured live
 * 2026-08-28 against `/api/v1/data/obs`, annzarro @ zarr 3.1.6):
 *
 *   - a requested column that does NOT exist was silently dropped: the
 *     response is `200 {"data": {}}` with the key ABSENT
 *     (`zarr_reader.get_obs_var` filters `column_names` by group membership);
 *   - a column that FAILED to read came back as the key PRESENT with `[]`;
 *   - a healthy column comes back with exactly `n_obs` values.
 *
 * So key-absent vs key-present-but-short is the discriminator between
 * "not in this dataset" and "failed to read". The current server answers both
 * before a body is built -- `404 key_not_found` for a column it does not list,
 * `400 unsupported_type` / `500 read_failed` for one it cannot read
 * (settylab/annzarro#41) -- and those reach `classifyError` instead. The body
 * rules stay for a server that predates that, and for one with no metadata
 * to check a column against.
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
 * The column names a specific cell or gene, and THIS dataset does not have it.
 *
 * Both surfaces reach this state -- an `obsp`/`varp` column keyed on a cell, a
 * `layer` column keyed on a gene -- and both used to describe it differently:
 * the table filled the column with nulls and reported "every entry is blank"
 * (legitimately absent data), while the plot threw a bare Error carrying no
 * classification at all. Same condition, two wrong answers, neither of them
 * "the thing you named is not here". One sentence, one reason, both surfaces.
 *
 * @param {string} kind  'cell' | 'gene'.
 * @param {string} name  The entity named by the column, if any.
 * @param {Object} [opts] `{ source, unit, total, role }`
 * @returns {Coverage}
 */
export function missingEntity(kind, name, { source = '', unit = 'values', total = null, role = ROLE.RESTRICTS } = {}) {
    // TWO conditions, not one. `cellIndex === -1` collapses them, and they have
    // different consequences for the reader: a stale name is a dataset
    // mismatch (the common case after switching dataset -- benign and
    // self-correcting, but it IS about this dataset), whereas no name at all
    // means the user has simply not picked a reference entity yet, which is not
    // a statement about the data at all.
    if (!name) {
        return Coverage.missing(
            GAP.UNFOCUSED,
            `this column is measured relative to a focused ${kind}, and none is `
            + `focused yet -- pick a ${kind} to fill it in`,
            { source, unit, total, role }
        );
    }
    return Coverage.missing(
        GAP.UNAVAILABLE,
        `the ${kind} "${name}" is not in this dataset`,
        { source, unit, total, role }
    );
}

/**
 * The column names a cell located by `DataManager.locateCell`, and its row
 * cannot be read. Under a subset a cell that is not shown is still in the
 * dataset and is read by its dataset row, so "not in this dataset" is said
 * only when the dataset really lacks it. An older server cannot read a cell
 * outside the subset, nor say whether the dataset has it: that is said as it is.
 *
 * @param {Object|null} cell  `{name, unreadable?}` from locateCell, or null
 *                            (no cell focused).
 * @param {Object} [opts] `{ source, unit, total, role }`
 * @returns {Coverage}
 */
export function unreadableCell(cell, opts = {}) {
    if (cell && cell.unreadable) {
        const { source = '', unit = 'values', total = null, role = ROLE.RESTRICTS } = opts;
        return Coverage.missing(
            GAP.UNAVAILABLE,
            `the cell "${cell.name}" is not among the cells shown, and this server cannot `
            + 'read a cell outside the subset',
            { source, unit, total, role }
        );
    }
    return missingEntity('cell', cell ? cell.name : null, opts);
}

/**
 * Classify a column read from a MATRIX-shaped member: `obsm`, `varm`, `obsp`,
 * `varp`, `layer`.
 *
 * These do not share `obs`/`var`'s contract: there is no key-presence signal in
 * the body to inspect, so `classifyColumn`'s discriminator does not apply.
 *
 * An empty array here used to mean "not in this dataset", because a missing
 * `obsm`/`varm` key answered `200` with `"data": []`. That stopped being true
 * from both ends. The server now answers a key it does not list with
 * `404 key_not_found` (`classifyError` -> UNAVAILABLE), and a key it DOES list
 * reads or raises rather than coming back empty (settylab/annzarro#42: a
 * sparse `X_cnv` and cell2location DataFrames, listed by `dataset_structure`,
 * were read as `[]` and badged "not in this dataset" on 15 keys of 10 served
 * datasets). So an empty array on a dataset with entities is the same claim
 * it is for `obs`: listed, and the read produced nothing -- FAILED.
 *
 * That rule lived only in `plot-make.js`, so the table read the identical body
 * in the opposite direction: `unavailable` (warning) on the plot,
 * `failed` (error) on the table, side by side on one page. It is here so both
 * surfaces consult it, which is the only thing that makes them agree.
 *
 * @param {Object} spec  As `classifyValues`, plus `key` for the message.
 * @returns {Coverage}
 */
export function classifyMatrixColumn({ values, expected = null, unit = 'values', source = '', role = ROLE.RESTRICTS, key = '' } = {}) {
    // An EMPTY ARRAY and a non-array body are both failures, with different
    // sentences: a body that is not an array at all is MALFORMED, and naming
    // what was sent points at the right question.
    if (!Array.isArray(values)) {
        // Malformed, and worth saying so specifically: naming the shape the
        // server actually sent points the reader at the right question, where
        // the generic "returned no values" sentence does not. This lived only
        // in the plot, so the two surfaces reached the same REASON by different
        // sentences -- agreement on the verdict and disagreement on the words
        // is still a divergence, and the better sentence is the one to share.
        return Coverage.missing(
            GAP.FAILED,
            `"${key || source}" returned an unexpected format (${typeof values})`,
            { source, unit, total: expected, role }
        );
    }
    if (values.length === 0 && typeof expected === 'number' && expected > 0) {
        return Coverage.missing(
            GAP.FAILED,
            `"${key || source}" is listed by this dataset but returned no values; `
            + 'the server could not read it',
            { source, unit, total: expected, role }
        );
    }
    return classifyValues({ values, expected, unit, source, role });
}

/**
 * Classify the slice of a matrix taken AT one cell or gene: an obsp/varp row,
 * or a layer row/column picked by a focused (or fixed) entity.
 *
 * Such a slice can be full length and entirely blank while every request
 * succeeded: a varp written for a subset of genes (a correlation computed
 * for highly variable genes only, say) carries all-NaN rows for every other
 * gene. `classifyValues` then said "every entry in this column is blank
 * (nothing was available to fill it)", which is true and does not tell the
 * user the one thing they need -- the ENTITY they picked is not covered by
 * this matrix, and a different one would be. Reported from a live instance:
 * a gene plot coloured by a varp row turned uniformly grey on the dataset's
 * default (first) gene, with nothing on screen saying why or what to do.
 *
 * Everything that is not "full length and all blank" goes through
 * `classifyMatrixColumn` unchanged, so the empty-array and malformed-body
 * rules stay shared with every other matrix read.
 *
 * @param {Object} spec  As `classifyMatrixColumn`, plus:
 * @param {string} spec.kind  'cell' | 'gene' -- what the slice is taken at.
 * @param {string} spec.name  That entity's name.
 * @param {boolean} [spec.focused=true]  Whether it follows the focus (vs. a
 *     fixed/locked entity); only changes the advice.
 * @returns {Coverage}
 */
export function classifyFocusRow({ values, kind, name, focused = true, expected = null, unit = 'values', source = '', role = ROLE.RESTRICTS, key = '' } = {}) {
    if (Array.isArray(values) && values.length > 0 && values.every(isBlank) && name) {
        const matrix = key || source;
        const who = focused ? `the focused ${kind} "${name}"` : `the ${kind} "${name}"`;
        const fix = focused
            ? `focus a ${kind} that "${matrix}" covers`
            : `pick a ${kind} that "${matrix}" covers`;
        return Coverage.missing(
            GAP.EMPTY,
            `${who} has no values in "${matrix}" (every entry for it is blank), `
            + `so this matrix does not cover it -- ${fix}`,
            { source, unit, total: expected, role }
        );
    }
    return classifyMatrixColumn({ values, expected, unit, source, role, key });
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
    // `key_not_found` is the server saying the column/key is not in this
    // dataset (settylab/annzarro#45 answers a missing obs/var column or
    // obsm/varm/obsp/varp/layer key with 404 instead of an empty 200). Read as
    // a generic failure it turned every absent column into "failed to read".
    // `names_not_loaded`: the cell names of a dataset too large to list
    // (remote-names.js) -- a limit of large-plot mode: nothing failed, and the
    // dataset does have them, so not "not in this dataset" either.
    if (serverReason === 'names_not_loaded') {
        return new Coverage({ shown: 0, total, unit, role,
            gaps: [{ reason: GAP.UNAVAILABLE, detail: message, source, count: total, kind: 'mode' }] });
    }
    // `too_many_categories`: a column with more categories than can be
    // coloured by (core/categories.py, utils/categories.js). The points are
    // all drawn; the message says what to use instead.
    if (serverReason === 'too_many_categories') {
        return new Coverage({ shown: total, total, unit, role,
            gaps: [{ reason: GAP.UNAVAILABLE, detail: body.detail || message, source, count: 0, kind: 'categories' }] });
    }
    if (serverReason === 'not_found' || serverReason === 'key_not_found') {
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
 * @param {Object} filterStats  As produced by `createFilterMask`. With
 *   `exclusive` ({coords, table, nan, outliers}: each hidden point counted
 *   once, under the first of those that applies) the lines add up to
 *   `filtered`; without it, the per-reason counts, which may overlap.
 * @param {string} unit  'cells' | 'genes'.
 * @param {Object} [opts]
 * @param {Object} [opts.axisCoverage]  `{ x, y, z }` -- the coverage reported by
 *   the series that loaded each COORDINATE AXIS. When an axis is entirely
 *   absent, the series that loaded it has already said why -- "needs a focused
 *   selection", "not in this dataset" -- and the filter mask, counting the same
 *   entities independently, adds a second line saying they were "filtered out".
 *   Both are true; they are the same fact twice, and the second frames a
 *   not-yet-made selection as a filter.
 * @returns {Coverage}
 */
export function classifyFilterStats(filterStats, unit = 'values', { axisCoverage = null } = {}) {
    if (!filterStats) return Coverage.unreported(unit);

    const total = typeof filterStats.total === 'number' ? filterStats.total : null;
    const gaps = [];
    const add = (count, source, detail, kind = '') => {
        if (count > 0) gaps.push({ reason: GAP.FILTERED, detail, source, count, kind });
    };

    // A series-level reason and a filter line are the SAME FACT only when the
    // series that loaded THAT AXIS has already accounted for every entity the
    // mask is about to count again. Suppression is a rule that DELETES a reason,
    // so each condition below is a route by which it would otherwise remove the
    // only reason a user was going to get:
    //
    //  - it must be that AXIS's OWN coverage, not the panel's. The merged panel
    //    coverage says only that SOMETHING is missing: a colour column awaiting
    //    a focused selection (which DESCRIBES, and by this module's own doctrine
    //    accounts for no entities at all), or an entity-name/point-count
    //    mismatch, each make it incomplete while saying nothing about x.
    //  - it must NAME a reason. `UNREPORTED` is the ABSENCE of one, and reading
    //    "nobody said" as "already said" is precisely the silence this module
    //    exists to end. Both call sites pass `Coverage.unreported()` when a
    //    loader reported nothing, so this arm is load-bearing, not defensive.
    //  - it must account for EVERY entity (`shown === 0`). A series that loaded
    //    150 of 200 does not explain 200 missing points.
    //
    // A partially-NaN axis is a genuine filter and still says so, and colour is
    // never suppressed -- with hide-NaN on it removes points that the colour
    // series' own DESCRIBES coverage does not account for, so dropping that line
    // would hide a real consequence rather than a duplicate one.
    // `shown === 0` would be a PROXY for the condition that actually matters.
    // The question is whether that axis's own coverage ALREADY ACCOUNTS FOR at
    // least the `count` entities the mask is about to count again, so ask that:
    // `total - shown`, against the axis's own total where it has one. The two
    // coincide whenever the axis agrees with the mask about how many entities
    // exist, and come apart when it does not -- a series whose coverage counts
    // 150 while the mask counts 200 explains 150 of them, not 200.
    let suppressed = false;
    const accountedFor = (cov) => {
        const t = (typeof cov.total === 'number') ? cov.total : total;
        return (typeof cov.shown === 'number' && typeof t === 'number')
            ? t - cov.shown : null;
    };
    const explains = (cov, count) => {
        if (!(cov instanceof Coverage) || total === null || count !== total) return false;
        if (!cov.gaps.some(g => g.reason !== GAP.UNREPORTED)) return false;
        const accounted = accountedFor(cov);
        return accounted !== null && accounted >= count;
    };
    const addAxis = (count, source, detail, cov) => {
        if (explains(cov, count)) { suppressed = true; return; }
        add(count, source, detail);
    };

    const only = filterStats.exclusive;
    if (only) {
        // Each hidden point counted once, under the first reason that applies
        // (createFilterMask), so the lines add up to `filtered`. The points an
        // axis's own series already accounts for are its line, not this one.
        const axes = ['x', 'y', 'z'].filter(a => filterStats[`${a}NaN`] > 0);
        let accounted = 0;
        for (const a of axes) {
            const cov = axisCoverage && axisCoverage[a];
            if (!(cov instanceof Coverage) || !cov.gaps.some(g => g.reason !== GAP.UNREPORTED)) continue;
            const n = accountedFor(cov);
            if (n !== null) accounted += Math.min(Math.max(0, n), filterStats[`${a}NaN`]);
        }
        const coords = Math.max(0, (only.coords || 0) - accounted);
        if (only.coords > 0 && coords === 0) suppressed = true;
        add(coords, axes.length === 1 ? `${axes[0]}-axis` : 'coordinates',
            `points with no ${axes.join('/') || 'x/y'} value`, 'coords');
        if (filterStats.tableFilterActive) {
            add(only.table, 'table filter', 'points not in the linked table', 'table');
        }
        if (filterStats.hideNaNActive) {
            add(only.nan, 'colour', 'points with no colour value (Hide NaN is on)', 'nan');
        }
        if (filterStats.hideOutliersActive) {
            add(only.outliers, 'colour', 'points outside the colour range (Hide Outliers is on)', 'outliers');
        }
    } else {
        addAxis(filterStats.xNaN, 'x-axis', 'points with no x value', axisCoverage && axisCoverage.x);
        addAxis(filterStats.yNaN, 'y-axis', 'points with no y value', axisCoverage && axisCoverage.y);
        addAxis(filterStats.zNaN, 'z-axis', 'points with no z value', axisCoverage && axisCoverage.z);
        if (filterStats.hideNaNActive) {
            add(filterStats.colorNaN, 'colour', 'points with no colour value (Hide NaN is on)');
        }
        if (filterStats.hideOutliersActive) {
            add(filterStats.colorOutliers, 'colour', 'points outside the colour range (Hide Outliers is on)');
        }
        if (filterStats.tableFilterActive) {
            add(filterStats.tableFiltered, 'table filter', 'points not in the linked table');
        }
    }

    const hidden = typeof filterStats.filtered === 'number' ? filterStats.filtered : null;
    const shown = (total !== null && hidden !== null) ? Math.max(0, total - hidden) : total;

    // `Coverage.complete(total)` reports `shown = total`, DISCARDING
    // `filterStats.filtered`. That is right for a panel nothing filtered; it is
    // a lie for one where the only gap was suppressed as a duplicate, because
    // those points really are off the screen. Keep the count and drop only the
    // sentence -- the series-level reason supplies the sentence.
    if (gaps.length === 0 && !suppressed) return Coverage.complete(total, unit);
    return new Coverage({ shown, total, unit, gaps });
}

/**
 * A count for the status strip: exact below a million ("99,812"), compact
 * above ("95.6M"). The popover uses exact counts throughout (`exactCount`).
 * @param {number} n
 * @returns {string}
 */
export function compactCount(n) {
    if (typeof n !== 'number' || !isFinite(n)) return String(n);
    if (Math.abs(n) < 1e6) return exactCount(n);
    const [div, unit] = Math.abs(n) >= 1e9 ? [1e9, 'B'] : [1e6, 'M'];
    const x = n / div;
    return (Math.abs(x) >= 100 ? String(Math.round(x)) : x.toFixed(1).replace(/\.0$/, '')) + unit;
}

/** A count with thousands separators: "95,624,334". */
export function exactCount(n) {
    return typeof n === 'number' && isFinite(n) ? n.toLocaleString('en-US') : String(n);
}

/** Short chip text per kind of hidden point (or a function of the gap); see `breakdown`. */
const KIND_CHIP = Object.freeze({
    coords: 'no coordinates', table: 'table filter', nan: 'NaN hidden', outliers: 'outliers hidden',
    unmapped: (g) => `not found in ${g.source || 'the service'}`
});

/** Order in which the breakdown lists reasons, as createFilterMask attributes them. */
const KIND_ORDER = Object.freeze({ outside: 0, coords: 1, '': 2, table: 3, nan: 4, outliers: 5 });

/**
 * What the status strip and its popover say about a Coverage: the headline
 * and one row per reason.
 *
 * `rows` are the gaps that take points off the screen, with their counts; the
 * counts add up to `hidden` (total - shown). Whatever they do not account for
 * is a row of its own, `unattributed`, rendered as UNREPORTED is: a reason
 * nobody gave is displayed, never dropped. `notes` are gaps that hide nothing
 * (a colour column that failed to read over points that are all drawn) or
 * carry no count.
 *
 * @param {Coverage} coverage
 * @returns {{shown: ?number, total: ?number, hidden: ?number, unit: string,
 *   severity: string, headline: string, headlineExact: string,
 *   rows: Array<{kind: string, reason: string, chip: string, label: string,
 *   count: number}>, notes: Array<{reason: string, label: string}>,
 *   unattributed: number}}
 */
export function breakdown(coverage) {
    const cov = coverage instanceof Coverage ? coverage : Coverage.unreported();
    const { shown, total, unit } = cov;
    const counted = typeof shown === 'number' && typeof total === 'number';
    const hidden = counted ? Math.max(0, total - shown) : null;
    const label = (g) => {
        if (g.reason === GAP.OUTSIDE) return g.detail.charAt(0).toUpperCase() + g.detail.slice(1);
        const where = g.source ? `${g.source}: ` : '';
        return `${where}${KIND_LABEL[g.kind] || GAP_LABEL[g.reason] || g.reason}${g.detail ? ` -- ${g.detail}` : ''}`;
    };
    const kindChip = (g) => (typeof KIND_CHIP[g.kind] === 'function' ? KIND_CHIP[g.kind](g) : KIND_CHIP[g.kind]);
    const chip = (g) => g.reason === GAP.OUTSIDE ? g.detail
        : kindChip(g) || `${g.source ? `${g.source} ` : ''}${GAP_LABEL[g.reason] || g.reason}`;
    const rows = [];
    const notes = [];
    for (const g of cov.gaps) {
        if (g.hides && typeof g.count === 'number' && g.count > 0 && counted) {
            rows.push({ kind: g.kind, reason: g.reason, chip: chip(g), label: label(g), count: g.count, names: g.names });
        } else {
            notes.push({ reason: g.reason, label: label(g) });
        }
    }
    rows.sort((a, b) => (KIND_ORDER[a.kind] ?? 2) - (KIND_ORDER[b.kind] ?? 2));
    const sum = rows.reduce((t, r) => t + r.count, 0);
    const unattributed = counted ? Math.max(0, hidden - sum) : 0;
    if (unattributed > 0) {
        rows.push({ kind: 'unattributed', reason: GAP.UNREPORTED, chip: 'no reason given',
            label: GAP_LABEL[GAP.UNREPORTED] + ' -- nothing says why these are not shown', count: unattributed });
    }
    let headline;
    let headlineExact;
    if (!counted) {
        headline = headlineExact = cov.headline() || (typeof total === 'number' ? countNoun(total, unit, exactCount) : unit);
    } else if (hidden === 0) {
        headline = countNoun(total, unit, compactCount);
        headlineExact = countNoun(total, unit, exactCount);
    } else {
        let a = compactCount(shown);
        const b = compactCount(total);
        // "95.6M of 95.6M" would say nothing is missing
        if (a === b) a = exactCount(shown);
        headline = `${a} of ${b} ${unit} shown`;
        headlineExact = `${exactCount(shown)} of ${exactCount(total)} ${unit} shown`;
    }
    return { shown, total, hidden, unit, severity: cov.isComplete ? 'ok' : cov.severity,
        headline, headlineExact, rows, notes, unattributed };
}
