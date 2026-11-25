"""Cell-Gene Plot Options > Legend > "Entries, at most" does what its name says (0.8.0, operator 2026-11-24).

The operator set it to 100 for a 17-level category and the strip legend still listed 7 levels and "+ 10 more". The setting was read
and wired; a second, unnamed limit won: the lines the legend's slot holds at the tile's height. The legend now takes the legend column's
height before it gives up an entry, wraps into more columns when the width allows, and only what the cap cuts (or what neither
height nor width can hold) is counted in a last "+ n more" line; nothing is dropped without that line.

1.  17 levels, Entries at most 100: all 17 are listed in the figure, with no "+ n more" line.
2.  The cap below the count: the first N, then "+ k more" with k the exact rest.
3.  3D draws no strips (it says so in the strip), so there is no strip legend to cut: the setting changes nothing there and nothing is
    listed half.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import os

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402,F401
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.test_cell_gene_panel import GENES, S1, TP, _sig  # noqa: E402,F401
from annzarro.tests.browser.test_grouping_palettes import served, page, _open, _gene_plot, GP, GT  # noqa: E402,F401
from annzarro.tests.browser.test_cell_grouping_panel import GA, _grouping  # noqa: E402
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402
from annzarro.tests.core.grouping_store import sample_names  # noqa: E402

LEVELS = 17
FACTOR = {"source": {"type": "obs", "key": "sample"}, "levels": [f"c:{n}" for n in sample_names()[:LEVELS]], "rest": "exclude"}
LEGEND = """(s) => { const gd = document.querySelector(s + ' .cgene-plot'); if (!gd || !gd.data) return null;
  const t = gd.data.find((d) => d.name === 'strip legend'); if (!t) return { none: true, types: gd.data.map((d) => d.type) };
  const text = [...t.text]; const more = /^\\+ (\\d+) more$/.exec(text[text.length - 1] || '');
  return { listed: more ? text.length - 1 : text.length, more: more ? Number(more[1]) : 0, text }; }"""


def _legend(page):
    return page.evaluate(LEGEND, GT)


def _show(page, served, view=None, **look):
    fields = {"look": look} if look else {}
    if view:
        fields["view"] = view
    _open(page, served, {GP: _gene_plot(cellAxis={"type": "cell-group", "key": GA}, sections=[{"source": S1, "rows": "genes"}], **fields),
                         S1: _sig(S1, "Markers", GENES[:4]), GA: _grouping(partitionings=[FACTOR])}, (GP, S1, GA))
    until(page, "(s) => { const e = document.querySelector(s + ' .cgene-panel'); return !!e && e.dataset.state === 'ready'; }", GT, timeout=60)


def test_a_cap_of_100_lists_all_17_levels(page, served):
    _show(page, served, legendMax=100)
    until(page, f"(s) => {{ const f = ({LEGEND})(s); return !!f && !f.none; }}", GT)
    got = _legend(page)
    assert got["listed"] == LEVELS and got["more"] == 0, got


def test_a_cap_below_the_count_lists_the_first_ones_and_says_how_many_more(page, served):
    _show(page, served, legendMax=5)
    until(page, f"(s) => {{ const f = ({LEGEND})(s); return !!f && !f.none; }}", GT)
    got = _legend(page)
    assert got["listed"] == 5 and got["more"] == LEVELS - 5, got
    assert got["text"][-1] == f"+ {LEVELS - 5} more"


def test_in_3d_there_is_no_strip_legend_to_cut_and_the_strip_says_so(page, served):
    _show(page, served, view="3d", legendMax=100)
    until(page, "(s) => { const g = document.querySelector(s + ' .cgene-plot'); return !!g && !!g.data && g.data.some((d) => d.type === 'mesh3d'); }", GT, timeout=60)
    got = _legend(page)
    assert got["none"] is True and "mesh3d" in got["types"], got
    tag = page.evaluate("(s) => { const t = document.querySelector(s + ' .ps-tag[data-tag=\"cgene-3d\"]'); return t ? (t.getAttribute('title') || t.textContent) : ''; }", GT)
    assert "strips" in tag, tag
