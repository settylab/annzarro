"""The sets of a Venn and an UpSet in a real browser, against the real cell_groups route (V1; UX 4.6, UX 2.8).

The store is the grouping fixture (tests/core/grouping_store.py), served as test_cell_count_panel.py serves it: 1,200
cells; cell_type (6 levels), pseudotime (20 cells without a value), is_doublet.

1.  Venn and UpSet are offered in Mode. Three sets (levels of a column, a condition on a number, a boolean column) draw
    a Venn whose every region is the brute-force count; each row names its set, its cells and "20 without a value,
    counted as out"; the universe line counts the cells in no set (CNT-5, CNT-11, CNT-13).
2.  Add set builds a set in place (Levels of a column, Condition on a number), one undoable step each.
3.  UpSet: the exclusive intersections, Show top and Minimum size, the share of cells not shown (CNT-12).
4.  A group set (UX 2.8, SHR-38): "Group changed" with the sentence, Keep, then "(follows the bin)" and later changes
    silent; two at once are one line with Keep all and Review; a key that is gone is "no longer a group"; a member on the
    wire is the key only.
5.  Add set is disabled at 16 sets with the reason, and 16 sets draw an UpSet.
6.  A link carries the sets as stored (groupWas, follow) and nothing computed.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import json
import os

import numpy as np
import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: F401,E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser import waits  # noqa: E402
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402
from annzarro.tests.browser.test_cell_count_panel import (  # noqa: E402,F401  (fixtures: served, page)
    CC, GA, S, DATA, N, served, page, _count, _open, _config,
)

OBS = DATA.obs
PSEUDO = OBS["pseudotime"].to_numpy()
LEVELS_SET = {"source": {"type": "obs", "key": "cell_type"}, "member": {"levels": ["c:T cell", "c:NK cell"]}}
COND_SET = {"source": {"type": "obs", "key": "pseudotime"}, "member": {"op": ">", "value": 0.5}}
BOOL_SET = {"source": {"type": "obs", "key": "is_doublet"}, "member": {"levels": ["c:true"]}}
GROUP_TYPE = "cell-group"   # the frozen source type id (plan 1.6), as a link stores it


def _membership(sets):
    """Each cell in or out of each set, from the fixture's own columns (a cell without a value is out)."""
    cols = []
    for s in sets:
        src, m = s["source"], s["member"]
        v = OBS[src["key"]]
        if "op" in m:
            x = v.to_numpy(dtype=float)
            ok = np.isfinite(x)
            op = {">": np.greater, ">=": np.greater_equal, "<": np.less, "<=": np.less_equal}[m["op"]]
            inside = np.zeros(N, dtype=bool)
            inside[ok] = op(x[ok], m["value"])
        elif v.dtype == bool:
            inside = v.to_numpy() if m["levels"] == ["c:true"] else ~v.to_numpy()
        else:
            inside = v.astype(str).isin([lv[2:] for lv in m["levels"]]).to_numpy()
        cols.append(inside)
    return np.stack(cols, axis=1)


def _regions(sets):
    """{bit code (bit s = in set s): cells}, the brute force of an exclusive region."""
    inside = _membership(sets)
    codes = (inside * (1 << np.arange(len(sets)))).sum(axis=1)
    values, counts = np.unique(codes, return_counts=True)
    return {int(c): int(n) for c, n in zip(values, counts)}


def _drawn(page, mode, check="true"):
    until(page, f"""([s, m]) => {{ const r = document.querySelector(s + ' .ccnt-panel');
        const c = window.PanelManager.getPanel('{CC}').getConfig();
        return r && r.dataset.drawn === m && r.dataset.state === 'ready' && ({check}); }}""", [S, mode], timeout=60)


def _rows(page):
    """Each set row as the list shows it."""
    return page.evaluate("""(s) => [...document.querySelectorAll(s + ' .ccnt-set:not(.ccnt-set--draft)')].map(r => ({
        letter: r.querySelector('.ccnt-set__letter').textContent, name: r.querySelector('.ccnt-set__name').textContent,
        cells: r.querySelector('.ccnt-set__count').title, noValue: r.querySelector('.ccnt-set__novalue').textContent,
        tag: r.querySelector('.ccnt-set__tag').textContent, state: r.dataset.state,
        note: r.querySelector('.ccnt-set__note').hidden ? null : r.querySelector('.ccnt-set__note p').textContent }))""", S)


