"""The group grid of the Cell Grouping panel in a real browser, against the real cell_groups route (G9c, GRP-6, GRP-18).

The store is the grouping fixture (tests/core/grouping_store.py): 1,200 cells, cell_type with 6 levels (one of 5 cells,
under the small-group threshold), condition, layers X (signed) and logged.

1.  The grid is a `role="grid"` with `aria-rowcount`; per group: colour, name, cells, share and the small mark.
2.  List and Cross-table: the cross-table of exactly two factors, counts, "N of M combinations hold cells".
3.  The focused gene's columns: from the offered statistics on the first offered layer; "No gene focused"; values equal
    the brute-force means; a statistic the layer cannot give is left out.
4.  The gate: slow estimate or panel off screen gives a "Show GENE005" button, and a focus change then sends no request.
5.  2,000 groups: a constant number of rows in the DOM, however far it is scrolled, and the keys of a grid.
6.  Export: the CSV has the grid's columns, after the key.
7.  "in no group" shows the reasons as the grid's rows.
8.  Screenshots, light and dark, when ANNZARRO_G9C_SHOTS names a folder.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import json
import os
import pathlib

import numpy as np
import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser import test_cell_grouping_panel as base  # noqa: E402
from annzarro.tests.browser import waits  # noqa: E402
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402
from annzarro.tests.core import grouping_store as gstore  # noqa: E402

served = base.served          # the fixture: the server on the grouping store
page = base.page              # the fixture: a page that records its cell_groups requests
GA, A, N, DATA = base.GA, base.A, base.N, base.DATA
CELL_TYPE, CONDITION = base.CELL_TYPE, base.CONDITION
SHOTS = os.environ.get("ANNZARRO_G9C_SHOTS")
GRID = f"{A} .cgg-grid"
ROWS = f"{GRID} .cgg-row"
GENE = "GENE005"
GENE_INDEX = 5


def _open(page, served, partitionings, **extra):
    base._open(page, served, {GA: base._grouping(partitionings=partitionings, **extra)})
    base._ready(page)
    page.wait_for_selector(GRID)


def _focus_gene(page, name):
    page.evaluate("async (g) => { const { DataManager } = await import('/static/js/data-manager.js'); DataManager.setFocusedGene(g); }", name)


def _grid(page):
    """What the grid shows: its columns, its rows as lists of texts, its ARIA size, and how many rows are in the DOM."""
    return page.evaluate("""(s) => { const g = document.querySelector(s);
        const text = (e) => e.textContent.trim();
        return { role: g.getAttribute('role'), rowcount: g.getAttribute('aria-rowcount'), colcount: g.getAttribute('aria-colcount'),
          label: g.getAttribute('aria-label'),
          headers: [...g.querySelectorAll('[role=columnheader]')].map(text),
          rows: [...g.querySelectorAll('.cgg-row')].map(r => ({ index: r.getAttribute('aria-rowindex'),
              cells: [...r.querySelectorAll('[role=gridcell]')].map(text),
              color: (r.querySelector('.cgg-swatch') || {}).style ? r.querySelector('.cgg-swatch').style.backgroundColor : null,
              small: !!r.querySelector('.cgg-small') })),
          dom: g.querySelectorAll('.cgg-row').length }; }""", f"{A} .cgg-grid")


def _expected_groups():
    sizes = DATA.obs.groupby(["cell_type", "condition"], observed=True).size()
    return {f"{ct} | {cond}": int(n) for (ct, cond), n in sizes.items()}


def _requests_with_features(page):
    return [c for c in page.calls if c.get("features")]


# ------------------------------------------------------------------ 1. the grid

def test_the_grid_is_a_grid_with_a_row_per_group_and_says_its_true_size(page, served):
    _open(page, served, [CELL_TYPE, CONDITION])
    expected = _expected_groups()
    g = _grid(page)
    assert g["role"] == "grid" and g["label"] == "Groups"
    assert g["rowcount"] == str(len(expected) + 1), "the header row counts"
    assert g["headers"][:3] == ["Name", "Cells", "Share"]
    shown = {r["cells"][0].replace(" small", ""): r for r in g["rows"]}
    assert set(shown) == set(expected)
    for name, n in expected.items():
        cells = shown[name]["cells"]
        assert cells[1] == f"{n:,}"
        assert cells[2] == (f"{100 * n / N:.1f}%".replace(".0%", "%") if n / N >= 0.0005 else "<0.1%")
        assert shown[name]["color"], f"{name} has a colour"
    small = [n for n, k in expected.items() if k < 10]
    assert small and {r["cells"][0].replace(" small", "") for r in g["rows"] if r["small"]} == set(small)
    assert page.inner_text(f"{A} .cgg__title") == f"Groups {len(expected)}"
    pill = page.locator(f"{ROWS} .cgg-small").first
    assert pill.get_attribute("title") == "Under 10 cells: statistics are unreliable"


def test_the_search_filters_the_groups_and_the_grid_says_how_many_remain(page, served):
    _open(page, served, [CELL_TYPE, CONDITION])
    page.fill(f"{A} .cgg__search", "platelet")
    until(page, "(s) => document.querySelectorAll(s + ' .cgg-row').length === 2", A)
    assert [r["cells"][0].replace(" small", "") for r in _grid(page)["rows"]] == [n for n in _expected_groups() if n.startswith("Platelet")]
    assert _grid(page)["rowcount"] == "3"
    page.fill(f"{A} .cgg__search", "")
    until(page, "(s) => document.querySelectorAll(s + ' .cgg-row').length > 2", A)


# ------------------------------------------------------------------ 2. the cross-table

def test_the_cross_table_has_the_first_factor_down_and_the_second_across(page, served):
    _open(page, served, [CELL_TYPE, CONDITION])
    assert page.get_attribute(f"{A} .cgg__view [data-view='list']", "aria-checked") == "true"
    page.click(f"{A} .cgg__view [data-view='cross']")
    until(page, "(s) => !!document.querySelector(s + ' .cgg-grid[data-view=cross]')", A)
    g = _grid(page)
    assert g["headers"] == ["", "ctrl", "treated"] or g["headers"] == ["cell_type", "ctrl", "treated"]
    table = DATA.obs.groupby(["cell_type", "condition"], observed=True).size().unstack(fill_value=0)
    rows = {r["cells"][0]: r["cells"][1:] for r in g["rows"]}
    for ct in table.index:
        assert rows[ct] == [f"{int(table.loc[ct, c]):,}" for c in ["ctrl", "treated"]]
    holds = int((table.values > 0).sum())
    assert page.inner_text(f"{A} .cgg__foot") == f"{holds} of {table.size} combinations hold cells."
    page.click(f"{A} .cgg__view [data-view='list']")
    until(page, "(s) => !document.querySelector(s + ' .cgg-grid[data-view=cross]')", A)


def test_the_cross_table_is_offered_for_exactly_two_factors(page, served):
    _open(page, served, [CELL_TYPE])
    assert page.locator(f"{A} .cgg__view [data-view='cross']").is_disabled()
    page.evaluate("() => window.PanelManager.getPanel('%s').addFactor({source: {type: 'obs', key: 'condition'}})" % GA)
    until(page, "(s) => !document.querySelector(s + ' .cgg__view [data-view=cross]').disabled", A)


# ------------------------------------------------------------------ 3. the focused gene

def _column_values(page, header_text):
    return page.evaluate("""([s, h]) => { const g = document.querySelector(s);
        const heads = [...g.querySelectorAll('[role=columnheader]')].map(e => e.textContent.trim());
        const i = heads.indexOf(h); if (i < 0) return null;
        return [...g.querySelectorAll('.cgg-row')].map(r => [r.querySelector('.cgg-name').textContent.replace(/ small$/, '').trim(),
            r.querySelectorAll('[role=gridcell]')[i].textContent.trim()]); }""", [f"{A} .cgg-grid", header_text])


def _three(x):
    return float(f"{x:.3g}")


def test_with_no_gene_focused_the_columns_say_so(page, served):
    _open(page, served, [CELL_TYPE, CONDITION])
    assert "No gene focused" in page.inner_text(f"{A} .cgg-grid .cgg-head")
    assert not _requests_with_features(page)


def test_the_focused_gene_columns_are_its_offered_statistics_on_the_first_layer(page, served):
    _open(page, served, [CELL_TYPE, CONDITION], layers=["logged", "X"])
    _focus_gene(page, GENE)
    until(page, "(s) => document.querySelector(s + ' .cgg-grid [role=columnheader]:nth-child(5)') !== null", A)
    until(page, "(s) => ![...document.querySelectorAll(s + ' .cgg-row .cgg-val')].some(e => e.textContent.trim() === '…')", A)
    mean = dict(_column_values(page, f"{GENE} mean"))
    pct = dict(_column_values(page, f"{GENE} % expressing"))
    column = DATA.logged[:, GENE_INDEX]
    obs = DATA.obs
    for (ct, cond), idx in obs.groupby(["cell_type", "condition"], observed=True).indices.items():
        name = f"{ct} | {cond}"
        assert float(mean[name]) == pytest.approx(_three(float(column[idx].mean())), rel=1e-6), name
        assert float(pct[name]) == pytest.approx(_three(100 * float((column[idx] > 0).mean())), rel=1e-6), name
    sent = _requests_with_features(page)
    assert sent and sent[-1]["features"][0]["name"] == GENE and sent[-1]["features"][0]["layer"] == "logged"


def test_a_statistic_the_layer_cannot_give_is_left_out(page, served):
    _open(page, served, [CELL_TYPE, CONDITION])          # X is signed: no % expressing
    _focus_gene(page, GENE)
    until(page, "(s) => [...document.querySelectorAll(s + ' .cgg-grid [role=columnheader]')].some(e => e.textContent.trim() === '%s mean')" % GENE, A)
    heads = _grid(page)["headers"]
    assert f"{GENE} mean" in heads and f"{GENE} % expressing" not in heads


# ------------------------------------------------------------------ 4. the gate

def _slow_estimates(page, seconds=40):
    def handler(route):
        body = json.loads(route.request.post_data or "{}")
        if not body.get("estimate_only"):
            return route.continue_()
        reply = route.fetch().json()
        reply["estimate"] = {**reply.get("estimate", {}), "seconds": seconds, "tier": "auto", "live_max_s": 5}
        route.fulfill(status=200, body=json.dumps(reply), headers={"Content-Type": "application/json"})
    page.route("**/api/v1/data/cell_groups*", handler)


def test_a_slow_estimate_gives_a_button_and_a_focus_change_then_sends_no_request(page, served):
    _open(page, served, [CELL_TYPE, CONDITION], layers=["logged"])
    _slow_estimates(page)
    _focus_gene(page, GENE)
    until(page, "(s) => !!document.querySelector(s + ' .cgg-show')", A)
    assert page.inner_text(f"{A} .cgg-show") == f"Show {GENE}"
    assert not _requests_with_features(page), "the estimate is a request without features' values"
    before = len(page.calls)
    _focus_gene(page, "GENE006")
    until(page, "(s) => document.querySelector(s + ' .cgg-show').textContent === 'Show GENE006'", A)
    waits.expect_stays(lambda: len(page.calls) == before, "a focus change must send no request while the header is a button", page=page, seconds=1.0)
    page.click(f"{A} .cgg-show")
    until(page, "(s) => !document.querySelector(s + ' .cgg-show') && [...document.querySelectorAll(s + ' .cgg-grid [role=columnheader]')].some(e => e.textContent.trim() === 'GENE006 mean')", A)
    mean = dict(_column_values(page, "GENE006 mean"))
    until(page, "(s) => ![...document.querySelectorAll(s + ' .cgg-row .cgg-val')].some(e => e.textContent.trim() === '…')", A)
    mean = dict(_column_values(page, "GENE006 mean"))
    assert all(v != "—" for v in mean.values())


def test_a_panel_off_screen_asks_for_nothing_when_the_focus_changes(page, served):
    _open(page, served, [CELL_TYPE, CONDITION])
    page.evaluate("(s) => { document.querySelector(s).style.visibility = 'hidden'; document.querySelector(s).style.display = 'none'; }", A)
    until(page, "(s) => window.PanelManager.getPanel('%s')._debugState().visible === false" % GA, A)
    before = len(page.calls)
    _focus_gene(page, GENE)
    waits.expect_stays(lambda: len(page.calls) == before, "a panel off screen must send no request for the focused gene", page=page, seconds=1.0)
    page.evaluate("(s) => { document.querySelector(s).style.display = ''; document.querySelector(s).style.visibility = ''; }", A)
    until(page, "(s) => [...document.querySelectorAll(s + ' .cgg-grid [role=columnheader]')].some(e => e.textContent.trim() === '%s mean')" % GENE, A)


# ------------------------------------------------------------------ 5. 2,000 groups

def _two_thousand(page):
    def handler(route):
        body = json.loads(route.request.post_data or "{}")
        if body.get("estimate_only") or body.get("features"):
            return route.continue_()
        ids = [f"c:G{i:04d}" for i in range(2000)]
        frame = {"type": "result", "version": 1, "shape": "grouping", "n_shown": 2000, "n_grouped": 2000,
                 "partitionings": [{"kind": "categorical", "levels": [{"id": i, "n": 1} for i in ids]}],
                 "groups": [{"key": [i], "n": 1} for i in ids], "blocks": []}
        route.fulfill(status=200, body=json.dumps({"type": "start"}) + "\n" + json.dumps(frame) + "\n",
                      headers={"Content-Type": "application/x-ndjson"})
    page.route("**/api/v1/data/cell_groups*", handler)


def test_2000_groups_keep_a_constant_number_of_rows_in_the_dom(page, served):
    _two_thousand(page)
    _open(page, served, [CELL_TYPE])
    g = _grid(page)
    assert g["rowcount"] == "2001" and g["role"] == "grid"
    first = g["dom"]
    assert 5 <= first <= 60, first
    for top in (50000, 20000, 0):
        page.evaluate("([s, t]) => { document.querySelector(s).scrollTop = t; }", [GRID, top])
        until(page, "([s, t]) => { const g = document.querySelector(s); return g.scrollTop === Math.min(t, g.scrollHeight - g.clientHeight) }", [GRID, top])
        until(page, "(s) => document.querySelectorAll(s + ' .cgg-row').length > 0", A)
        assert abs(_grid(page)["dom"] - first) <= 2, "the rows in the page do not grow with the scroll"
    page.evaluate("(s) => { const g = document.querySelector(s); g.scrollTop = g.scrollHeight; }", GRID)
    until(page, "(s) => [...document.querySelectorAll(s + ' .cgg-row')].some(r => r.getAttribute('aria-rowindex') === '2001')", A)
    assert _grid(page)["dom"] <= first + 2
    assert page.inner_text(f"{A} .cgg__title") == "Groups 2,000"


def test_the_keys_of_a_grid_move_between_rows(page, served):
    _two_thousand(page)
    _open(page, served, [CELL_TYPE])
    first = page.locator(f"{ROWS}[aria-rowindex='2']")
    first.focus()
    assert page.evaluate("() => document.activeElement.getAttribute('role')") == "row"
    focused = "() => document.activeElement.getAttribute('aria-rowindex')"
    page.keyboard.press("ArrowDown")
    until(page, f"() => ({focused})() === '3'")
    page.keyboard.press("End")
    until(page, f"() => ({focused})() === '2001'")
    page.keyboard.press("Home")
    until(page, f"() => ({focused})() === '2'")
    page.keyboard.press("PageDown")
    until(page, f"() => Number(({focused})()) > 5")
    page.keyboard.press("ArrowUp")
    assert int(page.evaluate(focused)) >= 2
    assert _grid(page)["dom"] <= 60
    assert page.locator(f"{GRID} [tabindex='0']").count() == 1, "one row is in the tab order"


# ------------------------------------------------------------------ 6. export

def test_the_csv_has_the_grids_columns_after_the_key(page, served):
    _open(page, served, [CELL_TYPE, CONDITION], layers=["logged"])
    _focus_gene(page, GENE)
    until(page, "(s) => [...document.querySelectorAll(s + ' .cgg-grid [role=columnheader]')].some(e => e.textContent.trim() === '%s mean')" % GENE, A)
    until(page, "(s) => ![...document.querySelectorAll(s + ' .cgg-row .cgg-val')].some(e => e.textContent.trim() === '…')", A)
    headers = _grid(page)["headers"]
    with page.expect_download() as info:
        page.click(f"{A} .cgg__export")
    path = info.value.path()
    lines = pathlib.Path(path).read_text().rstrip("\n").split("\n")
    assert lines[0].split(",") == ["Key"] + headers
    assert len(lines) == 1 + len(_expected_groups())
    assert info.value.suggested_filename.endswith(".csv")


# ------------------------------------------------------------------ 7. in no group

def test_in_no_group_shows_the_reasons_as_the_rows_of_the_grid(page, served):
    levels = {"source": CELL_TYPE["source"], "levels": ["c:B cell", "c:T cell"], "rest": "exclude"}
    _open(page, served, [levels])
    until(page, "(s) => !!document.querySelector(s + ' .cgrp-nogroup:not([hidden])')", A)
    reasons = page.locator(f"{A} .cgrp-reasons li").all_inner_texts()
    page.click(f"{A} .cgrp-nogroup")
    until(page, "(s) => document.querySelector(s + ' .cgg-grid').dataset.view === 'reasons'", A)
    assert [r["cells"][0] for r in _grid(page)["rows"]] == reasons
    page.click(f"{A} .cgrp-nogroup")
    until(page, "(s) => document.querySelector(s + ' .cgg-grid').dataset.view !== 'reasons'", A)
    assert _grid(page)["rowcount"] == "3"


# ------------------------------------------------------------------ 8. screenshots

@pytest.mark.skipif(not SHOTS, reason="set ANNZARRO_G9C_SHOTS to a folder to write the screenshots")
@pytest.mark.parametrize("theme", ["light", "dark"])
def test_screenshots(page, served, theme):
    out = pathlib.Path(SHOTS)
    out.mkdir(parents=True, exist_ok=True)
    page.emulate_media(color_scheme=theme)
    _open(page, served, [CELL_TYPE, CONDITION], layers=["logged"])
    _focus_gene(page, GENE)
    until(page, "(s) => ![...document.querySelectorAll(s + ' .cgg-row .cgg-val')].some(e => e.textContent.trim() === '…') && !!document.querySelector(s + ' .cgg-val')", A)
    page.locator(f"{A} .cgrp-groups").screenshot(path=str(out / f"group-grid-list-{theme}.png"))
    page.click(f"{A} .cgg__view [data-view='cross']")
    until(page, "(s) => !!document.querySelector(s + ' .cgg-grid[data-view=cross]')", A)
    page.locator(f"{A} .cgrp-groups").screenshot(path=str(out / f"group-grid-cross-{theme}.png"))
