"""Declarations and value types of the policy registry."""
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


def test_limits_and_remote_stores_are_declared_read_only():
    from annzarro.server.policy import load_declarations
    from annzarro.server.limits import LIMITS
    load_declarations()
    for name in LIMITS:
        key = REGISTRY.get(f"limits.{name}")
        assert key is not None and key.scope == "config" and key.config_path == f"server.{name}"
    for name in ("max_read_mb", "read_budget_mb", "read_wait_s"):
        assert REGISTRY.get(f"limits.{name}").scope == "config"
    assert REGISTRY.get("limits.max_requests").restart and not REGISTRY.get("limits.max_sessions").restart
    assert REGISTRY.get("feature.remote_stores").scope == "config"
