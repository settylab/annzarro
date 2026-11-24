"""The Cell-Gene Cluster ▾ and Color ▾ pop-overs look like a Plot Options body (U7 step 2 of the 0.8.0 pop-over unification).

For every piece they share with the Cell-Gene Plot Options (surface, header, title, section, heading, field row, label, select, check, help,
Reset link, footer, a number box) the computed styles that define the look (fonts, colours, spacing, control sizes) must equal the Plot
Options', in light and in dark. A difference fails and names the pop-over, the piece, the property and both values. EXCEPTIONS is the
named list of allowed differences (empty). Each body must also pass the standard of popover_standard.py. Screenshots of both pop-overs,
light and dark, go to ANNZARRO_U7_SHOTS when it is set.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import os

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402,F401
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.popover_standard import assert_body_standard  # noqa: E402
from annzarro.tests.browser.test_cell_gene_options import (  # noqa: E402,F401
    GENES, P, S1, TP, _drawn, _open, _plot, _sig, page, served)

# piece -> (selector in the Plot Options, selector in the pop-over under test). A piece the pop-over does not show is skipped,
# but each pop-over must show at least MUST of them.
PIECES = {
    "surface": (".az-popover", ".az-popover"),
    "header": (".az-popover-header", ".az-popover-header"),
    "title": (".az-popover-title", ".az-popover-title"),
    "body": (".az-popover-body", ".az-popover-body"),
    "section": ("details.az-pop-section", "details.az-pop-section"),
    "heading": ("details.az-pop-section > summary", "details.az-pop-section > summary"),
    "section body": (".az-pop-section__body", ".az-pop-section__body"),
    "select row": (".az-pop-field--select", ".az-pop-field--select"),
    "label": (".az-pop-field--select .az-pop-field__label", ".az-pop-field--select .az-pop-field__label"),
    "select": (".az-pop-field--select select", ".az-pop-field--select select"),
    "check row": (".az-pop-field--check", ".az-pop-field--check"),
    "check label": (".az-pop-check", ".az-pop-check"),
    "check box": (".az-pop-check input[type=checkbox]", ".az-pop-check input[type=checkbox]"),
    "number box": (".az-pop-field--number input[type=number]", ".az-range__field"),
    "help": (".az-pop-section__body .az-pop-help", ".az-pop-section__body .az-pop-help"),
    "reset": (".az-pop-reset", ".az-pop-reset"),
    "footer": (".az-pop-section__foot", ".az-pop-section__foot"),
}
MUST = {"cluster": ["surface", "header", "title", "section", "heading", "select row", "label", "select", "check row", "check label", "check box"],
        "color": ["surface", "section", "heading", "select row", "label", "select", "check label", "check box", "number box", "reset", "footer"]}
PROPS = ["display", "flexDirection", "alignItems", "justifyContent", "flexWrap", "fontFamily", "fontSize", "fontWeight", "lineHeight",
         "letterSpacing", "textTransform", "color", "backgroundColor", "borderTopWidth", "borderBottomWidth", "borderLeftWidth",
         "borderTopStyle", "borderTopColor", "borderBottomColor", "borderTopLeftRadius", "paddingTop", "paddingRight", "paddingBottom",
         "paddingLeft", "marginTop", "marginRight", "marginBottom", "marginLeft", "rowGap", "columnGap", "boxShadow"]
# the sizes only where the piece fixes them (a select's width follows its choices, a row's follows the pop-over)
SIZED = {"surface": ["width"], "number box": ["width", "height"], "select": ["height", "maxWidth"], "check box": ["width", "height"],
         "reset": ["height"], "heading": ["height"], "header": ["height"]}
# (pop-over, piece, property) -> why a difference is allowed. Empty on purpose.
EXCEPTIONS = {}
BUTTONS = {"plot-options": ".cgene-options-btn", "cluster": ".cgene-cluster-btn", "color": ".cgene-color-btn"}

READ = """([name, pieces, side, props, sized]) => {
    const pop = document.querySelector(`[data-popover='${name}']`);
    const out = {};
    for (const [piece, sels] of Object.entries(pieces)) {
        const sel = sels[side];
        const plain = (e) => !e.disabled && !e.checked;
        const el = [...pop.querySelectorAll(sel)].find((e) => (e.offsetParent !== null || e === pop) && (piece !== 'check box' || plain(e)))
            || (pop.matches(sel) ? pop : null);
        if (!el) continue;
        const cs = getComputedStyle(el);
        const v = {};
        for (const p of [...props, ...(sized[piece] || [])]) v[p] = cs[p];
        out[piece] = v;
    }
    return out;
}"""


def _frames(page):
    page.evaluate("() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))")


def _read(page, name, side):
    page.evaluate("(n) => document.querySelectorAll(`[data-popover='${n}'] details`).forEach((d) => { d.open = true; })", name)
    _frames(page)
    return page.evaluate(READ, [name, PIECES, side, PROPS, SIZED])


def _shown(page, name):
    """Open `name`, read it, close it."""
    page.click(f"{TP} {BUTTONS[name]}")
    page.wait_for_selector(f"[data-popover='{name}']")
    got = _read(page, name, 0 if name == "plot-options" else 1)
    page.keyboard.press("Escape")
    page.wait_for_selector(f"[data-popover='{name}']", state="detached")
    return got


@pytest.mark.parametrize("theme", ["light", "dark"])
def test_cluster_and_color_look_like_plot_options(page, served, theme):
    _open(page, served, {P: _plot(cellAxis={"type": "obs", "key": "cell_type"}, sections=[{"source": S1, "rows": "genes"}]),
                         S1: _sig(S1, "Markers", GENES[:4])}, open_ids=(P, S1))
    _drawn(page)
    page.evaluate("(t) => document.documentElement.setAttribute('data-theme', t)", theme)
    _frames(page)
    reference = _shown(page, "plot-options")
    problems = []
    for name in ("cluster", "color"):
        page.click(f"{TP} {BUTTONS[name]}")
        page.wait_for_selector(f"[data-popover='{name}']")
        assert_body_standard(page, f"[data-popover='{name}']", sections=2 if name == "cluster" else 1,
                             shot=f"cgene-{name}-{theme}" if os.environ.get("ANNZARRO_U7_SHOTS") else None)
        got = _read(page, name, 1)
        page.keyboard.press("Escape")
        page.wait_for_selector(f"[data-popover='{name}']", state="detached")
        for piece in MUST[name]:
            if piece not in got:
                problems.append(f"{name}: no {piece} shown")
        for piece, styles in got.items():
            want = _shown_reference(reference, piece)
            if want is None:
                continue
            for prop, value in styles.items():
                if value != want.get(prop) and (name, piece, prop) not in EXCEPTIONS:
                    problems.append(f"{name} / {piece} / {prop}: {value!r}, Plot Options has {want.get(prop)!r}")
    assert not problems, f"{theme}:\n" + "\n".join(problems)


def _shown_reference(reference, piece):
    return reference.get(piece)
