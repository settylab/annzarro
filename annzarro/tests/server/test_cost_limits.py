"""The cost limits (``limits:`` in the config file, ``limits.*`` on the Settings page; annzarro/core/cost_limits.py).

One table holds every limit: base.yaml, schema.yaml and the docs say the same; a value out of bounds or out of
order stops the server; a lowered value makes the server refuse at it and name it; the admin's change applies at
once and a reset gives the default back; the browser reads what the server enforces.
"""
import json
import os

import numpy as np
import pytest
import yaml

from annzarro.core import cost_limits as cl
from annzarro.core import subset as cell_subset
from annzarro.core import zarr_reader
from annzarro.server.core import create_app
from annzarro.server.routes import cell_groups as route
from annzarro.tests.core import grouping_store as gstore
from annzarro.tests.server.admin_helpers import ADMIN, USER, login, make_app, unsafe_headers

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
GROUPS = "/api/v1/data/cell_groups"
SCORE = "/api/v1/data/gene_score"
POLICY = "/api/v1/admin/policy"
CELL_TYPE = {"source": {"type": "obs", "key": "cell_type"}}            # 6 levels
SAMPLE = {"source": {"type": "obs", "key": "sample"}}
GENE1 = {"source": {"type": "layer", "key": "logged", "column": gstore.gene(1)}}


def _yaml(name):
    with open(os.path.join(ROOT, "annzarro", "config", name)) as fh:
        return yaml.safe_load(fh)


# -- one table -----------------------------------------------------------------------------------------------------

@pytest.mark.parametrize("name", sorted(cl.COST_LIMITS))
def test_every_limit_ships_its_default_and_bounds_in_base_and_schema(name):
    c = cl.COST_LIMITS[name]
    assert _yaml("base.yaml")["limits"][name] == c.default
    schema = _yaml("schema.yaml")["limits"]["properties"][name]
    assert (schema["default"], schema["minimum"], schema["maximum"]) == (c.default, c.minimum, c.maximum)
    assert schema["type"] == ("integer" if c.integer else "number")
    assert c.minimum <= c.default <= c.maximum


@pytest.mark.parametrize("name", sorted(cl.COST_LIMITS))
def test_every_limit_has_its_row_in_the_resource_limits_guide_and_the_configuration_reference(name):
    with open(os.path.join(ROOT, "docs", "deployment", "resource-limits.md"), encoding="utf-8") as fh:
        text = fh.read()
    assert f"`{name}`{{#cost-{name.replace('_', '-')}}}" in text
    with open(os.path.join(ROOT, "docs", "reference", "configuration.md"), encoding="utf-8") as fh:
        reference = fh.read()
    section = reference[reference.index("## `limits`"):reference.index("## `policy`")]
    c = cl.COST_LIMITS[name]
    default = f"{c.default:,}" if c.integer else f"{c.default:g}"
    assert f"| `{name}` | {default} |" in section


def test_the_settings_page_orders_the_headings_the_server_sends():
    import re
    from annzarro.server.limits import SERVER_SUBGROUP
    with open(os.path.join(ROOT, "static", "js", "admin", "policy-widgets.js"), encoding="utf-8") as fh:
        text = fh.read()
    listed = re.search(r"const SUBGROUP_ORDER = \[([^\]]*)\]", text).group(1)
    assert re.findall(r"'([^']+)'", listed) == [*cl.GROUPS.values(), SERVER_SUBGROUP]


def test_the_defaults_keep_the_order_and_the_grid_defaults_are_the_engines():
    from annzarro.core import cell_grid, cell_groups, gene_score, group_features
    assert cl.check(cl.defaults()) == []
    assert cell_grid.grid_limits() == cell_grid.GRID_LIMITS
    assert cell_groups.grouping_limits() == cell_groups.GROUPING_LIMITS
    assert gene_score.tier_limits() == {"live_max_s": 5.0, "auto_max_s": 60.0, "max_s": 600.0}
    assert group_features.grid_cells() == group_features.MAX_GRID_MEASURE_CELLS == 512 * 512 * 8
    assert group_features.feature_cells() == 400_000


