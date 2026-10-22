"""About AnnZarro: the app name at the top left opens a dialog.

1. a click or Enter on the name opens a centred dialog with the running version, the
   documentation, repository and changelog links, the paper and software DOIs, the Setty Lab
   logo (it loads, in the light and the dark theme) and the Setty Lab and Fred Hutch links, and the
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


def _serve(tmp_path, extra_env=None):
    """Start a server; yields its root and stops it. `extra_env` is what the desktop app adds."""
    (tmp_path / "home").mkdir()
    port = _free_port()
    env = dict(os.environ, ANNZARRO_HOME=str(tmp_path / "home"), ANNZARRO_HEADLESS="1",
               PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""), **(extra_env or {}))
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
            time.sleep(min(0.5, 0.1 * (_ + 1)))
    else:
        proc.kill()
        pytest.fail("server did not start")
    yield root
    proc.terminate()
    proc.wait(10)


@pytest.fixture
def server(tmp_path):
    yield from _serve(tmp_path)


@pytest.fixture
def brand_server(tmp_path):
    """As the desktop app starts its server: site.fred_hutch_logo on (utils desktop serverEnv)."""
    yield from _serve(tmp_path, {"ANNZARRO_SITE_FRED_HUTCH_LOGO": "true"})


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
            assert "Setty Lab at Fred Hutch Cancer Center" in " ".join(text.split())   # the line breaks before Fred Hutch
            assert "R35GM147125" in text and "K99GM159044" in text
            assert "National Institute of General Medical Sciences" in text
            # only the lab's logo shows (Fred Hutch is credited in text until its brand team approves the logo)
            logos = page.evaluate(LOGOS)
            assert sorted(l[0] for l in logos) == ["Setty Lab"]
            assert all(l[1] > 0 for l in logos)
            _shot(page, f"about-{scheme}-desktop")
        finally:
            browser.close()


def test_about_logo_files_are_served_in_both_themes(server):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            for scheme in ("light", "dark"):
                page = _open(browser, server, scheme)
                _show(page)
                srcs = page.evaluate("[...document.querySelectorAll('#about-modal img')].map(i => i.src)")
                assert srcs and not any("fredhutch" in s for s in srcs)
                for src in srcs:
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
            # hold the click until the script is requested and held back (a slow runner
            # may not have reached it when the name appears)
            for _ in range(150):
                if held:
                    break
                page.wait_for_timeout(100)
            assert held, "about-dialog.js was not requested within 15 s"
            page.click("#about-open")
            page.wait_for_selector("#about-modal.show", timeout=5000)
            assert page.locator("#about-version").inner_text() == ""
            for route in held:
                route.continue_()
            page.wait_for_function("() => document.getElementById('about-version').textContent.trim() !== ''",
                                   timeout=10000)
            version = json.load(urllib.request.urlopen(server + "/api/v1/config"))["annzarro_version"]
            assert page.locator("#about-version").inner_text() == version
        finally:
            browser.close()


BRAND_BOXES = """() => { const r = (s) => document.querySelector(s).getBoundingClientRect();
    const b = r('.about-brand-logo'), l = r('.about-logo-lab');
    return {brand: [b.left, b.top, b.right, b.bottom], lab: [l.left, l.top, l.right, l.bottom],
            plate: getComputedStyle(document.querySelector('.about-brand-link')).backgroundColor,
            padding: parseFloat(getComputedStyle(document.querySelector('.about-brand-link')).paddingLeft),
            linkW: r('.about-brand-link').width, fw: r('.about-brand-logo').width,
            alt: document.querySelector('.about-brand-logo').alt,
            href: document.querySelector('.about-brand-link').href,
            labParent: document.querySelector('.about-logo-lab').closest('.about-lab') !== null,
            sibling: document.querySelector('.about-brand').nextElementSibling.className} }"""


def test_about_without_the_key_has_the_text_credit_and_requests_no_fred_hutch_image(server):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_context(viewport={"width": 1440, "height": 900}).new_page()
            requested = []
            page.on("request", lambda req: requested.append(req.url))
            page.goto(server)
            page.wait_for_function("() => document.querySelector('.app-title').title.includes('AnnZarro ')", timeout=30000)
            _show(page)
            assert page.locator(".about-brand").count() == 0
            assert "Setty Lab at Fred Hutch Cancer Center" in " ".join(page.locator("#about-modal").inner_text().split())
            assert not [u for u in requested if "fredhutch" in u or "/img/brand/" in u]
        finally:
            browser.close()


@pytest.mark.parametrize("scheme", ["light", "dark"])
def test_about_with_the_key_shows_the_sign_post_and_keeps_the_lab_logo_apart(brand_server, scheme):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = _open(browser, brand_server, scheme)
            _show(page)
            logos = page.evaluate(LOGOS)
            assert sorted(l[0] for l in logos) == ["Fred Hutch Cancer Center", "Setty Lab"]
            assert all(l[1] > 0 for l in logos), "both images loaded"
            info = page.evaluate(BRAND_BOXES)
            assert info["alt"] == "Fred Hutch Cancer Center", "the sign post is not announced twice"
            assert info["href"] == "https://www.fredhutch.org/"
            assert 255 <= info["fw"] <= 320
            # the Setty Lab logo is lower, smaller, and not next to the Fred Hutch logo: the credit text
            # sits between them and they share no row
            brand, lab = info["brand"], info["lab"]
            assert lab[1] > brand[3] + 40, "the lab logo is well below the Fred Hutch logo"
            assert (lab[3] - lab[1]) < (brand[3] - brand[1]) * 1.2 + 20
            assert info["sibling"] == "about-dev", "the text credit follows the Fred Hutch logo"
            assert info["labParent"]
            assert page.evaluate("document.querySelector('.about-logos')") is None
            if scheme == "dark":
                assert info["plate"] == "rgb(255, 255, 255)", "navy artwork on a white plate"
                # clear space at least the F's cap height: 38.9 of the artwork's 804.9 units
                assert info["padding"] >= info["fw"] * 38.9 / 804.9
            else:
                assert info["plate"] == "rgba(0, 0, 0, 0)"
            _shot(page, f"about-brand-{scheme}-desktop")
        finally:
            browser.close()


@pytest.mark.parametrize("scheme", ["light", "dark"])
def test_about_with_the_key_fits_a_phone(brand_server, scheme):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = _open(browser, brand_server, scheme, 390, 844)
            _show(page)
            assert page.evaluate("document.querySelector('#about-modal .modal-body').scrollWidth"
                                 " <= document.querySelector('#about-modal .modal-body').clientWidth")
            assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
            logo = page.evaluate(BRAND_BOXES)
            assert 0 < logo["fw"] < 330 and logo["brand"][2] <= 390
            _shot(page, f"about-brand-{scheme}-phone")
        finally:
            browser.close()


def test_the_sign_post_file_is_served(brand_server):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = _open(browser, brand_server)
            _show(page)
            src = page.evaluate("document.querySelector('.about-brand-logo').src")
            assert src.endswith("/static/img/brand/fredhutch-annzarro-signpost.svg")
            assert urllib.request.urlopen(src, timeout=5).status == 200
        finally:
            browser.close()
