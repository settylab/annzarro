/**
 * The pop-over: one primitive for every option surface that must not change the size or flow of its panel
 * (plot options, colour and size sources, cluster, levels, binning, statistics, settings, add menus).
 *
 * The surface is a non-modal `role="dialog"` (or `role="menu"` for the menu variant) in ONE body-level layer
 * with `position: fixed`, so opening it moves nothing else. It is placed below its anchor (above when there
 * is more room there), clamped to the viewport, and follows the anchor on scroll and resize.
 *
 * Rules every user of this module gets for free:
 *  - One pop-over is open page-wide: opening another closes the first.
 *  - Escape anywhere closes it (document level, capture phase, so a panel's keydown handler cannot eat it)
 *    and puts focus back on the anchor.
 *  - A pointer press outside the surface and the anchor closes it. The press target decides (as the aesthetics
 *    menu's click-away always did), so a drag that starts inside (a slider, a text selection, a colour picker)
 *    and ends outside does not close it. A click outside leaves focus where the click put it.
 *  - The anchor again and the header's close button close it. Both put focus back on the anchor.
 *  - Tab and Shift+Tab cycle inside the surface. Menus also take the arrow keys, Home and End.
 *  - Opening focuses the control used last in that pop-over, else the first.
 *  - It closes when its anchor is removed, hidden or scrolled out of the viewport.
 *
 * Usage:
 *   import { createPopover } from '../ui/popover.js';
 *   const pop = createPopover({
 *       anchor: button,                  // a <button>; gets aria-haspopup, aria-expanded, aria-controls
 *       name: 'cluster',                 // becomes data-popover="cluster" on the surface (test hook)
 *       title: 'Cluster',                // header text, aria-labelledby of the dialog
 *       wide: false,                     // 440 px instead of 320 px
 *       render: (body, ctl) => { ... },  // fills body on every open; may return a cleanup function
 *       onClose: (reason) => { ... }     // after every close; see CLOSE_REASONS
 *   });
 *   pop.toggle();                        // also bound to the anchor's click
 *   pop.destroy();                       // on panel teardown
 *
 * `menu: true` gives the menu variant: `role="menu"`, no header, children marked `role="menuitem"` are
 * reached with the arrow keys, and activating one closes the menu (reason 'select').
 *
 * Styles: static/css/popover.css. Test hooks: `[data-popover=<name>]`, `.az-popover-close`, `.az-popover-body`.
 */

/** Why a pop-over closed, as passed to `onClose`. */
// export-unused-ok: the pop-over API for the panel work packages (WP-2, 5a, 5b, 6, 7, 8)
export const CLOSE_REASONS = Object.freeze(['escape', 'outside', 'anchor', 'button', 'select', 'other', 'anchor-gone', 'api']);

/** Reasons after which focus goes back to the anchor (a keyboard or an explicit close, not a click elsewhere). */
const REFOCUS = new Set(['escape', 'anchor', 'button', 'select']);

// export-unused-ok: the pop-over API for the panel work packages (WP-2, 5a, 5b, 6, 7, 8)
export const POPOVER_WIDTH = 320;
// export-unused-ok: the pop-over API for the panel work packages (WP-2, 5a, 5b, 6, 7, 8)
export const POPOVER_WIDE = 440;
// export-unused-ok: the pop-over API for the panel work packages (WP-2, 5a, 5b, 6, 7, 8)
export const POPOVER_MARGIN = 8;
// export-unused-ok: the pop-over API for the panel work packages (WP-2, 5a, 5b, 6, 7, 8)
export const POPOVER_GAP = 4;
/** Under this viewport width the surface is a full-width sheet. */
// export-unused-ok: the pop-over API for the panel work packages (WP-2, 5a, 5b, 6, 7, 8)
export const SHEET_BELOW = 480;
/** The surface is at most this share of the viewport height. */
// export-unused-ok: the pop-over API for the panel work packages (WP-2, 5a, 5b, 6, 7, 8)
export const MAX_HEIGHT_SHARE = 0.8;

/**
 * Where to put a surface.
 * @param {{left:number,top:number,right:number,bottom:number}} anchor Anchor rectangle, viewport coordinates.
 * @param {{width:number,height:number}} size Natural size of the surface (height unconstrained).
 * @param {{width:number,height:number}} viewport
 * @param {{margin?:number,gap?:number}} [opts]
 * @returns {{left:number,top:number,width:number,maxHeight:number,side:'below'|'above',sheet:boolean}}
 */
