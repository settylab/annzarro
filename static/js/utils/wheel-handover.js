/**
 * Hand the wheel over to the page when a panel's scroller runs out.
 *
 * The page (#tile-container) scrolls, and inside it a panel may scroll too: a
 * table body, a panel taller than its tile, a list. A browser latches one
 * scroll gesture (a trackpad swipe and its momentum) to the scroller it started
 * in. When that scroller reaches its end the rest of the gesture is dropped, so
 * the page does not move until the user lifts and swipes again; a table at its
 * end, or a panel that scrolls a few pixels, then feels like it holds the wheel.
 *
 * installWheelHandover listens for wheel events on the page. When the innermost
 * scroller under the pointer cannot move further in the wheel's direction, it
 * splits the wheel over the scrollers out from it, each taking up to its room
 * and passing the rest outward (a table body, then its DataTables .row wrapper,
 * then the page), in the same gesture. A scroller that is mid-glide counts as
 * already at its glide target, so ticks during a glide go on to the next one
 * instead of piling onto a scroller that is about to run out. While the inner
 * one can still move, the browser
 * scrolls it as usual. Zoom (ctrl/pinch), sideways wheels and wheels another
 * handler already took (Plotly's 3D zoom) are left alone.
 *
 * Pure helpers (findScrollers, nextWithRoom, splitDelta, pixelDelta) run under node --test.
 */

/** A notch of a mouse wheel moves at least this many px; trackpads send less. */
const NOTCH_PX = 50;
/** A smooth step that has not been extended for this long has ended. */
const SMOOTH_IDLE_MS = 250;

/**
 * Whether `el` scrolls vertically: overflow-y auto or scroll and more than a
 * pixel of content beyond its box (sub-pixel overflow is rounding, not content).
 */
export function isScroller(el, getStyle) {
    if (!el || el.scrollHeight - el.clientHeight <= 1) return false;
    const oy = getStyle(el).overflowY;
    return oy === 'auto' || oy === 'scroll' || oy === 'overlay';
}

/** Whether `el` can still move by `dy` (down for dy > 0). */
export function hasRoom(el, dy) {
    if (dy > 0) return el.scrollHeight - el.clientHeight - el.scrollTop > 0.5;
    return el.scrollTop > 0.5;
}

/** The vertical scrollers from `target` out to `root` (inclusive), innermost first. */
export function findScrollers(target, root, getStyle) {
    const out = [];
    for (let el = target; el; el = el.parentElement) {
        if (isScroller(el, getStyle)) out.push(el);
        if (el === root) break;
    }
    return out;
}

/**
 * The scroller that should take a wheel of `dy` the browser would drop: null
 * while the innermost scroller can still move (the browser scrolls it), else
 * the next one out that can.
 */
export function nextWithRoom(scrollers, dy) {
    if (!scrollers.length || hasRoom(scrollers[0], dy)) return null;
    return scrollers.slice(1).find(el => hasRoom(el, dy)) || null;
}

/**
 * Split a wheel of `dy` over `scrollers` (innermost first): each takes up to
 * its room in that direction and the rest passes outward. `posOf(el)` is where
 * the scroller is heading (its glide target while gliding, else its scrollTop).
 * Returns [{el, dy}] for the scrollers that take a share; the part no scroller
 * has room for is dropped.
 */
export function splitDelta(scrollers, dy, posOf = (el) => el.scrollTop) {
    const out = [];
    let left = dy;
    for (const el of scrollers) {
        if (Math.abs(left) < 0.5) break;
        const pos = posOf(el);
        const room = left > 0 ? el.scrollHeight - el.clientHeight - pos : pos;
        if (room <= 0.5) continue;
        const take = left > 0 ? Math.min(left, room) : Math.max(left, -room);
        out.push({ el, dy: take });
        left -= take;
    }
    return out;
}

/** The wheel's vertical delta in px (deltaMode 1 = lines, 2 = pages). */
export function pixelDelta(event, pageHeight) {
    if (event.deltaMode === 1) return event.deltaY * 16;
    if (event.deltaMode === 2) return event.deltaY * pageHeight;
    return event.deltaY;
}

/**
 * Listen on `root` (the page's scroller) and hand wheels over as above.
 * @param {HTMLElement} root
 * @param {Window} [win]
 * @returns {() => void} removes the listener
 */
export function installWheelHandover(root, win = window) {
    if (!root || root._wheelHandover) return () => {};
    const getStyle = (el) => win.getComputedStyle(el);
    // Per scroller: where a run of smooth steps is heading, and when it was last extended
    const smooth = new WeakMap();

    // Where `el` is heading: its glide target while a glide is running, else where it is
    const liveRun = (el) => {
        const run = smooth.get(el);
        return run && win.performance.now() - run.at < SMOOTH_IDLE_MS ? run : null;
    };
    const posOf = (el) => liveRun(el)?.to ?? el.scrollTop;

    // `glide`: the wheel was a mouse notch, so each share glides; else shares apply directly
    const scrollBy = (el, dy, glide) => {
        const max = el.scrollHeight - el.clientHeight;
        const to = Math.max(0, Math.min(max, posOf(el) + dy));
        if (!glide) {                           // trackpad: already fine-grained
            smooth.delete(el);
            el.scrollTop = to;
            return;
        }
        // Mouse wheel notch: glide like the browser's own wheel scrolling,
        // heading on from where the previous step was going
        smooth.set(el, { to, at: win.performance.now() });
        el.scrollTo({ top: to, behavior: 'smooth' });
    };

    const onWheel = (event) => {
        if (event.defaultPrevented || event.ctrlKey) return;
        if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
        const dy = pixelDelta(event, root.clientHeight);
        if (!dy) return;
        const target = event.target && event.target.nodeType === 1 ? event.target : event.target?.parentElement;
        const scrollers = findScrollers(target, root, getStyle);
        // The innermost scroller scrolls natively while it has room and no glide of ours is running on it
        if (!scrollers.length) return;
        const inner = scrollers[0];
        if (!liveRun(inner) && hasRoom(inner, dy)) return;
        const shares = splitDelta(scrollers, dy, posOf);
        if (!shares.length) return;
        // The browser would scroll nothing (or, at a gesture's start, chain on its
        // own): take the wheel so the page moves once, and moves now.
        if (event.cancelable) event.preventDefault();
        const glide = Math.abs(dy) >= NOTCH_PX;
        for (const { el, dy: part } of shares) scrollBy(el, part, glide);
    };

    root.addEventListener('wheel', onWheel, { passive: false });
    root._wheelHandover = true;
    return () => {
        root.removeEventListener('wheel', onWheel, { passive: false });
        delete root._wheelHandover;
    };
}
