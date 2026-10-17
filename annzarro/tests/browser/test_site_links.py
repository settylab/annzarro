"""The site's footer line and texts, in a real browser (annzarro/server/site.py).

1. Nothing configured: no footer, no "This site" block, the panel area fills the window as before;
2. configured: a small, quiet, centred footer line sits at the bottom of the window, below the panel
   area and never over it, at 1440 and 390 px wide, in the light and the dark theme;
3. "Impressum" opens the About dialog at the imprint (one click), by keyboard too, and Escape closes it;
   a link to a URL opens that address in a new tab; without JavaScript the link goes to /site/imprint;
4. the login, account and admin pages carry the same footer, at the bottom of the window;
5. the desktop app (<html data-desktop>) shows its privacy statement in About, a browser does not;
6. site.storage.persistent_convenience: false keeps the autosave in sessionStorage.

Screenshots go to ANNZARRO_SHOTS when it is set.

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
    import playwright.sync_api as playwright  # noqa: E402  (required: fail, do not skip)
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.test_close_all import _link  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
DATA_DIR = os.path.join(os.path.dirname(HERE), "data")
SHOTS = os.environ.get("ANNZARRO_SHOTS")

SITE = """
site:
  imprint:
    label: "Impressum"
    markdown: |
      ## Angaben gemäß § 5 DDG

      **Example Institute**, University of X  
      Main Street 1, 12345 Town

      Vertreten durch: Prof. Dr. Example, Direktorin

      E-Mail: [office@example.org](mailto:office@example.org)  
      Telefon: +49 123 456789

      - Registergericht: Amtsgericht Town
      - Umsatzsteuer-ID: DE123456789
  privacy:
    label: "Datenschutz"
    url: "https://example.org/datenschutz"
  accessibility:
    label: "Barrierefreiheit"
    markdown: "Wir arbeiten an der Barrierefreiheit."
  operator: "Example Institute, University of X"
  contact: "office@example.org"
  contact_label: "Kontakt"
  languages: "de"
