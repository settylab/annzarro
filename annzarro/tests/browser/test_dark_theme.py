"""The app follows the system's light or dark setting, has a toggle, and its plots follow too.

One headless Chromium, a context per test with the OS colour scheme emulated:

1. System (the default) follows prefers-color-scheme, and live: switching the OS
   scheme while the page is open switches the app and its plots;
2. the header toggle has System, Light and Dark; the choice is remembered per
   browser across a reload (System forgets it);
3. no flash: <html data-theme> is set once, before the first paint, and the
   script that sets it comes before every stylesheet;
4. the plots follow: background, paper, grid, axis lines, tick and title text,
   legend, colour bar, toolbar, the grey of points not in the table, the scale
   bar (it takes the text colour);
5. a colour the user sets is kept across theme changes, the others follow;
   a colour's Reset brings it back to the theme; the choice travels in a link,
   and a link from before the model (explicit light defaults) follows, while a
   saved palette pinned by the former Dark colours button stays dark;
6. the login page, the admin pages, the account page and the error pages are
   themed; key text/background pairs meet WCAG AA in both themes.

Needs Playwright with Chromium and gunicorn for the hosted pages; skipped
otherwise, unless ANNZARRO_REQUIRE_BROWSER=1 (set in CI), where a missing one
is an error.
"""
import base64
import json
import os
import re
import urllib.parse

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.test_admin_users_page import server as hosted  # noqa: E402,F401  (fixture)
from annzarro.tests.browser.test_memory_guard import STORE, _serve  # noqa: E402
from annzarro.tests.browser.test_plot_options import A, B, DRAWN, GD, _cfgs, _link  # noqa: E402

LIGHT = {"bg": "#ffffff", "grid": "#e6e6e6", "axis": "#000000", "text": "#000000", "grey": "#b4b4b4"}
DARK = {"bg": "#1e1e1e", "grid": "#444444", "axis": "#ffffff", "text": "#ffffff", "grey": "#6b7178"}

SNAP = """(id) => {
    const gd = (%s)(id), L = gd._fullLayout;
    const grey = gd.data.filter(t => t.name === 'Not in table' && t.x).map(t => t.marker.color);
    const bars = gd.data.filter(t => t.marker && t.marker.colorbar).map(t => t.marker.colorbar);
    const bar = gd._fullData.find(t => t.marker && t.marker.colorbar && t._module);
    const shapes = (L.shapes || []).filter(s => s.name === 'az-scalebar').map(s => s.line.color);
    return { paper: L.paper_bgcolor, plot: L.plot_bgcolor, font: L.font.color,
             grid: L.xaxis.gridcolor, line: L.xaxis.linecolor, tick: L.xaxis.tickfont.color, title: L.xaxis.title.font.color,
             legend: L.legend && L.legend.font ? L.legend.font.color : null,
             barTitle: bars.length ? bars[0].title.font.color : null,
             barTick: bar && bar.marker.colorbar.tickfont ? bar.marker.colorbar.tickfont.color : null,
             modebar: L.modebar ? { color: L.modebar.color, active: L.modebar.activecolor } : null,
             grey, scale: shapes };
}""" % GD


def _rgb(c):
    """'rgb(1, 2, 3)' or '#abc' / '#aabbcc' as a lower-case '#rrggbb'."""
    c = (c or "").strip().lower()
    m = re.match(r"rgba?\((\d+),\s*(\d+),\s*(\d+)", c)
    if m:
        return "#%02x%02x%02x" % tuple(int(x) for x in m.groups())
    if re.fullmatch(r"#[0-9a-f]{3}", c):
        return "#" + "".join(ch * 2 for ch in c[1:])
    return c


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    root, proc = _serve(tmp_path_factory)
    yield root
    proc.terminate()
    proc.wait(10)


@pytest.fixture(scope="module")
def browser():
    with playwright.sync_playwright() as p:
        b = p.chromium.launch()
        yield b
        b.close()


class Tab:
    """A page in a context whose OS colour scheme is `scheme`; the errors it raised."""

    def __init__(self, browser, scheme, **kw):
        self.context = browser.new_context(viewport={"width": 1500, "height": 1000}, color_scheme=scheme, **kw)
        self.page = self.context.new_page()
        self.errors = []
        self.page.on("pageerror", lambda e: self.errors.append(str(e)))
        self.page.on("dialog", lambda d: self.errors.append(f"dialog: {d.message}") or d.dismiss())

    def close(self):
        self.context.close()
        assert not self.errors, self.errors


