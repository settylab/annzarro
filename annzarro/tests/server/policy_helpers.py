"""Shared builders for the policy tests: a registry with one key of every kind,
and engines over it."""
from annzarro.server.policy import (Bool, Enum, Float, Hosts, Int, Key, Paths, PolicyEngine, Registry, Subset)
from annzarro.server.policy.resolver import OVERLAY, USER


def set_path(tree, path, value):
    node = tree
    parts = path.split(".")
    for part in parts[:-1]:
        node = node.setdefault(part, {})
    node[parts[-1]] = value
    return tree


def make_engine(registry, config=None, locked=(), overlay=None, user=None):
    """An engine whose stored layers are the dicts given (mutable: change them
    after building and the engine sees it)."""
    config = dict(config or {})
    set_path(config, "policy.locked", list(locked))
    engine = PolicyEngine(config, registry)
    engine.overlay_store = {} if overlay is None else overlay
    engine.user_store = {} if user is None else user
    engine.set_source(OVERLAY, lambda: engine.overlay_store, stamp=lambda: repr(sorted(engine.overlay_store.items(), key=str)))
    engine.set_source(USER, lambda name: engine.user_store, stamp=lambda: repr(sorted(engine.user_store.items(), key=str)))
    return engine


def with_config(registry, key, value, **kwargs):
    """An engine whose config sets ``key`` (which needs a config_path) to ``value``."""
    config = set_path({}, key.config_path, value)
    return make_engine(registry, config=config, **kwargs)


CHOICES = [{"id": "a", "label": "A"}, {"id": "b", "label": "B", "host": "b.example.org"}, "c"]


def sample_registry() -> Registry:
    """One key for each type, scope and combine, each with a config_path."""
    registry = Registry()
    n = 0

    def add(type_, default, scope, combine, **kw):
        nonlocal n
        n += 1
        registry.declare(Key(name=f"sample.k{n}", type=type_, default=default, scope=scope, combine=combine,
                             description="sample", area="features", config_path=f"sample.k{n}", **kw))

    for scope in ("config", "server", "user"):
        for combine in ("override", "restrict"):
            add(Bool(), True, scope, combine)
            add(Bool(restrictive=True), False, scope, combine)
            add(Enum(CHOICES, off=["c"]), "a", scope, combine)
            add(Int(min=1, max=10), 5, scope, combine)
            add(Float(min=0), 2.5, scope, combine)
            add(Hosts(), ["example.org", "example.net"], scope, combine)
            add(Paths(), ["/srv/a", "/srv/b"], scope, combine)
            add(Subset(CHOICES), ["a", "b", "c"], scope, combine)
    return registry
