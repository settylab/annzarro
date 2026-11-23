"""F7: reserved panel types have no policy switch, every other type has one; the two compute settings exist with their defaults."""
import json
import os

import yaml

from annzarro.server.core import DEFAULT_CONFIG
from annzarro.server.limits import LIMITS, validate_limits
from annzarro.server.policy import REGISTRY, load_declarations
from annzarro.server.policy.panels import panel_types

load_declarations()
CONFIG = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "config")


def test_reserved_types_have_no_switch_and_the_new_types_have_one():
    entries = panel_types()
    unreleased = {e["type"] for e in entries if e.get("released") is False or e.get("reserved")}
    assert unreleased == {"gene-count", "group-stat"}
    for t in ("cell-grouping", "cell-gene", "cell-count"):
        assert REGISTRY.get(f"panel.{t}.enabled") is not None, t
    for t in unreleased:
        assert REGISTRY.get(f"panel.{t}.enabled") is None, t
    released = {e["type"] for e in entries} - unreleased
    assert {k.name for k in REGISTRY if k.name.startswith("panel.") and k.name.endswith(".enabled")} == \
        {f"panel.{t}.enabled" for t in released}


def test_the_compute_settings_have_their_defaults():
    assert LIMITS["compute_budget_mb"].default == 4608 and LIMITS["group_code_cache_mb"].default == 512
    assert DEFAULT_CONFIG["compute_budget_mb"] == 4608 and DEFAULT_CONFIG["group_code_cache_mb"] == 512
    for key in ("compute_budget_mb", "group_code_cache_mb"):
        assert validate_limits({key: 1}) == [] and validate_limits({key: 0}) and validate_limits({key: "lots"})
        with open(os.path.join(CONFIG, "schema.yaml")) as fh:
            prop = yaml.safe_load(fh)["server"]["properties"][key]
        assert prop["minimum"] == 1 and prop["description"]