@pytest.mark.parametrize("name", sorted(cl.COST_LIMITS))
def test_a_value_outside_the_bounds_or_of_the_wrong_kind_is_refused(name):
    c = cl.COST_LIMITS[name]
    for bad in (c.minimum - 1, c.maximum + 1, True, "many", None):
        assert cl.check({name: bad}), f"{name}={bad!r} passed"
    if c.integer:
        assert cl.check({name: c.default + 0.5})
    assert cl.check({name: c.default}) == [] and cl.check({name: c.maximum}) == []


@pytest.mark.parametrize("values", [
    {"ask_first_s": 30, "refuse_s": 20},
    {"live_update_s": 10, "ask_first_s": 8},
    {"refuse_s": 40},                                            # below the default ask_first_s (60)
    {"partitionings": 9, "request_partitionings": 8},
])
def test_the_tiers_out_of_order_are_refused(values):
    errors = cl.check(values)
    assert errors and all("above" in e for e in errors), errors


def test_an_unknown_limit_is_refused():
    assert cl.check({"gropus": 3}) == ["Unknown setting limits.gropus"]


def test_ordered_lowers_the_looser_tier_to_the_stricter():
    out = cl.ordered({**cl.defaults(), "refuse_s": 20, "partitionings": 30, "request_partitionings": 4})
    assert (out["refuse_s"], out["ask_first_s"], out["live_update_s"]) == (20, 20, 5)
    assert out["partitionings"] == 4
    out = cl.ordered({**cl.defaults(), "ask_first_s": 2})
    assert (out["live_update_s"], out["ask_first_s"], out["refuse_s"]) == (2, 2, 600)


@pytest.mark.parametrize("limits, word", [
    ({"groups": 1}, "limits.groups"),
    ({"ask_first_s": 120, "refuse_s": 90}, "limits.ask_first_s"),
    ({"bars_3d_max": "lots"}, "limits.bars_3d_max"),
    ("groups: 3", "limits"),
])
def test_the_server_does_not_start_with_a_bad_limit(tmp_path, limits, word):
    with pytest.raises(ValueError, match=word):
        create_app({"TESTING": True, "data_dir": str(tmp_path), "log_file": str(tmp_path / "t.log"), "limits": limits})


def test_config_validate_reports_a_limit_out_of_order(tmp_path, monkeypatch):
    from annzarro.utils.config_manager import ConfigManager
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(ConfigManager, "SYSTEM_CONFIG_PATH", str(tmp_path / "none.yaml"))
    path = tmp_path / "site.yaml"
    path.write_text("limits:\n  live_update_s: 90\n")
    mgr = ConfigManager()
    mgr.load_config(env="production", config_path=str(path))
    ok, errors = mgr.validate_config()
    assert not ok and any("limits.live_update_s" in e for e in errors), errors


def test_a_file_with_only_a_limits_section_is_read_as_one(tmp_path, monkeypatch):
    from annzarro.utils.config_manager import ConfigManager
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(ConfigManager, "SYSTEM_CONFIG_PATH", str(tmp_path / "none.yaml"))
    path = tmp_path / "site.yaml"
    path.write_text("limits:\n  groups: 300\n")
    mgr = ConfigManager()
    mgr.load_config(env="production", config_path=str(path))
    flask = mgr.to_flask_config()
    assert flask["config_tree"]["limits"]["groups"] == 300 and "groups" not in flask


# -- the server refuses at a lowered limit, and names it ------------------------------------------------------------

@pytest.fixture(scope="module")
def layout(tmp_path_factory):
    base = tmp_path_factory.mktemp("costs")
    (base / "data").mkdir()
    gstore.make_store(base / "data" / "in.zarr", "csc", "zarr")
    return base


@pytest.fixture(autouse=True)
def fresh():
    zarr_reader.clear_cache()
    cell_subset.clear()
    route.CODES.clear()
    yield
    zarr_reader.clear_cache()
    cell_subset.clear()
    route.CODES.clear()


def client_with(layout, tmp_path, **limits):
    app = create_app({"TESTING": True, "data_dir": str(layout / "data"), "log_file": str(tmp_path / "t.log"),
                      **({"limits": limits} if limits else {})})
    return app.test_client()


def post(client, layout, body, url=GROUPS):
    return client.post(url, query_string={"dataset_path": str(layout / "data" / "in.zarr")}, data=json.dumps(body),
                       content_type="application/json")


