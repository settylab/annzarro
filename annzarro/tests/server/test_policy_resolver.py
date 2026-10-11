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
    new, errors = e.apply_update("overlay", {}, {"outbound.mode": "off"})
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
    new, errors = e.apply_update("overlay", stored, {"panel.a.enabled": False})
    assert not errors
    assert new == {**stored, "panel.a.enabled": False}
    assert stored == {"panel.gone.enabled": False, "future.thing": {"a": 1}, "panel.a.size": "bad"}
    assert {i.name for i in e.audit("overlay", new) if i.reason == "unknown_key"} == {"panel.gone.enabled", "future.thing"}


def test_null_removes_known_and_unknown_entries():
    e = make_engine(registry())
    new, errors = e.apply_update("overlay", {"panel.a.size": 5, "old.key": 1, "keep.me": 2},
                                 {"panel.a.size": None, "old.key": None})
    assert not errors and new == {"keep.me": 2}


def test_update_reports_and_changes_nothing_on_error():
    e = make_engine(registry())
    stored = {"panel.a.size": 5}
    new, errors = e.apply_update("overlay", stored, {"panel.a.enabled": False, "nope.x": 1, "panel.a.size": 0,
                                                     "limits.n": 3})
    assert new == stored
    assert errors == {"nope.x": "unknown_key", "panel.a.size": "out_of_range", "limits.n": "config_scope"}
    assert status_for(errors) == 409 and status_for({"x": "bad_type"}) == 400


def test_update_canonicalises():
    e = make_engine(registry())
    new, _ = e.apply_update("user", {}, {"panel.a.services": ["z", "x"]})
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
