"""Layer resolution, locks, constraints, updates and the version token."""
import pytest

from annzarro.server.policy import Bool, Enum, Hosts, Int, Key, Registry, Subset, status_for
from annzarro.tests.server.policy_helpers import make_engine, set_path


def registry():
    r = Registry()
    r.declare(Key(name="panel.a.enabled", type=Bool(), default=True, scope="user", combine="restrict",
                  description="d", area="panels"))
    r.declare(Key(name="panel.a.size", type=Int(min=1, max=100), default=10, scope="user",
                  description="d", area="panels", config_path="panels.a.size"))
    r.declare(Key(name="outbound.mode", type=Enum(["on", "ask", "off", "none"]), default="ask", scope="user",
                  combine="restrict", description="d", area="outbound", config_path="integrations.external_requests"))
    r.declare(Key(name="panel.a.services", type=Subset(["x", "y", "z"]), default=["x", "y"], scope="user",
                  combine="restrict", description="d", area="panels"))
    r.declare(Key(name="limits.n", type=Int(min=1), default=7, scope="config", description="d", area="limits",
                  config_path="server.n"))
    r.declare(Key(name="data.srv", type=Bool(), default=False, scope="server", description="d", area="data"))
    return r


def test_override_follows_the_stated_precedence():
    e = make_engine(registry(), config={"panels": {"a": {"size": 20}}})
    assert e.resolve("panel.a.size").value == 20 and e.resolve("panel.a.size").source == "config"
    e.overlay_store["panel.a.size"] = 30
    assert (e.resolve("panel.a.size").value, e.resolve("panel.a.size").source) == (30, "admin")
    e.user_store["panel.a.size"] = 40
    assert (e.resolve("panel.a.size").value, e.resolve("panel.a.size").source) == (40, "user")
    assert make_engine(registry()).resolve("panel.a.size").source == "default"


def test_restrict_narrows_and_never_widens():
    e = make_engine(registry(), config={"integrations": {"external_requests": "off"}})
    e.overlay_store["outbound.mode"] = "on"            # tries to widen the YAML
    assert e.resolve("outbound.mode").value == "off" and e.resolve("outbound.mode").source == "config"
    e.user_store["outbound.mode"] = "none"
    assert (e.resolve("outbound.mode").value, e.resolve("outbound.mode").source) == ("none", "user")


def test_restrict_may_widen_a_default_but_not_the_config():
    e = make_engine(registry())
    e.overlay_store["outbound.mode"] = "on"
    assert e.resolve("outbound.mode").value == "on"    # the default was "ask"
    e.overlay_store["panel.a.services"] = ["x", "y", "z"]
    assert e.resolve("panel.a.services").value == ["x", "y", "z"]


def test_subsets_intersect_across_layers():
    e = make_engine(registry())
    e.overlay_store["panel.a.services"] = ["x", "y"]
    e.user_store["panel.a.services"] = ["y", "z"]
    r = e.resolve("panel.a.services")
    assert (r.value, r.source) == (["y"], "user")     # no layer holds it alone: credited to the highest


def test_scope_limits_the_layers():
    e = make_engine(registry(), config={"server": {"n": 3}})
    e.overlay_store["limits.n"] = 99
    e.user_store["data.srv"] = True                    # server scope: not for users
    assert e.resolve("limits.n").value == 3
    assert e.resolve("data.srv").value is False
    assert {i.reason for i in e.audit("overlay", e.overlay_store)} == {"config_scope"}
    assert {i.reason for i in e.audit("user", e.user_store)} == {"server_scope"}


def test_locked_keys_ignore_the_stored_layers():
    e = make_engine(registry(), config={"integrations": {"external_requests": "ask"}},
                    locked=["outbound.mode", "panel.a.size"])
    e.overlay_store.update({"outbound.mode": "none", "panel.a.size": 50})
    e.user_store.update({"panel.a.size": 60})
    assert e.resolve("outbound.mode").value == "ask" and e.resolve("outbound.mode").locked
    assert e.resolve("panel.a.size").value == 10 and e.resolve("panel.a.size").locked   # the default
    assert not e.resolve("panel.a.enabled").locked
    assert {i.reason for i in e.audit("overlay", e.overlay_store)} == {"locked_by_config"}
    new, errors, _ = e.apply_update("overlay", {}, {"outbound.mode": "off"})
    assert errors == {"outbound.mode": "locked_by_config"} and status_for(errors) == 409


def test_a_bad_stored_value_falls_through_to_the_next_layer():
    e = make_engine(registry(), config={"panels": {"a": {"size": 20}}})
    e.overlay_store["panel.a.size"] = "big"
    e.user_store["panel.a.size"] = 1000
    assert e.resolve("panel.a.size").value == 20
    assert {(i.name, i.reason) for i in e.audit("overlay", e.overlay_store)} == {("panel.a.size", "bad_type")}
    assert {(i.name, i.reason) for i in e.audit("user", e.user_store)} == {("panel.a.size", "out_of_range")}


