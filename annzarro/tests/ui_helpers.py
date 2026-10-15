"""Helpers for the browser and end-to-end tests that drive the page with Playwright.

``open_dataset`` is how a test opens a dataset: through the page's one entry point
(``DatasetState``, static/js/utils/dataset-state.js), or by loading the link
``?dataset_path=``. No test needs to know which control the page offers for choosing a dataset, so
replacing that control changes this module and not the tests. A test of the control itself
(test_dataset_dropdown_browser.py, test_dataset_picker_browser.py) still drives the control.
"""
import urllib.parse

#: The state of the page's current dataset (``window.annzarro.getDataset()``), as a JavaScript function.
STATE = "() => (window.annzarro && window.annzarro.getDataset) ? window.annzarro.getDataset() : null"


#: The path of the dataset that is opening or open in the page, or null (``window.annzarro.getDataset()``).
SHOWN_DATASET = ("() => { const s = window.annzarro && window.annzarro.getDataset && window.annzarro.getDataset();"
                 " return s && (s.status === 'open' || s.status === 'opening') ? s.path : null; }")


def dataset_state(page):
    """The page's current dataset: ``{path, label, status, error, failed}``, or None before the page starts."""
    return page.evaluate(STATE)


def dataset_path(page):
    """The path of the dataset that is opening or open in the page, or None."""
    state = dataset_state(page)
    return state["path"] if state and state["status"] in ("opening", "open") else None


def wait_for_open(page, path=None, *, timeout=60_000):
    """Wait until the page's dataset is open (and is ``path``, or ends with it, when given); returns the state.

    A dataset that failed to open is raised at once with the page's reason instead of timing out.
    """
    page.wait_for_function(
        """([want]) => {
            const s = window.annzarro && window.annzarro.getDataset && window.annzarro.getDataset();
            if (!s) return false;
            if (s.failed) throw new Error('the dataset did not open: ' + s.failed.message);
            if (s.status === 'none' && s.error) throw new Error('the dataset did not open: ' + s.error);
            return s.status === 'open' && !!s.path && (!want || s.path === want || s.path.endsWith(want));
        }""", arg=[path], timeout=timeout)
    return dataset_state(page)


def start_open_dataset(page, path, *, timeout=60_000):
    """Ask the page to open ``path`` and return at once, for a test that holds the page's requests meanwhile."""
    page.wait_for_function("() => !!(window.annzarro && window.annzarro.openDataset)", timeout=timeout)
    page.evaluate("(path) => { window.annzarro.openDataset(path); }", path)


def open_dataset(page, path, *, base=None, timeout=60_000):
    """Open the dataset ``path`` in ``page`` and wait until it is open; returns the state.

    With ``base`` (the server's URL) the page loads ``<base>/?dataset_path=<path>``, as a share link does.
    Without it the page must already have loaded the app, and the dataset is opened as the user would
    choose it (source ``user``, so it is also recorded as recently opened).
    """
    if base is not None:
        page.goto(f"{base.rstrip('/')}/?dataset_path={urllib.parse.quote(path, safe='/:')}")
    else:
        start_open_dataset(page, path, timeout=timeout)
    return wait_for_open(page, path, timeout=timeout)