// export-unused-ok: the pop-over API for the panel work packages (WP-2, 5a, 5b, 6, 7, 8)
export function placePopover(anchor, size, viewport, opts = {}) {
    const margin = opts.margin ?? POPOVER_MARGIN;
    const gap = opts.gap ?? POPOVER_GAP;
    const sheet = viewport.width < SHEET_BELOW;
    const room = Math.max(0, viewport.width - 2 * margin);
    const width = sheet ? room : Math.min(size.width, room);
    const left = sheet ? margin : Math.min(Math.max(anchor.left, margin), Math.max(margin, viewport.width - margin - width));
    const below = viewport.height - margin - anchor.bottom - gap;
    const above = anchor.top - gap - margin;
    const cap = viewport.height * MAX_HEIGHT_SHARE;
    // Below unless it does not fit there and there is more room above.
    const side = size.height > below && above > below ? 'above' : 'below';
    const maxHeight = Math.max(0, Math.floor(Math.min(cap, side === 'below' ? below : above)));
    const height = Math.min(size.height, maxHeight);
    const top = side === 'below' ? anchor.bottom + gap : anchor.top - gap - height;
    return { left, top, width, maxHeight, side, sheet };
}

/**
 * The press-target rule: a click follows the press that began it. `pressed` is whether the last pointerdown
 * landed inside (null when the click came without one, a synthetic click); `target` is whether the click's own
 * target is inside. Returns whether the click counts as inside.
 */
// export-unused-ok: the pop-over API for the panel work packages (WP-2, 5a, 5b, 6, 7, 8)
export function pressInside(pressed, target) {
    return pressed !== null && pressed !== undefined ? !!pressed : !!target;
}

/** Index Tab (or Shift+Tab) moves to inside a surface of `count` focusable controls; -1 when there are none. */
// export-unused-ok: the pop-over API for the panel work packages (WP-2, 5a, 5b, 6, 7, 8)
export function nextTabIndex(index, count, shift) {
    if (count <= 0) return -1;
    if (index < 0) return shift ? count - 1 : 0;
    return shift ? (index - 1 + count) % count : (index + 1) % count;
}

/** Index a menu moves to on `key` (ArrowDown, ArrowUp, Home, End), wrapping; the same index for other keys. */
// export-unused-ok: the pop-over API for the panel work packages (WP-2, 5a, 5b, 6, 7, 8)
export function nextMenuIndex(index, count, key) {
    if (count <= 0) return -1;
    if (key === 'Home') return 0;
    if (key === 'End') return count - 1;
    if (key === 'ArrowDown') return index < 0 ? 0 : (index + 1) % count;
    if (key === 'ArrowUp') return index < 0 ? count - 1 : (index - 1 + count) % count;
    return index;
}

/**
 * The one-open-page-wide rule as a small state machine. `open(token, closeFn)` makes `token` the open one and
 * closes the previous (calls its `closeFn`); `closed(token)` clears it if it is still the open one.
 */
// export-unused-ok: the pop-over API for the panel work packages (WP-2, 5a, 5b, 6, 7, 8)
export function createRegistry() {
    let current = null;
    return {
        open(token, closeFn) {
            const prev = current;
            current = { token, closeFn };
            if (prev && prev.token !== token) prev.closeFn();
            return prev ? prev.token : null;
        },
        closed(token) {
            if (current && current.token === token) current = null;
        },
        current() {
            return current ? current.token : null;
        }
    };
}

const registry = createRegistry();
let serial = 0;
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),'
    + 'textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])';

function ensureLayer() {
    let layer = document.getElementById('az-popover-layer');
    if (!layer) {
        layer = document.createElement('div');
        layer.id = 'az-popover-layer';
        document.body.appendChild(layer);
    }
    return layer;
}

function visible(el) {
    return el.getClientRects().length > 0;
}

function focusables(root) {
    return Array.from(root.querySelectorAll(FOCUSABLE)).filter(visible);
}

