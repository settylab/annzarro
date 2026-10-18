"""The admin page's Public site section and the default footer, in a real browser.

1. Every field of /admin#site has a help that shows on hover and on focus, and the guide is linked;
2. the Markdown preview renders with the safe renderer in a sandboxed frame: a <script> in the text is
   shown as text and runs nowhere;
3. a text saved there shows in the footer of the sign-in page at once (no restart), and is listed as set;
4. a hosted server's footer is "About · Data & privacy" with nothing configured, "About" opens the About
   dialog on the main page; a personal server on loopback (login off) has no footer.

Screenshots (the section in the light and the dark theme, the default footer) go to ANNZARRO_SHOTS when
it is set.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import os
import socket
import subprocess
import sys
import time
import urllib.request

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.server.admin_helpers import ADMIN, PASSWORD  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
SHOTS = os.environ.get("ANNZARRO_SHOTS")

#: an app of the admin tests' helper (login on or off), served by werkzeug
SERVE = """
import sys
from pathlib import Path
from werkzeug.serving import run_simple
from annzarro.tests.server.admin_helpers import make_app
app = make_app(Path(sys.argv[1]), auth=sys.argv[3] == "1")
run_simple("127.0.0.1", int(sys.argv[2]), app, threaded=True)
"""


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _serve(root, auth):
    root.mkdir(parents=True, exist_ok=True)
    port = _free_port()
    env = dict(os.environ, ANNZARRO_HOME=str(root / "home"), ANNZARRO_HEADLESS="1",
               PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""))
    env.pop("ANNZARRO_CONFIG", None)
    proc = subprocess.Popen([sys.executable, "-c", SERVE, str(root), str(port), "1" if auth else "0"], env=env,
                            cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    url = f"http://127.0.0.1:{port}"
    for _ in range(160):
        try:
            urllib.request.urlopen(url + "/site/data", timeout=1)
            return proc, url
        except OSError:
            if proc.poll() is not None:
                break
            time.sleep(0.25)
    proc.kill()
    pytest.fail("server did not start")


@pytest.fixture(scope="module")
def hosted(tmp_path_factory):
    proc, url = _serve(tmp_path_factory.mktemp("site-admin"), auth=True)
    yield url
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


@pytest.fixture
def section(browser, hosted):
    context = browser.new_context(viewport={"width": 1300, "height": 1000})
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    _sign_in(page, hosted)
    page.goto(hosted + "/admin#site")
    page.wait_for_selector("#site-checklist")
    yield page
    assert not errors, errors
    context.close()


def _footer(page):
    return page.locator("#site-footer a").all_inner_texts()


def test_every_field_has_a_help_on_hover_and_focus_and_the_guide_is_linked(section):
    helps = section.locator("[data-site-help]")
    assert helps.count() == 13
    for i in range(helps.count()):
        mark = helps.nth(i)
        assert mark.get_attribute("aria-label").startswith("Help: ")
        assert len(mark.get_attribute("data-bs-original-title") or mark.get_attribute("title") or "") > 40
    imprint = section.locator('[data-key="site.imprint"] [data-site-help]')
    imprint.hover()
    tip = section.locator(".tooltip")
    tip.wait_for(state="visible")
    assert "Impressum" in tip.inner_text()
    section.mouse.move(0, 0)
    section.locator('[data-key="site.robots"] [data-site-help]').focus()
    section.wait_for_function("() => [...document.querySelectorAll('.tooltip')].some(t => /search engines/i.test(t.textContent))")
    guides = section.locator('a[href*="public-site.html"]')
    assert guides.count() >= 14
    assert guides.first.get_attribute("target") == "_blank"


def test_the_preview_is_safe_and_live(section):
    card = section.locator('[data-key="site.imprint"]')
    card.locator("label", has_text="Text written here").click()
    card.locator("textarea").fill("## Angaben\n\n<script>window.__pwned = 1</script> **Example Institute** "
                                  "[x](javascript:alert(1))")
    frame = section.frame_locator('[data-preview="imprint"]')
    frame.locator("strong", has_text="Example Institute").wait_for()
    assert frame.locator("h3").inner_text() == "Angaben", "headings sit under the page's title, as on /site/imprint"
    assert "<script>window.__pwned = 1</script>" in frame.locator("body").inner_text(), "the script is text"
    assert frame.locator("script").count() == 0
    assert frame.locator('a[href^="javascript"]').count() == 0
    assert section.evaluate("() => window.__pwned") is None
    assert card.locator("iframe").get_attribute("sandbox") == ""


def test_a_saved_text_shows_in_the_footer_at_once(section, hosted, browser):
    card = section.locator('[data-key="site.imprint"]')
    card.locator("label", has_text="Link to a page").click()
    card.locator('input[type="url"]').fill("https://example.org/impressum")
    card.locator('input[id="site-imprint-label"]').fill("Impressum")
    section.locator("#site-save").click()
    section.wait_for_selector('[data-check="imprint"][data-set="1"]')
    assert section.locator('[data-key="site.imprint"] .badge').first.inner_text() == "set here"
    visitor = browser.new_context()
    page = visitor.new_page()
    page.goto(hosted + "/login")
    assert _footer(page) == ["About", "Impressum", "Data & privacy"]
    assert page.locator('#site-footer a:has-text("Impressum")').get_attribute("href") == "https://example.org/impressum"
    visitor.close()
    # a refused value is shown on its field and nothing is stored
    section.locator("#site-contact").fill("javascript:alert(1)")
    section.locator("#site-save").click()
    section.wait_for_selector('[data-key="site.contact"] .site-error:not([hidden])')
    assert "e-mail address" in section.locator('[data-key="site.contact"] .site-error').inner_text()
    # back to nothing, for the other tests
    section.locator('[data-reset="imprint"]').click()
    section.wait_for_selector('[data-check="imprint"][data-set="0"]')


@pytest.mark.parametrize("scheme", ["light", "dark"])
def test_screenshots_of_the_section(browser, hosted, scheme):
    context = browser.new_context(viewport={"width": 1300, "height": 2000}, color_scheme=scheme)
    page = context.new_page()
    _sign_in(page, hosted)
    page.goto(hosted + "/admin#site")
    page.wait_for_selector("#site-checklist")
    card = page.locator('[data-key="site.imprint"]')
    card.locator("label", has_text="Text written here").click()
    card.locator("textarea").fill("## Angaben gemäß § 5 DDG\n\n**Example Institute**, University of X  \n"
                                  "Main Street 1, 12345 Town\n\nE-Mail: [office@example.org](mailto:office@example.org)")
    page.frame_locator('[data-preview="imprint"]').locator("strong").wait_for()
    page.locator('[data-key="site.privacy"] [data-site-help]').hover()
    page.locator(".tooltip.show").wait_for(state="visible")
    page.wait_for_function("() => parseFloat(getComputedStyle(document.querySelector('.tooltip.show')).opacity) >= 0.85")
    assert page.evaluate("() => document.documentElement.getAttribute('data-theme')") == scheme
    if SHOTS:
        os.makedirs(SHOTS, exist_ok=True)
        page.screenshot(path=os.path.join(SHOTS, f"admin-public-site-{scheme}.png"), full_page=True)
    context.close()


def test_the_default_footer_on_a_hosted_server(browser, hosted):
    context = browser.new_context(viewport={"width": 1300, "height": 800})
    page = context.new_page()
    page.goto(hosted + "/login")
    assert _footer(page) == ["About", "Data & privacy"]
    if SHOTS:
        page.screenshot(path=os.path.join(SHOTS, "footer-default-login.png"))
    page.click('#site-footer a:has-text("Data & privacy")')
    page.wait_for_load_state()
    assert page.url.endswith("/site/data")
    assert "This is not a privacy notice." in page.inner_text("main")
    if SHOTS:
        page.screenshot(path=os.path.join(SHOTS, "site-data-page.png"), full_page=True)
    page.go_back()
    page.click('#site-footer a:has-text("About")')
    page.wait_for_load_state()
    assert page.url.endswith("/site/about") and "AnnZarro is developed by the" in page.inner_text("main")
    _sign_in(page, hosted)
    page.goto(hosted + "/")
    page.wait_for_selector("#site-footer")
    assert _footer(page) == ["About", "Data & privacy"]
    page.click('#site-footer a:has-text("About")')
    page.locator("#about-modal").wait_for(state="visible")
    assert page.url.rstrip("/") == hosted, "About opens the dialog in place"
    if SHOTS:
        page.locator("#about-modal .btn-close").click()
        page.locator("#about-modal").wait_for(state="hidden")
        page.wait_for_function("() => !document.querySelector('.modal-backdrop')")
        page.screenshot(path=os.path.join(SHOTS, "footer-default-main.png"))
    context.close()


def test_a_personal_server_has_no_footer(browser, tmp_path):
    proc, url = _serve(tmp_path / "personal", auth=False)
    try:
        context = browser.new_context()
        page = context.new_page()
        page.goto(url + "/")
        page.wait_for_load_state("networkidle")
        assert page.locator("#site-footer").count() == 0
        context.close()
    finally:
        proc.terminate()
        proc.wait(10)