@pytest.fixture
def tab(browser):
    made = []

    def make(scheme="light", **kw):
        t = Tab(browser, scheme, **kw)
        made.append(t)
        return t
    yield make
    for t in made:
        t.close()


def _open(t, root, cfgs=None, plots=(A, B)):
    t.page.goto(_link(root, cfgs))
    for pid in plots:
        t.page.wait_for_function(DRAWN, arg=pid, timeout=60000)
    t.page.wait_for_timeout(1200)
    return t.page


def _shot(page, name):
    """Screenshots for the docs and for looking: only when ANNZARRO_THEME_SHOTS names a directory."""
    out = os.environ.get("ANNZARRO_THEME_SHOTS")
    if out:
        os.makedirs(out, exist_ok=True)
        page.screenshot(path=os.path.join(out, name + ".png"))


def _theme(page):
    return page.evaluate("document.documentElement.getAttribute('data-theme')")


def _snap(page, pid):
    return page.evaluate(SNAP, pid)


def _wait_theme(page, theme):
    page.wait_for_function("(t) => document.documentElement.getAttribute('data-theme') === t", arg=theme, timeout=5000)


def _wait_plot(page, pid, key, want):
    page.wait_for_function(f"""([id, want]) => {{
        const s = ({SNAP})(id); return s['{key}'] === want; }}""", arg=[pid, want], timeout=10000)


def _cfg(page, pid):
    return page.evaluate("(id) => window.PanelManager.saveLayout().panelConfigs[id]", pid)


def _toggle(page, mode):
    page.click(f'#theme-toggle button[data-theme-mode="{mode}"]')


def _menu(page, pid, section="background"):
    if not page.query_selector(f"details[data-panel='{pid}']"):
        page.click(f"#aesthetics-menu-btn-{pid}")
        page.wait_for_selector(f"details[data-panel='{pid}']", state="visible")
    d = page.query_selector(f"details[data-panel='{pid}'][data-section='{section}']")
    if not d.evaluate("e => e.open"):
        d.query_selector("summary").click()
    page.wait_for_function("(e) => e.open", arg=d)


def _set_colour(page, selector, value):
    page.evaluate("""([sel, v]) => { const el = document.querySelector(sel); el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }""",
                  [selector, value])
    page.wait_for_timeout(400)


# ---- 1. System, live ----

def test_system_theme_follows_the_os_and_switches_live(tab, server):
    t = tab("dark")
    page = _open(t, server)
    assert _theme(page) == "dark"
    assert page.evaluate("document.documentElement.getAttribute('data-theme-mode')") == "system"
    s = _snap(page, A)
    assert (_rgb(s["paper"]), _rgb(s["font"]), _rgb(s["grid"])) == (DARK["bg"], DARK["text"], DARK["grid"])
    body = page.evaluate("getComputedStyle(document.body).backgroundColor")
    assert _rgb(body) == "#14171a"

    page.emulate_media(color_scheme="light")          # the OS switches while the page is open
    _wait_theme(page, "light")
    _wait_plot(page, A, "paper", LIGHT["bg"])
    s = _snap(page, A)
    assert (_rgb(s["paper"]), _rgb(s["font"]), _rgb(s["grid"])) == (LIGHT["bg"], LIGHT["text"], LIGHT["grid"])
    assert _rgb(page.evaluate("getComputedStyle(document.body).backgroundColor")) == "#ffffff"

    page.emulate_media(color_scheme="dark")
    _wait_theme(page, "dark")
    _wait_plot(page, A, "paper", DARK["bg"])


# ---- 2. the toggle ----

