"""Declarations and value types of the policy registry."""
import os

import pytest

from annzarro.server.policy import (Bool, Enum, Float, Hosts, Int, Key, Paths, PolicyValueError, Registry, Subset)
from annzarro.server.policy.registry import REGISTRY


def reason(type_, value):
    with pytest.raises(PolicyValueError) as caught:
        type_.validate(value)
    return caught.value.reason


def test_bool():
    assert Bool().validate(True) is True
    for bad in (1, "true", None):
        assert reason(Bool(), bad) == "bad_type"
    assert Bool().restrict([True, False, True]) is False
    assert Bool(restrictive=True).restrict([False, True]) is True
    assert Bool().off == (False,) and Bool(restrictive=True).off == (True,)


def test_enum_restricts_towards_the_later_choice_and_knows_aliases():
    t = Enum(["on", "ask", "off", "none"], off=["none"], aliases={True: "on", False: "off", "yes": "on"})
    assert t.validate("ask") == "ask"
    assert t.validate(False) == "off" and t.validate(" YES ") == "on"
    assert reason(t, "maybe") == "bad_choice"
    assert reason(t, 3) == "bad_type"
    assert t.restrict(["ask", "none", "on"]) == "none"
    assert t.describe()["choices"] == ["on", "ask", "off", "none"]


def test_enum_choices_may_carry_labels():
    t = Enum([{"id": "x", "label": "X", "host": "x.org"}, "y"])
    assert t.ids == ["x", "y"]
    assert t.describe()["choices"][0]["host"] == "x.org"


@pytest.mark.parametrize("make,good,bad,why", [
    (lambda: Int(min=1, max=5), 3, 6, "out_of_range"),
    (lambda: Int(min=1), 1, 0, "out_of_range"),
    (lambda: Int(min=1), 2, 2.5, "bad_type"),
    (lambda: Float(min=0, max=1), 0.5, 1.5, "out_of_range"),
    (lambda: Float(), 1, float("nan"), "bad_type"),
    (lambda: Int(), 1, True, "bad_type"),
    (lambda: Float(), 1, "1", "bad_type"),
])
def test_numbers(make, good, bad, why):
    t = make()
    assert t.validate(good) == good
    assert reason(t, bad) == why


def test_integral_float_is_an_int_and_restriction_direction():
    assert Int().validate(3.0) == 3 and isinstance(Int().validate(3.0), int)
    assert Int().restrict([5, 2, 9]) == 2
    assert Int(restrictive="high").restrict([5, 2, 9]) == 9
    assert Int(min=1, max=5).describe() == {"kind": "int", "min": 1, "max": 5}


def test_lists():
    assert Hosts().validate([" Example.ORG ", "example.org", "a.b:8080"]) == ["example.org", "a.b:8080"]
    for bad in ("example.org", ["http://example.org"], ["a b"], [3]):
        assert reason(Hosts(), bad) == "bad_type"
    assert Paths().validate(["/srv/a", "/srv/a"]) == ["/srv/a"]
    assert reason(Paths(), [""]) == "bad_type"
    s = Subset(["a", "b", "c"])
    assert s.validate(["c", "a"]) == ["a", "c"]
    assert reason(s, ["z"]) == "bad_choice"
    assert s.restrict([["a", "b"], ["b", "c"]]) == ["b"]
    assert Hosts().restrict([["a.org", "b.org"], ["b.org"], ["b.org", "c.org"]]) == ["b.org"]


def test_key_validates_its_declaration():
    ok = dict(type=Bool(), default=True, scope="user", description="d", area="panels")
    Key(name="panel.x.enabled", **ok)
    for bad in ({"name": "Panel"}, {"name": "x"}, {"scope": "everyone"}, {"area": "misc"},
                {"combine": "max"}, {"default": "yes"}, {"restart": True}, {"type": "bool"},
                {"type": Int(), "default": 1, "routes": ("r",)}):
        with pytest.raises(ValueError):
            Key(**{"name": "panel.x.enabled", **ok, **bad})
    Key(name="panel.x.enabled", **{**ok, "scope": "config", "restart": True})


