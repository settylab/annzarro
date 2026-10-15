/*
 * Sets <html data-theme> before the page's CSS paints, so there is no flash of
 * the wrong theme. A classic, synchronous script in <head> (an external file,
 * because the admin pages' Content-Security-Policy allows script-src 'self'
 * only). Keep the rule in step with resolveTheme() in utils/theme.js, which the
 * unit tests cover; this file is the same few lines without modules.
 *
 * The choice is "system" (follow prefers-color-scheme), "light" or "dark",
 * kept per browser in localStorage under 'annzarro-theme'.
 */
(function () {
    var mode = 'system';
    try {
        var stored = window.localStorage.getItem('annzarro-theme');
        if (stored === 'light' || stored === 'dark') mode = stored;
    } catch { /* storage blocked: follow the system */ }
    var dark = mode === 'dark' ||
        (mode === 'system' && !!window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    var root = document.documentElement;
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
    root.setAttribute('data-theme-mode', mode);

    // The pages with no module of their own (sign in, sign out) follow the system live too
    if (mode === 'system' && window.matchMedia) {
        var query = window.matchMedia('(prefers-color-scheme: dark)');
        var follow = function () {
            if (root.getAttribute('data-theme-mode') === 'system') root.setAttribute('data-theme', query.matches ? 'dark' : 'light');
        };
        if (query.addEventListener) query.addEventListener('change', follow);
        else if (query.addListener) query.addListener(follow);
    }
})();
