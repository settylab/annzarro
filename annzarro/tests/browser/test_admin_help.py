"""Every setting of the admin pages carries an info mark and a Guide link, in a real browser.

1. Every control the admin pages render (the Settings and Public site tabs, the Users dialogs,
   the Access panel and its per-user settings, Data sources, Panel sets, Server health, Audit)
   is inside a setting that has an info mark with a text and a Guide link, or is marked as not
   being a setting (a filter, a row checkbox). A new control with neither fails here.
2. Each Guide link names a page and an anchor that exist in the docs.
3. The mark is reachable by keyboard: Tab focuses it, the text shows and Escape closes it; the
   text is in the page for screen readers (aria-describedby).
4. In the dark theme the tip is readable, and at 390 px no tab overflows sideways.

Screenshots (Settings and Users tabs, light and dark) go to ANNZARRO_SHOTS when it is set.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import json
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

from annzarro.tests.server.admin_helpers import ADMIN, PASSWORD, USER  # noqa: E402
from annzarro.tests.server.docs_anchors import guide_exists  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
SHOTS = os.environ.get("ANNZARRO_SHOTS")
DOCS = "https://annzarro.readthedocs.io/en/latest/"

SERVE = """
import sys
from pathlib import Path
from werkzeug.serving import run_simple
from annzarro.tests.server.admin_helpers import make_app
app = make_app(Path(sys.argv[1]), auth=True, admin_data_roots=[sys.argv[3]])
run_simple("127.0.0.1", int(sys.argv[2]), app, threaded=True)
"""

#: what one page of the admin interface holds that is a setting, and what is not (see help.js)
AUDIT = """(registry) => {
  const bad = [], guides = new Set();
  const settings = [...document.querySelectorAll('#admin-main [data-setting]')];
  for (const s of settings) {
    const id = s.getAttribute('data-setting');
    const mark = s.querySelector('[data-help]');
    const text = mark ? (mark.getAttribute('data-bs-original-title') || mark.getAttribute('title') || '') : '';
    if (!mark) bad.push(id + ': no info mark');
    else if (text.trim().split(/\\s+/).length < 8) bad.push(id + ': help too terse: ' + text);
    else {
      const described = document.getElementById(mark.getAttribute('aria-describedby') || '');
      if (!described || !described.textContent.trim()) bad.push(id + ': aria-describedby does not name a text');
    }
    const title = s.querySelector('.policy-label');
    if (title && /[._]/.test(title.textContent)) bad.push(id + ': titled with a key, not a label: ' + title.textContent);
    if (mark && registry.includes(id)) {
      const path = mark.getAttribute('data-config-file');
      const own = 'Config file: none. Set here or per user; to lock it, list ' + id + ' under policy.locked.';
      if (!path) bad.push(id + ': the tooltip has no config file line');
      else if (path === 'none' ? !text.endsWith(own) : !text.endsWith('Config file: ' + path)) bad.push(id + ': the tooltip does not end with its config file line: ' + text);
    }
    const link = s.querySelector('a[data-guide]');
    if (!link) bad.push(id + ': no Guide link');
    else guides.add(link.getAttribute('href'));
  }
  for (const c of document.querySelectorAll('#admin-main input, #admin-main select, #admin-main textarea')) {
    if (c.type === 'hidden') continue;
    if (!c.closest('[data-setting], [data-not-setting]')) bad.push('control outside any setting: ' + (c.id || c.name || c.getAttribute('aria-label') || c.outerHTML.slice(0, 80)));
  }
  return { bad, guides: [...guides], count: settings.length };
}"""


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def hosted(tmp_path_factory):
    root = tmp_path_factory.mktemp("admin-help")
    parent = root / "parent"
    (parent / "lab1").mkdir(parents=True)
    sessions = root / "data" / "sessions"
    sessions.mkdir(parents=True)
    for name in ("one", "two"):
        (sessions / f"{name}.json").write_text(json.dumps(
            {"name": name, "owner": USER, "dataset": "d.zarr", "modified_at": "2026-10-10T10:00:00", "modified_by": USER}))
    port = _free_port()
    env = dict(os.environ, ANNZARRO_HOME=str(root / "home"), ANNZARRO_HEADLESS="1",
               PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""))
    env.pop("ANNZARRO_CONFIG", None)
    proc = subprocess.Popen([sys.executable, "-c", SERVE, str(root), str(port), str(parent)], env=env, cwd=REPO,
                            stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    url = f"http://127.0.0.1:{port}"
    for _ in range(160):
        try:
            urllib.request.urlopen(url + "/login", timeout=1)
            break
        except OSError:
            if proc.poll() is not None:
                pytest.fail("server exited")
            time.sleep(0.25)
    else:
        proc.kill()
        pytest.fail("server did not start")
    yield url
    proc.terminate()
    proc.wait(10)


@pytest.fixture(scope="module")
def browser():
    with playwright.sync_playwright() as p:
        b = p.chromium.launch()
        yield b
        b.close()


def _open(browser, url, section, width=1300, height=1000):
    context = browser.new_context(viewport={"width": width, "height": height})
    page = context.new_page()
    page.errors = []
    page.on("pageerror", lambda e: page.errors.append(str(e)))
    page.goto(url + "/login")
    page.fill("input[name=username]", ADMIN)
    page.fill("input[name=password]", PASSWORD)
    page.click("button[type=submit], input[type=submit]")
    page.wait_for_load_state("networkidle")
    page.goto(f"{url}/admin#{section}")
    page.wait_for_selector("#admin-nav .nav-link.active")
    return context, page


def _audit(page, minimum):
    page.wait_for_function("() => document.querySelectorAll('#admin-main [data-setting], #admin-main table, #admin-main .text-muted').length > 0")
    registry = page.evaluate("() => fetch('/api/v1/admin/policy').then(r => r.json()).then(p => p.keys.map(k => k.name))")
    got = page.evaluate(AUDIT, registry)
    assert got["bad"] == [], got["bad"]
    assert got["count"] >= minimum, f"only {got['count']} settings found; the audit would pass for the wrong reason"
    for href in got["guides"]:
        assert href.startswith(DOCS), href
        assert guide_exists(href[len(DOCS):]), f"{href}: no such anchor in the docs"
    return got


def test_the_settings_and_public_site_tabs(browser, hosted):
    context, page = _open(browser, hosted, "settings")
    try:
        page.wait_for_selector(".policy-row")
        got = _audit(page, 25)
        assert "deployment/admin.html#policy-panel-cell-plot-enabled" in "".join(got["guides"])
        assert "deployment/resource-limits.html#limit-max-requests" in "".join(got["guides"])
        page.goto(hosted + "/admin#site")
        page.wait_for_selector("#site-checklist")
        _audit(page, 13)
        assert not page.errors, page.errors
    finally:
        context.close()


def test_the_users_dialogs_and_the_access_panel(browser, hosted):
    context, page = _open(browser, hosted, "users")
    try:
        page.wait_for_selector("[data-action=add]")
        page.click("[data-action=add]")
        page.wait_for_selector("#users-add")
        _audit(page, 3)
        page.click("#users-add button:has-text('Cancel')")
        row = page.locator("tr", has_text=USER)
        row.locator("[data-action=reset]").click()
        page.wait_for_selector("#users-reset")
        _audit(page, 1)
        page.click("#users-reset button:has-text('Cancel')")
        row.locator("[data-action=remove]").click()
        page.wait_for_selector("#users-remove [data-setting='user.reassign']")
        _audit(page, 1)
        page.click("#users-remove button:has-text('Cancel')")
        row.locator("[data-action=access]").click()
        page.wait_for_selector("#user-access .policy-row")
        got = _audit(page, 10)
        assert any("access-field-restricted" in g for g in got["guides"])
        assert not page.errors, page.errors
    finally:
        context.close()


def test_data_sources_panel_sets_health_and_audit(browser, hosted):
    context, page = _open(browser, hosted, "data")
    try:
        page.wait_for_selector("#remote-datasets")
        page.wait_for_selector("#data-root-add")
        got = _audit(page, 3)
        assert any("data-field-parents" in g for g in got["guides"])
        assert any("policy-feature-remote-stores" in g for g in got["guides"])
        for section, ready in (("panel-sets", "#ps-owner"), ("health", None), ("audit", None)):
            page.goto(f"{hosted}/admin#{section}")
            page.wait_for_selector("#admin-nav .nav-link.active")
            if ready:
                page.wait_for_selector(ready)
            page.wait_for_timeout(600)
            _audit(page, 0)
        assert not page.errors, page.errors
    finally:
        context.close()


def test_the_mark_is_reachable_by_keyboard_and_closes_on_escape(browser, hosted):
    context, page = _open(browser, hosted, "settings")
    try:
        page.wait_for_selector(".policy-row")
        row = page.locator("[data-setting='panel.cell-plot.enabled']")
        mark = row.locator("[data-help]")
        mark.focus()
        page.wait_for_selector(".tooltip.show")
        assert "Cell Plot" in page.inner_text(".tooltip.show")
        assert page.inner_text(".tooltip.show").endswith("list panel.cell-plot.enabled under policy.locked.")
        assert page.locator(".tooltip.show code").all_inner_texts() == ["panel.cell-plot.enabled", "policy.locked"]
        page.keyboard.press("Escape")
        page.wait_for_selector(".tooltip", state="detached")
        # the text stays available to a screen reader after the tip is gone
        described = mark.get_attribute("aria-describedby")
        assert described.startswith("admin-help-")
        assert "Cell Plot" in page.eval_on_selector(f"#{described}", "e => e.textContent")
        # the control the mark is for is described by the same text
        assert row.locator("input, select").first.get_attribute("aria-describedby") == described
        # reached with Tab from the row's label side: the mark is a button in the tab order
        assert mark.evaluate("e => e.tabIndex") >= 0
        mark.hover()
        page.wait_for_selector(".tooltip.show")
    finally:
        context.close()


def test_dark_theme_and_a_phone_width(browser, hosted):
    context, page = _open(browser, hosted, "settings", width=390, height=844)
    try:
        page.wait_for_selector(".policy-row")
        page.evaluate("document.documentElement.setAttribute('data-bs-theme', 'dark')")
        page.locator("[data-setting='panel.cell-plot.enabled'] [data-help]").focus()
        page.wait_for_selector(".tooltip.show")
        colours = page.evaluate("""() => {
            const inner = document.querySelector('.tooltip.show .tooltip-inner');
            const s = getComputedStyle(inner);
            const box = inner.getBoundingClientRect();
            return {color: s.color, background: s.backgroundColor, right: box.right, left: box.left, width: innerWidth};
        }""")
        assert colours["color"] != colours["background"], colours
        assert colours["left"] >= -1 and colours["right"] <= colours["width"] + 1, colours
        for section in ("settings", "site", "users", "data", "panel-sets", "health"):
            page.goto(f"{hosted}/admin#{section}")
            page.wait_for_selector("#admin-nav .nav-link.active")
            page.wait_for_timeout(700)
            wide = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
            assert wide <= 1, f"{section} overflows by {wide}px at 390 px"
        assert not page.errors, page.errors
    finally:
        context.close()


@pytest.mark.skipif(not SHOTS, reason="screenshots only when ANNZARRO_SHOTS is set")
def test_screenshots(browser, hosted):
    os.makedirs(SHOTS, exist_ok=True)
    for theme in ("light", "dark"):
        context, page = _open(browser, hosted, "settings", height=700)
        try:
            page.click(f"button[title='Colour theme: {theme}']")
            page.wait_for_selector(".policy-row")
            page.locator("[data-setting='gene-set.external_requests'] [data-help], [data-setting='panel.gene-set.external_requests'] [data-help]").first.hover()
            page.wait_for_selector(".tooltip.show")
            page.wait_for_timeout(500)         # past the fade
            page.screenshot(path=os.path.join(SHOTS, f"settings-{theme}.png"))
            page.goto(f"{hosted}/admin#users")
            page.wait_for_selector("[data-action=add]")
            page.click("[data-action=add]")
            page.wait_for_selector("#users-add")
            page.locator("#users-add [data-setting='user.password'] [data-help]").hover()
            page.wait_for_selector(".tooltip.show")
            page.wait_for_timeout(500)
            page.screenshot(path=os.path.join(SHOTS, f"users-add-{theme}.png"))
        finally:
            context.close()