def test_toggle_has_three_states_and_remembers_the_choice(tab, server):
    t = tab("light")
    page = _open(t, server)
    modes = page.eval_on_selector_all("#theme-toggle button", "els => els.map(e => e.dataset.themeMode)")
    assert modes == ["system", "light", "dark"]
    pressed = lambda: page.eval_on_selector_all("#theme-toggle button", "els => els.filter(e => e.getAttribute('aria-pressed') === 'true').map(e => e.dataset.themeMode)")  # noqa: E731
    assert pressed() == ["system"]                              # the default

    _toggle(page, "dark")
    _wait_theme(page, "dark")
    assert pressed() == ["dark"]
    assert page.evaluate("localStorage.getItem('annzarro-theme')") == "dark"
    _wait_plot(page, A, "paper", DARK["bg"])

    page.reload()                                               # remembered
    page.wait_for_function(DRAWN, arg=A, timeout=60000)
    assert _theme(page) == "dark" and pressed() == ["dark"]

    _toggle(page, "light")
    _wait_theme(page, "light")
    page.reload()
    assert _theme(page) == "light" and pressed() == ["light"]
    t.page.emulate_media(color_scheme="dark")                   # a fixed choice ignores the OS
    page.wait_for_timeout(400)
    assert _theme(page) == "light"

    _toggle(page, "system")                                     # System forgets the choice and follows the OS again
    _wait_theme(page, "dark")
    assert page.evaluate("localStorage.getItem('annzarro-theme')") is None
    page.reload()
    assert _theme(page) == "dark" and pressed() == ["system"]


def test_blocked_storage_still_themes_the_page(tab, server):
    t = tab("dark")
    t.page.add_init_script("""Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });""")
    page = _open(t, server, plots=(A,))
    assert _theme(page) == "dark"
    _toggle(page, "light")                                      # works for this visit
    _wait_theme(page, "light")


# ---- 3. no flash ----

HISTORY = """(() => {
    window.__themeLog = [];
    new MutationObserver((records) => { for (const r of records) window.__themeLog.push([performance.now(), r.target.getAttribute('data-theme')]); })
        .observe(document, { attributes: true, attributeFilter: ['data-theme'], subtree: true });
    window.__paint = null;
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === 'first-paint' && window.__paint === null) window.__paint = e.startTime; })
        .observe({ type: 'paint', buffered: true });
})()"""


@pytest.mark.parametrize("scheme", ["dark", "light"])
def test_theme_is_set_once_before_the_first_paint(tab, server, scheme):
    t = tab(scheme)
    t.page.add_init_script(HISTORY)
    _open(t, server, plots=(A,))
    log = t.page.evaluate("window.__themeLog")
    paint = t.page.evaluate("window.__paint")
    assert log, "the theme attribute was never set"
    assert {v for _, v in log} == {scheme}, f"the theme flipped on load: {log}"
    assert len(log) == 1, f"the theme attribute was written more than once: {log}"
    assert paint is not None and log[0][0] <= paint, f"theme set at {log[0][0]} after the first paint at {paint}"
    # the script that sets it is the first thing in <head> that loads, before every stylesheet
    order = t.page.evaluate("""() => [...document.head.children].map(e => e.tagName === 'SCRIPT' ? 'script:' + (e.getAttribute('src') || '')
        : e.tagName === 'LINK' && e.rel === 'stylesheet' ? 'css' : null).filter(Boolean)""")
    assert order[0].endswith("js/theme-init.js"), order
    assert t.page.evaluate("document.head.querySelector('script[src*=\"theme-init\"]').async === false")
    assert t.page.evaluate("document.head.querySelector('script[src*=\"theme-init\"]').defer === false")


# ---- 4. plots follow ----

CFG_GREY = {A: {"equalAspect": True, "showScaleBar": True, "tableFilter": "cell-table-G"}}


