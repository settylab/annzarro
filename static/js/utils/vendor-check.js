/**
 * Are the bundled libraries the page needs there? (templates/index.html loads
 * them from static/vendor before the application's modules.)
 *
 * When the server does not send them (a source checkout without
 * `python scripts/vendor_assets.py`, an install whose static/vendor folder lost
 * files), the page used to start anyway and stop at the first library it
 * touched, with a message such as "Can't find variable: bootstrap" that says
 * nothing about the cause. main.js asks vendorProblem() first and, when
 * something is missing, says what and what to do, and does not start.
 */

/** The libraries main.js cannot start without, and how each shows it loaded. */
export const REQUIRED = [
    ['jQuery', (g) => typeof g.$ === 'function'],
    ['Bootstrap', (g) => !!g.bootstrap],
    ['Plotly', (g) => !!g.Plotly],
    ['DataTables', (g) => !!(g.$ && g.$.fn && g.$.fn.DataTable)],
    ['chroma.js', (g) => !!g.chroma],
];

/** The names of the required libraries that are not there. */
export function missingLibraries(g = globalThis) {
    return REQUIRED.filter(([, present]) => !present(g)).map(([name]) => name);
}

/**
 * null when everything is there; otherwise the title and message to show, and
 * the files the browser could not load (recorded by static/js/vendor-watch.js).
 */
export function vendorProblem(g = globalThis) {
    const missing = missingLibraries(g);
    if (!missing.length) return null;
    const files = [...new Set(Array.isArray(g.__annzarroVendorFailed) ? g.__annzarroVendorFailed : [])];
    const which = files.length ? ` (${files.join(', ')})` : '';
    return {
        title: 'AnnZarro did not start',
        message: `The server did not send the libraries the page needs: ${missing.join(', ')}${which}. ` +
            'Reload the page. If that does not help, this installation of AnnZarro is missing files in ' +
            'its static/vendor folder: whoever runs it can reinstall AnnZarro or, in a source checkout, ' +
            'run python scripts/vendor_assets.py.',
        missing,
        files,
    };
}
