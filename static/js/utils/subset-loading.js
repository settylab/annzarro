/**
 * "Loading part 3..." over every open panel while other cells are read.
 *
 * A subset change (a part step, the dialog's Apply) reads the new cells'
 * indices and names before any panel starts its own load, which on a very
 * large dataset takes tens of seconds with the old plot unchanged and no sign
 * that anything happens. This marks every tile at once: a pill over its top
 * left corner with the text and a Cancel button, and the panel's content
 * dimmed until the new points are drawn (styles.css, .subset-loading).
 *
 * It touches only the tiles' DOM (class and one child element), not the
 * panels: a panel opened or closed meanwhile is not harmed, and the panels'
 * own loading overlays (utils/load-scope.js) take over when they start.
 */

const PILL_CLASS = 'subset-loading-pill';
const TILE_CLASS = 'subset-loading';

function tiles(root) {
    return Array.from((root || document).querySelectorAll('.tile-content'));
}

/**
 * Mark every tile as waiting for other cells.
 * @param {string} text - e.g. "Loading part 3..."
 * @param {() => void} [onCancel] - the pill's Cancel button (shown after a moment)
 * @param {Document|HTMLElement} [root]
 * @returns {number} tiles marked
 */
export function showSubsetLoading(text, onCancel = null, root = null) {
    let n = 0;
    for (const tile of tiles(root)) {
        tile.classList.add(TILE_CLASS);
        let pill = Array.from(tile.children).find(c => c.classList && c.classList.contains(PILL_CLASS));
        if (!pill) {
            pill = document.createElement('div');
            pill.className = PILL_CLASS;
            pill.setAttribute('role', 'status');
            pill.innerHTML = '<div class="spinner"></div><span class="subset-loading-text"></span>'
                + '<button type="button" class="btn btn-sm btn-outline-secondary load-cancel" '
                + 'title="Stop loading and keep the cells shown">Cancel</button>';
            tile.appendChild(pill);
        }
        pill.querySelector('.subset-loading-text').textContent = text;
        const cancel = pill.querySelector('.load-cancel');
        cancel.hidden = !onCancel;
        cancel.onclick = onCancel ? (e) => { e.stopPropagation(); onCancel(); } : null;
        n++;
    }
    return n;
}

/** Take the mark off every tile. */
export function hideSubsetLoading(root = null) {
    for (const tile of tiles(root)) {
        tile.classList.remove(TILE_CLASS);
        for (const pill of Array.from(tile.children)) {
            if (pill.classList && pill.classList.contains(PILL_CLASS)) pill.remove();
        }
    }
}

/**
 * The panels start drawing the new cells and show their own loading overlays
 * (with their own Cancel): take the pills off, and keep the dimming until
 * hideSubsetLoading.
 */
export function handOverToPanels(root = null) {
    for (const tile of tiles(root)) {
        for (const pill of Array.from(tile.children)) {
            if (pill.classList && pill.classList.contains(PILL_CLASS)) pill.remove();
        }
    }
}
