"""Tests generated over every declared policy key, with no per-key code.

A key declared anywhere (``REGISTRY`` after ``load_declarations``) is covered
for its default, its type, the layers it can be set in, restriction, locks,
unknown-key preservation and the routes it names. ``sample_registry`` adds one
key of every type, scope and combine, so the mechanism is covered as well as
the declarations.

Outbound hosts and the CSP: ``test_policy_csp.py`` (slice P1) turns the hook at
the end into the per-key CSP test.
"""
import itertools
import os

import pytest

from annzarro.server.policy import REGISTRY, Bool, Key, check_routes, config_lookup, load_declarations
from annzarro.server.policy.resolver import CONFIG, OVERLAY, USER, SOURCE_NAMES
from annzarro.tests.server.policy_helpers import make_engine, sample_registry, set_path

load_declarations()
SAMPLE = sample_registry()
CASES = [pytest.param(registry, key, id=f"{label}:{key.name}")
         for label, registry in (("registry", REGISTRY), ("sample", SAMPLE)) for key in registry]
SETTABLE = [c for c in CASES if c.values[1].scope != "config"]
PAIRED = [c for c in CASES if c.values[1].type.samples() is not None]
RESTRICT = [c for c in PAIRED if c.values[1].combine == "restrict"]
OVERRIDE = [c for c in PAIRED if c.values[1].combine == "override"]
CONFIGURED = [c for c in PAIRED if c.values[1].config_path]

#: no declared type accepts a dict
BAD = {"not": "a value"}


def layers_of(key):
    """The layers a key can be set in, highest first."""
    layers = {"config": [], "server": [OVERLAY], "user": [USER, OVERLAY]}[key.scope]
    return layers + ([CONFIG] if key.config_path else [])


def build(registry, key, values, locked=()):
    """An engine where ``values`` is {layer: value}."""
    config = set_path({}, key.config_path, values[CONFIG]) if CONFIG in values else {}
    engine = make_engine(registry, config=config, locked=locked)
    if OVERLAY in values:
        engine.overlay_store[key.name] = values[OVERLAY]
    if USER in values:
        engine.user_store[key.name] = values[USER]
    return engine


@pytest.mark.parametrize("registry,key", CASES)
def test_default_is_valid_and_is_the_value_with_nothing_set(registry, key):
    engine = make_engine(registry)
    default = key.default_value(engine.config)
    assert key.type.validate(default) == default
    resolved = engine.resolve(key.name)
    assert (resolved.value, resolved.source, resolved.locked) == (default, "default", False)


@pytest.mark.parametrize("registry,key", CASES)
def test_a_description_and_a_describe_for_the_settings_page(registry, key):
    assert key.description.strip()
    described = key.describe()
    assert described["type"]["kind"] == key.type.kind and described["name"] == key.name


@pytest.mark.parametrize("registry,key", SETTABLE)
def test_a_value_of_the_wrong_type_in_a_stored_layer_is_ignored_and_flagged(registry, key):
    default = make_engine(registry).resolve(key.name).value
    for layer in layers_of(key):
        if layer == CONFIG:
            continue
        engine = build(registry, key, {layer: BAD})
        assert engine.resolve(key.name).value == default
        issues = engine.audit(layer, {key.name: BAD})
        assert [(i.name, i.reason) for i in issues] == [(key.name, "bad_type")]
        assert engine.stored(layer)[key.name] == BAD            # flagged, not dropped


@pytest.mark.parametrize("registry,key", CASES)
def test_a_stored_layer_the_scope_does_not_allow_is_ignored(registry, key):
    pair = key.type.samples()
    if pair is None:
        pytest.skip("one value only")
    permissive, restrictive = pair
    default = make_engine(registry).resolve(key.name).value
    value = restrictive if default == permissive else permissive
    for layer in (USER, OVERLAY):
        if layer in layers_of(key):
            continue
        engine = build(registry, key, {layer: value})
        assert engine.resolve(key.name).value == default
        assert [i.reason for i in engine.audit(layer, {key.name: value})] == [
            "config_scope" if key.scope == "config" else "server_scope"]


@pytest.mark.parametrize("registry,key", [c for c in OVERRIDE])
def test_override_keys_take_the_highest_layer_that_sets_them(registry, key):
    permissive, restrictive = key.type.samples()
    layers = layers_of(key)
    for high, low in itertools.combinations(layers, 2):
        for a, b in ((permissive, restrictive), (restrictive, permissive)):
            resolved = build(registry, key, {high: a, low: b}).resolve(key.name)
            assert (resolved.value, resolved.source) == (a, SOURCE_NAMES[high]), (high, low)


