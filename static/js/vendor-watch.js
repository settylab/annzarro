/*
 * Records which bundled libraries (static/vendor) fail to load, so main.js can
 * say which files the server did not send instead of failing on the first
 * library it uses ("Can't find variable: bootstrap"). A classic, synchronous
 * script in <head>, before the library tags, as an external file for the same
 * reason as theme-init.js. utils/vendor-check.js reads the list.
 */
(function () {
    var failed = window.__annzarroVendorFailed = [];
    window.addEventListener('error', function (event) {
        var el = event.target;
        if (!el || (el.tagName !== 'SCRIPT' && el.tagName !== 'LINK')) return;
        var url = el.src || el.href || '';
        if (url.indexOf('/static/vendor/') < 0) return;
        failed.push(url.split('?')[0].split('/').pop());
    }, true);
})();
