"""About AnnZarro: the app name at the top left opens a dialog.

1. a click or Enter on the name opens a centred dialog with the running version, the
   documentation, repository and changelog links, the paper and software DOIs, the Setty Lab
   and Fred Hutch logos (both load, in the light and the dark theme) with their links, and the
   funding statement in text (no NIH logo);
2. Escape and the close button close it, and focus returns to the name;
3. at 390 px wide nothing overflows sideways;
4. the title keeps its tooltip.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
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

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
DATA_DIR = os.path.join(os.path.dirname(HERE), "data")
SHOTS = os.environ.get("ANNZARRO_SHOTS")   # a directory: also write screenshots there

LOGOS = """() => [...document.querySelectorAll('#about-modal img')]
    .filter(i => i.offsetParent !== null).map(i => [i.alt, i.naturalWidth, i.getBoundingClientRect().height])"""


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture
def server(tmp_path):
    (tmp_path / "home").mkdir()
    port = _free_port()
    env = dict(os.environ, ANNZARRO_HOME=str(tmp_path / "home"), ANNZARRO_HEADLESS="1",
               PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""))
    env.pop("ANNZARRO_CONFIG", None)
    proc = subprocess.Popen([sys.executable, "-m", "annzarro.cli", "start", "--auth-disabled", "--host", "127.0.0.1",
                             "--port", str(port), "--data-dir", DATA_DIR, "--no-browser"],
                            env=env, cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    root = f"http://127.0.0.1:{port}"
    for _ in range(120):
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


def _open(browser, root, scheme="light", width=1440, height=900):
    page = browser.new_context(viewport={"width": width, "height": height}, color_scheme=scheme).new_page()
    page.goto(root)
    page.wait_for_function("() => document.querySelector('.app-title').title.includes('AnnZarro ')", timeout=30000)
    return page


def _shot(page, name):
    if SHOTS:
        os.makedirs(SHOTS, exist_ok=True)
        page.screenshot(path=os.path.join(SHOTS, name + ".png"))


def _closed(page):
    """Hidden, and Bootstrap done with the backdrop (its hidden event has run)."""
    page.wait_for_function("() => !document.body.classList.contains('modal-open')", timeout=5000)


def _show(page):
    page.click("#about-open")
    page.wait_for_selector("#about-modal.show", timeout=5000)
    page.wait_for_timeout(500)   # the fade


@pytest.mark.parametrize("scheme", ["light", "dark"])
def test_about_opens_by_click_and_shows_everything(server, scheme):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = _open(browser, server, scheme)
            version = page.evaluate("fetch('/api/v1/config').then(r => r.json()).then(c => c.annzarro_version)")
            tooltip = page.evaluate("document.querySelector('.app-title').title")
            assert tooltip.endswith(version)
            _show(page)
            modal = page.locator("#about-modal")
            assert page.evaluate("document.documentElement.getAttribute('data-theme')") == scheme
            assert version in modal.locator("#about-version").inner_text()
            # centred
            box = modal.locator(".modal-content").bounding_box()
            assert abs(box["x"] + box["width"] / 2 - 720) < 2
            assert abs(box["y"] + box["height"] / 2 - 450) < 40
            links = {a.inner_text().strip(): a.get_attribute("href") for a in modal.locator("a").all()}
            assert links["Documentation"] == "https://annzarro.readthedocs.io"
            assert links["GitHub"] == "https://github.com/settylab/annzarro"
            assert links["Changelog"].endswith("/CHANGELOG.md")
            assert links["doi:10.64898/2026.10.10.758158"] == "https://doi.org/10.64898/2026.10.10.758158"
            assert links["doi:10.5281/zenodo.23222216"] == "https://doi.org/10.5281/zenodo.23222216"
            hrefs = [a.get_attribute("href") for a in modal.locator("a").all()]
            assert "https://research.fredhutch.org/setty" in hrefs and "https://www.fredhutch.org" in hrefs
            for a in modal.locator("a").all():
                assert a.get_attribute("target") == "_blank" and "noopener" in a.get_attribute("rel")
            text = modal.inner_text()
            assert "Setty Lab at Fred Hutch Cancer Center" in text
            assert "R35GM147125" in text and "K99GM159044" in text
            assert "National Institute of General Medical Sciences" in text
            # exactly the logos of the lab and Fred Hutch show, whatever the theme, and they loaded
            logos = page.evaluate(LOGOS)
            assert sorted(l[0] for l in logos) == ["Fred Hutch Cancer Center", "Setty Lab"]
            assert all(l[1] > 0 for l in logos)
            _shot(page, f"about-{scheme}-desktop")
        finally:
            browser.close()


def test_about_logos_follow_the_theme(server):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            for scheme, want in (("light", "fredhutch-navy.png"), ("dark", "fredhutch-white.png")):
                page = _open(browser, server, scheme)
                _show(page)
                shown = page.evaluate("[...document.querySelectorAll('.about-logo-fh')]"
                                      ".filter(i => i.offsetParent !== null).map(i => i.src.split('/').pop())")
                assert shown == [want]
                # every logo file the dialog names is served
                for src in page.evaluate("[...document.querySelectorAll('#about-modal img')].map(i => i.src)"):
                    assert urllib.request.urlopen(src, timeout=5).status == 200
        finally:
            browser.close()


def test_about_by_keyboard_escape_and_focus_return(server):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = _open(browser, server)
            assert page.evaluate("document.getElementById('about-open').tagName") == "BUTTON"
            page.focus("#about-open")
            page.keyboard.press("Enter")
            page.wait_for_selector("#about-modal.show", timeout=5000)
            page.wait_for_timeout(400)
            assert page.evaluate("document.getElementById('about-modal').contains(document.activeElement)")
            page.keyboard.press("Escape")
            _closed(page)
            assert page.evaluate("document.activeElement.id") == "about-open"

            # the close button does the same
            page.keyboard.press("Space")
            page.wait_for_selector("#about-modal.show", timeout=5000)
            page.wait_for_timeout(400)
            page.click("#about-modal .btn-close")
            _closed(page)
            assert page.evaluate("document.activeElement.id") == "about-open"
            # the tooltip stays
            assert "AnnZarro " in page.evaluate("document.querySelector('.app-title').title")
        finally:
            browser.close()


@pytest.mark.parametrize("scheme", ["light", "dark"])
def test_about_fits_a_phone(server, scheme):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = _open(browser, server, scheme, 390, 844)
            _show(page)
            assert page.evaluate("document.querySelector('#about-modal .modal-body').scrollWidth"
                                 " <= document.querySelector('#about-modal .modal-body').clientWidth")
            box = page.locator("#about-modal .modal-content").bounding_box()
            assert box["x"] >= 0 and box["x"] + box["width"] <= 390
            assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
            _shot(page, f"about-{scheme}-phone")
        finally:
            browser.close()


def test_about_version_appears_when_opened_before_the_config_arrives(server):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_context(viewport={"width": 1440, "height": 900}).new_page()
            release = []

            def slow(route):
                release.append(route)   # held until the dialog is open

            page.route("**/api/v1/config", slow)
            page.goto(server, wait_until="domcontentloaded")
            page.wait_for_selector("#about-open")
            page.click("#about-open")
            page.wait_for_selector("#about-modal.show", timeout=5000)
            assert page.locator("#about-version").inner_text() == ""
            for route in release:
                route.continue_()
            page.wait_for_function("() => document.getElementById('about-version').textContent.trim() !== ''",
                                   timeout=10000)
            version = json.load(urllib.request.urlopen(server + "/api/v1/config"))["annzarro_version"]
            assert page.locator("#about-version").inner_text() == version
        finally:
            browser.close()


def test_about_version_appears_when_opened_before_the_script_loads(server):
    """A click on the name before the app's scripts have run: Bootstrap opens
    the dialog by itself, and the version still appears once they have."""
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_context(viewport={"width": 1440, "height": 900}).new_page()
            held = []
            page.route("**/static/js/utils/about-dialog.js", lambda route: held.append(route))
            page.goto(server, wait_until="commit")
            page.wait_for_selector("#about-open")
            page.click("#about-open")
            page.wait_for_selector("#about-modal.show", timeout=5000)
            assert held, "about-dialog.js was not requested before the click"
            assert page.locator("#about-version").inner_text() == ""
            for route in held:
                route.continue_()
            page.wait_for_function("() => document.getElementById('about-version').textContent.trim() !== ''",
                                   timeout=10000)
            version = json.load(urllib.request.urlopen(server + "/api/v1/config"))["annzarro_version"]
            assert page.locator("#about-version").inner_text() == version
        finally:
            browser.close()