@pytest.mark.parametrize("registry,key", RESTRICT)
def test_restrict_keys_narrow_and_never_widen(registry, key):
    permissive, restrictive = key.type.samples()
    layers = layers_of(key)
    for high, low in itertools.permutations(layers, 2):
        resolved = build(registry, key, {high: permissive, low: restrictive}).resolve(key.name)
        assert resolved.value == restrictive, (high, low)
        assert key.type.validate(resolved.value) == resolved.value


@pytest.mark.parametrize("registry,key", [c for c in RESTRICT if c.values[1].config_path])
def test_a_config_value_is_a_ceiling_for_the_admin(registry, key):
    permissive, restrictive = key.type.samples()
    for layer in (USER, OVERLAY):
        if layer in layers_of(key):
            engine = build(registry, key, {CONFIG: restrictive, layer: permissive})
            assert engine.resolve(key.name).value == restrictive


@pytest.mark.parametrize("registry,key", CONFIGURED)
def test_a_config_value_beats_the_default(registry, key):
    permissive, restrictive = key.type.samples()
    default = make_engine(registry).resolve(key.name).value
    value = restrictive if default == permissive else permissive
    resolved = build(registry, key, {CONFIG: value}).resolve(key.name)
    assert (resolved.value, resolved.source, resolved.has_config) == (value, "config", True)


@pytest.mark.parametrize("registry,key", [c for c in PAIRED if c.values[1].scope != "config"])
def test_locks_block_the_overlay_and_the_user_layer(registry, key):
    permissive, restrictive = key.type.samples()
    default = make_engine(registry, config=set_path({}, key.config_path, permissive) if key.config_path else {}
                          ).resolve(key.name).value
    for layer in (USER, OVERLAY):
        if layer not in layers_of(key):
            continue
        values = {layer: restrictive if default == permissive else permissive}
        if key.config_path:
            values[CONFIG] = permissive
        locked = build(registry, key, values, locked=[key.name])
        resolved = locked.resolve(key.name)
        assert resolved.locked and resolved.value == default, layer
        _, errors, _ = locked.apply_update(layer, {}, {key.name: restrictive})
        assert errors == {key.name: "locked_by_config"}
        assert [i.reason for i in locked.audit(layer, {key.name: values[layer]})] == ["locked_by_config"]


@pytest.mark.parametrize("registry,key", CASES)
def test_unknown_stored_keys_survive_a_write_of_this_key(registry, key):
    stored = {"retired.setting.x": {"kept": [1, 2]}, "other.unknown": "v"}
    pair = key.type.samples()
    engine = make_engine(registry)
    layer = (layers_of(key) or [OVERLAY])[0] if key.scope != "config" else OVERLAY
    if key.scope == "config" or pair is None:
        new, errors, _ = engine.apply_update(layer, stored, {key.name: None})
        assert not errors and new == stored
        return
    new, errors, _ = engine.apply_update(layer, stored, {key.name: pair[1]})
    assert not errors
    assert {k: new[k] for k in stored} == stored and new[key.name] == pair[1]
    again, errors, _ = engine.apply_update(layer, new, {key.name: None})
    assert not errors and again == stored
    assert {i.name for i in engine.audit(layer, again) if i.reason == "unknown_key"} == set(stored)


@pytest.mark.parametrize("registry,key", [c for c in CASES if c.values[1].scope == "config"])
def test_a_config_scope_key_cannot_be_written(registry, key):
    pair = key.type.samples()
    if pair is None:
        pytest.skip("one value only")
    _, errors, _ = make_engine(registry).apply_update(OVERLAY, {}, {key.name: pair[0]})
    assert errors == {key.name: "config_scope"}


@pytest.mark.parametrize("registry,key", SETTABLE)
def test_invalid_values_are_refused_on_write(registry, key):
    _, errors, _ = make_engine(registry).apply_update(layers_of(key)[0], {}, {key.name: BAD})
    assert errors == {key.name: "bad_type"}


@pytest.mark.parametrize("label,registry", [("registry", REGISTRY), ("sample", SAMPLE)])
def test_effective_has_exactly_the_client_keys(label, registry):
    engine = make_engine(registry)
    assert set(engine.effective(client_only=True)) == {k.name for k in registry if k.client}
    assert set(engine.effective()) == set(registry.names())


def test_routes_and_requires_agree_on_the_server_app(tmp_path):
    from annzarro.server.core import create_app
    (tmp_path / "data").mkdir()
    app = create_app({"TESTING": True, "host": "127.0.0.1", "data_dir": str(tmp_path / "data"),
                      "log_file": str(tmp_path / "t.log")})
    assert check_routes(app) == []


@pytest.mark.parametrize("key", [k for k in REGISTRY if k.routes])
def test_every_route_a_key_names_exists(key, tmp_path):
    from annzarro.server.core import create_app
    (tmp_path / "data").mkdir()
    app = create_app({"TESTING": True, "host": "127.0.0.1", "data_dir": str(tmp_path / "data"),
                      "log_file": str(tmp_path / "t.log")})
    assert all(endpoint in app.view_functions for endpoint in key.routes)


