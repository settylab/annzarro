"""Resolving the declared keys over the layers that can set them.

The layer stack for a requester, highest first::

    user:<name>   a per-user override (scope "user")        stored by the access model
    overlay       the admin's settings (scope "server")     stored in overlay.json
    config        the operator's YAML                       read through Key.config_path
    default       Key.default

``override`` keys take the highest layer that sets them. ``restrict`` keys take
the most restrictive value among user, overlay and config, so a layer can
narrow what the one below allows and never widen it; the default only applies
when no layer sets the key. ``policy.locked`` in the YAML lists keys that only
the YAML (or the default) decides.

The stored layers (user, overlay) come from *sources*, callables the owner of
each store injects with :meth:`PolicyEngine.set_source`. A source returns the
stored ``{name: value}`` dict as it is, unknown names and bad values included:
this module ignores what it cannot use and reports it, and never drops it.
"""
import hashlib
import json
import logging
from dataclasses import dataclass
from typing import Any, Callable, Dict, Iterable, List, Mapping, Optional, Tuple

from .registry import REGISTRY, Key, Registry
from .types import PolicyValueError

logger = logging.getLogger(__name__)

USER, OVERLAY, CONFIG, DEFAULT, FORCED = "user", "overlay", "config", "default", "forced"
#: The layers a stored dict can come from, highest first
STORED_LAYERS = (USER, OVERLAY)
#: What the admin API calls the layer a value came from
SOURCE_NAMES = {USER: "user", OVERLAY: "admin", CONFIG: "config", DEFAULT: "default", FORCED: "forced"}
#: Layers a key of each scope may be set in
_SCOPE_LAYERS = {"config": (), "server": (OVERLAY,), "user": (USER, OVERLAY)}

UNKNOWN_KEY = "unknown_key"
LOCKED = "locked_by_config"
CONFIG_SCOPE = "config_scope"
SERVER_SCOPE = "server_scope"
#: Update errors that are a conflict (409), not a bad request (400)
CONFLICTS = (LOCKED, CONFIG_SCOPE, SERVER_SCOPE)


@dataclass(frozen=True)
class Issue:
    """A stored value the resolver ignored."""
    layer: str
    name: str
    value: Any
    reason: str          # unknown_key | bad_type | out_of_range | bad_choice | config_scope | server_scope | locked_by_config

    def as_dict(self) -> Dict[str, Any]:
        return {"layer": self.layer, "name": self.name, "value": self.value, "reason": self.reason}


@dataclass(frozen=True)
class Resolution:
    name: str
    value: Any
    source: str                  # "user" | "admin" | "config" | "default" | "forced"
    locked: bool = False
    config_value: Any = None     # what the YAML set, when it set the key
    has_config: bool = False


def config_lookup(config: Mapping, path: str) -> Tuple[bool, Any]:
    """``(found, value)`` for a dotted path in the configuration.

    Reads ``config_tree`` (the nested form the config manager keeps), then the
    flat form Flask holds. ``server.x`` is the flat key ``x``, as
    ``ConfigManager.to_flask_config`` flattens that section. ``None`` counts as
    not set."""
    for tree in (config.get("config_tree"), config):
        node: Any = tree
        for part in path.split("."):
            if not isinstance(node, Mapping) or part not in node:
                node = None
                break
            node = node[part]
        if node is not None:
            return True, node
    head, _, rest = path.partition(".")
    if head == "server" and rest and config.get(rest) is not None:
        return True, config[rest]
    return False, None