def last_frame(resp):
    assert resp.status_code == 200, resp.get_data(as_text=True)
    data = resp.get_data()
    frames, pos = [], 0
    while pos < len(data):
        end = data.index(b"\n", pos)
        frame = json.loads(data[pos:end])
        frames.append(frame)
        pos = end + 1
        if frame["type"] == "result":
            break
    return frames[-1]


def grouping(parts, **kw):
    return {"shape": "grouping", "partitionings": parts, **kw}


def genes(n):
    return [{"id": f"f{i}", "kind": "gene", "name": gstore.gene(i), "layer": "logged"} for i in range(n)]


def refusal(resp):
    """``(reason, limit)`` of a refusal, before the stream or in its result frame."""
    if resp.status_code == 200:
        refused = last_frame(resp)["refused"]
        return refused["reason"], refused["limit"]
    body = resp.get_json()
    return body["reason"], body.get("limit")


#: (limits, request, the reason, the limit it names): each passes at the default
LOWERED = [
    ({"groups": 3}, grouping([CELL_TYPE]), "too_many_levels", 3),
    ({"groups": 40}, grouping([SAMPLE, CELL_TYPE]), "too_many_groups", 40),     # 30 samples x 6 types
    ({"matrix_values": 17}, grouping([CELL_TYPE], features=genes(3)), "too_many_values", 17),
    ({"partitionings": 1}, grouping([CELL_TYPE, SAMPLE]), "too_many_partitionings", 1),
    ({"request_partitionings": 1, "partitionings": 1},                # one per grouping, two counted in all
     grouping([{"source": {"type": "cell-group", "key": "g", "recipe": {"partitionings": [CELL_TYPE]}}}]),
     "too_many_partitionings", 1),
    ({"measures": 1}, grouping([CELL_TYPE], measures=[{"id": "a", "source": {"type": "obs", "key": "depth"}},
                                                      {"id": "b", "source": {"type": "obs", "key": "score"}}]),
     "too_many_measures", 1),
    ({"thresholds": 1}, grouping([CELL_TYPE], features=[{**genes(1)[0], "detect_above": 0.5},
                                                         {**genes(1)[0], "id": "g", "detect_above": 1.5}]),
     "too_many_thresholds", 1),
    ({"grid_cells": 100}, {"shape": "grid", "mode": "2d", "partitionings": [
        {"source": {"type": "obs", "key": "score"}, "binning": {"method": "equal_width", "bins": 20}},
        {"source": {"type": "obs", "key": "depth"}, "binning": {"method": "equal_width", "bins": 20}}]},
     "grid_too_large", 100),
    ({"grid_sets": 2}, {"shape": "grid", "mode": "sets", "partitionings": [
        {"source": {"type": "obs", "key": k}, "member": {"op": ">", "value": 0.5}} for k in ("score", "depth",
                                                                                               "pseudotime")]},
     "too_many_sets", 2),
    ({"grid_categorical_levels": 4}, {"shape": "grid", "mode": "categorical", "partitionings": [CELL_TYPE]},
     "too_many_levels", 4),
    ({"obsp_source_max_cells": gstore.N_OBS - 1},
     grouping([{"source": {"type": "obsp", "key": "connectivities", "column": "5"}}]), "obsp_too_large",
     gstore.N_OBS - 1),
]


@pytest.mark.parametrize("limits, body, reason, limit", LOWERED, ids=[next(iter(c[0])) for c in LOWERED])
def test_a_lowered_limit_is_refused_with_the_new_value_in_the_refusal(layout, tmp_path, limits, body, reason, limit):
    default = post(client_with(layout, tmp_path), layout, body)
    assert default.status_code == 200 and "refused" not in last_frame(default), default.get_data(as_text=True)[:400]
    assert refusal(post(client_with(layout, tmp_path, **limits), layout, body)) == (reason, limit)


