/**
 * The score store: where computed gene-signature scores live in the browser,
 * and the one place that asks the server for them. The machinery (the
 * byte-budget cache, one job per key, the estimate and its tiers, the states,
 * the limit on computations at once) is the derived-value store of
 * utils/derived-store.js; this file adds what is particular to scores: their
 * cache key, Float32Array values, and the wording of an empty reply. The server
 * is reached through an injected `api` (utils/gene-score-client.js is the
 * real one).
 *
 * A score's key is the recipe's hash plus the dataset and the cells shown.
 * Title and gene order are not in the hash, so renaming a signature never
 * recomputes. See derived-store.js for a job's life.
 */
import {
    ByteCache, DEFAULT_BUDGET, DEFAULT_MAX_ACTIVE, SETTLED, WORKING, createDerivedStore, estimateKey
} from './derived-store.js';

export { DEFAULT_BUDGET, DEFAULT_MAX_ACTIVE, SETTLED, WORKING, estimateKey };

/**
 * The cache key of a score.
 * @param {{hash: string, dataset: string, subset?: (string|null)}} parts
 * @returns {string}
 */
export function scoreKey({ hash, dataset, subset = null }) {
    return `${hash}\u0001${dataset || ''}\u0001${subset || ''}`;
}

/** A byte-bounded least-recently-used cache of Float32Arrays. */
export class ScoreCache extends ByteCache {
    /** @param {number} [budget] - bytes */
    constructor(budget = DEFAULT_BUDGET) {
        super(budget, (values) => values.byteLength);
    }
}

/**
 * @typedef {import('./derived-store.js').DerivedApi} ScoreApi
 */

/**
 * @param {{api: ScoreApi, budget?: number, maxActive?: number,
 *   limiter?: ReturnType<import('./derived-store.js').createLimiter>}} options
 */
export function createScoreStore({ api, budget = DEFAULT_BUDGET, maxActive = DEFAULT_MAX_ACTIVE, limiter = null }) {
    return createDerivedStore({
        api, budget, maxActive, limiter,
        bytesOf: (values) => values.byteLength,
        emptyMessage: 'No score could be made.',
        refusalReason: 'score_too_expensive'
    });
}
