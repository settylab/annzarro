"""The settings behind stepping through the parts of a huge dataset: base.yaml,
schema.yaml and the browser's fallbacks (static/js/config.js) must say the same.

  ui.defaults.names_on_demand_above   5,000,000 cells: above it a part's cell names stay on the server
  ui.defaults.prefetch_next_part      auto: the next part is read ahead on a single-user server only
  server.name_index_max_mb            6144 MB for the name indices of the focus pickers' search
"""
import os
import re

import pytest

from annzarro.core import name_index
from annzarro.utils.config_manager import ConfigManager

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))


@pytest.fixture
def merged(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(ConfigManager, "SYSTEM_CONFIG_PATH", str(tmp_path / "none.yaml"))
    mgr = ConfigManager()
    return mgr, mgr.load_config(env="production")


def test_the_defaults_agree_between_base_and_schema(merged):
    mgr, config = merged
    schema = mgr._load_schema()
    ui = schema["ui"]["properties"]["defaults"]["properties"]
    assert config["ui"]["defaults"]["names_on_demand_above"] == ui["names_on_demand_above"]["default"] == 5_000_000
    assert config["ui"]["defaults"]["prefetch_next_part"] == ui["prefetch_next_part"]["default"] == "auto"
    server = schema["server"]["properties"]["name_index_max_mb"]["default"]
    assert config["server"]["name_index_max_mb"] == server == name_index.DEFAULT_MAX_MB == 6144


def test_the_browser_fallbacks_agree():
    with open(os.path.join(REPO, "static", "js", "config.js"), encoding="utf-8") as f:
        source = f.read()
    assert re.search(r"NAMES_ON_DEMAND_ABOVE: 5000000,", source)
    assert re.search(r"PREFETCH_NEXT_PART: 'auto',", source)