def test_the_estimate_reports_the_tiers_in_force_and_the_server_keeps_to_them(layout, tmp_path):
    body = grouping([GENE1])
    est = post(client_with(layout, tmp_path), layout, {**body, "estimate_only": True}).get_json()["estimate"]
    assert (est["live_max_s"], est["auto_max_s"], est["max_s"], est["tier"]) == (5, 60, 600, "auto")
    client = client_with(layout, tmp_path, live_update_s=0, ask_first_s=0)
    est = post(client, layout, {**body, "estimate_only": True}).get_json()["estimate"]
    assert (est["live_max_s"], est["auto_max_s"], est["tier"], est["lane"]) == (0, 0, "confirm", "heavy")
    resp = post(client, layout, body)
    assert resp.status_code == 409 and resp.get_json()["reason"] == "confirmation_required"
    assert post(client, layout, {**body, "confirm": True}).status_code == 200
    client = client_with(layout, tmp_path, live_update_s=0, ask_first_s=0, refuse_s=0)
    for extra in ({}, {"confirm": True}):
        resp = post(client, layout, {**body, **extra})
        assert resp.status_code == 413 and resp.get_json()["reason"] == "groups_too_expensive"
        assert resp.get_json()["estimate"]["max_s"] == 0 and "the limit is 0 seconds" in resp.get_json()["error"]
    resp = post(client, layout, {"recipe": {"genes": [gstore.gene(1), gstore.gene(2)]}}, url=SCORE)
    assert resp.status_code == 413 and resp.get_json()["reason"] == "score_too_expensive"


def test_a_grouping_cached_under_a_higher_limit_is_not_served_under_a_lower(layout, tmp_path):
    """The code cache is the worker's; a grouping it holds from before the admin lowered the limit is refused."""
    body = grouping([CELL_TYPE])
    assert "refused" not in last_frame(post(client_with(layout, tmp_path), layout, body))
    assert refusal(post(client_with(layout, tmp_path, groups=3), layout, body)) == ("too_many_levels", 3)


# -- the admin's change applies at once; a reset gives the default back ----------------------------------------------

@pytest.fixture
def admin_app(tmp_path):
    app = make_app(tmp_path)
    gstore.make_store(tmp_path / "data" / "in.zarr", "csc", "zarr")
    return app


def put(client, body):
    return client.put(POLICY, data=json.dumps(body), headers=unsafe_headers(client))


def keys_of(reply):
    return {k["name"]: k for k in reply.get_json()["keys"]}


def test_an_admin_lowers_a_limit_the_server_refuses_at_it_and_a_reset_restores_the_default(admin_app, tmp_path):
    admin, user = login(admin_app, ADMIN), login(admin_app, USER)
    path = tmp_path / "data" / "in.zarr"
    body = grouping([CELL_TYPE])

    def ask():
        return user.post(GROUPS, query_string={"dataset_path": str(path)}, data=json.dumps(body),
                         content_type="application/json", headers=unsafe_headers(user))

    assert "refused" not in last_frame(ask())
    key = keys_of(admin.get(POLICY))["limits.groups"]
    assert (key["value"], key["default"], key["source"], key["scope"]) == (2000, 2000, "default", "server")
    assert key["type"] == {"kind": "int", "min": 2, "max": 20000}
    assert put(admin, {"limits.groups": 3}).status_code == 200
    assert refusal(ask()) == ("too_many_levels", 3)
    values = user.get("/api/v1/policy/effective").get_json()["values"]
    assert values["limits.groups"] == 3 and values["limits.matrix_values"] == 400_000
    reply = put(admin, {"limits.groups": None})
    assert reply.status_code == 200
    key = keys_of(reply)["limits.groups"]
    assert (key["value"], key["source"]) == (2000, "default")
    assert "refused" not in last_frame(ask())
    assert user.get("/api/v1/policy/effective").get_json()["values"]["limits.groups"] == 2000


@pytest.mark.parametrize("change, name", [
    ({"limits.ask_first_s": 30, "limits.refuse_s": 20}, "limits.ask_first_s"),
    ({"limits.refuse_s": 30}, "limits.refuse_s"),                    # below the default ask_first_s
    ({"limits.live_update_s": 50, "limits.ask_first_s": 40}, "limits.live_update_s"),
    ({"limits.partitionings": 10, "limits.request_partitionings": 9}, "limits.partitionings"),
])
def test_an_admin_change_out_of_order_is_refused_and_nothing_is_written(admin_app, change, name):
    admin = login(admin_app, ADMIN)
    reply = put(admin, change)
    assert reply.status_code == 400, reply.get_json()
    out = reply.get_json()
    assert out["errors"] == {name: "out_of_order"} and name in out["error"]
    assert "live_update_s <= ask_first_s <= refuse_s" in out["error"] or "partitionings" in name
    keys = keys_of(admin.get(POLICY))
    assert all(keys[n]["source"] == "default" for n in change)