class PolicyEngine:
    """The resolver for one app: its configuration, its sources, the registry."""

    def __init__(self, config: Optional[Mapping] = None, registry: Optional[Registry] = None):
        self.config = config if config is not None else {}
        self.registry = registry if registry is not None else REGISTRY
        self._sources: Dict[str, Tuple[Callable, Optional[Callable]]] = {}
        self._defaults: Dict[str, Any] = {}
        found, locked = config_lookup(self.config, "policy.locked")
        self.locked = frozenset(str(n) for n in locked) if found and isinstance(locked, (list, tuple)) else frozenset()
        for name in sorted(self.locked - set(self.registry.keys)):
            logger.warning("policy.locked names %r, which is not a policy key", name)
        self._config_layer, self.config_issues = self._read_config()
        for issue in self.config_issues:
            logger.warning("Configuration %s is ignored: %s (%r)", self.registry.keys[issue.name].config_path,
                           issue.reason, issue.value)
        self._config_id = self._digest({"locked": sorted(self.locked),
                                        "config": {n: self._config_layer[n] for n in sorted(self._config_layer)},
                                        "keys": self.registry.names()})

    # -- sources -----------------------------------------------------------

    def set_source(self, layer: str, load: Callable[..., Mapping], stamp: Optional[Callable[[], str]] = None) -> None:
        """Inject the store of a layer.

        ``load()`` for the overlay and ``load(user)`` for the user layer return
        the stored ``{name: value}`` (``user`` is None when login is off).
        ``stamp()`` returns a string that changes whenever the store does (a
        stat stamp); it feeds :meth:`version`."""
        if layer not in STORED_LAYERS:
            raise ValueError(f"{layer!r} is not a stored layer ({', '.join(STORED_LAYERS)})")
        self._sources[layer] = (load, stamp)

    def stored(self, layer: str, user: Optional[str] = None) -> Dict[str, Any]:
        entry = self._sources.get(layer)
        if entry is None:
            return {}
        stored = entry[0](user) if layer == USER else entry[0]()
        return dict(stored or {})

    def version(self) -> str:
        """A token that changes whenever the configuration or a stored layer does."""
        stamps = [self._config_id]
        for layer in STORED_LAYERS:
            entry = self._sources.get(layer)
            stamps.append(str(entry[1]()) if entry and entry[1] else "")
        return self._digest(stamps)[:16]

    @staticmethod
    def _digest(obj) -> str:
        return hashlib.sha1(json.dumps(obj, sort_keys=True, default=str).encode()).hexdigest()

    # -- reading layers ----------------------------------------------------

    def _read_config(self) -> Tuple[Dict[str, Any], List[Issue]]:
        values, issues = {}, []
        for key in self.registry:
            if not key.config_path:
                continue
            found, raw = config_lookup(self.config, key.config_path)
            if not found:
                continue
            try:
                values[key.name] = key.type.validate(raw)
            except PolicyValueError as exc:
                issues.append(Issue(CONFIG, key.name, raw, exc.reason))
        return values, issues

    def default(self, key: Key) -> Any:
        if key.name not in self._defaults:
            self._defaults[key.name] = key.default_value(self.config)
        return self._defaults[key.name]

    def check_stored(self, layer: str, name: str, value: Any) -> Tuple[bool, Any, Optional[Issue]]:
        """``(usable, canonical value, issue)`` for one stored entry."""
        key = self.registry.get(name)
        if key is None:
            return False, None, Issue(layer, name, value, UNKNOWN_KEY)
        if layer not in _SCOPE_LAYERS[key.scope]:
            return False, None, Issue(layer, name, value, CONFIG_SCOPE if key.scope == "config" else SERVER_SCOPE)
        try:
            return True, key.type.validate(value), None
        except PolicyValueError as exc:
            return False, None, Issue(layer, name, value, exc.reason)

    def audit(self, layer: str, stored: Mapping[str, Any]) -> List[Issue]:
        """Every entry of a stored layer that resolution ignores: unknown names,
        values that fail their type, keys of another scope, and keys the YAML
        locks. The admin API lists the ``unknown_key`` ones under ``unknown``."""
        issues = []
        for name, value in stored.items():
            ok, _, issue = self.check_stored(layer, name, value)
            if not ok:
                issues.append(issue)
            elif name in self.locked:
                issues.append(Issue(layer, name, value, LOCKED))
        return issues

    # -- resolution --------------------------------------------------------

    def resolve_all(self, user: Optional[str] = None, names: Optional[Iterable[str]] = None) -> Dict[str, Resolution]:
        """Every key's :class:`Resolution` for ``user`` (None: login off or the
        server's own view). Constraints between keys apply over the result."""
        stored = {layer: self.stored(layer, user) for layer in STORED_LAYERS}
        out: Dict[str, Resolution] = {}
        for key in self.registry:
            out[key.name] = self._resolve_key(key, stored)
        out = self._constrain(out)
        if names is not None:
            wanted = set(names)
            out = {n: r for n, r in out.items() if n in wanted}
        return out

    def resolve(self, name: str, user: Optional[str] = None) -> Resolution:
        return self.resolve_all(user)[name]

    def effective(self, user: Optional[str] = None, keys: Optional[Iterable[str]] = None,
                  client_only: bool = False) -> Dict[str, Any]:
        """``{name: value}`` as ``user`` gets it."""
        resolved = self.resolve_all(user, keys)
        return {n: r.value for n, r in resolved.items() if not client_only or self.registry.keys[n].client}

    def _resolve_key(self, key: Key, stored: Mapping[str, Mapping[str, Any]]) -> Resolution:
        locked = key.name in self.locked
        candidates: List[Tuple[str, Any]] = []
        if not locked:
            for layer in STORED_LAYERS:
                if key.name in stored[layer]:
                    ok, value, _ = self.check_stored(layer, key.name, stored[layer][key.name])
                    if ok:
                        candidates.append((layer, value))
        if key.name in self._config_layer:
            candidates.append((CONFIG, self._config_layer[key.name]))
        config_value = self._config_layer.get(key.name)
        has_config = key.name in self._config_layer
        if not candidates:
            return Resolution(key.name, self.default(key), DEFAULT, locked, config_value, has_config)
        if key.combine == "override":
            layer, value = candidates[0]
        else:
            value = key.type.restrict([v for _, v in candidates])
            # the highest layer holding the result; an intersection no layer holds alone is credited to the highest
            layer = next((l for l, v in candidates if v == value), candidates[0][0])
        return Resolution(key.name, value, SOURCE_NAMES[layer], locked, config_value, has_config)

    def _constrain(self, resolved: Dict[str, Resolution]) -> Dict[str, Resolution]:
        for fn in self.registry.constraints:
            forced = fn({n: r.value for n, r in resolved.items()}) or {}
            for name, value in forced.items():
                key = self.registry.get(name)
                if key is None:
                    raise KeyError(f"a policy constraint forces {name!r}, which is not declared")
                value = key.type.validate(value)
                current = resolved[name]
                if current.value != value:
                    resolved[name] = Resolution(name, value, SOURCE_NAMES[FORCED], current.locked,
                                                current.config_value, current.has_config)
        return resolved

    # -- writing a layer ---------------------------------------------------

    def apply_update(self, layer: str, stored: Mapping[str, Any], changes: Mapping[str, Any]
                     ) -> Tuple[Dict[str, Any], Dict[str, str]]:
        """``(new stored dict, errors)`` for ``{name: value | None}`` applied to
        a layer's stored dict. ``None`` removes the entry, known or not.

        Everything else in ``stored`` is kept as it is, unknown names and bad
        values included. With any error nothing changes (the errors are
        ``{name: reason}``; :func:`status_for` says 400 or 409)."""
        errors: Dict[str, str] = {}
        new = dict(stored)
        for name, value in changes.items():
            if value is None:
                new.pop(name, None)
                continue
            key = self.registry.get(name)
            if key is None:
                errors[name] = UNKNOWN_KEY
            elif name in self.locked:
                errors[name] = LOCKED
            else:
                ok, canonical, issue = self.check_stored(layer, name, value)
                if ok:
                    new[name] = canonical
                else:
                    errors[name] = issue.reason
        return (dict(stored), errors) if errors else (new, errors)


def status_for(errors: Mapping[str, str]) -> int:
    """The HTTP status of an update's errors: 409 if any is a conflict, else 400."""
    return 409 if any(reason in CONFLICTS for reason in errors.values()) else 400