def _plot_regions(page):
    """The regions drawn: {bit code: count}, read from the trace's customdata and the model's regions."""
    return page.evaluate("""(s) => { const p = document.querySelector(s + ' .ccnt-plot');
        const t = p.data.find(d => d.name === 'regions' || d.name === 'intersections');
        return { customdata: Array.from(t.customdata), text: Array.from(t.text || []), y: t.y ? Array.from(t.y) : null }; }""", S)


def _undo_steps(page):
    return page.evaluate(f"() => window.PanelManager.getPanel('{CC}')._debugState().undo")


# ------------------------------------------------------------------ 1. a Venn of three sets

def test_venn_and_upset_are_offered_and_three_sets_draw_every_region_as_counted(page, served):
    sets = [LEVELS_SET, COND_SET, BOOL_SET]
    _open(page, served, {CC: _count(mode="venn", sets=sets)})
    _drawn(page, "venn")
    modes = page.evaluate("""(s) => [...document.querySelectorAll(s + ' .ccnt-mode option')].filter(o => ['venn', 'upset'].includes(o.value))
        .map(o => [o.value, o.disabled, o.title])""", S)
    assert modes == [["venn", False, ""], ["upset", False, ""]]

    brute = _regions(sets)
    drawn = _plot_regions(page)
    assert len(drawn["customdata"]) == 7, "a Venn of three sets has seven regions"
    rows = _rows(page)
    inside = _membership(sets)
    assert [r["letter"] for r in rows] == ["A", "B", "C"]
    assert [r["name"] for r in rows] == ["cell_type is T cell, NK cell", "pseudotime > 0.5", "is_doublet"]
    assert [r["cells"] for r in rows] == [f"{int(inside[:, s].sum()):,} cells" for s in range(3)]
    assert [r["noValue"] for r in rows] == ["", f"{int(np.isnan(PSEUDO).sum())} without a value, counted as out", ""]
    assert page.inner_text(f"{S} .ccnt-sets__universe") == f"Universe: the {N:,} cells shown. {brute.get(0, 0):,} are in no set."
    # a Venn lists its regions in the order of their bit code, so region i is code i + 1; its label starts with its count
    for i, text in zip(drawn["customdata"], drawn["text"]):
        assert text.startswith(f"{brute.get(i + 1, 0):,}"), (i, text)


# ------------------------------------------------------------------ 2. Add set, in place

def test_add_set_builds_levels_and_a_condition_in_place_each_one_step(page, served):
    _open(page, served, {CC: _count(mode="venn")})
    until(page, "(s) => document.querySelector(s + ' .ccnt-sets') && !document.querySelector(s + ' .ccnt-sets').hidden", S)
    assert page.inner_text(f"{S} .ccnt-state__text") == "Add two or more sets."
    kinds = page.evaluate("(s) => [...document.querySelectorAll(s + ' .ccnt-sets__add option')].slice(1).map(o => o.textContent)", S)
    assert kinds == ["Cell table…", "Boolean column…", "Levels of a column…", "Condition on a number…", "Group of a grouping…"]

    page.select_option(f"{S} .ccnt-sets__add", "levels")
    draft = "[data-popover='set-definition']"     # the draft's definition is in a pop-over, open on the draft's letter
    page.select_option(f"{draft} select[data-field='column']", "cell_type")
    page.wait_for_selector(f"{draft} .ccnt-set__levels input[value='c:T cell']")
    # a commit draws the row again, so the box is clicked, not checked through one element handle
    page.click(f"{draft} .ccnt-set__levels input[value='c:T cell']")
    until(page, f"() => (window.PanelManager.getPanel('{CC}').getConfig().sets || []).length === 1")
    assert _config(page)["sets"] == [{"source": {"type": "obs", "key": "cell_type"}, "member": {"levels": ["c:T cell"]}}]
    steps = _undo_steps(page)
    page.click("[data-popover='set-definition'] .ccnt-set__levels input[value='c:NK cell']")
    until(page, f"() => window.PanelManager.getPanel('{CC}').getConfig().sets[0].member.levels.length === 2")
    assert _undo_steps(page) == steps + 1

    page.select_option(f"{S} .ccnt-sets__add", "condition")
    page.select_option(f"{draft} .axis-type-select", "obs")
    page.select_option(f"{draft} .axis-key-select", "pseudotime")
    page.select_option(f"{draft} select[data-field='op']", ">=")
    page.fill(f"{draft} input[data-field='value']", "0.25")
    page.press(f"{draft} input[data-field='value']", "Enter")
    until(page, f"() => (window.PanelManager.getPanel('{CC}').getConfig().sets || []).length === 2")
    assert _config(page)["sets"][1] == {"source": {"type": "obs", "key": "pseudotime"}, "member": {"op": ">=", "value": 0.25}}
    _drawn(page, "venn")
    assert [r["name"] for r in _rows(page)] == ["cell_type is T cell, NK cell", "pseudotime ≥ 0.25"]

    # a categorical source under a condition is not committed, and says why
    page.select_option(f"{S} .ccnt-sets__add", "condition")
    page.select_option(f"{draft} .axis-type-select", "obs")
    page.select_option(f"{draft} .axis-key-select", "cell_type")
    page.fill(f"{draft} input[data-field='value']", "1")
    page.press(f"{draft} input[data-field='value']", "Enter")
    page.wait_for_selector(f"{draft} .ccnt-set__problem:has-text('Choose a numeric source.')")
    assert len(_config(page)["sets"]) == 2

    # Remove is one step, and Undo brings the set back
    page.click(f"{S} .ccnt-set[data-set-index='1'] [data-set-action='remove']")
    until(page, f"() => window.PanelManager.getPanel('{CC}').getConfig().sets.length === 1")
    page.evaluate(f"() => window.PanelManager.getPanel('{CC}').undo()")
    until(page, f"() => window.PanelManager.getPanel('{CC}').getConfig().sets.length === 2")


