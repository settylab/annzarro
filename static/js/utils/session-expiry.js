/**
 * Back to the login page, and back to this view, when the login expires.
 *
 * A login ends after auth.session_timeout of inactivity (or when the user is
 * removed or their password changes). Every API call then answers
 * 401 {"reason": "login_required"}; the app used to show those as failed
 * loads and stay on a page that could no longer fetch anything.
 *
 * installSessionExpiryHandler wraps window.fetch once, so every call site is
 * covered. On the first such 401 it encodes the CURRENT view (the same link
 * the Share button copies: ?dataset_path= plus #view=) and goes to
 * /login?next=<path and query>#<view>. The login page keeps the fragment
 * (templates/login.html) and the server sends the browser back to `next`
 * with it after signing in, so the user lands on the same dataset and view.
 *
 * Pure apart from the wrapped fetch and the navigation, so the pieces run
 * under `node --test`.
 */

/** The 401 body's markers for "this request needs a login". */
const LOGIN_REQUIRED_REASON = 'login_required';
const LOGIN_REQUIRED_ERROR = 'Authentication required';

/**
 * Whether a response says the login is gone (and not some other 401).
 * @param {Response} response
 * @returns {Promise<boolean>}
 */
export async function isLoginRequired(response) {
    if (!response || response.status !== 401) return false;
    try {
        const body = await response.clone().json();
        return body && (body.reason === LOGIN_REQUIRED_REASON || body.error === LOGIN_REQUIRED_ERROR);
    } catch (e) {
        return false;
    }
}

/**
 * The login URL that returns to `returnUrl` (absolute, same origin).
 * `next` carries the path and query; the view travels in the login page's
 * own fragment, which the login form posts back (the server never sees a
 * fragment in a URL).
 * @param {string} returnUrl - e.g. https://host/explore/?dataset_path=a.zarr#view=...
 * @param {string} root - the app's mount point, "" or "/explore"
 * @param {string} origin - this page's origin; a returnUrl elsewhere is ignored
 * @returns {string} e.g. /explore/login?next=%2Fexplore%2F%3Fdataset_path%3Da.zarr#view=...
 */
export function loginUrlFor(returnUrl, root, origin) {
    const login = `${root}/login`;
    let url;
    try {
        url = new URL(returnUrl, origin);
    } catch (e) {
        return login;
    }
    if (url.origin !== origin) return login;
    const next = url.pathname + url.search;
    return `${login}?next=${encodeURIComponent(next)}${url.hash || ''}`;
}

/**
 * Wrap `win.fetch` so the first "login required" answer from this server
 * sends the browser to the login page with a way back to the current view.
 * Idempotent; returns the uninstall function (for tests).
 *
 * @param {Object} options
 * @param {Window|Object} [options.win] - provides fetch, location
 * @param {string} [options.root] - mount point ("" or "/explore")
 * @param {function(): (string|Promise<string>)} options.currentViewUrl -
 *        absolute URL of the current view (the share link); may throw
 * @param {function(string): void} [options.navigate] - defaults to location.assign
 * @returns {function(): void}
 */
export function installSessionExpiryHandler({ win = globalThis, root = '', currentViewUrl, navigate } = {}) {
    if (win.__annzarroSessionExpiry) return win.__annzarroSessionExpiry;
    const originalFetch = win.fetch.bind(win);
    const go = navigate || (url => win.location.assign(url));
    let redirecting = false;

    win.fetch = async function annzarroFetch(input, init) {
        const response = await originalFetch(input, init);
        if (!redirecting && await isLoginRequired(response)) {
            redirecting = true;
            let returnUrl = win.location.href;
            try {
                returnUrl = (await currentViewUrl()) || returnUrl;
            } catch (e) {
                // A view that cannot be encoded still returns to the page
                console.warn('Could not encode the current view for after login:', e);
            }
            go(loginUrlFor(returnUrl, root, win.location.origin));
        }
        return response;
    };

    const uninstall = () => {
        win.fetch = originalFetch;
        delete win.__annzarroSessionExpiry;
    };
    win.__annzarroSessionExpiry = uninstall;
    return uninstall;
}