def test_declare_twice():
    registry = Registry()
    key = Key(name="panel.x.enabled", type=Bool(), default=True, scope="user", description="d", area="panels")
    registry.declare(key)
    registry.declare(key)
    with pytest.raises(ValueError):
        registry.declare(Key(name="panel.x.enabled", type=Bool(), default=False, scope="user",
                             description="d", area="panels"))


def test_default_callable_gets_the_config_and_is_validated():
    key = Key(name="panel.x.n", type=Int(min=1), default=lambda config: config["n"], scope="user",
              description="d", area="panels")
    assert key.default_value({"n": 4}) == 4
    with pytest.raises(PolicyValueError):
        key.default_value({"n": 0})


#: The exact contract of every ``limits.*`` key (docs design cost-limits-080.md). A key in none of these lists fails
#: the test below, so a new limit cannot become editable on the Settings page without being placed here.
ADMIN_EDITABLE_SERVER = {
    "name_search_timeout_s", "max_sessions_per_user", "max_sessions", "max_sessions_mb", "dataset_folder_max_entries",
    "dataset_search_max_depth", "dataset_search_max_entries", "dataset_details_check_budget_s",
    "dataset_scan_max_entries", "text_index_workers", "text_index_store_timeout_s", "text_index_max_stores",
    "text_index_readme_kb", "text_index_max_mb", "text_index_ttl_s",
}
ADMIN_EDITABLE_COSTS = {
    "ask_first_s", "refuse_s", "live_update_s", "progress_bar_s", "refresh_min_interval_large_s",
    "refresh_large_cells", "matrix_values", "genes_per_section", "groups",
    "partitionings", "request_partitionings", "measures", "thresholds", "grid_cells", "grid_2d_bins", "grid_2d_split",
    "grid_1d_bins", "grid_1d_split", "grid_categorical_levels", "grid_sets", "obsp_source_max_cells",
    "cell_export_max", "bars_3d_max", "dendrogram_rows", "density_points_draw", "density_points_load",
}
#: read when the server starts (gunicorn, the ledger, the read and subset budgets and their waits and shares)
READ_AT_START = {
    "compute_budget_mb", "group_code_cache_mb", "max_requests", "max_requests_jitter", "limit_request_line",
    "limit_request_fields", "limit_request_field_size", "max_request_mb", "read_user_share_percent", "subset_wait_s",
    "subset_budget_mb", "max_read_mb", "read_budget_mb", "read_wait_s",
}
#: read per request, but a parse bound rather than a cost: the YAML's alone
CONFIG_ONLY = {"name_search_max_regex_chars"}
#: Must not be configurable at all (cost-limits-080.md): no policy key, no setting, and the value the code relies on.
#: (module, name, value): uint16 codes and their ceilings, the measured read rates, parse and security caps, and the
#: algorithm versions and slab size.
FIXED = [
    ("annzarro.core.cell_groups", "NONE16", 0xFFFF),
    ("annzarro.core.binning", "MAX_CATEGORY_LEVELS", 0xFFFE),
    ("annzarro.core.gene_score", "RATES", {"csc": 30e6, "csr": 60e6, "dense": 200e6}),
    ("annzarro.core.gene_score", "REMOTE_RATE_FACTOR", 0.1),
    ("annzarro.core.gene_score", "BASE_SECONDS", 0.2),
    ("annzarro.server.routes.cell_groups", "MAX_BODY_BYTES", 16 << 20),
    ("annzarro.server.routes.gene_score", "MAX_BODY_BYTES", 16 << 20),
    ("annzarro.core.subset", "MAX_CONDITIONS", 16),
    ("annzarro.core.subset", "MAX_VALUES", 200),
    ("annzarro.core.subset", "MAX_SPEC_CHARS", 2000),
    ("annzarro.server.paste_focus", "MAX_PATTERN", 500),
    ("annzarro.server.paste_focus", "MAX_TEXT", 4096),
    ("annzarro.server.site", "FILE_MAX_BYTES", 256 * 1024),
    ("annzarro.server.admin.users", "MIN_PASSWORD", 10),
    ("annzarro.core.cell_groups", "MAX_NESTING", 4),
    ("annzarro.core.cell_sources", "SLAB_ROWS", 1 << 22),
    ("annzarro.core.cell_groups", "ALGORITHM_VERSION", 1),
    ("annzarro.core.cell_grid", "ALGORITHM_VERSION", 1),
    ("annzarro.core.group_features", "ALGORITHM_VERSION", 1),
    ("annzarro.core.gene_score", "ALGORITHM_VERSION", 1),
]


