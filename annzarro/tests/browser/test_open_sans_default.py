"""Open Sans is the default font of all four plot kinds (Cell, Gene, Cell-Gene, Count), bundled with the app, in exported images
too; Arial is what the Publication preset sets and what a plot saved before Open Sans was the default keeps drawing in.

1. The page loads the font: document.fonts.check('12px "Open Sans"') after load, from the bundled file (no network font).
2. A new plot of each kind (from the chooser: on Default) draws in Open Sans, as the font itself, not Verdana.
3. An image of a plot holds the font: an exported SVG has it embedded, and an SVG image made from it draws with it (PNG, JPEG and
   WEBP are made from that SVG), while the same text without it falls back.
4. A plot saved with no font (Cell, Gene and Cell-Gene) still draws in Arial; a Count plot with none still draws Open Sans.
5. The Publication preset sets Arial on all four.
6. All four offer the same list of fonts in the same order, Open Sans first.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import os

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402,F401
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.test_cell_gene_panel import served, page, _url, _plot, _sig, P, S1, GENES  # noqa: E402,F401
from annzarro.tests.browser.test_cell_gene_plot_options import _configs, CP, GP, _drawn  # noqa: E402
from annzarro.tests.browser.test_cell_count_panel import CELL_TYPE, CONDITION  # noqa: E402
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402

CC = "cell-count-A"
POP = "[data-popover='plot-options']"
OPEN = '"Open Sans", verdana, arial, sans-serif'
ARIAL = "Arial, Helvetica, sans-serif"
TILES = {"cell-plot": CP, "gene-plot": GP, "cell-gene": P, "cell-count": CC}
BUTTONS = {"cell-plot": f"#aesthetics-menu-btn-{CP}", "gene-plot": f"#aesthetics-menu-btn-{GP}",
           "cell-gene": f'.tile[data-tile-id="{P}"] .cgene-options-btn', "cell-count": f'.tile[data-tile-id="{CC}"] .ccnt-options-btn'}


def _config(**flags):
    """All four kinds; `flags` goes to the Cell, Gene and Cell-Gene plots (styleDefault for a plot from the chooser)."""
    configs = _configs("cell-plot", **flags)[0]
    configs.update(_configs("gene-plot", **flags)[0])
    configs[P] = _plot(cellAxis={"type": "obs", "key": "cell_type"}, sections=[{"source": S1, "rows": "genes"}], **flags)
    configs[S1] = _sig(S1, "Markers", GENES[:4])
    configs[CC] = {"id": CC, "title": "Count 1", "version": 1, "mode": "bar", "x": CONDITION, "split": CELL_TYPE}
    return configs


def _ready(page):
    for pid in (CP, GP):
        _drawn(page, pid)
    until(page, "(id) => { const e = document.querySelector(`.tile[data-tile-id='${id}'] .cgene-panel`); return e && e.dataset.state === 'ready'; }", P, timeout=60)
    until(page, "(id) => { const r = document.querySelector(`.tile[data-tile-id='${id}'] .ccnt-panel`); return r && r.dataset.state === 'ready'; }", CC, timeout=60)


def _open(page, served, **flags):
    page.set_viewport_size({"width": 1700, "height": 1100})
    page.goto(_url(served, [CP, GP, P, CC], _config(**flags)))
    _ready(page)


FAMILY = """(id) => { const gd = document.querySelector(`.tile[data-tile-id="${id}"] .js-plotly-plot`);
    return { family: gd._fullLayout.font.family, drawn: getComputedStyle(gd.querySelector('.xtick text, .ytick text, .legendtext, .infolayer text')).fontFamily }; }"""


def test_the_page_loads_the_bundled_font(page, served):
    seen = []
    page.on("request", lambda r: seen.append(r.url))
    _open(page, served)
    ok = page.evaluate("async () => { await document.fonts.load('12px \"Open Sans\"'); return document.fonts.check('12px \"Open Sans\"'); }")
    assert ok
    faces = page.evaluate("() => [...document.fonts].filter((f) => f.family.includes('Open Sans')).map((f) => [f.status, f.weight])")
    assert faces and faces[0][0] == "loaded", faces
    # from the app, not a CDN
    mine = [u for u in seen if "OpenSans" in u]
    assert mine and all("/static/fonts/open-sans/" in u for u in mine), mine
    assert not [u for u in seen if "gstatic" in u or "googleapis" in u], seen


@pytest.mark.parametrize("kind", list(TILES))
def test_a_new_plot_draws_in_open_sans(page, served, kind):
    _open(page, served, styleDefault=True)
    got = page.evaluate(FAMILY, TILES[kind])
    assert got["family"] == OPEN, got
    # the glyphs are Open Sans's: a tick label is as long as Open Sans sets it, not Verdana (which is wider); its length along the text,
    # since CI's narrower window turns the Cell-Gene Plot's gene labels, and a rotated label's box is its height wide
    wide = page.evaluate("""(id) => { const t = document.querySelector(`.tile[data-tile-id="${id}"] .js-plotly-plot .xtick text, .tile[data-tile-id="${id}"] .js-plotly-plot .legendtext`);
        const cs = getComputedStyle(t); const c = document.createElement('canvas').getContext('2d');
        const w = (f) => { c.font = `${cs.fontSize} ${f}`; return c.measureText(t.textContent).width; };
        return { drawn: t.getComputedTextLength(), open: w('"Open Sans"'), verdana: w('Verdana'), text: t.textContent }; }""", TILES[kind])
    assert abs(wide["drawn"] - wide["open"]) < abs(wide["drawn"] - wide["verdana"]) or abs(wide["open"] - wide["verdana"]) < 0.5, wide


def test_an_image_holds_the_font(page, served):
    _open(page, served, styleDefault=True)
    svg = page.evaluate("""async (id) => { const { fullImage } = await import('/static/js/utils/plot-export.js');
        const gd = document.querySelector(`.tile[data-tile-id="${id}"] .js-plotly-plot`);
        return await fullImage(gd, { format: 'svg', width: 600, height: 400, scale: 1 }); }""", CP)
    assert "@font-face" in svg and "font/woff2;base64," in svg and "Open Sans" in svg
    # an SVG image (what PNG, JPEG and WEBP are made from) draws with the embedded font, and without it the text falls back
    ink = page.evaluate("""async (svg) => {
        const { embedFonts } = await import('/static/js/utils/fonts.js');
        const text = (family, defs = '') => `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="60">${defs}<text x="4" y="40" font-size="32" font-family='${family}'>Wijmg \\u2265 \\u00b1</text></svg>`;
        const inkWidth = (markup) => new Promise((resolve) => { const img = new Image(); img.onload = () => {
            const c = document.createElement('canvas'); c.width = 400; c.height = 60; const x = c.getContext('2d'); x.drawImage(img, 0, 0);
            const d = x.getImageData(0, 0, 400, 60).data; let last = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 40) last = Math.max(last, (i / 4) % 400);
            resolve(last); }; img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup); });
        const bare = text('Open Sans, Verdana');
        const embedded = await embedFonts(bare);
        return { embedded: await inkWidth(embedded), fallback: await inkWidth(bare), verdana: await inkWidth(text('Verdana')), hasFace: embedded.includes('@font-face') }; }""", svg)
    assert ink["hasFace"] and ink["embedded"] != ink["fallback"] and ink["embedded"] != ink["verdana"], ink


@pytest.mark.parametrize("kind", ["cell-plot", "gene-plot", "cell-gene"])
def test_a_plot_saved_with_no_font_still_draws_in_arial(page, served, kind):
    _open(page, served)                                  # configs with no font and not on Default: saved before
    assert page.evaluate(FAMILY, TILES[kind])["family"] == ARIAL


def test_a_count_plot_saved_with_no_font_still_draws_open_sans(page, served):
    _open(page, served)
    assert page.evaluate(FAMILY, CC)["family"] == OPEN


@pytest.mark.parametrize("kind", list(TILES))
def test_the_publication_preset_sets_arial(page, served, kind):
    _open(page, served, styleDefault=True)
    page.click(BUTTONS[kind])
    page.wait_for_selector(POP)
    page.evaluate("() => document.querySelectorAll(\"[data-popover='plot-options'] details\").forEach((d) => { d.open = true; })")
    page.click(f"{POP} [data-preset='publication']")
    until(page, "([id, f]) => document.querySelector(`.tile[data-tile-id='${id}'] .js-plotly-plot`)._fullLayout.font.family === f", [TILES[kind], ARIAL], timeout=30)
    assert page.input_value(f"{POP} [data-concept='fontFamily'] select") == ARIAL


def test_all_four_offer_the_same_fonts_in_the_same_order(page, served):
    _open(page, served)
    lists = {}
    for kind, button in BUTTONS.items():
        page.click(button)
        page.wait_for_selector(POP)
        lists[kind] = page.evaluate("() => [...document.querySelectorAll(\"[data-popover='plot-options'] [data-concept='fontFamily'] option\")].map((o) => [o.value, o.textContent])")
        page.keyboard.press("Escape")
        page.wait_for_selector(POP, state="detached")
    first = lists["cell-gene"]
    assert first[0][1] == "Open Sans" and ("Arial" in [t for _, t in first]), first
    assert all(v == first for v in lists.values()), lists
