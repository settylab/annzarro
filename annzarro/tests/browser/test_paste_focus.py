"""Paste to focus in a real browser (Ctrl+V / Cmd+V outside a text field sets the focused cell or gene).

A server with login on and two stores whose cell names the test controls: BL_1697_spatial_annzarro.zarr
(cell ``hdfihbcc-1`` at row 5, genes g0...) and other.zarr. The config file carries the rule for a row
copied from another platform, ahead of the default one-token rule. The paste event is dispatched with a
DataTransfer, as the browser does for Ctrl+V. Then:

1. the example row focuses ``hdfihbcc-1`` in the open dataset and says so in one toast;
2. one token that is no cell but a gene focuses the gene (the default rule);
3. a paste into the Focused Gene box is the browser's own: not prevented, nothing focused;
4. a cell that is not in the dataset gets one toast; text no rule matches gets none;
5. the row pasted while another store is open asks "... is in <store>. Open it?"; Open opens that store
   and focuses the cell; the dataset never switches by itself;
6. an open modal dialog keeps its paste;
7. the admin Settings page lists the rules, its Test box shows the extraction, a bad pattern is refused
   in the form, and a saved rule reaches the page.

Screenshots (the rule editor, the toasts) go to ANNZARRO_SHOTS when it is set.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import json
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.parse
import urllib.request

import numpy as np
import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.server.admin_helpers import ADMIN, PASSWORD  # noqa: E402
from annzarro.tests.server.test_focus_rows import N_OBS, _dataframe, _make_store  # noqa: E402
from annzarro.tests.zarr_compat import open_group  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
SHOTS = os.environ.get("ANNZARRO_SHOTS")

PATTERN = r"^(?<dataset>[^\t]+)\t[^\t]*\t[^\t]*\t(?<cell>[^\t]+)"
ROW = "BL_1697\t5127.7\t7483.4\thdfihbcc-1\tEndothelial\tLSEC\tLSEC\tonboard  "
MISSING = "BL_1697\t1.0\t2.0\tnope-9\tEndothelial\tLSEC\tLSEC\tonboard"
CONFIG = {"ui": {"paste_focus": {"rules": [
    {"pattern": PATTERN, "dataset_match": "prefix"},
    {"pattern": r"^(?=(?<gene>\S+)$)(?<cell>\S+)$", "dataset_match": "prefix"},
]}}}
STORE_A = "BL_1697_spatial_annzarro.zarr"
STORE_B = "other.zarr"

SERVE = """
import json, sys
from pathlib import Path
from werkzeug.serving import run_simple
from annzarro.tests.server.admin_helpers import make_app
app = make_app(Path(sys.argv[1]), **json.loads(sys.argv[3]))
run_simple("127.0.0.1", int(sys.argv[2]), app, threaded=True)
"""

PASTE = """([selector, text]) => {
  const target = selector ? document.querySelector(selector) : document.body;
  const data = new DataTransfer();
  data.setData('text/plain', text);
  const event = new ClipboardEvent('paste', {clipboardData: data, bubbles: true, cancelable: true});
  target.dispatchEvent(event);
  return event.defaultPrevented;
}"""


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _store(path, names):
    """The focus-rows test store with the given cell names."""
    _make_store(path)
    shutil.rmtree(os.path.join(path, "obs"))
    _dataframe(open_group(path, mode="a"), "obs", names, {"score": np.arange(len(names), dtype=np.float64)})
    return str(path)


@pytest.fixture(scope="module")
def served(tmp_path_factory):
    root = tmp_path_factory.mktemp("paste")
    data = root / "data"
    data.mkdir()
    names_a = [f"cA{i}" for i in range(N_OBS)]
    names_a[5] = "hdfihbcc-1"
    store_a = _store(data / STORE_A, names_a)
    store_b = _store(data / STORE_B, [f"cB{i}" for i in range(N_OBS)])
    port = _free_port()
    env = dict(os.environ, ANNZARRO_HOME=str(root / "home"), ANNZARRO_HEADLESS="1",
               PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""))
    env.pop("ANNZARRO_CONFIG", None)
    proc = subprocess.Popen([sys.executable, "-c", SERVE, str(root), str(port), json.dumps(CONFIG)], env=env, cwd=REPO,
                            stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    url = f"http://127.0.0.1:{port}"
    for _ in range(160):
        try:
            urllib.request.urlopen(url + "/login", timeout=1)
            break
        except OSError:
            if proc.poll() is not None:
                break
            time.sleep(min(0.5, 0.1 * (_ + 1)))
    else:
        proc.kill()
        pytest.fail("server did not start")
    yield url, store_a, store_b
    proc.terminate()
    proc.wait(10)


@pytest.fixture(scope="module")
def browser():
    with playwright.sync_playwright() as p:
        b = p.chromium.launch()
        yield b
        b.close()


def _sign_in(page, url):
    page.goto(url + "/login")
    page.fill("input[name=username]", ADMIN)
    page.fill("input[name=password]", PASSWORD)
    page.click("button[type=submit], input[type=submit]")
    page.wait_for_load_state("networkidle")


def _open(browser, served, store):
    url = served[0]
    context = browser.new_context(viewport={"width": 1400, "height": 900})
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    _sign_in(page, url)
    page.goto(f"{url}/?dataset_path={urllib.parse.quote(store, safe='/')}")
    first = "cA0" if store.endswith(STORE_A) else "cB0"
    page.wait_for_function(f"() => document.getElementById('focused-cell').value === '{first}'", timeout=30000)
    # the policy (with the rules) is read before the page is usable
    page.wait_for_function("() => !!document.querySelector('.panel-type-option')", timeout=30000)
    return context, page, errors


def _paste(page, text, selector=None):
    page.evaluate("() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); }")
    return page.evaluate(PASTE, [selector, text])


def _toasts(page):
    return [t.locator(".notification-message").inner_text().strip()
            for t in page.locator("#notification-container .notification").all()]


def _shot(page, name, element=None):
    if SHOTS:
        os.makedirs(SHOTS, exist_ok=True)
        page.wait_for_timeout(600)          # the toast fades in
        (element or page).screenshot(path=os.path.join(SHOTS, name))


def test_the_example_row_focuses_the_cell_and_says_so_once(browser, served):
    context, page, errors = _open(browser, served, served[1])
    try:
        assert _paste(page, ROW) is True            # the page took the paste
        page.wait_for_function("() => document.getElementById('focused-cell').value === 'hdfihbcc-1'", timeout=15000)
        page.wait_for_selector("#notification-container .notification")
        assert _toasts(page) == ["Focused cell hdfihbcc-1 (from clipboard)"]
        _shot(page, "toast-focused.png")
        assert not errors, errors
    finally:
        context.close()


def test_one_token_that_is_a_gene_focuses_the_gene(browser, served):
    context, page, errors = _open(browser, served, served[1])
    try:
        _paste(page, "  g3\n")
        page.wait_for_function("() => document.getElementById('focused-gene').value === 'g3'", timeout=15000)
        assert page.input_value("#focused-cell") == "cA0"
        page.wait_for_function("() => document.querySelector('#notification-container .notification')")
        assert _toasts(page) == ["Focused gene g3 (from clipboard)"]
        assert not errors, errors
    finally:
        context.close()


def test_a_paste_into_a_text_box_is_the_browsers_own(browser, served):
    context, page, errors = _open(browser, served, served[1])
    try:
        for selector in ("#focused-gene", "#focused-cell"):
            prevented = page.evaluate(PASTE, [selector, ROW])
            assert prevented is False
        page.wait_for_timeout(500)
        assert page.input_value("#focused-cell") == "cA0"
        assert _toasts(page) == []
        # and typing the text really works there
        page.click("#focused-gene")
        page.keyboard.insert_text("g2")
        assert page.input_value("#focused-gene") == "g2"
        assert not errors, errors
    finally:
        context.close()


def test_a_missing_cell_gets_one_toast_and_other_text_none(browser, served):
    context, page, errors = _open(browser, served, served[1])
    try:
        assert _paste(page, MISSING) is True
        page.wait_for_selector("#notification-container .notification")
        assert _toasts(page) == ["nope-9 is not in this dataset"]
        assert page.input_value("#focused-cell") == "cA0"
        page.evaluate("() => document.getElementById('notification-container').replaceChildren()")
        assert _paste(page, "two words that no rule reads") is False
        assert _paste(page, "x" * 5000) is False
        assert _paste(page, "") is False
        page.wait_for_timeout(500)
        assert _toasts(page) == []
        assert not errors, errors
    finally:
        context.close()


def test_a_row_naming_another_store_asks_before_opening_it(browser, served):
    url, store_a, store_b = served
    context, page, errors = _open(browser, served, store_b)
    try:
        _paste(page, ROW)
        page.wait_for_selector("#notification-container .notification-ask")
        ask = page.locator("#notification-container .notification-ask")
        assert ask.locator(".notification-message").inner_text() == f"hdfihbcc-1 is in {STORE_A}. Open it?"
        _shot(page, "toast-open.png")
        page.wait_for_timeout(800)
        assert page.input_value("#focused-cell") == "cB0"             # nothing switched by itself
        ask.locator("button", has_text="Open").click()
        page.wait_for_function("() => document.getElementById('focused-cell').value === 'hdfihbcc-1'", timeout=30000)
        page.wait_for_function("() => /BL_1697_spatial_annzarro/.test(document.body.innerText)", timeout=15000)
        assert not errors, errors
    finally:
        context.close()


def test_a_dialog_keeps_its_paste(browser, served):
    context, page, errors = _open(browser, served, served[1])
    try:
        page.keyboard.press("Control+Shift+L")             # Load Panel Set
        page.wait_for_selector(".modal.show")
        assert page.evaluate(PASTE, [None, ROW]) is False
        page.wait_for_timeout(400)
        assert page.input_value("#focused-cell") == "cA0"
        assert not errors, errors
    finally:
        context.close()


def test_the_admin_page_edits_and_tests_the_rules(browser, served):
    url, store_a, _ = served
    context = browser.new_context(viewport={"width": 1300, "height": 1400})
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    try:
        _sign_in(page, url)
        page.goto(url + "/admin#settings")
        row = page.locator('.policy-row[data-key="ui.paste_focus.rules"]')
        row.wait_for()
        cards = row.locator(".paste-rule")
        assert cards.count() == 2
        assert cards.nth(0).locator(".paste-rule-pattern").input_value() == PATTERN
        # the test box shows which rule takes the text and what it extracts
        row.locator("#paste-rules-test").fill(ROW)
        result = row.locator(".paste-rules-result")
        assert result.inner_text() == 'Rule 1 matches: cell = "hdfihbcc-1", dataset = "BL_1697" (prefix match).'
        row.locator("#paste-rules-test").fill("CD34")
        assert result.inner_text() == 'Rule 2 matches: cell = "CD34", gene = "CD34", no dataset.'
        row.locator("#paste-rules-test").fill("two words")
        assert result.inner_text().startswith("No rule matches")
        row.locator("#paste-rules-test").fill(ROW)
        _shot(page, "admin-rule-editor.png", row)
        # a bad pattern is refused in the form
        row.locator(".paste-rules-add").click()
        new = row.locator(".paste-rule").nth(2)
        new.locator(".paste-rule-pattern").fill("(?<cell>oops")
        assert new.locator(".paste-rule-error").is_visible()
        assert row.locator("button", has_text="Save rules").is_disabled()
        new.locator(".paste-rule-pattern").fill("^id:(?<gene>\\w+)$")
        assert row.locator("button", has_text="Save rules").is_enabled()
        # reorder, then save
        new.locator(".paste-rule-up").click()
        row.locator("button", has_text="Save rules").click()
        page.wait_for_function(
            "() => document.querySelectorAll('.policy-row[data-key=\"ui.paste_focus.rules\"] .paste-rule').length === 3")
        page.wait_for_function(
            "() => document.querySelector('.policy-row[data-key=\"ui.paste_focus.rules\"] .badge').textContent === 'admin'")
        reply = context.request.get(f"{url}/api/v1/policy/effective?keys=ui.paste_focus.rules").json()
        rules = reply["values"]["ui.paste_focus.rules"]
        assert [r["pattern"] for r in rules] == [PATTERN, "^id:(?<gene>\\w+)$", CONFIG["ui"]["paste_focus"]["rules"][1]["pattern"]]
        assert not errors, errors
    finally:
        context.close()