def test_every_limit_key_is_classified_and_only_the_listed_ones_are_the_admins():
    from annzarro.server.policy import load_declarations
    from annzarro.server.limits import LIMITS
    from annzarro.core.cost_limits import COST_LIMITS
    load_declarations()
    lists = (ADMIN_EDITABLE_SERVER, ADMIN_EDITABLE_COSTS, READ_AT_START, CONFIG_ONLY)
    assert sum(len(x) for x in lists) == len(set().union(*lists)), "a limit is in two lists"
    declared = {k.name[len("limits."):] for k in REGISTRY if k.name.startswith("limits.")}
    assert declared == set().union(*lists), f"unclassified: {sorted(declared - set().union(*lists))}"
    assert set(LIMITS) | {"max_read_mb", "read_budget_mb", "read_wait_s"} == \
        ADMIN_EDITABLE_SERVER | READ_AT_START | CONFIG_ONLY and set(COST_LIMITS) == ADMIN_EDITABLE_COSTS
    for name in sorted(declared):
        key = REGISTRY.get(f"limits.{name}")
        editable = name in ADMIN_EDITABLE_SERVER | ADMIN_EDITABLE_COSTS
        assert key.scope == ("server" if editable else "config"), name
        assert key.config_path == (f"limits.{name}" if name in COST_LIMITS else f"server.{name}"), name
        if name in COST_LIMITS:
            assert key.combine == "restrict" and key.client, f"{name}: the config file is its ceiling, the browser reads it"
        else:
            assert not key.client, name
    for name in sorted(READ_AT_START - {"subset_budget_mb", "max_read_mb", "read_budget_mb", "read_wait_s"}):
        assert REGISTRY.get(f"limits.{name}").restart, name
    assert REGISTRY.get("limits.max_requests").restart and not REGISTRY.get("limits.max_sessions").restart


@pytest.mark.parametrize("module, name, value", FIXED, ids=[f"{m.rsplit('.', 1)[1]}.{n}" for m, n, _ in FIXED])
def test_what_must_not_be_configurable_has_no_key_and_keeps_its_value(module, name, value):
    import importlib
    from annzarro.server.policy import load_declarations
    load_declarations()
    assert getattr(importlib.import_module(module), name) == value
    lowered = name.lower()
    assert not [k.name for k in REGISTRY if k.name.split(".")[-1] == lowered], f"{name} became a policy key"
    import yaml
    with open(os.path.join(os.path.dirname(importlib.import_module("annzarro").__file__), "config", "base.yaml")) as fh:
        base = yaml.safe_load(fh)
    assert lowered not in (base.get("server") or {}) and lowered not in (base.get("limits") or {})


def test_remote_stores_is_the_admins_to_narrow():
    from annzarro.server.policy import load_declarations
    load_declarations()
    # an administrator sets remote datasets under Data sources (it was read-only before that control existed)
    remote = REGISTRY.get("feature.remote_stores")
    assert (remote.scope, remote.combine, remote.section) == ("server", "restrict", "data")
