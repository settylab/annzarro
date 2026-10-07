"""Views saved by older releases still open: the compatibility corpus.

annzarro/tests/compat/<version>/ holds share links and panel set files that
release itself wrote (make_corpus.py, run against the release's tag), and
the state it restored from them. Every later version must open each one
without a page error and restore its layout and panels: the same tile tree
(ids and split sizes), the same panel types, the same focused gene.

The same pixels are not required across versions; within one version,
test_export_reproducible.py holds the figures to the byte.

They name their store by the absolute path it had on the machine that made
them, which no other machine has. They carry no fingerprint (that came with
v0.4.1), so the store is found by its name in this server's data directory,
and the user is told it was opened from there.

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1 (set in CI), where a missing Playwright is an error.
"""
import glob
import json
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.request

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402  (required: fail, do not skip)
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.compat.make_corpus import STATE_JS, TREE_JS

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
FIXTURE = os.path.join(os.path.dirname(HERE), "data", "fixture_small.zarr")
COMPAT = os.path.join(os.path.dirname(HERE), "compat")

ENTRIES = []
for manifest_path in sorted(glob.glob(os.path.join(COMPAT, "*", "manifest.json"))):
    with open(manifest_path) as fh:
        manifest = json.load(fh)
    for name, entry in sorted(manifest["entries"].items()):
        for kind in ("link", "panel_set"):
            ENTRIES.append(pytest.param(os.path.dirname(manifest_path), manifest, name, entry, kind,
                                        id=f"{manifest['version']}-{name}-{kind}"))


def test_the_corpus_is_there():
    assert ENTRIES, f"no compat corpus under {COMPAT}"


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    data_dir = tmp_path_factory.mktemp("data")
    shutil.copytree(FIXTURE, data_dir / "fixture_small.zarr")
    port = _free_port()
    env = dict(os.environ, ANNZARRO_HOME=str(tmp_path_factory.mktemp("home")), ANNZARRO_HEADLESS="1",
               PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""))
    proc = subprocess.Popen([sys.executable, "-m", "annzarro.cli", "start", "--host", "127.0.0.1",
                             "--port", str(port), "--data-dir", str(data_dir), "--no-browser", "--auth-disabled"],
                            env=env, cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    root = f"http://127.0.0.1:{port}"
    for _ in range(160):
        try:
            urllib.request.urlopen(root + "/api/v1/config", timeout=1)
            break
        except OSError:
            time.sleep(0.25)
    else:
        proc.kill()
        pytest.fail("server did not start")
    yield root
    proc.terminate()
    proc.wait(10)


@pytest.fixture(scope="module")
def browser():
    with playwright.sync_playwright() as p:
        b = p.chromium.launch()
        yield b
        b.close()


def _settle(page):
    page.wait_for_function("() => window.PanelManager && PanelManager.getActivePanels().length > 0", timeout=30000)
    page.wait_for_function("() => window.annzarroPlotState && !JSON.parse(window.annzarroPlotState()).loading",
                           timeout=30000)
    page.wait_for_timeout(2500)


@pytest.mark.parametrize("folder, manifest, name, entry, kind", ENTRIES)
def test_an_older_view_opens_with_its_layout_and_panels(server, browser, folder, manifest, name, entry, kind):
    ctx = browser.new_context(viewport={"width": 1400, "height": 1000})
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    try:
        if kind == "link":
            page.goto(entry["link"].replace("{root}", server))
        else:
            page.goto(server + "/")
            page.wait_for_function("() => !!window.PanelManager", timeout=30000)
            page.wait_for_timeout(1000)
            page.click("#btn-load-session")
            page.wait_for_selector("#session-modal", state="visible")
            page.click("#toggle-upload-btn")
            page.set_input_files("#session-file-upload", os.path.join(folder, entry["panel_set"]))
            page.click("#btn-confirm-session")
        _settle(page)
        state = page.evaluate(STATE_JS)
        want = entry["restored"]
        assert page.query_selector(".panel-no-data") is None, "opened without data"
        assert page.evaluate(TREE_JS) == want["tree"]
        assert sorted(p["type"] for p in state["panels"]) == sorted(p["type"] for p in want["panels"])
        assert state["focusedGene"] == want["focusedGene"]
        notices = " ".join(page.eval_on_selector_all(".notification", "els => els.map(e => e.innerText)"))
        assert "Opened on another path" in notices and "same name" in notices, notices
        assert not errors, errors
    finally:
        ctx.close()
