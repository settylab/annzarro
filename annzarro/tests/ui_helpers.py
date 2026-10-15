"""Helpers for the browser and end-to-end tests that drive the page with Playwright.

``open_dataset`` is how a test opens a dataset: through the page's one entry point
(``DatasetState``, static/js/utils/dataset-state.js), or by loading the link
``?dataset_path=``. No test needs to know which control the page offers for choosing a dataset, so
replacing that control changes this module and not the tests. A test of the control itself
(test_dataset_browser.py, test_dataset_browser_a11y.py) drives the dataset button and the browser;
the helpers at the end of this module are what those tests and the ones that choose a dataset
through the dialog share.
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


# ---- the dataset button and the dataset browser (static/js/utils/dataset-button.js, dataset-browser.js) ----

#: The button at the left of the dataset bar that names the open dataset and opens the browser.
BUTTON = "#dataset-button"
#: The dataset browser dialog.
BROWSER = "#dataset-browser"
#: A table row of the browser (a store or a folder), and its name button.
ROW = f"{BROWSER} #dsb-table tbody tr.dsb-row"


def button_text(page):
    """What the dataset button says (the cut name, or "Open a dataset...", "No data: ...")."""
    return page.inner_text(f"{BUTTON} .dataset-button-name").strip()


def button_state(page):
    """``none``, ``opening``, ``open``, ``nodata`` or ``unavailable``: the state the button shows."""
    return page.get_attribute(BUTTON, "data-state")


def open_browser(page, *, query=None, shortcut=False, timeout=30_000):
    """Open the dataset browser (the button, or Ctrl+O with ``shortcut``) and wait until it has listed something.

    ``query`` is typed into its search field. Returns the dialog locator.
    """
    if shortcut:
        page.keyboard.press("Control+o")
    else:
        page.click(BUTTON)
    dialog = page.locator(BROWSER)
    dialog.wait_for(state="visible", timeout=timeout)
    page.wait_for_function(
        "() => { const w = document.querySelector('#dsb-table-wrap');"
        " return w && (w.querySelector('#dsb-table tbody tr') || w.querySelector('.dsb-state')) && !/Loading/.test(w.innerText); }",
        timeout=timeout)
    page.wait_for_function("() => document.activeElement && document.activeElement.id === 'dsb-search'", timeout=5_000)
    if query is not None:
        page.fill("#dsb-search", query)
    return dialog


def browser_rows(page):
    """The path of every row of the browser's table, in order."""
    return page.eval_on_selector_all(f"{ROW}[data-kind]", "rows => rows.map(r => r.dataset.path)")


def browser_row(page, suffix):
    """The row whose path ends with ``suffix``."""
    return page.locator(f"{ROW}[data-path$='{suffix}']")


def choose_in_browser(page, suffix, *, query=None):
    """Open the browser, search for ``query`` if given, and open the store whose path ends with ``suffix`` (a click on its name)."""
    open_browser(page, query=query)
    row = browser_row(page, suffix)
    row.first.wait_for(timeout=30_000)
    row.first.locator(".dsb-name").click()


def close_browser(page):
    """Close the browser with Escape and wait until it is gone."""
    page.keyboard.press("Escape")
    page.locator(BROWSER).wait_for(state="hidden", timeout=10_000)