def test_an_admin_change_in_order_with_its_partner_lowered_too_is_taken(admin_app):
    admin = login(admin_app, ADMIN)
    assert put(admin, {"limits.ask_first_s": 10, "limits.refuse_s": 20, "limits.live_update_s": 1}).status_code == 200
    values = login(admin_app, USER).get("/api/v1/policy/effective").get_json()["values"]
    assert (values["limits.live_update_s"], values["limits.ask_first_s"], values["limits.refuse_s"]) == (1, 10, 20)


def test_a_value_of_the_config_file_is_a_ceiling_the_admin_can_lower(tmp_path):
    app = make_app(tmp_path, limits={"groups": 100})
    admin = login(app, ADMIN)
    key = keys_of(admin.get(POLICY))["limits.groups"]
    assert (key["value"], key["source"]) == (100, "config")
    reply = put(admin, {"limits.groups": 200})
    assert reply.status_code == 409 and reply.get_json()["errors"] == {"limits.groups": "config_ceiling"}
    assert put(admin, {"limits.groups": 50}).status_code == 200
    assert keys_of(admin.get(POLICY))["limits.groups"]["value"] == 50


def test_tiers_out_of_order_in_the_stored_layers_resolve_to_the_stricter():
    """An overlay the Settings page would refuse (edited by hand, or written before the file changed) never makes
    the server ask first above where it refuses: the stricter tier wins, marked forced."""
    from annzarro.server.policy import REGISTRY, load_declarations
    from annzarro.tests.server.policy_helpers import make_engine
    load_declarations()
    eng = make_engine(REGISTRY, config={"limits": {"refuse_s": 300}},
                      overlay={"limits.ask_first_s": 400, "limits.partitionings": 9, "limits.request_partitionings": 3})
    got = eng.resolve_all(None)
    assert (got["limits.ask_first_s"].value, got["limits.ask_first_s"].source) == (300, "forced")
    assert (got["limits.partitionings"].value, got["limits.partitionings"].source) == (3, "forced")
    eng.overlay_store["limits.live_update_s"] = 40
    eng.overlay_store["limits.ask_first_s"] = 20
    got = eng.resolve_all(None)
    assert (got["limits.live_update_s"].value, got["limits.live_update_s"].source) == (20, "forced")


def test_a_live_server_limit_changes_without_a_restart_and_a_start_one_stays_read_only(admin_app):
    admin = login(admin_app, ADMIN)
    keys = keys_of(admin.get(POLICY))
    assert keys["limits.dataset_folder_max_entries"]["scope"] == "server"
    assert keys["limits.compute_budget_mb"]["scope"] == "config" and keys["limits.compute_budget_mb"]["restart"]
    assert keys["limits.subset_wait_s"]["restart"] and keys["limits.read_user_share_percent"]["restart"]
    assert put(admin, {"limits.dataset_folder_max_entries": 7}).status_code == 200
    admin.get(POLICY)                                              # the next request applies it
    assert admin_app.config["dataset_folder_max_entries"] == 7
    reply = put(admin, {"limits.compute_budget_mb": 100})
    assert reply.status_code == 409 and reply.get_json()["errors"] == {"limits.compute_budget_mb": "config_scope"}
    assert put(admin, {"limits.dataset_folder_max_entries": None}).status_code == 200
    admin.get(POLICY)
    assert admin_app.config["dataset_folder_max_entries"] == 500


def test_a_lowered_name_search_limit_reaches_the_name_search(admin_app):
    from annzarro.core import name_index
    admin = login(admin_app, ADMIN)
    assert put(admin, {"limits.name_search_timeout_s": 3}).status_code == 200
    admin.get(POLICY)
    assert name_index._timeout_s == 3
    assert put(admin, {"limits.name_search_timeout_s": None}).status_code == 200
    admin.get(POLICY)
    assert name_index._timeout_s == 10
    # the longest pattern is a parse bound, not a cost: the config file's alone
    reply = put(admin, {"limits.name_search_max_regex_chars": 7})
    assert reply.status_code == 409 and reply.get_json()["errors"] == {"limits.name_search_max_regex_chars": "config_scope"}


