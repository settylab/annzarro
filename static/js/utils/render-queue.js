/**
 * Coalesced redraws for controls that fire faster than a plot can draw.
 *
 * A range input fires `input` for every pixel of a drag. The point size and
 * opacity sliders used to redraw the plot on each one behind a 5 ms debounce,
 * shorter than one redraw, so a drag stacked redraws back to back and input
 * waited behind them.
 *
 * `coalesce(run)` returns a `request(...args)` that never runs `run`
 * concurrently with itself and never queues more than one pending call:
 *
 *   - idle: wait `delay` ms from the first request, then run with the newest args;
 *   - busy: remember only the newest args; when the running call has finished
 *     (its promise settled and the next frame painted), run once more with them.
 *
 * So the control stays free to emit events, the plot shows the latest value
 * as soon as the previous draw is on screen, and the final value always lands.
 */

// After a draw: let the browser paint it, then give queued input and timers a
// turn before the next draw starts, so a long drag cannot starve the page.
const nextFrame = () => new Promise(resolve => {
    const yieldTask = () => setTimeout(resolve, 0);
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(yieldTask);
    else yieldTask();
});

/**
 * @param {Function} run - The redraw; may return a promise.
 * @param {Object} [options]
 * @param {number} [options.delay=30] - Wait after the first request while idle, in ms.
 * @param {Function} [options.onError] - Called with an error thrown by `run`.
 * @param {Function} [options.afterRun] - Awaited after each run before the next
 *     may start; defaults to waiting one animation frame (the draw is painted).
 * @returns {Function & {pending: Function, flush: Function}}
 */
export function coalesce(run, { delay = 30, onError = null, afterRun = nextFrame } = {}) {
    let running = false;
    let pendingArgs = null;
    let timer = null;
    let settled = Promise.resolve();

    async function drain() {
        running = true;
        try {
            while (pendingArgs) {
                const args = pendingArgs;
                pendingArgs = null;
                try {
                    await run(...args);
                } catch (error) {
                    if (onError) onError(error);
                    else console.error('Coalesced redraw failed:', error);
                }
                await afterRun();
            }
        } finally {
            running = false;
        }
    }

    function start() {
        timer = null;
        settled = drain();
    }

    function request(...args) {
        pendingArgs = args;
        if (running || timer !== null) return;
        timer = setTimeout(start, delay);
    }

    /** Whether a call is running or waiting to run. */
    request.pending = () => running || timer !== null || pendingArgs !== null;

    /** Resolves once every requested call has run. */
    request.flush = async () => {
        if (timer !== null) {
            clearTimeout(timer);
            start();
        }
        await settled;
    };

    return request;
}
