/*
 * Opening the dataset browser before the app has started.
 *
 * The dataset button is in the page's HTML, but main.js wires it (and Ctrl/Cmd+O, and the
 * desktop app's open-dataset-browser event) partway through its start, after the modules have
 * loaded. This classic script runs as soon as the page is parsed: until main.js takes over
 * (`window.annzarroEarlyOpen.detach()`), a click on the button, Ctrl/Cmd+O or the event only
 * records that the browser was asked for and marks the button busy. When the app has started,
 * main.js calls `flush(open)`, which opens it once, however many requests there were.
 */
(function () {
    'use strict';
    var button = document.getElementById('dataset-button');
    var queued = false;
    var detail = null;

    function request(e) {
        if (e && e.preventDefault) e.preventDefault();
        queued = true;
        if (e && e.detail && e.detail.path) detail = e.detail;
        if (button) button.setAttribute('aria-busy', 'true');
    }
    function onKey(e) {
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && String(e.key).toLowerCase() === 'o') request(e);
    }
    function onClick(e) { request(e); }
    function onEvent(e) { request(e); }

    if (button) button.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('annzarro:open-dataset-browser', onEvent);

    window.annzarroEarlyOpen = {
        /** main.js has wired the real handlers: stop recording. */
        detach: function () {
            if (button) button.removeEventListener('click', onClick);
            document.removeEventListener('keydown', onKey, true);
            document.removeEventListener('annzarro:open-dataset-browser', onEvent);
        },
        /** The app has started: run `open(detail)` once if the browser was asked for meanwhile. */
        flush: function (open) {
            if (button) button.removeAttribute('aria-busy');
            if (!queued) return;
            queued = false;
            var asked = detail;
            detail = null;
            open(asked);
        },
    };
})();
