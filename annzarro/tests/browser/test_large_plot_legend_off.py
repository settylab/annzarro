"""Large-plot mode honours Show Legend off (it drew the legend whatever the setting said), with columns saved."""
import base64
import json
import urllib.parse

import pytest

from annzarro.tests.browser.test_large_plot_subset_roundtrip import STORE, server, GD, playwright  # noqa: F401
from annzarro.tests.browser.test_large_plot_legend_hidden import page, READY  # noqa: F401


def _link(root, **extra):
    plot = {"id": "cell-plot-a", "title": "A", "pointSize": 12, "pointOpacity": 1,
            "x": {"type": "obsm", "key": "X_umap", "column": "0"},
            "y": {"type": "obsm", "key": "X_umap", "column": "1"},
            "color": {"type": "obs", "key": "cell_type", "column": ""}, **extra}
    view = {"v": 1, "subset": None,
            "layout": {"v": 1, "hierarchy": [{"type": "tile", "id": "cell-plot-a", "controlsVisible": True}],
                       "controlState": {"cell-plot-a": True}, "panelConfigs": {"cell-plot-a": plot}}}
    enc = base64.urlsafe_b64encode(json.dumps(view, separators=(",", ":")).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(STORE, safe='/')}#view={enc}"


LEGENDS = "() => document.querySelector('%s').querySelectorAll('g.legend g.traces, g.legend2 g.traces').length" % GD


@pytest.mark.parametrize("columns", [None, 2])
def test_large_plot_with_the_legend_off_has_no_legend(page, server, columns):
    extra = {"showLegend": False}
    if columns:
        extra["legendColumns"] = columns
    page.goto(_link(server, **extra))
    page.wait_for_function(READY, timeout=60000)
    page.wait_for_timeout(2500)
    assert page.evaluate(LEGENDS) == 0
    assert page.evaluate("() => document.querySelector('%s').layout.showlegend" % GD) is False
    assert page.evaluate("() => !document.querySelector('%s').layout.legend2" % GD)
