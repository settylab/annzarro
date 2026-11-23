"""Cell-Gene Plot, from the chooser to the matrix, through the real route (0.8.0, Z2).

Nothing is stubbed: a real server and store. The user opens **Cell Grouping** (cell type), **Gene Signature** (three
genes) and **Cell-Gene Plot** from "Create New Panel", takes the grouping as the groups and the signature as the genes,
and the plot is drawn from ``POST /api/v1/data/cell_groups``. A new plot reads Color as the mean of the log-normalised
layer on a grouping axis too (decision 24, kept by decision 32), so every group's mean of each gene on ``logged``, in the
heatmap and in the dots' colours, is compared with values computed here from the store's own arrays. % expressing is
not asserted here.

Needs Playwright with Chromium; skipped without it, or failed when ANNZARRO_REQUIRE_BROWSER=1.
"""
import json

import numpy as np

from annzarro.tests.browser.test_memory_guard import until
from annzarro.tests.e2e.grouping_e2e import create_panel, gene_column, grouping_server, obs_levels, tile, user  # noqa: F401

GENES = ["GENE000", "GENE001", "GENE002"]


def test_the_matrix_is_drawn_from_a_grouping_and_a_signature(user, grouping_server):
    page = user
    store = grouping_server[1]
    calls = []
    page.on("request", lambda r: calls.append(json.loads(r.post_data or "{}"))
            if "/data/cell_groups" in r.url and r.method == "POST" else None)

    gid = create_panel(page, "cell-grouping")
    g = tile(gid)
    page.click(f"{g} .cgrp-add")
    page.click(f"{g} .cgrp-add-menu [data-entry='column']")
    page.select_option(f"{g} .cgrp-addrow__type", "obs")
    page.select_option(f"{g} .cgrp-addrow__key", "cell_type")
    page.click(f"{g} .cgrp-addrow__ok")
    until(page, "(s) => document.querySelector(s + ' .cgrp-status').dataset.state === 'ready'", g, timeout=60)

    sid = create_panel(page, "gene-signature")
    s = tile(sid)
    page.wait_for_selector(f"{s} .gsig-grid .gsig-row", timeout=30000)
    for gene in GENES:
        page.fill(f"{s} .gsig-search", gene)
        page.press(f"{s} .gsig-search", "Enter")
    until(page, "(id) => window.PanelManager.getPanel(id).getRecipe().genes.length === 3", sid)

    pid = create_panel(page, "cell-gene")
    p = tile(pid)
    page.wait_for_selector(f"{p} .cgene-panel[data-state]", timeout=30000)
    page.select_option(f"{p} .cgene-axis-type", "cell-group")
    page.select_option(f"{p} .cgene-axis-key", gid)
    page.click(f"{p} .cgene-add")
    page.locator(f"{p} .cgene-add-menu [role='menuitem']").first.click()
    until(page, "(s) => document.querySelector(s + ' .cgene-panel').dataset.state === 'ready'", p, timeout=60)
    # the dots first: one per group and gene, the genes along the axis in the signature's order
    cfg = page.evaluate("(id) => window.PanelManager.getPanel(id).getConfig()", pid)
    assert cfg["mode"] == "dots" and cfg["color"] == {"stat": "mean", "layer": "logged"}
    dots = page.evaluate("(s) => { const d = document.querySelector(s + ' .cgene-plot'); return { ticks: d.layout.xaxis.ticktext, "
                         "x: Array.from(d.data[0].x), y: Array.from(d.data[0].y), color: Array.from(d.data[0].marker.color) }; }", p)
    assert dots["ticks"] == GENES and len(dots["x"]) == 6 * 3

    # a heatmap of the same numbers: one row per group, one column per gene, each a mean over the group's cells
    page.click(f"{p} .cgene-mode input[value='heatmap']")
    until(page, "(s) => document.querySelector(s + ' .cgene-plot').data[0].type === 'heatmap'", p)
    z = np.array(page.evaluate("(s) => document.querySelector(s + ' .cgene-plot').data[0].z", p), dtype=float)
    levels, codes = obs_levels(store, "cell_type")
    assert z.shape == (len(levels), len(GENES))
    for j, gene in enumerate(GENES):
        values = gene_column(store, "logged", gene)
        want = np.array([values[codes == k].mean() for k in range(len(levels))])
        np.testing.assert_allclose(z[:, j], want, rtol=1e-4, atol=1e-6, err_msg=gene)
        # the dots carry the same means, x = gene, y = group
        by_dot = {(x, y): c for x, y, c in zip(dots["x"], dots["y"], dots["color"])}
        np.testing.assert_allclose([by_dot[(j, k)] for k in range(len(levels))], want, rtol=1e-4, atol=1e-6, err_msg=gene)

    # the genes reached the route as features, whichever requests carried them
    asked = {f["name"] for c in calls if not c.get("estimate_only") for f in (c.get("features") or [])}
    assert asked == set(GENES), asked
