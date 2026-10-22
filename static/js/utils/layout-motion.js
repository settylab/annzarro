/**
 * Short eased transitions for the layout's size changes: a split opening, a
 * pane's chooser growing its row and the chosen panel shrinking it back, a
 * pane closing and its sibling taking the space. The layout code is unchanged
 * and so are the sizes it ends at; only the way between them is animated.
 *
 * FLIP on the clamping properties: capture() records each row's height
 * before a change; on the next frame (before paint) the new sizes are
 * measured, each element is pinned at its old size (a row by 'height', a pane
 * by 'max-width') and transitioned to the new one, and the inline styles are
 * removed when the transition ends. Rows are overflow: clip, so content
 * taller than the moving row is clipped, not squeezed. 'height: auto' cannot
 * be transitioned itself, and the View Transitions API cross-fades snapshots
 * (a stretched plot image) and is missing in Firefox.
 *
 * Plots do not follow the frames: listeners.js asks moving() and defers its
 * Plotly relayout to afterMotion(), which runs it once at the end.
 *
 * prefers-reduced-motion: reduce turns all of it off.
 */

const DURATION_MS = 180;
const EASING = 'cubic-bezier(0.2, 0, 0, 1)'; // ease-out: quick start, soft landing

let _rows = null;          // Map row -> height before the change, while a play is pending
let _slides = [];          // [element, width before] to transition by max-width
let _running = null;       // {pinned, timer} of the transition on screen
let _flex = null;          // {els, timer} of the split sizes easing, while they do
const _after = new Set();  // callbacks deferred to the end of the transition

function reduced() {
    return typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** True while a layout transition is on screen (or about to start). */
export function moving() {
    return _running !== null || _rows !== null || _flex !== null;
}

/** Resolves once no layout transition is on screen (at once when none is). */
export function whenIdle() {
    return new Promise(resolve => afterMotion(resolve));
}

/**
 * Ease split panes to new sizes (a split moved by a history step): the same
 * duration and easing as the other transitions, on flex-grow. Plots refit
 * once at the end (afterMotion), not on every frame. A second call while one
 * runs lets the first land at once, then eases from there.
 * @param {Array<[HTMLElement, number]>} changes - [pane, new flex value]
 */
export function flex(changes) {
    const todo = changes.filter(([el, value]) => el.isConnected && parseFloat(el.style.flex) !== value);
    if (_flex) endFlex();
    if (reduced() || typeof requestAnimationFrame !== 'function' || !todo.length) {
        for (const [el, value] of changes) el.style.flex = `${value}`;
        return;
    }
    const els = [];
    for (const [el] of todo) {
        els.push([el, el.style.transition]);
        el.style.transition = `flex-grow ${DURATION_MS}ms ${EASING}`;
    }
    void document.body.offsetHeight; // start from the old sizes
    for (const [el, value] of changes) el.style.flex = `${value}`;
    _flex = { els, timer: setTimeout(endFlex, DURATION_MS + 60) };
}

function endFlex() {
    if (!_flex) return;
    clearTimeout(_flex.timer);
    for (const [el, transition] of _flex.els) el.style.transition = transition;
    _flex = null;
    finish();
}

/**
 * Run fn once the current transition ends; at once when none is running.
 * The same function queued twice runs once.
 * @param {Function} fn
 */
export function afterMotion(fn) {
    if (moving()) _after.add(fn);
    else fn();
}

function finish() {
    if (_running) {
        clearTimeout(_running.timer);
        for (const [el, prev] of _running.pinned) {
            el.style.transition = prev.transition;
            el.style[prev.prop] = prev.value;
        }
        _running = null;
    }
    if (moving()) return;
    const fns = [..._after];
    _after.clear();
    for (const fn of fns) {
        try { fn(); } catch (e) { console.error('layout motion callback:', e); }
    }
}

/**
 * Record the rows' heights before a layout change; the transition plays on
 * the next frame, after the rest of the change (a chooser removing itself)
 * has run. Calls before that frame add to the same transition.
 * @param {HTMLElement} [slideIn] - A new pane that opens from zero width
 * @param {HTMLElement} [widen] - An element whose width changes; its width now
 */
export function capture({ slideIn = null, widen = null } = {}) {
    if (reduced() || typeof requestAnimationFrame !== 'function') return;
    if (_rows === null) {
        // a second change mid-transition starts from where the first ends
        if (_running) finish();
        _rows = new Map();
        for (const row of document.querySelectorAll('.tile-container > .panel-wrapper')) {
            _rows.set(row, row.getBoundingClientRect().height);
        }
        requestAnimationFrame(play);
    }
    if (slideIn) _slides.push([slideIn, 0]);
    if (widen) _slides.push([widen, widen.getBoundingClientRect().width]);
}

function play() {
    const moves = [];
    const held = [];  // [element, property, px]: content held at its final size while its box moves
    for (const [row, from] of _rows) {
        if (!row.isConnected) continue;
        const to = row.getBoundingClientRect().height;
        if (Math.abs(to - from) > 1) moves.push([row, 'height', from, to]);
        // a shrinking row's content does not stretch into the room it is
        // leaving (a plot drawn taller, a chooser scrolled to lower down)
        if (to < from - 1) for (const child of row.children) held.push([child, 'maxHeight', child.getBoundingClientRect().height]);
    }
    for (const [el, from] of _slides) {
        if (!el.isConnected) continue;
        const to = el.getBoundingClientRect().width;
        if (Math.abs(to - from) > 1) moves.push([el, 'maxWidth', from, to]);
        // the opening pane's chooser is laid out once, at its final width, and
        // revealed, rather than rewrapped on every frame
        if (from === 0) for (const child of el.children) held.push([child, 'minWidth', child.getBoundingClientRect().width]);
    }
    _rows = null;
    _slides = [];
    if (!moves.length) { finish(); return; }

    const pinned = new Map();
    for (const [el, prop, from] of moves) {
        pinned.set(el, { prop, value: el.style[prop], transition: el.style.transition });
        el.style.transition = 'none';
        el.style[prop] = `${from}px`;
    }
    for (const [el, prop, px] of held) {
        pinned.set(el, { prop, value: el.style[prop], transition: el.style.transition });
        el.style[prop] = `${px}px`;
    }
    void document.body.offsetHeight; // start from the old sizes
    const cssProp = { height: 'height', maxWidth: 'max-width' };
    for (const [el, prop, , to] of moves) {
        el.style.transition = `${cssProp[prop]} ${DURATION_MS}ms ${EASING}`;
        el.style[prop] = `${to}px`;
    }
    // Ends on the last transitionend; the timer covers a transition that
    // never runs (an element removed meanwhile, a hidden tab)
    let left = moves.length;
    const done = (e) => {
        if (e.target !== e.currentTarget || !pinned.has(e.target)) return;
        e.target.removeEventListener('transitionend', done);
        if (--left === 0 && _running && _running.pinned === pinned) finish();
    };
    for (const [el] of moves) el.addEventListener('transitionend', done);
    _running = { pinned, timer: setTimeout(finish, DURATION_MS * 4) };
}