def test_every_plot_colour_follows_the_theme(tab, server):
    t = tab("light")
    page = _open(t, server)
    for pid in (A, B):
        s = _snap(page, pid)
        assert _rgb(s["paper"]) == LIGHT["bg"] and _rgb(s["plot"]) == LIGHT["bg"]
        assert _rgb(s["line"]) == LIGHT["axis"] and _rgb(s["tick"]) == LIGHT["text"] and _rgb(s["title"]) == LIGHT["text"]
        assert _rgb(s["grid"]) == LIGHT["grid"]
    _toggle(page, "dark")
    _wait_plot(page, A, "paper", DARK["bg"])
    _wait_plot(page, B, "paper", DARK["bg"])
    for pid in (A, B):
        s = _snap(page, pid)
        assert _rgb(s["paper"]) == DARK["bg"] and _rgb(s["plot"]) == DARK["bg"]
        assert _rgb(s["font"]) == DARK["text"]
        assert _rgb(s["line"]) == DARK["axis"] and _rgb(s["tick"]) == DARK["text"] and _rgb(s["title"]) == DARK["text"]
        assert _rgb(s["grid"]) == DARK["grid"]
        assert s["modebar"] and _rgb(s["modebar"]["active"]) == DARK["text"]
    # legend text (A, categories) and colour bar text (B, numeric)
    assert _rgb(_snap(page, A)["legend"]) == DARK["text"]
    assert _rgb(page.evaluate(SNAP, B)["barTitle"]) == DARK["text"]
    assert _rgb(page.evaluate("""(id) => { const gd = (%s)(id); const t = gd._fullData.find(t => t.marker && t.marker.colorbar);
        return t.marker.colorbar.tickfont.color; }""" % GD, B)) == DARK["text"]
    _toggle(page, "light")
    _wait_plot(page, A, "paper", LIGHT["bg"])
    assert _rgb(page.evaluate(SNAP, B)["barTitle"]) == LIGHT["text"]


def test_a_3d_plot_follows_the_theme(tab, server):
    t = tab("light")
    cfgs = _cfgs(extra_a={"z": {"type": "obsm", "key": "X_umap", "column": "1"}})
    page = _open(t, server, cfgs, plots=(B,))
    page.wait_for_function("""(id) => { const gd = (%s)(id); return !!(gd && gd._fullLayout && gd._fullLayout.scene && gd.data && gd.data.length); }""" % GD,
                           arg=A, timeout=60000)
    page.wait_for_timeout(1000)
    scene = "(id) => { const L = (%s)(id)._fullLayout; return [L.scene.bgcolor, L.scene.xaxis.gridcolor, L.scene.xaxis.tickfont.color]; }" % GD
    assert [_rgb(c) for c in page.evaluate(scene, A)] == [LIGHT["bg"], LIGHT["grid"], LIGHT["text"]]
    _toggle(page, "dark")
    page.wait_for_function("""([id, want]) => (%s)(id)._fullLayout.scene.bgcolor === want""" % GD,
                           arg=[A, DARK["bg"]], timeout=10000)
    assert [_rgb(c) for c in page.evaluate(scene, A)] == [DARK["bg"], DARK["grid"], DARK["text"]]


def test_scale_bar_and_not_in_table_grey_follow_the_theme(tab, server):
    t = tab("light")
    cfgs = _cfgs(extra_a={"equalAspect": True, "showScaleBar": True})
    page = _open(t, server, cfgs)
    assert [_rgb(c) for c in _snap(page, A)["scale"]] == [LIGHT["text"]]
    _toggle(page, "dark")
    page.wait_for_function("""(id) => { const s = (%s)(id)._fullLayout.shapes || []; return s.some(x => x.name === 'az-scalebar' && x.line.color === '#ffffff'); }""" % GD,
                           arg=A, timeout=10000)
    assert [_rgb(c) for c in _snap(page, A)["scale"]] == [DARK["text"]]
    # the grey of points a table hides, as greyMarker draws it
    greys = page.evaluate("""async () => { const { greyMarker } = await import('/static/js/utils/point-style.js');
        return greyMarker({}, 50).color; }""")
    assert _rgb(greys) == DARK["grey"]


# ---- 5. what the user sets is kept ----

