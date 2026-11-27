"""A "Levels of a column" set on a column whose categories are float32 numbers or integers past 2**53 (0.8.1 S2).

The grouping fixture plus two categorical obs columns: ``f32`` (float32 categories 0.1, 0.2, 0.3) and ``big`` (int64
categories 2**53+1, 2**53+3, 2**53+5). A set picks its levels by id: the ids are the server's (the obs route sends
them beside the labels), so each box names exactly one level and the Venn counts the cells of the ticked categories.
The engine's ids are those of 0.8.0 (a float32 level is its float64 widening), so links stored earlier are untouched.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import os

import numpy as np
import pytest

from annzarro.tests.browser import test_cell_count_panel as base
from annzarro.tests.browser.test_cell_count_panel import (  # noqa: F401  (fixtures: page)
    CC, S, N, DATA, page, _count, _open, _config, _drawn,
)
from annzarro.tests.browser import test_focus_outside_subset as _focus
from annzarro.tests.browser.test_memory_guard import until
from annzarro.tests.browser.test_names_dataset_scope import _serve
from annzarro.tests.browser.test_count_sets import _plot_regions, _rows
from annzarro.tests.zarr_compat import consolidate, open_group, write_array

F32 = np.array([0.1, 0.2, 0.3], dtype=np.float32)
BIG = np.array([2 ** 53 + 1, 2 ** 53 + 3, 2 ** 53 + 5], dtype=np.int64)
CODES = (np.arange(N) % 3).astype(np.int8)
CODES[::7] = 2
TRUE = {"f32": ["c:0.10000000149011612", "c:0.20000000298023224", "c:0.30000001192092896"], "big": [f"c:{2 ** 53 + k}" for k in (1, 3, 5)]}
OTHER = {"source": {"type": "obs", "key": "is_doublet"}, "member": {"levels": ["c:true"]}}


def _store_with_numeric_levels(path):
    path = base._make_store(path)
    root = open_group(path, mode="a")
    obs = root["obs"]
    for name, cats in (("f32", F32), ("big", BIG)):
        g = obs.create_group(name)
        g.attrs.update({"encoding-type": "categorical", "encoding-version": "0.2.0", "ordered": False})
        write_array(g, "codes", CODES)
        write_array(g, "categories", cats)
    obs.attrs["column-order"] = list(obs.attrs["column-order"]) + ["f32", "big"]
    if os.path.exists(os.path.join(path, ".zmetadata")):     # the store was consolidated: it lists the new members
        consolidate(path)
    return path


@pytest.fixture(scope="module")
def served(tmp_path_factory):
    original = _focus._make_store
    _focus._make_store = _store_with_numeric_levels
    try:
        proc, root, store = _serve(tmp_path_factory)
    finally:
        _focus._make_store = original
    yield root, store
    proc.terminate()
    proc.wait(10)


def _expected(codes_picked):
    """{bit code: cells} of set A (is_doublet, bit 0) and set B (the picked categories of the column, bit 1)."""
    a = np.isin(CODES, codes_picked)
    b = DATA.obs["is_doublet"].to_numpy()
    bits = b.astype(int) + 2 * a.astype(int)
    values, counts = np.unique(bits, return_counts=True)
    return {int(v): int(c) for v, c in zip(values, counts)}


@pytest.mark.parametrize("column", ["f32", "big"])
def test_ticking_levels_of_a_numeric_column_names_each_level_and_counts_its_cells(page, served, column):
    _open(page, served, {CC: _count(mode="venn", sets=[OTHER])})
    page.select_option(f"{S} .ccnt-sets__add", "levels")
    draft = "[data-popover='set-definition']"
    options = page.evaluate("(d) => [...document.querySelectorAll(d + ' select[data-field=column] option')].map(o => o.value)", draft)
    assert column in options, options
    page.select_option(f"{draft} select[data-field='column']", column)
    ids = TRUE[column]
    for i in ids:
        page.wait_for_selector(f"{draft} .ccnt-set__levels input[value='{i}']")
    page.click(f"{draft} .ccnt-set__levels input[value='{ids[0]}']")
    until(page, f"() => (window.PanelManager.getPanel('{CC}').getConfig().sets || []).length === 2")
    page.click(f"{draft} .ccnt-set__levels input[value='{ids[1]}']")
    until(page, f"() => window.PanelManager.getPanel('{CC}').getConfig().sets[1].member.levels.length === 2")
    assert _config(page)["sets"][1] == {"source": {"type": "obs", "key": column}, "member": {"levels": ids[:2]}}
    _drawn(page, "venn")
    brute = _expected([0, 1])
    drawn = _plot_regions(page)
    for code, text in zip(drawn["customdata"], drawn["text"]):
        assert text.startswith(f"{brute.get(code + 1, 0):,}"), (code, text)
    row = _rows(page)[1]
    assert row["cells"] == f"{int(np.isin(CODES, [0, 1]).sum()):,} cells" and row["state"] != "problem"