# ------------------------------------------------------------------ 3. UpSet

def test_upset_draws_exclusive_intersections_with_show_top_and_minimum_size(page, served):
    sets = [LEVELS_SET, COND_SET, BOOL_SET, {"source": {"type": "obs", "key": "depth"}, "member": {"op": ">", "value": 0}}]
    _open(page, served, {CC: _count(mode="upset", sets=sets)})
    _drawn(page, "upset")
    brute = {c: n for c, n in _regions(sets).items() if c != 0}
    bars = _plot_regions(page)
    assert sorted(bars["y"], reverse=True) == bars["y"], "sorted by size"
    assert sorted(bars["y"]) == sorted(brute.values()), "every region that holds a cell, each counted once"
    assert sum(bars["y"]) + _regions(sets).get(0, 0) == N

    page.fill(f"{S} [data-upset='top']", "3")
    page.press(f"{S} [data-upset='top']", "Enter")
    _drawn(page, "upset", "c.top === 3")
    assert _plot_regions(page)["y"] == sorted(brute.values(), reverse=True)[:3]
    hidden = sum(sorted(brute.values(), reverse=True)[3:])
    note = page.evaluate("(s) => document.querySelector(s + ' .ccnt-plot').layout.annotations.map(a => a.text).join(' ')", S)
    assert "bars not shown" in note and f"{len(brute) - 3}" in note and hidden > 0, note

    page.fill(f"{S} [data-upset='minSize']", "-1")
    page.press(f"{S} [data-upset='minSize']", "Enter")
    page.wait_for_selector(f"{S} .ccnt-sets__problem:has-text('Enter a whole number, 0 or more.')")
    assert "minSize" not in _config(page)
    smallest = sorted(brute.values(), reverse=True)[1]
    page.fill(f"{S} [data-upset='minSize']", str(smallest))
    page.press(f"{S} [data-upset='minSize']", "Enter")
    _drawn(page, "upset", f"c.minSize === {smallest}")
    assert all(y >= smallest for y in _plot_regions(page)["y"])
    page.select_option(f"{S} [data-upset='sort']", "degree")
    _drawn(page, "upset", "c.sort === 'degree'")


# ------------------------------------------------------------------ 4. a group set: changed, Keep, following, gone

def _grouping(thresholds):
    return {"id": GA, "title": "Grouping 1", "version": 1,
            "partitionings": [{"source": {"type": "obs", "key": "pseudotime"}, "binning": {"method": "manual", "thresholds": thresholds}}]}


def _labels(page):
    """The grouping's groups now: {key json: default labels}, as a consumer that names one group reads them."""
    return until(page, f"""async () => {{ const {{ groupSources }} = await import('/static/js/utils/group-host.js');
        const s = groupSources().sources; const h = s.watch('{GA}', {{ consumer: {{ kind: 'plot', role: 'test', panelId: 'test' }}, option: {{}}, onChange() {{}} }});
        const snap = h.read(); const out = snap.state === 'ready' && snap.values ? Object.fromEntries([...s.labelsOf('{GA}', snap.values.reply).byKey]) : null;
        h.release(); return out; }}""")


def _set_grouping(page, thresholds):
    """The grouping's thresholds edited as a link or Back would give them: the recipe as saved."""
    page.evaluate("([id, cfg]) => window.PanelManager.getPanel(id).updateConfig(cfg)", [GA, {k: v for k, v in _grouping(thresholds).items() if k not in ("id", "title")}])