@pytest.mark.parametrize("key", [k for k in REGISTRY if k.config_path], ids=lambda k: k.name)
def test_a_declared_default_equals_the_value_base_yaml_ships(key):
    """The shipped YAML is not the operator's, so its value is the key's default
    (config_lookup ignores it). They cannot drift apart."""
    import os
    import yaml
    import annzarro
    with open(os.path.join(os.path.dirname(annzarro.__file__), "config", "base.yaml")) as fh:
        found, shipped = config_lookup(yaml.safe_load(fh), key.config_path)
    if not found:
        pytest.skip("base.yaml does not set it")
    assert key.default_value({}) == key.type.validate(shipped)


@pytest.mark.parametrize("registry,key", [c for c in RESTRICT if c.values[1].scope != "config" and c.values[1].config_path])
def test_a_write_wider_than_the_operators_config_is_refused_or_reported_capped(registry, key):
    permissive, restrictive = key.type.samples()
    engine = build(registry, key, {CONFIG: restrictive})
    if OVERLAY in layers_of(key):
        assert engine.apply_update(OVERLAY, {}, {key.name: permissive}).errors == {key.name: "config_ceiling"}
        assert engine.apply_update(OVERLAY, {}, {key.name: restrictive}).errors == {}
    if USER in layers_of(key):
        update = engine.apply_update(USER, {}, {key.name: permissive})
        assert not update.errors and update.stored == {key.name: permissive} and update.capped == {key.name: restrictive}


@pytest.mark.parametrize("registry,key", [c for c in PAIRED if c.values[1].scope != "config"])
def test_layers_and_inherited_describe_the_stack(registry, key):
    permissive, restrictive = key.type.samples()
    layer = layers_of(key)[0]
    if layer == CONFIG:
        pytest.skip("no stored layer")
    nothing = build(registry, key, {}).resolve(key.name)
    assert nothing.inherited == {} and set(nothing.layers) == {"default"}
    default = nothing.value
    value = restrictive if default == permissive else permissive
    resolved = build(registry, key, {layer: value}).resolve(key.name)
    assert resolved.layers[SOURCE_NAMES[layer]] == value and resolved.layers["default"] == default
    # clearing the layer gives back exactly what an engine without it resolves
    assert resolved.inherited == {SOURCE_NAMES[layer]: default}


def outbound_coverage_gaps(keys, tests_dir):
    """Why the CSP test does not cover ``keys`` (those with ``outbound_hosts``); empty when it does.

    Slice P1 provides ``annzarro/server/policy/csp.py`` with ``csp_hosts(engine, user)`` and
    ``test_policy_csp.py``, which must parametrize over ``REGISTRY.with_outbound_hosts()``."""
    if not keys:
        return []
    gaps = []
    try:
        import importlib
        if not hasattr(importlib.import_module("annzarro.server.policy.csp"), "csp_hosts"):
            gaps.append("annzarro.server.policy.csp has no csp_hosts(engine, user)")
    except ImportError:
        gaps.append("annzarro.server.policy.csp does not exist")
    csp_test = os.path.join(tests_dir, "test_policy_csp.py")
    if not os.path.exists(csp_test):
        gaps.append("tests/server/test_policy_csp.py does not exist")
    else:
        with open(csp_test) as fh:
            if "with_outbound_hosts" not in fh.read():
                gaps.append("test_policy_csp.py does not parametrize over REGISTRY.with_outbound_hosts()")
    return [f"{', '.join(k.name for k in keys)} have outbound_hosts, but {gap}" for gap in gaps]


def test_every_outbound_key_is_covered_by_the_csp_test():
    assert outbound_coverage_gaps(REGISTRY.with_outbound_hosts(), os.path.dirname(__file__)) == []


def test_the_csp_coverage_guard_goes_red_without_a_csp_test(tmp_path):
    outbound = [k for k in SAMPLE_OUTBOUND]
    gaps = outbound_coverage_gaps(outbound, str(tmp_path))
    assert any("test_policy_csp.py does not exist" in g for g in gaps)
    (tmp_path / "test_policy_csp.py").write_text("def test_x(): pass\n")
    assert any("does not parametrize" in g for g in outbound_coverage_gaps(outbound, str(tmp_path)))
    assert outbound_coverage_gaps([], str(tmp_path)) == []


SAMPLE_OUTBOUND = [Key(name="outbound.sample.host", type=Bool(), default=True, scope="user", description="d",
                       area="outbound", combine="restrict", outbound_hosts=lambda value, config: ["x.example.org"])]