def test_a_bad_config_value_is_ignored_and_reported():
    e = make_engine(registry(), config={"integrations": {"external_requests": "sometimes"}})
    assert e.resolve("outbound.mode").value == "ask"
    assert [(i.name, i.reason) for i in e.config_issues] == [("outbound.mode", "bad_choice")]


def test_config_lookup_reads_the_tree_and_the_flat_server_keys():
    e = make_engine(registry(), config={"config_tree": {"server": {"n": 4}}})
    assert e.resolve("limits.n").value == 4
    from annzarro.server.policy import PolicyEngine
    assert PolicyEngine({"n": 5}, registry()).resolve("limits.n").value == 5
    assert PolicyEngine({"n": None}, registry()).resolve("limits.n").value == 7


def test_unknown_keys_survive_updates():
    e = make_engine(registry())
    stored = {"panel.gone.enabled": False, "future.thing": {"a": 1}, "panel.a.size": "bad"}
    new, errors, _ = e.apply_update("overlay", stored, {"panel.a.enabled": False})
    assert not errors
    assert new == {**stored, "panel.a.enabled": False}
    assert stored == {"panel.gone.enabled": False, "future.thing": {"a": 1}, "panel.a.size": "bad"}
    assert {i.name for i in e.audit("overlay", new) if i.reason == "unknown_key"} == {"panel.gone.enabled", "future.thing"}


def test_null_removes_known_and_unknown_entries():
    e = make_engine(registry())
    new, errors, _ = e.apply_update("overlay", {"panel.a.size": 5, "old.key": 1, "keep.me": 2},
                                 {"panel.a.size": None, "old.key": None})
    assert not errors and new == {"keep.me": 2}


def test_update_reports_and_changes_nothing_on_error():
    e = make_engine(registry())
    stored = {"panel.a.size": 5}
    new, errors, _ = e.apply_update("overlay", stored, {"panel.a.enabled": False, "nope.x": 1, "panel.a.size": 0,
                                                     "limits.n": 3})
    assert new == stored
    assert errors == {"nope.x": "unknown_key", "panel.a.size": "out_of_range", "limits.n": "config_scope"}
    assert status_for(errors) == 409 and status_for({"x": "bad_type"}) == 400


def test_update_canonicalises():
    e = make_engine(registry())
    new, _, _ = e.apply_update("user", {}, {"panel.a.services": ["z", "x"]})
    assert new == {"panel.a.services": ["x", "z"]}


def test_constraints_force_values():
    r = registry()
    r.constrain(lambda values: {"outbound.mode": "none"} if values["panel.a.enabled"] is False else {})
    e = make_engine(r)
    assert e.resolve("outbound.mode").value == "ask"
    e.overlay_store["panel.a.enabled"] = False
    forced = e.resolve("outbound.mode")
    assert (forced.value, forced.source) == ("none", "forced")
    bad = registry()
    bad.constrain(lambda values: {"nope.x": 1})
    with pytest.raises(KeyError):
        make_engine(bad).resolve_all()


def test_callable_default_sees_the_config():
    r = Registry()
    r.declare(Key(name="data.hosted", type=Bool(), default=lambda c: bool(c.get("hosted")), scope="user",
                  description="d", area="data"))
    from annzarro.server.policy import PolicyEngine
    assert PolicyEngine({"hosted": True}, r).resolve("data.hosted").value is True
    assert PolicyEngine({}, r).resolve("data.hosted").value is False


def test_version_changes_with_every_layer():
    e = make_engine(registry())
    seen = {e.version()}
    e.overlay_store["panel.a.size"] = 5
    seen.add(e.version())
    e.user_store["panel.a.size"] = 6
    seen.add(e.version())
    assert len(seen) == 3
    assert e.version() == e.version()
    a = make_engine(registry(), config={"panels": {"a": {"size": 20}}})
    b = make_engine(registry(), config={"panels": {"a": {"size": 21}}})
    c = make_engine(registry(), locked=["panel.a.size"])
    assert len({a.version(), b.version(), c.version(), make_engine(registry()).version()}) == 4


def test_a_source_must_be_a_stored_layer():
    with pytest.raises(ValueError):
        make_engine(registry()).set_source("config", lambda: {})


# -- what counts as the operator's configuration ------------------------------

def origin_engine(origin, value="ask"):
    config = {"config_tree": {"integrations": {"external_requests": value}},
              "config_origins": {"integrations.external_requests": origin}}
    return make_engine(registry(), config=config)


def test_the_packages_own_defaults_are_not_the_operators_ceiling():
    e = origin_engine("defaults:base")
    e.overlay_store["outbound.mode"] = "on"
    r = e.resolve("outbound.mode")
    assert (r.value, r.source, r.has_config) == ("on", "admin", False)
    assert origin_engine("defaults:production").resolve("outbound.mode").source == "default"


@pytest.mark.parametrize("origin", ["system", "user", "project", "--config", "env:ANNZARRO_X", "cli:--x"])
def test_anything_the_operator_set_is_the_ceiling(origin):
    e = origin_engine(origin)
    e.overlay_store["outbound.mode"] = "on"
    r = e.resolve("outbound.mode")
    assert (r.value, r.source, r.has_config) == ("ask", "config", True)