def test_a_set_colour_is_kept_and_follow_restores(tab, server):
    t = tab("light")
    page = _open(t, server)
    _menu(page, A)
    _set_colour(page, f"#text-color-{A}", "#ff0000")
    assert _rgb(_snap(page, A)["font"]) == "#ff0000"
    cfg = _cfg(page, A)
    assert cfg["textColor"] == "#ff0000"
    for key in ("bgColor", "gridColor", "axisColor", "zeroLineColor", "backdropColor"):
        assert key not in cfg, f"{key} was written although the user did not set it: {cfg}"

    _toggle(page, "dark")
    _wait_plot(page, A, "paper", DARK["bg"])
    s = _snap(page, A)
    assert _rgb(s["font"]) == "#ff0000" and _rgb(s["tick"]) == "#ff0000"      # kept
    assert _rgb(s["paper"]) == DARK["bg"] and _rgb(s["grid"]) == DARK["grid"]   # the rest followed
    assert _rgb(_snap(page, B)["font"]) == DARK["text"]                         # another plot is untouched
    # the menu shows what is drawn
    assert page.input_value(f"#text-color-{A}") == "#ff0000"
    assert page.input_value(f"#plot-bg-color-{A}") == DARK["bg"]
    assert page.is_disabled(f"#reset-bg-color-{A}") and not page.is_disabled(f"#reset-text-color-{A}")

    _toggle(page, "light")
    _wait_plot(page, A, "paper", LIGHT["bg"])
    assert _rgb(_snap(page, A)["font"]) == "#ff0000"

    _menu(page, A)
    _menu(page, A, "text")
    page.click(f"#reset-text-color-{A}")                                        # Reset: the colour follows the theme again
    _wait_plot(page, A, "font", LIGHT["text"])
    cfg = _cfg(page, A)
    assert all(k not in cfg for k in ("textColor", "bgColor", "gridColor", "axisColor"))
    _toggle(page, "dark")
    _wait_plot(page, A, "font", DARK["text"])


def test_a_colours_reset_follows_the_theme_again(tab, server):
    t = tab("dark")
    page = _open(t, server)
    _menu(page, A)
    _set_colour(page, f"#plot-bg-color-{A}", "#223344")
    assert _rgb(_snap(page, A)["paper"]) == "#223344" and _cfg(page, A)["bgColor"] == "#223344"
    page.click(f"#reset-bg-color-{A}")
    _wait_plot(page, A, "paper", DARK["bg"])
    assert "bgColor" not in _cfg(page, A)
    assert page.is_disabled(f"#reset-bg-color-{A}")


def test_the_theme_buttons_are_gone_and_a_pinned_palette_still_loads(tab, server):
    """Plot colours follow the app theme unless set; a palette pinned by the removed buttons is kept as saved."""
    dark_pin = {"colourModel": 2, "bgColor": DARK["bg"], "gridColor": DARK["grid"], "axisColor": DARK["axis"],
                "textColor": DARK["text"], "zeroLineColor": "#666666", "backdropColor": "#121212"}
    t = tab("light")
    page = _open(t, server, _cfgs(extra_a=dict(dark_pin)))
    _menu(page, A)
    assert page.query_selector(f"#follow-theme-{A}") is None and page.query_selector(f"#dark-theme-{A}") is None
    assert page.query_selector(f"#light-theme-{A}") is None
    title = page.eval_on_selector(f"details[data-panel='{A}'][data-section='background'] > summary", "e => e.textContent.trim()")
    assert title == "Background"
    assert _rgb(_snap(page, A)["paper"]) == DARK["bg"]                          # drawn as saved, in a light app
    _toggle(page, "dark")
    _toggle(page, "light")
    page.wait_for_timeout(600)
    assert _rgb(_snap(page, A)["paper"]) == DARK["bg"]                          # and kept across theme changes
    _menu(page, A)                                                              # a click on the toggle closed the menu
    assert page.input_value(f"#plot-bg-color-{A}") == DARK["bg"] and not page.is_disabled(f"#reset-bg-color-{A}")
    page.click(f"#reset-bg-color-{A}")                                          # each colour's own Reset follows the theme
    _wait_plot(page, A, "paper", LIGHT["bg"])
    assert "bgColor" not in _cfg(page, A) and _cfg(page, A)["textColor"] == DARK["text"]
    _toggle(page, "dark")
    _wait_plot(page, A, "paper", DARK["bg"])
    assert _rgb(_snap(page, B)["paper"]) == DARK["bg"]


