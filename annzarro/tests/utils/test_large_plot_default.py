"""ui.defaults.large_plot_points is 1,000,000 by default (user decision,
2026-10-04, was 5,000,000): the regular Cell Plot costs 400-900 B of browser
heap per point, and at 1M several regular plots, each with hover, click and
table filters, fit side by side. base.yaml, schema.yaml and the browser's
fallbacks (static/js/config.js, large-plot.js, utils/subset-presets.js) must
say the same; a plot is large when its points exceed the value (1M itself is
regular), checked in annzarro/tests/js/large-plot.test.mjs."""
import os
import re

from annzarro.utils.config_manager import ConfigManager

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))


def test_large_plot_points_default_is_one_million(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(ConfigManager, "SYSTEM_CONFIG_PATH", str(tmp_path / "none.yaml"))
    for key in list(os.environ):
        if "LARGE_PLOT" in key:
            monkeypatch.delenv(key)
    mgr = ConfigManager()
    merged = mgr.load_config(env="production")["ui"]["defaults"]["large_plot_points"]
    schema = mgr._load_schema()["ui"]["properties"]["defaults"]["properties"]["large_plot_points"]["default"]
    assert merged == schema == 1_000_000


def test_browser_fallbacks_agree():
    def read(rel):
        with open(os.path.join(REPO, "static", "js", rel), encoding="utf-8") as f:
            return f.read()
    assert re.search(r"LARGE_PLOT_POINTS: 1000000,", read("config.js"))
    assert re.search(r"v >= 0 \? v : 1000000;", read("panels/plot-utilities/large-plot.js"))
    assert re.search(r"DEFAULT_LARGE_PLOT_POINTS = 1000000;", read("utils/subset-presets.js"))