/**
 * Creates a pop-over bound to `anchor`.
 * @param {object} cfg
 * @param {HTMLElement} cfg.anchor Button that opens it.
 * @param {string} cfg.name Value of data-popover on the surface.
 * @param {string} [cfg.title] Header text (dialogs) or aria-label (menus).
 * @param {boolean} [cfg.wide] 440 px wide instead of 320 px.
 * @param {boolean} [cfg.menu] Menu variant.
 * @param {(body:HTMLElement, ctl:{close:Function,update:Function,surface:HTMLElement})=>(void|Function)} cfg.render
 *        Fills the body on every open; a returned function runs on close.
 * @param {(reason:string)=>void} [cfg.onClose] Called after each close with one of CLOSE_REASONS.
 * @returns {{open:Function,close:Function,toggle:Function,isOpen:Function,update:Function,destroy:Function,
 *            readonly surface:(HTMLElement|null)}}
 */
export function createPopover(cfg) {
    const { anchor, name, title = '', wide = false, menu = false, render, onClose } = cfg;
    const token = ++serial;
    const surfaceId = `az-popover-${token}`;
    let surface = null;
    let body = null;
    let cleanup = null;
    let resizeWatch = null;
    let anchorWatch = null;
    let pressedInside = null;
    let last = null;                 // {id, index} of the control used last, to focus it again
    let isOpen = false;

    anchor.setAttribute('aria-haspopup', menu ? 'menu' : 'dialog');
    anchor.setAttribute('aria-expanded', 'false');

    const inside = (t) => !!(t && t.closest && ((surface && surface.contains(t)) || anchor.contains(t)));

    function position() {
        if (!surface) return;
        const r = anchor.getBoundingClientRect();
        const vw = document.documentElement.clientWidth;
        const vh = document.documentElement.clientHeight;
        if (!anchor.isConnected || !visible(anchor) || r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) {
            close('anchor-gone');
            return;
        }
        surface.style.maxHeight = 'none';
        surface.style.width = `${wide ? POPOVER_WIDE : POPOVER_WIDTH}px`;
        const natural = { width: wide ? POPOVER_WIDE : POPOVER_WIDTH, height: surface.offsetHeight };
        if (menu && !wide) natural.width = Math.max(surface.offsetWidth, 192);
        const p = placePopover(r, natural, { width: vw, height: vh });
        surface.style.left = `${p.left}px`;
        surface.style.top = `${p.top}px`;
        surface.style.width = `${p.width}px`;
        surface.style.maxHeight = `${p.maxHeight}px`;
        surface.dataset.side = p.side;
        surface.classList.toggle('az-popover-sheet', p.sheet);
    }

    function rememberFocus(e) {
        const list = focusables(body);
        const i = list.indexOf(e.target);
        if (i >= 0) last = { id: e.target.id || null, index: i };
    }

    function focusInitial() {
        const list = focusables(menu ? surface : body);
        let target = null;
        if (last) target = (last.id && list.find(el => el.id === last.id)) || list[last.index] || null;
        (target || list[0] || surface).focus({ preventScroll: true });
    }

    function onDocKey(e) {
        if (e.key !== 'Escape' || !isOpen) return;
        // A control inside the surface that has an Escape of its own (a field being edited: Escape cancels the edit) marks
        // itself `data-az-own-escape` and handles the key; the next Escape, from elsewhere, closes the pop-over.
        if (e.target && e.target.closest && e.target.closest('[data-az-own-escape]') && surface && surface.contains(e.target)) return;
        e.stopPropagation();
        e.preventDefault();
        close('escape');
    }

    function onSurfaceKey(e) {
        if (e.key === 'Tab') {
            const list = focusables(surface);
            const next = nextTabIndex(list.indexOf(document.activeElement), list.length, e.shiftKey);
            if (next < 0) { e.preventDefault(); surface.focus(); return; }
            // Only the ends wrap; elsewhere the browser's own order (radios, groups) stands.
            const at = list.indexOf(document.activeElement);
            if (at < 0 || (e.shiftKey ? at === 0 : at === list.length - 1)) {
                e.preventDefault();
                list[next].focus();
            }
        } else if (menu && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
            const items = Array.from(surface.querySelectorAll('[role=menuitem]')).filter(visible);
            const at = items.indexOf(document.activeElement);
            const next = nextMenuIndex(at, items.length, e.key);
            if (next >= 0) { e.preventDefault(); items[next].focus(); }
        }
    }

    function onSurfaceClick(e) {
        if (menu && e.target.closest && e.target.closest('[role=menuitem]')) {
            // Let the item's own handler run first, then close.
            setTimeout(() => { if (isOpen) close('select'); }, 0);
        }
    }

    const onPress = (e) => { pressedInside = inside(e.target); };
    const onClickAway = (e) => {
        const was = pressInside(pressedInside, inside(e.target));
        pressedInside = null;
        if (!e.target.isConnected) return;       // a control the surface drew again is not outside it
        if (!was) close('outside');
    };

    function open() {
        if (isOpen) return;
        registry.open(token, () => close('other'));
        isOpen = true;
        surface = document.createElement('div');
        surface.id = surfaceId;
        surface.className = `az-popover${menu ? ' az-popover-menu' : ''}${wide ? ' az-popover-wide' : ''}`;
        surface.dataset.popover = name;
        surface.tabIndex = -1;
        surface.setAttribute('role', menu ? 'menu' : 'dialog');
        if (menu) {
            if (title) surface.setAttribute('aria-label', title);
            body = surface;
        } else {
            const head = document.createElement('div');
            head.className = 'az-popover-header';
            const h = document.createElement('span');
            h.className = 'az-popover-title';
            h.id = `${surfaceId}-title`;
            h.textContent = title;
            const x = document.createElement('button');
            x.type = 'button';
            x.className = 'az-popover-close';
            x.setAttribute('aria-label', 'Close');
            x.textContent = '×';
            x.addEventListener('click', () => close('button'));
            head.append(h, x);
            body = document.createElement('div');
            body.className = 'az-popover-body';
            surface.setAttribute('aria-labelledby', h.id);
            surface.append(head, body);
        }
        ensureLayer().appendChild(surface);
        anchor.setAttribute('aria-expanded', 'true');
        anchor.setAttribute('aria-controls', surfaceId);
        anchor.classList.add('az-popover-anchor-open');
        const ret = render(body, { close: () => close('api'), update: position, surface });
        cleanup = typeof ret === 'function' ? ret : null;
        position();
        if (!isOpen) return;
        surface.addEventListener('keydown', onSurfaceKey);
        surface.addEventListener('click', onSurfaceClick);
        surface.addEventListener('focusin', rememberFocus);
        document.addEventListener('keydown', onDocKey, true);
        document.addEventListener('pointerdown', onPress, true);
        document.addEventListener('click', onClickAway);
        window.addEventListener('resize', position);
        window.addEventListener('scroll', position, true);
        if (typeof ResizeObserver === 'function') {
            resizeWatch = new ResizeObserver(position);
            resizeWatch.observe(surface);
            anchorWatch = new ResizeObserver(position);
            anchorWatch.observe(anchor);
        }
        focusInitial();
    }

    function close(reason = 'api') {
        if (!isOpen) return;
        isOpen = false;
        registry.closed(token);
        document.removeEventListener('keydown', onDocKey, true);
        document.removeEventListener('pointerdown', onPress, true);
        document.removeEventListener('click', onClickAway);
        window.removeEventListener('resize', position);
        window.removeEventListener('scroll', position, true);
        resizeWatch?.disconnect();
        anchorWatch?.disconnect();
        resizeWatch = anchorWatch = null;
        pressedInside = null;
        if (cleanup) { try { cleanup(); } finally { cleanup = null; } }
        surface.remove();
        surface = body = null;
        anchor.setAttribute('aria-expanded', 'false');
        anchor.removeAttribute('aria-controls');
        anchor.classList.remove('az-popover-anchor-open');
        if (REFOCUS.has(reason) && anchor.isConnected) anchor.focus({ preventScroll: true });
        if (onClose) onClose(reason);
    }

    function toggle() {
        if (isOpen) close('anchor');
        else open();
    }

    const onAnchorClick = () => toggle();
    const onAnchorKey = (e) => {
        // A real <button> turns Enter and Space into a click; anything else needs it said.
        if (anchor.tagName !== 'BUTTON' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(); }
        else if (menu && !isOpen && e.key === 'ArrowDown') { e.preventDefault(); open(); }
    };
    anchor.addEventListener('click', onAnchorClick);
    anchor.addEventListener('keydown', onAnchorKey);

    return {
        open, close, toggle,
        isOpen: () => isOpen,
        update: position,
        get surface() { return surface; },
        destroy() {
            if (isOpen) close('api');
            anchor.removeEventListener('click', onAnchorClick);
            anchor.removeEventListener('keydown', onAnchorKey);
            anchor.removeAttribute('aria-haspopup');
            anchor.removeAttribute('aria-expanded');
        }
    };
}