"""


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _launch(tmp_path, yaml_text, auth=False, ready="/api/v1/config"):
    (tmp_path / "home").mkdir()
    config = tmp_path / "site.yaml"
    users = tmp_path / "users.json"
    config.write_text((f"auth:\n  enabled: true\n  user_file: \"{users}\"\n" if auth else "") + yaml_text)
    env = dict(os.environ, ANNZARRO_HOME=str(tmp_path / "home"), ANNZARRO_HEADLESS="1",
               PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""))
    env.pop("ANNZARRO_CONFIG", None)
    if auth:
        for name, extra in (("root", ["--admin"]), ("alice", [])):
            subprocess.run([sys.executable, "-m", "annzarro.cli", "user", "--config", str(config), "add",
                            "--username", name, "--password", "pw-one-two-three", *extra],
                           env=env, cwd=REPO, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    port = _free_port()
    proc = subprocess.Popen([sys.executable, "-m", "annzarro.cli", "start", "--config", str(config),
                             "--host", "127.0.0.1", "--port", str(port), "--data-dir", DATA_DIR, "--no-browser",
                             *([] if auth else ["--auth-disabled"])],
                            env=env, cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    root = f"http://127.0.0.1:{port}"
    for _ in range(120):
        try:
            urllib.request.urlopen(root + ready, timeout=1)
            return root, proc
        except OSError:
            time.sleep(0.25)
    proc.kill()
    pytest.fail("server did not start")


@pytest.fixture(scope="module")
def sited(tmp_path_factory):
    root, proc = _launch(tmp_path_factory.mktemp("sited"), SITE)
    yield root
    proc.terminate()
    proc.wait(10)


@pytest.fixture(scope="module")
def plain(tmp_path_factory):
    root, proc = _launch(tmp_path_factory.mktemp("plain"), "")
    yield root
    proc.terminate()
    proc.wait(10)


@pytest.fixture(scope="module")
def login_site(tmp_path_factory):
    root, proc = _launch(tmp_path_factory.mktemp("login"), SITE, auth=True, ready="/login")
    yield root
    proc.terminate()
    proc.wait(10)


@pytest.fixture(scope="module")
def browser():
    with playwright.sync_playwright() as p:
        b = p.chromium.launch()
        yield b
        b.close()


def _shot(page, name):
    if SHOTS:
        os.makedirs(SHOTS, exist_ok=True)
        page.screenshot(path=os.path.join(SHOTS, name + ".png"))


def _page(browser, width=1440, height=900, scheme="light", **context):
    ctx = browser.new_context(viewport={"width": width, "height": height}, color_scheme=scheme, **context)
    page = ctx.new_page()
    page.errors = []
    page.on("pageerror", lambda e: page.errors.append(str(e)))
    return page


BOXES = """() => {
  const box = (sel) => { const e = document.querySelector(sel); if (!e) return null;
    const r = e.getBoundingClientRect(); return {x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom}; };
  return {footer: box('#site-footer'), tiles: box('#tile-container'), vw: innerWidth, vh: innerHeight,
          overflow: document.documentElement.scrollWidth - innerWidth,
          fontSize: document.querySelector('#site-footer') ? parseFloat(getComputedStyle(document.querySelector('#site-footer')).fontSize) : 0};
}"""


def _wait_app(page):
    page.wait_for_selector("#tile-container", timeout=30000)
    page.wait_for_function("() => document.querySelector('.app-title').title.includes('AnnZarro ')", timeout=30000)


# 1 ------------------------------------------------------------------------------------------------

def test_nothing_is_added_when_nothing_is_configured(browser, plain):
    page = _page(browser)
    page.goto(plain)
    _wait_app(page)
    assert page.locator("#site-footer").count() == 0
    assert page.locator("#about-this-site").count() == 0
    b = page.evaluate(BOXES)
    assert abs(b["tiles"]["bottom"] - b["vh"]) < 1.5, "the panel area reaches the bottom of the window, as before"
    page.click("#about-open")
    page.wait_for_selector("#about-modal.show")
    assert page.locator("#about-this-site").count() == 0
    assert page.locator("#about-desktop-privacy").is_hidden()
    assert "AnnZarro is developed by the Setty Lab" in page.inner_text("#about-modal")
    assert page.errors == []


# 2 ------------------------------------------------------------------------------------------------

@pytest.mark.parametrize("scheme", ["light", "dark"])
@pytest.mark.parametrize("width, height", [(1440, 900), (390, 844)])
def test_the_footer_is_small_centred_and_covers_nothing(browser, sited, scheme, width, height):
    page = _page(browser, width, height, scheme)
    page.goto(sited)
    _wait_app(page)
    assert page.evaluate("document.documentElement.getAttribute('data-theme')") == scheme
    b = page.evaluate(BOXES)
    f, t = b["footer"], b["tiles"]
    assert f is not None and f["h"] < 36 and b["fontSize"] <= 13, "small and quiet"
    assert abs(f["bottom"] - b["vh"]) < 1.5, "at the bottom of the window"
    assert t["bottom"] <= f["y"] + 0.5, "the panel area ends where the footer begins: no overlap"
    assert abs((f["x"] + f["w"] / 2) - width / 2) < 2 and f["w"] >= width - 2
    assert b["overflow"] <= 0, "no sideways scrolling"
    texts = page.locator("#site-footer a").all_inner_texts()
    assert texts == ["Impressum", "Datenschutz", "Barrierefreiheit", "Kontakt"]
    # nothing in the footer lies over the panel area, and the panel area is clickable down to its last pixel
    hit = page.evaluate("""() => { const t = document.querySelector('#tile-container').getBoundingClientRect();
        const e = document.elementFromPoint(innerWidth / 2, t.bottom - 2); return e ? e.closest('#site-footer') === null : false; }""")
    assert hit
    _shot(page, f"footer-main-{width}-{scheme}")
    assert page.errors == []


def test_the_footer_does_not_cover_a_panel(browser, sited):
    page = _page(browser, 1440, 900)
    url, ids = _link(sited)
    page.goto(url)
    for i in ids:
        page.wait_for_selector(f".tile[data-tile-id='{i}'] .js-plotly-plot", timeout=60000)
    page.wait_for_timeout(800)
    covered = page.evaluate("""() => {
        const f = document.querySelector('#site-footer').getBoundingClientRect();
        const c = document.querySelector('#tile-container').getBoundingClientRect();
        const at = (x, y) => document.elementFromPoint(x, y);
        const mid = innerWidth / 2;
        return {footerOnTop: !!at(mid, f.top + f.height / 2).closest('#site-footer'),
                panelsOnTop: !!at(mid, c.bottom - 2).closest('#tile-container'),
                gap: f.top - c.bottom};
    }""")
    assert covered["footerOnTop"] and covered["panelsOnTop"] and abs(covered["gap"]) < 1.5
    _shot(page, "footer-with-panels-1440-light")


# 3 ------------------------------------------------------------------------------------------------

def test_impressum_opens_about_at_the_imprint_in_one_click(browser, sited):
    page = _page(browser)
    page.goto(sited)
    _wait_app(page)
    page.click("#site-footer a:has-text('Impressum')")
    page.wait_for_selector("#about-modal.show", timeout=5000)
    page.wait_for_timeout(500)
    section = page.locator("details#about-imprint")
    assert section.evaluate("e => e.open") is True
    assert page.url.rstrip("/") == sited, "no navigation: the dialog opened in place"
    assert "Angaben gemäß § 5 DDG" in page.inner_text("#about-imprint")
    assert "Umsatzsteuer-ID: DE123456789" in page.inner_text("#about-imprint")
    # the text is inside the dialog's visible part
    inside = page.evaluate("""() => { const b = document.querySelector('#about-modal .modal-body').getBoundingClientRect();
        const s = document.querySelector('#about-imprint summary').getBoundingClientRect();
        return s.top >= b.top - 1 && s.bottom <= b.bottom + 1; }""")
    assert inside
    assert page.evaluate("document.activeElement.closest('summary') !== null"), "focus is on the section"
    block = page.inner_text("#about-this-site")
    assert "Operated by Example Institute, University of X" in block and "Kontakt: office@example.org" in block
    assert "Datenschutz" in block and "Barrierefreiheit" in block
    _shot(page, "about-imprint-1440-light")
    page.keyboard.press("Escape")
    page.wait_for_function("() => !document.body.classList.contains('modal-open')", timeout=5000)
    assert page.errors == []


def test_the_footer_works_by_keyboard(browser, sited):
    page = _page(browser)
    page.goto(sited)
    _wait_app(page)
    page.focus("#site-footer a")
    assert page.evaluate("document.activeElement.textContent") == "Impressum"
    outline = page.evaluate("getComputedStyle(document.activeElement).outlineStyle")
    assert outline != "none", "a visible focus ring"
    page.keyboard.press("Enter")
    page.wait_for_selector("#about-modal.show", timeout=5000)
    page.wait_for_timeout(400)
    assert page.locator("details#about-imprint").evaluate("e => e.open") is True
    page.keyboard.press("Escape")
    page.wait_for_function("() => !document.body.classList.contains('modal-open')", timeout=5000)
    page.focus("#site-footer a:has-text('Datenschutz')")
    assert page.evaluate("document.activeElement.getAttribute('target')") == "_blank"
    assert page.evaluate("document.activeElement.getAttribute('href')") == "https://example.org/datenschutz"
    # Tab order: the footer links in reading order
    page.focus("#site-footer a")
    seen = []
    for _ in range(4):
        seen.append(page.evaluate("document.activeElement.textContent"))
        page.keyboard.press("Tab")
    assert seen == ["Impressum", "Datenschutz", "Barrierefreiheit", "Kontakt"]


def test_a_url_link_opens_a_new_tab_at_that_address(browser, sited):
    page = _page(browser)
    page.goto(sited)
    _wait_app(page)
    page.route("https://example.org/**", lambda route: route.fulfill(status=200, body="<title>stub</title>", content_type="text/html"))
    with page.context.expect_page() as opened:
        page.click("#site-footer a:has-text('Datenschutz')")
    assert opened.value.url.startswith("https://example.org/datenschutz")
    assert page.locator("#about-modal.show").count() == 0, "an address is opened, not the dialog"


def test_without_javascript_the_imprint_is_a_page(browser, sited):
    page = _page(browser, java_script_enabled=False)
    page.goto(sited)
    page.click("#site-footer a:has-text('Impressum')")
    page.wait_for_url("**/site/imprint")
    assert page.inner_text("h1") == "Impressum"
    assert "Umsatzsteuer-ID: DE123456789" in page.inner_text("main")
    assert page.get_attribute("html", "lang") == "de"
    _shot(page, "site-page-imprint-1440-light")
    page.click("main a:has-text('AnnZarro')")
    assert page.url.rstrip("/") == sited


@pytest.mark.parametrize("scheme", ["light", "dark"])
def test_the_text_page_is_readable_on_a_phone(browser, sited, scheme):
    page = _page(browser, 390, 844, scheme)
    page.goto(sited + "/site/imprint")
    assert page.evaluate("document.documentElement.scrollWidth - innerWidth") <= 0
    footer = page.evaluate(BOXES)["footer"]
    assert abs(footer["bottom"] - 844) < 1.5, "the footer is at the bottom of a short page"
    _shot(page, f"site-page-imprint-390-{scheme}")


# 4 ------------------------------------------------------------------------------------------------

@pytest.mark.parametrize("scheme", ["light", "dark"])
@pytest.mark.parametrize("width, height", [(1440, 900), (390, 844)])
def test_the_sign_in_page_carries_the_footer(browser, login_site, scheme, width, height):
    page = _page(browser, width, height, scheme)
    page.goto(login_site + "/login")
    b = page.evaluate(BOXES)
    assert b["footer"] is not None and abs(b["footer"]["bottom"] - height) < 1.5 and b["overflow"] <= 0
    card = page.locator(".login-container").bounding_box()
    assert card["y"] + card["height"] <= b["footer"]["y"] + 0.5, "the card is above the footer"
    assert abs((card["x"] + card["width"] / 2) - width / 2) < 2, "still centred"
    # no About dialog here: the imprint link goes to its page
    assert page.get_attribute("#site-footer a", "href").endswith("/site/imprint")
    assert response_ok(page, login_site + "/site/imprint")
    _shot(page, f"footer-login-{width}-{scheme}")


def response_ok(page, url):
    return page.evaluate("async (u) => (await fetch(u)).status", url) == 200


def test_the_account_and_admin_pages_carry_the_footer(browser, login_site):
    page = _page(browser, 1440, 900)
    page.goto(login_site + "/login")
    page.fill("#username", "root")
    page.fill("#password", "pw-one-two-three")
    page.click("button[type=submit]")
    page.wait_for_url(lambda u: "/login" not in u, timeout=30000)
    for path, ready in (("/account/password", "#account-form"), ("/admin", "#admin-nav .nav-link")):
        page.goto(login_site + path)
        page.wait_for_selector(ready, timeout=30000)
        b = page.evaluate(BOXES)
        assert b["footer"] is not None and abs(b["footer"]["bottom"] - 900) < 1.5, path
        assert page.locator("#site-footer a").all_inner_texts()[0] == "Impressum"
        _shot(page, "footer-" + path.strip("/").replace("/", "-") + "-1440-light")


# 5 ------------------------------------------------------------------------------------------------

def test_the_desktop_app_states_what_it_sends(browser, plain):
    page = _page(browser)
    page.add_init_script("const set = () => document.documentElement && document.documentElement.setAttribute('data-desktop', ''); "
                         "set(); new MutationObserver(set).observe(document, {childList: true})")
    page.goto(plain)
    _wait_app(page)
    assert page.locator("#site-footer").count() == 0, "a desktop app shows no site footer unless configured"
    page.click("#about-open")
    page.wait_for_selector("#about-modal.show")
    statement = page.locator("#about-desktop-privacy")
    assert statement.is_visible()
    text = statement.inner_text()
    for needle in ("github.com", "IP address", "Gene Set", "agree", "Check for Updates Automatically"):
        assert needle in text
    assert statement.locator("a").get_attribute("href").endswith("/deployment/public-site.html#desktop-privacy")
    _shot(page, "about-desktop-privacy-1440-light")


# 6 ------------------------------------------------------------------------------------------------

def _autosaved(page, root):
    url, ids = _link(root)
    page.goto(url)
    for i in ids:
        page.wait_for_selector(f".tile[data-tile-id='{i}'] .js-plotly-plot", timeout=60000)
    page.wait_for_function("() => sessionStorage.getItem('annzarro_autosave') || localStorage.getItem('annzarro_autosave')",
                           timeout=30000)
    return page.evaluate("() => ({local: localStorage.getItem('annzarro_autosave') !== null, "
                         "session: sessionStorage.getItem('annzarro_autosave') !== null})")


FAST_AUTOSAVE = "ui:\n  autosave:\n    interval_ms: 300\n"


def test_the_autosave_lasts_between_visits_by_default(browser, tmp_path):
    root, proc = _launch(tmp_path, FAST_AUTOSAVE)
    try:
        page = _page(browser)
        assert _autosaved(page, root) == {"local": True, "session": False}
    finally:
        proc.terminate()
        proc.wait(10)


def test_session_only_keeps_the_autosave_out_of_local_storage_and_forgets_the_old(browser, tmp_path):
    root, proc = _launch(tmp_path, FAST_AUTOSAVE + "site:\n  storage:\n    persistent_convenience: false\n")
    try:
        page = _page(browser)
        page.add_init_script("if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); "
                             "localStorage.setItem('annzarro_autosave', '{\"old\": true}'); "
                             "localStorage.setItem('annzarro.recents:x|local', '[]'); localStorage.setItem('annzarro-theme', 'dark'); }")
        assert _autosaved(page, root) == {"local": False, "session": True}
        assert page.evaluate("localStorage.getItem('annzarro.recents:x|local')") is None, "an earlier visit's history is forgotten"
        assert page.evaluate("localStorage.getItem('annzarro-theme')") == "dark", "a choice the user made stays"
    finally:
        proc.terminate()
        proc.wait(10)