def test_a_group_set_says_group_changed_once_and_keep_makes_it_follow_silently(page, served):
    sets = [COND_SET, {"source": {"type": GROUP_TYPE, "key": GA}, "member": {"group": ["bin:1"], "groupWas": ["pseudotime ≥ 0.4"]}}]
    _open(page, served, {CC: _count(mode="venn", sets=sets), GA: _grouping([0.5])}, open_ids=(CC, GA))
    _drawn(page, "venn")
    now = _labels(page)['["bin:1"]'][0]
    assert now != "pseudotime ≥ 0.4"
    until(page, "(s) => document.querySelector(s + ' .ccnt-set[data-set-index=\"1\"]').dataset.state === 'changed'", S)
    row = _rows(page)[1]
    assert row["tag"] == "Group changed"
    assert row["note"] == f"This group has changed: was 'pseudotime ≥ 0.4', now '{now}'."
    assert row["name"] == "Grouping 1: pseudotime ≥ 0.4"
    # the member on the wire is the key only
    sent = [c for c in page.calls if c.get("shape") == "grid"]
    assert sent and sent[-1]["partitionings"][1]["member"] == {"group": ["bin:1"]}
    # the drawing marks the set
    ticks = page.evaluate("(s) => document.querySelector(s + ' .ccnt-plot').data[0].hovertext.join(' ')", S)
    assert "pseudotime ≥ 0.4" in ticks

    page.click(f"{S} .ccnt-set[data-set-index='1'] [data-set-action='keep']")
    until(page, f"() => window.PanelManager.getPanel('{CC}').getConfig().sets[1].member.follow === true")
    assert _config(page)["sets"][1]["member"] == {"group": ["bin:1"], "groupWas": [now], "follow": True}
    until(page, "(s) => document.querySelector(s + ' .ccnt-set[data-set-index=\"1\"]').dataset.state === 'ok'", S)
    assert _rows(page)[1]["name"] == f"Grouping 1: {now} (follows the bin)"
    assert _rows(page)[1]["note"] is None and _rows(page)[1]["tag"] == ""

    # a later change: the stored name follows with no history step and no notice
    steps = _undo_steps(page)
    _set_grouping(page, [0.6])
    until(page, f"() => window.PanelManager.getPanel('{CC}').getConfig().sets[1].member.groupWas[0] !== {json.dumps(now)}", timeout=60)
    later = _config(page)["sets"][1]["member"]
    assert later["follow"] is True and later["groupWas"] == [_labels(page)['["bin:1"]'][0]]
    assert _undo_steps(page) == steps
    waits.expect_stays(lambda: _rows(page)[1]["note"] is None and _rows(page)[1]["tag"] == "",
                       "a following set says nothing after a change: no event marks the absence of a notice", page=page)

    # Choose another, or picking the group again, ends following
    page.click(f"{S} .ccnt-set[data-set-index='1'] .ccnt-set__letter")
    page.select_option("[data-popover='set-definition'] select[data-field='group']", label=_labels(page)['["bin:1"]'][0])
    until(page, f"() => !('follow' in window.PanelManager.getPanel('{CC}').getConfig().sets[1].member)")


def test_two_group_sets_changed_at_once_are_one_line_and_a_key_that_is_gone_says_so(page, served):
    sets = [{"source": {"type": GROUP_TYPE, "key": GA}, "member": {"group": ["bin:0"], "groupWas": ["old 0"]}},
            {"source": {"type": GROUP_TYPE, "key": GA}, "member": {"group": ["bin:1"], "groupWas": ["old 1"]}},
            {"source": {"type": GROUP_TYPE, "key": GA}, "member": {"group": ["bin:2"], "groupWas": ["old 2"]}}]
    _open(page, served, {CC: _count(mode="venn", sets=sets), GA: _grouping([0.3, 0.6])}, open_ids=(CC, GA))
    _drawn(page, "venn")
    page.wait_for_selector(f"{S} .ccnt-sets__summary:not([hidden])")
    assert page.inner_text(f"{S} .ccnt-sets__summary p") == "3 groups have changed after the subset changed."
    assert page.evaluate("(s) => [...document.querySelectorAll(s + ' .ccnt-sets__summary button')].map(b => b.textContent)", S) == ["Keep all", "Review"]
    assert all(r["tag"] == "Group changed" and r["note"] is None for r in _rows(page)), "one line, not three sentences"
    page.click(f"{S} .ccnt-sets__summary [data-set-action='review']")
    until(page, "(s) => [...document.querySelectorAll(s + ' .ccnt-set__note')].every(n => !n.hidden)", S)
    page.click(f"{S} .ccnt-sets__summary [data-set-action='keepAll']")
    until(page, f"() => window.PanelManager.getPanel('{CC}').getConfig().sets.every(s => s.member.follow === true)")
    labels = _labels(page)
    assert [s["member"]["groupWas"] for s in _config(page)["sets"]] == [labels[f'["bin:{i}"]'] for i in range(3)]

    # bin:2 is no longer a group once the grouping has one threshold: the row keeps the set and says so
    _set_grouping(page, [0.5])
    until(page, "(s) => document.querySelector(s + ' .ccnt-set[data-set-index=\"2\"]').dataset.state === 'gone'", S, timeout=60)
    row = _rows(page)[2]
    assert row["tag"] == "No longer a group"
    assert row["note"] == f"'{labels['[\"bin:2\"]'][0]}' is no longer a group of 'Grouping 1'."
    assert len(_config(page)["sets"]) == 3, "nothing is silently reset"


