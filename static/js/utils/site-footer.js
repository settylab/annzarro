/**
 * Keep the site's footer line (templates/_site_footer.html) the last thing in the page.
 *
 * On the main page the footer sits inside #tile-container, the page's scroller, so it
 * comes after the panels and the chooser under them: at the bottom of the page, reached
 * by scrolling, not pinned to the bottom of the window. The panel code empties that
 * container (a restored layout, a reset) and appends to it (a new chooser), which would
 * drop the footer or leave it in the middle. keepLast holds on to the footer and puts it
 * back at the end after every change to the container's children, so its place in the
 * reading and tab order is last too, and its listeners (about-dialog.js) stay attached.
 */

/**
 * @param {Element} container  the element whose last child the footer stays
 * @param {Element|null} footer  the footer, or null when the site shows none
 * @param {Function} [Observer]  MutationObserver (injected by the tests)
 * @returns {Function} stop, which disconnects the observer
 */
export function keepLast(container, footer, Observer = globalThis.MutationObserver) {
    if (!container || !footer || typeof Observer !== 'function') return () => {};
    const place = () => {
        if (container.lastElementChild !== footer) container.appendChild(footer);
    };
    place();
    const observer = new Observer(place);
    observer.observe(container, { childList: true });
    return () => observer.disconnect();
}
