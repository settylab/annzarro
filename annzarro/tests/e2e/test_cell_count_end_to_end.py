"""Cell Count Plot, from the chooser to the bars, through the real route (0.8.0, Z2).

Nothing is stubbed: a real server and store. The user opens **Cell Count Plot** from "Create New Panel", chooses the obs
column ``cell_type`` for X, and the panel asks ``POST /api/v1/data/cell_groups`` for the counts and draws one bar per
group. The bars are compared with the value counts read back from the store's own arrays, and a second input
(``condition``, as Color by) is compared with the store's own cross-counts.

Needs Playwright with Chromium; skipped without it, or failed when ANNZARRO_REQUIRE_BROWSER=1.
"""
import json

import numpy as np

from annzarro.tests.browser.test_memory_guard import until
from annzarro.tests.e2e.grouping_e2e import create_panel, grouping_server, obs_levels, tile, user, value_counts  # noqa: F401

PLOT = """(s) => { const p = document.querySelector(s + ' .ccnt-plot');
    return { ticks: p.layout.xaxis.ticktext, traces: p.data.map(t => ({ name: t.name, x: Array.from(t.x), y: Array.from(t.y) })) }; }"""


def _choose(page, t, row, key):
    page.select_option(f"{t} [data-input='{row}'] .axis-type-select", "obs")
    page.select_option(f"{t} [data-input='{row}'] .axis-key-select", key)


def _drawn(page, t, check="true"):
    until(page, f"""(s) => {{ const r = document.querySelector(s + ' .ccnt-panel');
        return r && r.dataset.state === 'ready' && r.dataset.drawn === 'bar' && ({check}); }}""", t, timeout=60)


def test_counts_per_group_are_drawn_as_the_store_counts_them(user, grouping_server):
    page = user
    store = grouping_server[1]
    calls, statuses = [], []
    page.on("request", lambda r: calls.append(json.loads(r.post_data or "{}"))
            if "/data/cell_groups" in r.url and r.method == "POST" else None)
    page.on("response", lambda r: statuses.append(r.status)
            if "/data/cell_groups" in r.url and r.request.method == "POST" else None)

    cid = create_panel(page, "cell-count")
    t = tile(cid)
    page.wait_for_selector(f"{t} .ccnt-panel[data-state]", timeout=30000)

    _choose(page, t, "x", "cell_type")
    _drawn(page, t)
    want = value_counts(store, "cell_type")
    fig = page.evaluate(PLOT, t)
    assert len(fig["traces"]) == 1
    got = {fig["ticks"][x]: y for x, y in zip(fig["traces"][0]["x"], fig["traces"][0]["y"])}
    assert {k: v for k, v in got.items() if v} == want
    assert sum(got.values()) == 1200

    # a second input: counts per cell type and condition, against the store's own cross-counts
    _choose(page, t, "split", "condition")
    _drawn(page, t, "!!window.PanelManager.getPanel('%s').getConfig().split" % cid)
    ct_levels, ct_codes = obs_levels(store, "cell_type")
    cd_levels, cd_codes = obs_levels(store, "condition")
    cross = {(ct_levels[a], cd_levels[b]): int(np.sum((ct_codes == a) & (cd_codes == b)))
             for a in range(len(ct_levels)) for b in range(len(cd_levels))}
    fig = page.evaluate(PLOT, t)
    got = {(fig["ticks"][x], tr["name"]): y for tr in fig["traces"] for x, y in zip(tr["x"], tr["y"])}
    assert {k: v for k, v in got.items() if v} == {k: v for k, v in cross.items() if v}

    sent = [c for c in calls if not c.get("estimate_only")]
    assert sent and sent[-1]["shape"] == "grid"
    assert [p["source"]["key"] for p in sent[-1]["partitionings"]] == ["cell_type", "condition"]
    assert statuses and set(statuses) == {200}, statuses
