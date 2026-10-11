"""Policy keys: what can be set, and the registry that holds the declarations.

A key is declared once, in Python, next to the feature it governs::

    declare(Key(
        name="panel.gene-set.enabled",
        type=Bool(),
        default=True,
        scope="user",
        description="Whether the Gene Set Analysis panel may be used",
        area="panels",
        combine="restrict",
    ))

Storage, the HTTP API, the Settings page and the generated tests all work from
the registry, so a new setting needs no change to any of them. See
docs/design/policy-registry.md.
"""
import re
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Iterator, List, Optional, Tuple

from .types import PolicyType

#: Where a key can be set. ``config``: the YAML only (shown, not editable).
#: ``server``: also the admin's overlay. ``user``: also a per-user override.
SCOPES = ("config", "server", "user")
#: ``override``: the highest layer that sets the key wins. ``restrict``: the
#: most restrictive layer wins, so a layer can narrow what the one below allows
#: and never widen it.
COMBINES = ("override", "restrict")
#: The groups the Settings page shows. Add one here when a feature needs it.
AREAS = ("panels", "outbound", "data", "limits", "features")

_NAME = re.compile(r"^[a-z][a-z0-9_]*(\.[a-z0-9][a-z0-9_-]*)+$")


@dataclass(frozen=True)
class Key:
    name: str                       # "panel.gene-set.enabled": dotted, area first
    type: PolicyType                # Bool() | Enum(choices) | Int(min, max) | Float(min, max) | Hosts() | Paths() | Subset(choices)
    default: Any                    # or a callable(config) for a default derived from the configuration
    scope: str                      # one of SCOPES
    description: str
    area: str                       # one of AREAS
    combine: str = "override"       # one of COMBINES
    #: hosts this key lets the browser contact at a given value: callable(value, config) -> [host]
    outbound_hosts: Optional[Callable[[Any, dict], List[str]]] = None
    #: keys whose "off" value (``type.off``) shuts this key's outbound hosts: the hosts a layer of
    #: ``services`` lets through are of no use when ``external_requests`` is off
    gated_by: Tuple[str, ...] = ()
    #: endpoints (Flask endpoint names) this key gates; ``requires(name)`` on each is checked by check_routes
    routes: Tuple[str, ...] = ()
    #: where the YAML keeps it, "integrations.external_requests"
    config_path: Optional[str] = None
    client: bool = True             # included in /api/v1/policy/effective
    restart: bool = False           # takes effect only after a restart; implies scope "config"

    def __post_init__(self):
        if not _NAME.match(self.name):
            raise ValueError(f"policy key name {self.name!r}: expected dotted lower-case words, e.g. panel.gene-set.enabled")
        if not isinstance(self.type, PolicyType):
            raise ValueError(f"{self.name}: type must be a PolicyType instance")
        for field_name, allowed in (("scope", SCOPES), ("combine", COMBINES), ("area", AREAS)):
            if getattr(self, field_name) not in allowed:
                raise ValueError(f"{self.name}: {field_name} {getattr(self, field_name)!r} is not one of {', '.join(allowed)}")
        if self.restart and self.scope != "config":
            raise ValueError(f"{self.name}: restart implies scope 'config'")
        if self.routes and not self.type.off:
            raise ValueError(f"{self.name}: a {self.type.kind} key has no 'off' value, so it cannot gate routes")
        if not callable(self.default):
            self.type.validate(self.default)

    def default_value(self, config: Optional[dict] = None) -> Any:
        value = self.default(config or {}) if callable(self.default) else self.default
        return self.type.validate(value)

    def describe(self) -> Dict[str, Any]:
        """What the Settings page needs of the declaration (not the value)."""
        return {"name": self.name, "type": self.type.describe(), "scope": self.scope, "area": self.area,
                "description": self.description, "combine": self.combine, "restart": self.restart,
                "routes": list(self.routes), "config_path": self.config_path}


@dataclass
class Registry:
    """The declared keys, plus constraints between them. ``REGISTRY`` is the
    server's; tests build their own."""

    keys: Dict[str, Key] = field(default_factory=dict)
    constraints: List[Callable[[Dict[str, Any]], Dict[str, Any]]] = field(default_factory=list)

    def declare(self, key: Key) -> Key:
        existing = self.keys.get(key.name)
        if existing is not None and existing != key:
            raise ValueError(f"policy key {key.name!r} is already declared differently")
        self.keys[key.name] = key
        return key

    def constrain(self, fn: Callable[[Dict[str, Any]], Dict[str, Any]]) -> Callable:
        """Register a rule between keys: ``fn(values)`` gets the resolved values
        and returns the ones to force (``{name: value}``), e.g. every outbound key
        to its no-outbound value when ``outbound.allow_external`` is false."""
        if fn not in self.constraints:
            self.constraints.append(fn)
        return fn

    def get(self, name: str) -> Optional[Key]:
        return self.keys.get(name)

    def __contains__(self, name) -> bool:
        return name in self.keys

    def __iter__(self) -> Iterator[Key]:
        return iter(sorted(self.keys.values(), key=lambda k: k.name))

    def names(self) -> List[str]:
        return sorted(self.keys)

    def with_outbound_hosts(self) -> List[Key]:
        return [k for k in self if k.outbound_hosts is not None]


REGISTRY = Registry()

#: Modules that declare keys when imported; ``load_declarations`` imports them,
#: so a registry is complete wherever it is built. Add yours here.
DECLARING_MODULES = ("annzarro.server.limits", "annzarro.core.remote", "annzarro.server.policy.panels")


def load_declarations() -> None:
    import importlib
    for module in DECLARING_MODULES:
        importlib.import_module(module)


def declare(key: Key, registry: Optional[Registry] = None) -> Key:
    """Declare ``key`` (at import time of the module that owns the feature)."""
    return (registry or REGISTRY).declare(key)