def test_a_set_whose_table_is_gone_keeps_its_row_marked_deleted_with_choose_another(page, served):
    gone = {"source": {"type": "table", "key": "cell-table-gone"}, "name": "old table"}
    _open(page, served, {CC: _count(mode="venn", sets=[COND_SET, gone])})
    until(page, "(s) => { const r = document.querySelector(s + ' .ccnt-set[data-set-index=\"1\"]'); return r && r.dataset.state === 'deleted'; }", S)
    row = _rows(page)[1]
    assert row["tag"] == "deleted" and row["name"] == "old table"
    assert len(_config(page)["sets"]) == 2, "nothing is silently reset"
    page.click(f"{S} .ccnt-set[data-set-index='1'] [data-set-action='chooseAnother']")
    page.wait_for_selector("[data-popover='set-definition'] select[data-field='table']")


# ------------------------------------------------------------------ 5. sixteen sets

def test_add_set_is_disabled_at_sixteen_with_the_reason_and_sixteen_sets_draw(page, served):
    sets = [{"source": {"type": "obs", "key": "score"}, "member": {"op": ">", "value": round(1.0 + i * 0.5, 2)}} for i in range(16)]
    _open(page, served, {CC: _count(mode="upset", sets=sets)})
    # sixteen rows push the plot below the fold, and a plot computes while it is on screen (host-binding.js)
    page.locator(f"{S} .ccnt-plot").scroll_into_view_if_needed()
    _drawn(page, "upset")
    add = page.evaluate("(s) => { const a = document.querySelector(s + ' .ccnt-sets__add'); return [a.disabled, a.title]; }", S)
    assert add == [True, "UpSet shows up to 16 sets."]
    assert len(_rows(page)) == 16
    assert _rows(page)[15]["letter"] == "P"


# ------------------------------------------------------------------ 6. a link

def test_a_link_carries_the_sets_as_stored_and_nothing_computed(page, served):
    group = {"source": {"type": GROUP_TYPE, "key": GA}, "member": {"group": ["bin:1"], "groupWas": ["x"], "follow": True}, "name": "late"}
    sets = [COND_SET, group]
    _open(page, served, {CC: _count(mode="venn", sets=sets, top=12), GA: _grouping([0.5])}, open_ids=(CC, GA))
    _drawn(page, "venn")
    cfg = page.evaluate("() => window.sessionManager.captureView()")["layout"]["panelConfigs"][CC]
    assert cfg["sets"][0] == COND_SET
    assert cfg["sets"][1]["name"] == "late" and cfg["sets"][1]["member"]["follow"] is True
    assert cfg["top"] == 12
    assert "n_no_value" not in json.dumps(cfg) and "regions" not in json.dumps(cfg)
    assert _rows(page)[1]["name"] == "late (follows the bin)", "a following set's row says so, after its own name"


def test_the_set_definition_pop_over_uses_the_az_pop_body(page, served):
    from annzarro.tests.browser.popover_standard import assert_body_standard
    _open(page, served, {CC: _count(mode="venn")})
    until(page, "(s) => document.querySelector(s + ' .ccnt-sets') && !document.querySelector(s + ' .ccnt-sets').hidden", S)
    page.select_option(f"{S} .ccnt-sets__add", "levels")
    draft = "[data-popover='set-definition']"
    page.select_option(f"{draft} select[data-field='column']", "cell_type")
    page.wait_for_selector(f"{draft} .ccnt-set__levels input[value='c:T cell']")
    assert_body_standard(page, draft, fields=False, shot="count-set-definition")
