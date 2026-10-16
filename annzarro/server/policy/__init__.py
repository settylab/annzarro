"""The policy registry: settings declared as keys, resolved over layers.

``declare(Key(...))`` next to the feature; ``requires(key)`` on a route that a
key gates; ``engine(app).effective(user)`` where a value is needed on the
server. The browser reads ``/api/v1/policy/effective``. See
docs/design/policy-registry.md.
"""
from .registry import AREAS, COMBINES, DECLARING_MODULES, REGISTRY, SCOPES, Key, Registry, declare, load_declarations
from .resolver import (CONFIG, DEFAULT, OVERLAY, USER, Issue, PolicyEngine, Resolution, config_lookup,
                       status_for)
from .routes import POLICY_HEADER, check_routes, engine, install, requester, requires
from .types import (BAD_CHOICE, BAD_TYPE, OUT_OF_RANGE, Bool, Enum, Float, Hosts, Int, Paths, PolicyType,
                    PolicyValueError, RemoteAccess, Subset)

__all__ = [
    "AREAS", "COMBINES", "DECLARING_MODULES", "REGISTRY", "load_declarations", "SCOPES", "Key", "Registry", "declare",
    "CONFIG", "DEFAULT", "OVERLAY", "USER", "Issue", "PolicyEngine", "Resolution", "config_lookup", "status_for",
    "POLICY_HEADER", "check_routes", "engine", "install", "requester", "requires",
    "BAD_CHOICE", "BAD_TYPE", "OUT_OF_RANGE", "Bool", "Enum", "Float", "Hosts", "Int", "Paths", "PolicyType",
    "PolicyValueError", "RemoteAccess", "Subset",
]