def test_every_cost_limit_is_served_to_the_browser_and_no_other_limit_is(tmp_path):
    client = client_with_data(tmp_path)
    values = client.get("/api/v1/policy/effective").get_json()["values"]
    served = {k: v for k, v in values.items() if k.startswith("limits.")}
    assert served == {f"limits.{n}": c.default for n, c in cl.COST_LIMITS.items()}


def client_with_data(tmp_path):
    (tmp_path / "data").mkdir(exist_ok=True)
    return create_app({"TESTING": True, "data_dir": str(tmp_path / "data"),
                       "log_file": str(tmp_path / "t.log")}).test_client()


def test_a_request_sets_the_limits_of_its_app_and_code_outside_a_request_has_the_defaults(layout, tmp_path):
    client = client_with(layout, tmp_path, groups=3)
    post(client, layout, grouping([CELL_TYPE]))
    assert cl.get("groups") == 3                                    # the thread that served the request
    cl.use(None)
    assert cl.get("groups") == 2000 and cl.snapshot() == cl.defaults()
    with cl.override(groups=5):
        assert cl.get("groups") == 5
    assert cl.get("groups") == 2000


def test_the_grid_measure_charge_grows_with_the_grid_cell_limit(layout, tmp_path):
    from annzarro.core import cell_grid, get_reader
    reader = get_reader(str(layout / "data" / "in.zarr"))
    body = {"shape": "grid", "mode": "1d", "partitionings": [
        {"source": {"type": "obs", "key": "score"}, "binning": {"method": "equal_width", "bins": 10}}],
        "measures": [{"id": "m", "source": {"type": "obs", "key": "depth"}}]}
    plan = cell_grid.plan(reader, str(layout / "data" / "in.zarr"), cell_grid.parse_request(body))
    base, _ = route.reservation(plan, gstore.N_OBS)
    with cl.override(grid_cells=cl.COST_LIMITS["grid_cells"].default * 4):
        raised, _ = route.reservation(plan, gstore.N_OBS)
    with cl.override(grid_cells=100):
        lowered, _ = route.reservation(plan, gstore.N_OBS)
    assert raised - base == 3 * route._GRID_MEASURE_AT_LIMIT and lowered == base
    assert np.isfinite(base)


# -- the browser's copy of the defaults -----------------------------------------------------------------------------

def test_the_browsers_defaults_are_written_from_the_table():
    """static/js/limits-defaults.json is what `python -m annzarro.core.cost_limits` writes; a stale copy fails here."""
    with open(os.path.join(ROOT, cl.BROWSER_DEFAULTS), encoding="utf-8") as fh:
        assert fh.read() == cl.browser_defaults_text(), "run: python -m annzarro.core.cost_limits"


def test_the_browser_reads_every_limit_through_limits_js_and_keeps_no_copy():
    """The numbers the browser used to hold of its own are gone: each is read from utils/limits.js."""
    js = os.path.join(ROOT, "static", "js")
    gone = {
        "utils/cell-gene-model.js": ("MATRIX_CELLS_MAX", "GENES_PER_SECTION_MAX = "),
        "panels/cell-gene/sections.js": ("GENES_PER_SECTION_MAX = ",),
        "utils/cell-grouping.js": ("partitionings: 8", "levels: 2000"),
        "utils/count-plot-model.js": ("GRID_CELLS_MAX", "512 * 512 * 8", "bins: 2000", "levels: 200,"),
        "utils/set-plot-model.js": ("SETS_MAX = 16",),
        "panels/cell-grouping/cell-export.js": ("CELL_EXPORT_LIMIT",),
        "utils/derived-sources.js": ("LIVE_MAX_S = ",),
        "utils/bars-3d.js": ("BARS_3D_MAX = 40000",),
        "utils/source-notices.js": ("BAR_AFTER_S = 10",),
        "panels/cell-count/density-points.js": ("1_000_000", "25_000_000"),
        "panels/cell-count/density-points-load.js": ("import { DENSITY_POINTS_DRAW", "DENSITY_POINTS_LOAD, sampleIndices"),
        "config.js": ("DENSITY_POINTS_DRAW: 1000000", "DENSITY_POINTS_LOAD: 25000000"),
    }
    for path, words in gone.items():
        with open(os.path.join(js, path), encoding="utf-8") as fh:
            text = fh.read()
        assert "limits.js" in text, f"{path} does not read utils/limits.js"
        for word in words:
            assert word not in text, f"{path} still holds {word!r}"