def test_the_origin_of_a_parent_key_counts():
    config = {"config_tree": {"integrations": {"external_requests": "off"}},
              "config_origins": {"integrations": "defaults:base"}}
    assert make_engine(registry(), config=config).resolve("outbound.mode").source == "default"


def test_the_config_manager_exports_where_each_key_came_from(tmp_path):
    from annzarro.utils.config_manager import ConfigManager
    manager = ConfigManager()
    path = tmp_path / "site.yaml"
    path.write_text("integrations:\n  external_requests: 'off'\n")
    manager.load_config(config_path=str(path))
    flask_config = manager.to_flask_config()
    origins = flask_config["config_origins"]
    assert origins["integrations.external_requests"] == "--config"
    assert origins["server.max_sessions"].startswith("defaults:")
    from annzarro.server.policy import config_lookup
    assert config_lookup(flask_config, "integrations.external_requests") == (True, "off")
    assert config_lookup(flask_config, "server.max_sessions") == (False, None)       # shipped, not chosen


# -- writes against the ceiling ------------------------------------------------

def test_an_overlay_write_wider_than_the_config_is_a_conflict():
    e = make_engine(registry(), config={"integrations": {"external_requests": "off"}})
    stored, errors, capped = e.apply_update("overlay", {}, {"outbound.mode": "on"})
    assert errors == {"outbound.mode": "config_ceiling"} and status_for(errors) == 409 and stored == {}
    assert e.apply_update("overlay", {}, {"outbound.mode": "none"}).stored == {"outbound.mode": "none"}
    assert e.apply_update("overlay", {}, {"outbound.mode": "off"}).errors == {}


def test_a_user_write_wider_than_the_overlay_is_kept_and_reported_capped():
    e = make_engine(registry())
    e.overlay_store["outbound.mode"] = "off"
    stored, errors, capped = e.apply_update("user", {}, {"outbound.mode": "on", "panel.a.size": 3})
    assert not errors and stored["outbound.mode"] == "on" and capped == {"outbound.mode": "off"}
    e.user_store.update(stored)
    assert e.resolve("outbound.mode").value == "off"
    assert e.apply_update("user", {}, {"outbound.mode": "none"}).capped == {}


def test_a_default_may_be_widened_by_the_overlay():
    assert make_engine(registry()).apply_update("overlay", {}, {"outbound.mode": "on"}).errors == {}


# -- layers and inherited -------------------------------------------------------

def test_resolution_reports_each_layer_and_what_clearing_one_would_give():
    e = make_engine(registry(), config={"integrations": {"external_requests": "ask"}})
    e.overlay_store["outbound.mode"] = "off"
    e.user_store["outbound.mode"] = "none"
    r = e.resolve("outbound.mode")
    assert r.layers == {"user": "none", "admin": "off", "config": "ask", "default": "ask"}
    assert r.inherited == {"user": "off", "admin": "none"}
    e.user_store.clear()
    r = e.resolve("outbound.mode")
    assert r.inherited == {"admin": "ask"} and r.value == "off"
    e.overlay_store.clear()
    r = e.resolve("outbound.mode")
    assert r.inherited == {} and r.layers == {"config": "ask", "default": "ask"}


def test_inherited_for_an_override_key():
    e = make_engine(registry(), config={"panels": {"a": {"size": 20}}})
    e.overlay_store["panel.a.size"] = 30
    e.user_store["panel.a.size"] = 40
    r = e.resolve("panel.a.size")
    assert r.inherited == {"user": 30, "admin": 40} and r.layers["default"] == 10


def test_locked_keys_show_no_stored_layers():
    e = make_engine(registry(), locked=["panel.a.size"])
    e.overlay_store["panel.a.size"] = 30
    r = e.resolve("panel.a.size")
    assert r.layers == {"default": 10} and r.inherited == {}


# -- constraints -----------------------------------------------------------------

def test_a_constraint_may_not_widen_or_force_an_override_key(caplog):
    r = registry()
    r.constrain(lambda values: {"outbound.mode": "on", "panel.a.size": 99})
    e = make_engine(r)
    e.overlay_store["outbound.mode"] = "off"
    resolved = e.resolve_all()
    assert resolved["outbound.mode"].value == "off" and resolved["panel.a.size"].value == 10
    assert "ignored" in caplog.text


def test_constraints_run_until_nothing_changes():
    r = registry()
    # registered in the wrong order: the second one's output is the first one's input
    r.constrain(lambda values: {"panel.a.enabled": False} if values["outbound.mode"] == "none" else {})
    r.constrain(lambda values: {"outbound.mode": "none"} if values["panel.a.services"] == [] else {})
    e = make_engine(r)
    e.overlay_store["panel.a.services"] = []
    resolved = e.resolve_all()
    assert resolved["outbound.mode"].value == "none" and resolved["panel.a.enabled"].value is False