def test_a_link_keeps_pinned_colours_and_lets_the_rest_follow(tab, server):
    t = tab("light")
    t.page.add_init_script("Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('no clipboard')) } }); document.execCommand = () => false;")
    page = _open(t, server)
    _menu(page, A)
    _set_colour(page, f"#grid-color-{A}", "#12ab34")
    page.click("#btn-share-link")                                   # the app's own Share Link (no clipboard here: the link is shown)
    page.wait_for_selector("#share-link-field", state="visible")
    link = page.input_value("#share-link-field")
    assert "#view=" in link
    t2 = tab("dark")
    t2.page.goto(link)
    t2.page.wait_for_function(DRAWN, arg=A, timeout=60000)
    t2.page.wait_for_timeout(1200)
    s = _snap(t2.page, A)
    assert _rgb(s["grid"]) == "#12ab34"                                         # pinned, round trip
    assert _rgb(s["paper"]) == DARK["bg"] and _rgb(s["font"]) == DARK["text"]   # followed in the dark app
    cfg = _cfg(t2.page, A)
    assert cfg["gridColor"] == "#12ab34" and "bgColor" not in cfg


def test_old_links_follow_the_theme_unless_a_colour_was_chosen(tab, server):
    old_light = {"bgColor": "#ffffff", "gridColor": "#e6e6e6", "axisColor": "#000000", "textColor": "#000000",
                 "zeroLineColor": "#cccccc", "backdropColor": "#f0f0f0"}
    t = tab("dark")
    page = _open(t, server, _cfgs(extra_a=dict(old_light)))          # written before plots followed the theme
    s = _snap(page, A)
    assert (_rgb(s["paper"]), _rgb(s["font"]), _rgb(s["grid"])) == (DARK["bg"], DARK["text"], DARK["grid"])
    assert "colourModel" in _cfg(page, A) and "bgColor" not in _cfg(page, A)

    chosen = dict(old_light, gridColor="#ff00ff")                     # the user had chosen the grid colour
    page = _open(t, server, _cfgs(extra_a=chosen))
    s = _snap(page, A)
    assert _rgb(s["grid"]) == "#ff00ff" and _rgb(s["paper"]) == DARK["bg"]

    old_dark = {"bgColor": "#1e1e1e", "gridColor": "#444444", "axisColor": "#ffffff", "textColor": "#ffffff",
                "zeroLineColor": "#666666", "backdropColor": "#121212"}   # the old Dark Theme button
    t2 = tab("light")
    page = _open(t2, server, _cfgs(extra_a=old_dark))
    s = _snap(page, A)
    assert _rgb(s["paper"]) == DARK["bg"] and _rgb(s["font"]) == DARK["text"]   # pinned: stays dark in a light app

    new_model = dict(old_light, colourModel=2)                        # the same values written by this version are pinned
    page = _open(t2, server, _cfgs(extra_a=new_model))
    _toggle(page, "dark")
    page.wait_for_timeout(1000)
    assert _rgb(_snap(page, A)["paper"]) == LIGHT["bg"]


def test_the_publication_preset_stays_white_in_a_dark_app(tab, server):
    t = tab("dark")
    page = _open(t, server)
    _menu(page, A, "presets")
    page.click(f"#preset-publication-{A}")
    page.wait_for_timeout(800)
    s = _snap(page, A)
    assert _rgb(s["paper"]) == LIGHT["bg"] and _rgb(s["font"]) == LIGHT["text"]
    page.click(f"#preset-default-{A}")                                 # Default follows the theme again
    _wait_plot(page, A, "paper", DARK["bg"])


def test_exports_use_the_colours_on_screen(tab, server):
    t = tab("dark")
    page = _open(t, server, plots=(A,))
    # the export reads the plot's own layout (what you see): the dark colours, not a light default
    layout = page.evaluate("""(id) => { const gd = (%s)(id); return { paper: gd.layout.paper_bgcolor, font: gd.layout.font.color }; }""" % GD, A)
    assert (_rgb(layout["paper"]), _rgb(layout["font"])) == (DARK["bg"], DARK["text"])


# ---- 6. the other pages ----

