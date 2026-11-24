"""Visual parity of the Plot Options pop-over on all four plot kinds (Cell, Gene, Cell-Gene, Count): for every shared piece of
the body (surface, header, heading, section, field row, label, number box, select, range, check, help line, Reset link, footer)
the computed styles that define the look must be the same in every kind that has it, in light and in dark.

Any difference fails and names the piece, the property and the values. EXCEPTIONS is the named list of allowed differences
(empty). A screenshot of each pop-over, light and dark, goes to ANNZARRO_SHOTS when it is set.

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

SHOTS = os.environ.get("ANNZARRO_SHOTS")
CC = "cell-count-A"
POP = "[data-popover='plot-options']"

# kind -> (tile id, the button that opens its Plot Options)
KINDS = {
    "cell-plot": (CP, f"#aesthetics-menu-btn-{CP}"),
    "gene-plot": (GP, f"#aesthetics-menu-btn-{GP}"),
    "cell-gene": (P, f'.tile[data-tile-id="{P}"] .cgene-options-btn'),
    "cell-count": (CC, f'.tile[data-tile-id="{CC}"] .ccnt-options-btn'),
}

# the pieces of the body, by selector inside the pop-over (the first visible match is read)
PIECES = {
    "surface": ".az-popover",
    "header": ".az-popover-header",
    "title": ".az-popover-title",
    "body": ".az-popover-body",
    "section": "details.az-pop-section",
    "heading": "details.az-pop-section > summary",
    "section body": ".az-pop-section__body",
    "number row": ".az-pop-field--number",
    "label": ".az-pop-field--number .az-pop-field__label",
    "number box": ".az-pop-field--number input[type=number]",
    "select row": ".az-pop-field--select",
    "select": ".az-pop-field--select select",
    "range": "input[type=range]",
    "check row": ".az-pop-field--check",
    "check label": ".az-pop-check",
    "check box": ".az-pop-check input[type=checkbox]",
    "help": ".az-pop-section__body .az-pop-help",
    "reset": ".az-pop-reset",
    "footer": ".az-pop-section__foot",
}

PROPS = ["display", "flexDirection", "alignItems", "justifyContent", "flexWrap", "fontFamily", "fontSize", "fontWeight", "lineHeight",
         "letterSpacing", "textTransform", "color", "backgroundColor", "borderTopWidth", "borderBottomWidth", "borderLeftWidth",
         "borderTopColor", "borderBottomColor", "borderLeftColor", "borderTopLeftRadius", "paddingTop", "paddingRight", "paddingBottom",
         "paddingLeft", "marginTop", "marginRight", "marginBottom", "marginLeft", "rowGap", "columnGap", "boxShadow", "opacity"]
# the sizes only where the piece fixes them (a select's width follows its choices, a row's follows the pop-over)
SIZED = {"surface": ["width"], "number box": ["width", "height"], "select": ["height", "maxWidth"], "range": ["height"],
         "check box": ["width", "height"], "reset": ["height"], "heading": ["height"], "header": ["height"]}

# (piece, property) -> why a difference is allowed. Empty on purpose.
EXCEPTIONS = {}

READ = """([pieces, props, sized]) => {
    const pop = document.querySelector("[data-popover='plot-options']");
    const out = {};
    for (const [name, sel] of Object.entries(pieces)) {
        // a control is read in its plain state (enabled; a check box unchecked), so the state does not look like a difference
        const plain = (e) => !e.disabled && !e.checked;
        const el = [...pop.querySelectorAll(sel)].find((e) => (e.offsetParent !== null || e === pop) && (name !== 'range' && name !== 'check box' || plain(e)))
            || (pop.matches(sel) ? pop : null);
        if (!el) continue;
        const cs = getComputedStyle(el);
        const v = {};
        for (const p of [...props, ...(sized[name] || [])]) v[p] = cs[p];
        out[name] = v;
    }
    return out;
}"""


def _config():
    configs, _ = _configs("cell-plot")
    configs.update(_configs("gene-plot")[0])
    configs[P] = _plot(cellAxis={"type": "obs", "key": "cell_type"}, sections=[{"source": S1, "rows": "genes"}])
    configs[S1] = _sig(S1, "Markers", GENES[:4])
    configs[CC] = {"id": CC, "title": "Count 1", "version": 1, "mode": "bar", "x": CONDITION, "split": CELL_TYPE}
    return configs


def _ready(page):
    for pid in (CP, GP):
        _drawn(page, pid)
    until(page, "(id) => { const e = document.querySelector(`.tile[data-tile-id='${id}'] .cgene-panel`); return e && e.dataset.state === 'ready'; }", P, timeout=60)
    until(page, "(id) => { const r = document.querySelector(`.tile[data-tile-id='${id}'] .ccnt-panel`); return r && r.dataset.state === 'ready'; }", CC, timeout=60)


def _snapshot(page, theme, shot_dir):
    got = {}
    for kind, (pid, button) in KINDS.items():
        page.click(button)
        page.wait_for_selector(POP)
        page.evaluate("() => document.querySelectorAll(\"[data-popover='plot-options'] details\").forEach((d) => { d.open = true; })")
        page.wait_for_timeout(300)
        got[kind] = page.evaluate(READ, [PIECES, PROPS, SIZED])
        # the room it may take is the anchor's (placePopover): never more than 80 % of the window, whatever the kind
        assert page.evaluate("() => parseFloat(getComputedStyle(document.querySelector(\"[data-popover='plot-options']\")).maxHeight) <= 0.8 * innerHeight") , kind
        if shot_dir:
            page.locator(POP).screenshot(path=os.path.join(shot_dir, f"{kind}-{theme}.png"))
        page.keyboard.press("Escape")
        page.wait_for_selector(POP, state="detached")
    return got


def test_plot_options_look_the_same_in_all_four_plot_kinds(page, served):
    page.set_viewport_size({"width": 1700, "height": 1100})
    page.goto(_url(served, [CP, GP, P, CC], _config()))
    _ready(page)
    if SHOTS:
        os.makedirs(SHOTS, exist_ok=True)
    problems = []
    for theme in ("light", "dark"):
        page.click(f'#theme-toggle button[data-theme-mode="{theme}"]')
        page.wait_for_function("(t) => document.documentElement.getAttribute('data-theme') === t", arg=theme)
        page.wait_for_timeout(500)
        got = _snapshot(page, theme, SHOTS)
        for piece in PIECES:
            have = {k: v[piece] for k, v in got.items() if piece in v}
            assert len(have) >= 2, f"{piece}: found in {sorted(have)} only ({theme}); the guard compares at least two kinds"
            for prop in set().union(*[set(v) for v in have.values()]):
                values = {k: v.get(prop) for k, v in have.items()}
                if len(set(values.values())) > 1 and (piece, prop) not in EXCEPTIONS:
                    problems.append(f"{theme} / {piece} / {prop}: {values}")
    assert not problems, "Plot Options differ between plot kinds:\n" + "\n".join(problems)
