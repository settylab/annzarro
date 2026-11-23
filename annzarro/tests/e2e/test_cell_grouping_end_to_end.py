"""Cell Grouping, from the chooser to the grid, through the real route (0.8.0, Z2).

Nothing is stubbed: a real server and store. The user opens **Cell Grouping** from "Create New Panel", adds the obs
column ``cell_type`` as a factor, and the panel asks ``POST /api/v1/data/cell_groups``; its grid then lists the groups
with their cell counts. The counts are compared with the value counts read back from the store's own arrays.

Needs Playwright with Chromium; skipped without it, or failed when ANNZARRO_REQUIRE_BROWSER=1.
"""
import json

from annzarro.tests.browser.test_memory_guard import until
from annzarro.tests.e2e.grouping_e2e import create_panel, grouping_server, tile, user, value_counts  # noqa: F401


def test_a_grouping_built_from_an_obs_column_lists_the_groups_with_their_counts(user, grouping_server):
    page = user
    store = grouping_server[1]
    calls, statuses = [], []
    page.on("request", lambda r: calls.append(json.loads(r.post_data or "{}"))
            if "/data/cell_groups" in r.url and r.method == "POST" else None)
    page.on("response", lambda r: statuses.append(r.status)
            if "/data/cell_groups" in r.url and r.request.method == "POST" else None)

    gid = create_panel(page, "cell-grouping")
    t = tile(gid)
    page.wait_for_selector(f"{t} .cgrp-panel .cgrp-status[data-state='empty']", timeout=30000)
    assert not [c for c in calls if not c.get("estimate_only")], "an empty grouping asks for nothing"

    page.click(f"{t} .cgrp-add")
    page.click(f"{t} .cgrp-add-menu [data-entry='column']")
    row = f"{t} .cgrp-addrow"
    page.wait_for_selector(row)
    page.select_option(f"{row} .cgrp-addrow__type", "obs")
    page.select_option(f"{row} .cgrp-addrow__key", "cell_type")
    page.click(f"{row} .cgrp-addrow__ok")
    until(page, "(s) => document.querySelector(s + ' .cgrp-status').dataset.state === 'ready'", t, timeout=60)

    want = value_counts(store, "cell_type")
    assert len(want) == 6 and sum(want.values()) == 1200
    rows = page.evaluate("""(s) => [...document.querySelectorAll(s + ' .cgg-grid .cgg-row')].map(r => [
        r.querySelector('.cgg-name').textContent.replace(/ small$/, '').trim(),
        r.querySelector('.cgg-cells').textContent.replace(/,/g, '').trim()])""", t)
    assert {name: int(n) for name, n in rows} == want
    assert page.inner_text(f"{t} .cgrp-status__text").startswith("6 groups")

    sent = [c for c in calls if not c.get("estimate_only")]
    assert sent and sent[-1]["partitionings"][0]["source"] == {"type": "obs", "key": "cell_type"}
    assert statuses and set(statuses) == {200}, statuses