def _luminance(rgb):
    r, g, b = [int(rgb[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    f = lambda c: c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4  # noqa: E731
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)


def _ratio(a, b):
    hi, lo = sorted((_luminance(_rgb(a)), _luminance(_rgb(b))), reverse=True)
    return (hi + 0.05) / (lo + 0.05)


# the effective colours of an element: its text, and the background under it (the first opaque ancestor)
COLOURS = """(sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const alpha = (c) => { const m = c.match(/rgba?\\(([^)]*)\\)/); if (!m) return 1; const p = m[1].split(',').map(Number); return p.length > 3 ? p[3] : 1; };
    let bg = 'rgb(255, 255, 255)', n = el;
    while (n && n.nodeType === 1) { const c = getComputedStyle(n).backgroundColor; if (alpha(c) > 0.5) { bg = c; break; } n = n.parentElement; }
    const cs = getComputedStyle(el);
    return { color: cs.color, bg, border: cs.borderTopColor, visible: !!(el.offsetWidth || el.offsetHeight) };
}"""

# (selector, what), checked in both themes on the main page; text needs 4.5:1
MAIN_TEXT = [
    "body", ".app-title", "#dataset-button", "#dataset-stats", "#cell-count",
    ".tile-title", ".tile .form-select", ".tile .form-control", "#btn-save-session", "#btn-load-session",
    "#btn-close-all", "#btn-share-link", ".tile .btn-outline-secondary", ".tile .btn-light",
    ".dataTables_wrapper .table td", ".dataTables_wrapper .table th", ".nav-tabs .nav-link.active", ".nav-tabs .nav-link:not(.active)",
]


@pytest.mark.parametrize("scheme", ["light", "dark"])
def test_text_and_controls_meet_wcag_aa_on_the_main_page(tab, server, scheme):
    t = tab(scheme)
    page = _open(t, server, plots=(A,))
    page.wait_for_selector(".dataTables_wrapper .table td", timeout=30000) if page.query_selector(".dataTables_wrapper") else None
    bad = []
    for sel in MAIN_TEXT:
        c = page.evaluate(COLOURS, sel)
        if not c or not c["visible"]:
            continue
        r = _ratio(c["color"], c["bg"])
        if r < 4.5:
            bad.append((sel, c["color"], c["bg"], round(r, 2)))
    # controls: the edge of a text box and an outline button against the surface behind it
    for sel in (".tile .form-control", ".tile .form-select", ".tile .btn-outline-secondary"):
        c = page.evaluate(COLOURS, sel)
        if c and c["visible"]:
            r = _ratio(c["border"], c["bg"])
            if r < 3:
                bad.append((sel + " border", c["border"], c["bg"], round(r, 2)))
    assert not bad, bad


def test_form_placeholder_and_notices_are_readable_in_both_themes(tab, server):
    for scheme in ("light", "dark"):
        t = tab(scheme)
        page = _open(t, server, plots=(A,))
        r = page.evaluate("""() => { const el = document.querySelector('#focused-gene');
            const cs = getComputedStyle(el, '::placeholder'); const bg = getComputedStyle(el).backgroundColor;
            return { color: cs.color, bg }; }""")
        assert _ratio(r["color"], r["bg"]) >= 4.5, (scheme, r)
        # the notice colours of the app's own stylesheet
        rows = page.evaluate("""() => { const out = [];
            const probe = (cls) => { const d = document.createElement('div'); d.className = cls; document.body.appendChild(d);
                const cs = getComputedStyle(d); out.push([cls, cs.color, cs.backgroundColor]); d.remove(); };
            ['notification notification-error', 'notification notification-warning', 'notification notification-success', 'notification notification-info',
             'alert alert-warning', 'alert alert-info', 'alert alert-danger', 'alert alert-success', 'badge bg-secondary'].forEach(probe);
            return out; }""")
        weak = [(c, fg, bg, round(_ratio(fg, bg), 2)) for c, fg, bg in rows if _ratio(fg, bg) < 4.5]
        assert not weak, (scheme, weak)


def _sign_in(page, srv, user="root", password="root-password-1"):
    page.goto(srv.url + "/login")
    page.fill("#username", user)
    page.fill("#password", password)
    page.click("button[type=submit]")
    page.wait_for_load_state()


def test_login_admin_account_and_error_pages_are_dark(hosted, tab):
    t = tab("dark")
    page = t.page
    page.goto(hosted.url + "/login")
    assert _theme(page) == "dark"
    _shot(page, "login")
    card = page.evaluate(COLOURS, ".login-container")
    assert _rgb(card["bg"]) == "#1c2024"
    assert _rgb(page.evaluate("getComputedStyle(document.body).backgroundColor")) == "#14171a"
    for sel in ("h1", "label[for=username]", ".logo h2", "button[type=submit]", "#username"):
        c = page.evaluate(COLOURS, sel)
        assert c and _ratio(c["color"], c["bg"]) >= 4.5, (sel, c)
    # the sign-in page follows the OS live too
    page.emulate_media(color_scheme="light")
    _wait_theme(page, "light")
    assert _rgb(page.evaluate("getComputedStyle(document.body).backgroundColor")) == "#f5f5f5"
    page.emulate_media(color_scheme="dark")
    _wait_theme(page, "dark")

    _sign_in(page, hosted)
    page.goto(hosted.url + "/admin")
    page.wait_for_selector("#admin-nav .nav-link", timeout=20000)
    assert _theme(page) == "dark"
    assert _rgb(page.evaluate("getComputedStyle(document.body).backgroundColor")) == "#14171a"
    header = page.evaluate(COLOURS, ".admin-header")
    assert _rgb(header["bg"]) == "#23282d"
    page.wait_for_selector("#admin-main table, #admin-main .card, #admin-main form", timeout=20000)
    for sel in (".admin-title", "#admin-nav .nav-link.active", "#admin-main table td", "#admin-main table th", "#admin-main .btn-outline-secondary"):
        c = page.evaluate(COLOURS, sel)
        if c and c["visible"]:
            assert _ratio(c["color"], c["bg"]) >= 4.5, (sel, c)
    # every admin section is themed, not only the first
    for tabname in page.eval_on_selector_all("#admin-nav .nav-link", "els => els.map(e => e.getAttribute('href'))"):
        page.goto(hosted.url + "/admin" + tabname)
        page.wait_for_timeout(700)
        _shot(page, "admin-" + tabname.lstrip("#"))
        light_bg = page.evaluate("""() => [...document.querySelectorAll('#admin-main *')].filter(e => {
            const c = getComputedStyle(e).backgroundColor; const m = c.match(/\\d+/g);
            return m && m.length >= 3 && (c.indexOf('rgba') < 0 || +c.split(',')[3] > 0.5) && +m[0] > 200 && +m[1] > 200 && +m[2] > 200 && e.offsetWidth > 20; }).map(e => e.className || e.tagName)""")
        assert not light_bg, f"{tabname}: light surfaces in the dark theme: {light_bg[:6]}"
    # the admin toggle works and is remembered
    page.click('#theme-toggle button[data-theme-mode="light"]')
    _wait_theme(page, "light")
    assert _rgb(page.evaluate("getComputedStyle(document.body).backgroundColor")) == "#ffffff"
    page.reload()
    assert _theme(page) == "light"
    page.click('#theme-toggle button[data-theme-mode="system"]')
    _wait_theme(page, "dark")

    page.goto(hosted.url + "/account/password")
    assert _theme(page) == "dark"
    assert _rgb(page.evaluate("getComputedStyle(document.body).backgroundColor")) == "#14171a"
    c = page.evaluate(COLOURS, ".form-control")
    assert _ratio(c["color"], c["bg"]) >= 4.5

    # the GET /logout page is themed too
    page.goto(hosted.url + "/logout")
    assert _theme(page) == "dark"
    assert _rgb(page.evaluate("getComputedStyle(document.body).backgroundColor")) == "#14171a"


def test_a_refused_admin_page_says_it_supports_both_schemes(hosted, tab):
    t = tab("dark")
    _sign_in(t.page, hosted, "alice", "alice-password-1")
    response = t.page.goto(hosted.url + "/admin")                   # a user who is not an admin: the small 403 page
    assert response.status == 403
    assert t.page.evaluate("document.querySelector('meta[name=color-scheme]').content") == "light dark"


def test_login_page_contrast_in_both_themes(hosted, tab):
    for scheme in ("light", "dark"):
        t = tab(scheme)
        t.page.goto(hosted.url + "/login")
        for sel in ("h1", "label[for=username]", "label[for=password]", "button[type=submit]", "#username"):
            c = t.page.evaluate(COLOURS, sel)
            assert _ratio(c["color"], c["bg"]) >= 4.5, (scheme, sel, c)
        c = t.page.evaluate(COLOURS, "#username")
        assert _ratio(c["border"], c["bg"]) >= 3 or scheme == "light", (scheme, c)
