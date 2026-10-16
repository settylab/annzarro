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
import os
from dataclasses import dataclass, field, replace
from typing import Any, Callable, Dict, Iterable, List, Mapping, NamedTuple, Optional, Tuple

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
_PASSES = 5
CONFIG_CEILING = "config_ceiling"
CONFLICTS = (LOCKED, CONFIG_SCOPE, SERVER_SCOPE, CONFIG_CEILING)


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
    source: str                  # "user" | "admin" | "env" | "config" | "default" | "forced"
    locked: bool = False
    config_value: Any = None     # what the YAML set, when it set the key
    has_config: bool = False
    #: the value of each layer that set the key and counted ("user", "admin", "config"), plus "default"
    layers: Dict[str, Any] = field(default_factory=dict)
    #: for each stored layer that set the key ("user", "admin"), the value that would apply were
    #: that layer cleared: what "reset to inherited" returns to
    inherited: Dict[str, Any] = field(default_factory=dict)


def _walk(tree: Any, path: str) -> Tuple[bool, Any]:
    node = tree
    for part in path.split("."):
        if not isinstance(node, Mapping) or part not in node:
            return False, None
        node = node[part]
    return (node is not None), node


def _from_package_defaults(origins: Optional[Mapping[str, str]], path: str) -> bool:
    """Whether the config manager recorded the package's own defaults
    (``defaults:base``, ``defaults:production``) as where ``path`` came from."""
    parts = path.split(".")
    for end in range(len(parts), 0, -1):
        origin = (origins or {}).get(".".join(parts[:end]))
        if origin is not None:
            return str(origin).startswith("defaults:")
    return False


#: Settings an environment variable decides over the configuration, as the
#: client has always read them (routes/core.py): ``{path: variable}``. The
#: engine reads it (``_read_config``): a value the key's type does not accept is
#: warned about and ignored, and the YAML decides, as ``/api/v1/config`` does.
ENV_OVERRIDES = {"integrations.external_requests": "ANNZARRO_EXTERNAL_REQUESTS"}


def config_lookup(config: Mapping, path: str) -> Tuple[bool, Any]:
    """``(found, value)`` for a dotted path in what the operator configured.

    Reads ``config_tree``, the nested merge the config manager keeps, but only
    for values some layer other than the package's defaults set
    (``config_origins``): a value that ships in ``base.yaml`` is the key's
    default, not a decision of the operator, and must not act as the ceiling
    of an ordinary admin. A config handed to ``create_app`` without a tree
    (tests, embedding) is read as it is, nested or flat: ``server.x`` is the
    flat key ``x``, as ``ConfigManager.to_flask_config`` flattens that section.
    ``None`` counts as not set."""
    tree = config.get("config_tree")
    if tree is not None:
        found, value = _walk(tree, path)
        if found and _from_package_defaults(config.get("config_origins"), path):
            return False, None
        return found, value
    found, value = _walk(config, path)
    if found:
        return True, value
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
            logger.warning("Configuration %s is ignored: %s (%r)",
                           self.registry.keys[issue.name].config_path or issue.name,
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
        stat stamp); it feeds :meth:`version`. The user source returns ``{}`` for an
        administrator: admins get no per-user overrides, even if the store holds some."""
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
        self._env_keys = set()
        for key in self.registry:
            if key.config_reader:
                found, raw, from_env = key.config_reader(self.config)
                if not found:
                    continue
                try:
                    values[key.name] = key.type.validate(raw)
                    if from_env:
                        self._env_keys.add(key.name)
                except PolicyValueError as exc:
                    issues.append(Issue(CONFIG, key.name, raw, exc.reason))
                continue
            if not key.config_path:
                continue
            variable = ENV_OVERRIDES.get(key.config_path)
            if variable and os.environ.get(variable, "").strip():
                raw = os.environ[variable]
                try:
                    values[key.name] = key.type.validate(raw)
                    self._env_keys.add(key.name)
                    continue
                except PolicyValueError:
                    logger.warning("%s=%r is not a valid value of %s; ignored, the configuration decides",
                                   variable, raw, key.config_path)
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

    def _candidates(self, key: Key, stored: Mapping[str, Mapping[str, Any]]) -> List[Tuple[str, Any]]:
        """The ``(layer, value)`` pairs that count for ``key``, highest first."""
        found: List[Tuple[str, Any]] = []
        if key.name not in self.locked:
            for layer in STORED_LAYERS:
                if key.name in stored[layer]:
                    ok, value, _ = self.check_stored(layer, key.name, stored[layer][key.name])
                    if ok:
                        found.append((layer, value))
        if key.name in self._config_layer:
            found.append((CONFIG, self._config_layer[key.name]))
        return found

    def _combine(self, key: Key, candidates: List[Tuple[str, Any]]) -> Tuple[Any, str]:
        """``(value, layer)`` of ``candidates`` by the key's rule; the default when there are none."""
        if not candidates:
            return self.default(key), DEFAULT
        if key.combine == "override":
            layer, value = candidates[0]
            return value, layer
        value = key.type.restrict([v for _, v in candidates])
        # the highest layer holding the result; an intersection no layer holds alone is credited to the highest
        return value, next((l for l, v in candidates if v == value), candidates[0][0])

    def _resolve_key(self, key: Key, stored: Mapping[str, Mapping[str, Any]]) -> Resolution:
        candidates = self._candidates(key, stored)
        value, layer = self._combine(key, candidates)
        layers = {SOURCE_NAMES[l]: v for l, v in candidates}
        layers[SOURCE_NAMES[DEFAULT]] = self.default(key)
        inherited = {SOURCE_NAMES[l]: self._combine(key, [c for c in candidates if c[0] != l])[0]
                     for l, _ in candidates if l in STORED_LAYERS}
        source = "env" if layer == CONFIG and key.name in self._env_keys else SOURCE_NAMES[layer]
        return Resolution(key.name, value, source, key.name in self.locked,
                          self._config_layer.get(key.name), key.name in self._config_layer, layers, inherited)

    def _constrain(self, resolved: Dict[str, Resolution]) -> Dict[str, Resolution]:
        """Apply the registry's constraints until nothing changes (at most ``_PASSES``
        rounds). A constraint can only narrow a ``restrict`` key; anything else it
        returns is logged and ignored."""
        for _ in range(_PASSES):
            changed = False
            for fn in self.registry.constraints:
                forced = fn({n: r.value for n, r in resolved.items()}) or {}
                for name, value in forced.items():
                    key = self.registry.get(name)
                    if key is None:
                        raise KeyError(f"a policy constraint forces {name!r}, which is not declared")
                    value = key.type.validate(value)
                    current = resolved[name]
                    if current.value == value:
                        continue
                    if key.combine != "restrict" or key.type.restrict([current.value, value]) != value:
                        logger.error("A policy constraint tried to widen or force %s (%r to %r); ignored",
                                     name, current.value, value)
                        continue
                    resolved[name] = replace(current, value=value, source=SOURCE_NAMES[FORCED])
                    changed = True
            if not changed:
                break
        return resolved

    # -- writing a layer ---------------------------------------------------

    def apply_update(self, layer: str, stored: Mapping[str, Any], changes: Mapping[str, Any]) -> "Update":
        """``Update(stored, errors, capped)`` for ``{name: value | None}`` applied
        to a layer's stored dict. ``None`` removes the entry, known or not.

        Everything else in ``stored`` is kept as it is, unknown names and bad
        values included. With any error nothing changes (``errors`` is
        ``{name: reason}``; :func:`status_for` says 400 or 409).

        A restrict key cannot be widened past the operator's config: the overlay
        write is refused (``config_ceiling``). A user-layer write is accepted,
        because the overlay may change; ``capped`` says, for each such name, the
        value that applies instead."""
        errors: Dict[str, str] = {}
        capped: Dict[str, Any] = {}
        new = dict(stored)
        overlay = self.stored(OVERLAY) if layer == USER else {}
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
                if not ok:
                    errors[name] = issue.reason
                    continue
                if key.combine == "restrict":
                    below = [(OVERLAY, v) for v in [self._usable(OVERLAY, name, overlay)] if v is not _NOTHING] \
                        if layer == USER else []
                    if name in self._config_layer:
                        below.append((CONFIG, self._config_layer[name]))
                    if below:
                        bound = key.type.restrict([canonical] + [v for _, v in below])
                        if bound != canonical:
                            if layer == OVERLAY:
                                errors[name] = CONFIG_CEILING
                                continue
                            capped[name] = bound
                new[name] = canonical
        return Update(dict(stored), errors, {}) if errors else Update(new, errors, capped)

    def _usable(self, layer: str, name: str, stored: Mapping[str, Any]) -> Any:
        if name not in stored:
            return _NOTHING
        ok, value, _ = self.check_stored(layer, name, stored[name])
        return value if ok else _NOTHING


class Update(NamedTuple):
    stored: Dict[str, Any]
    errors: Dict[str, str]
    capped: Dict[str, Any]


_NOTHING = object()


def status_for(errors: Mapping[str, str]) -> int:
    """The HTTP status of an update's errors: 409 if any is a conflict, else 400."""
    return 409 if any(reason in CONFLICTS for reason in errors.values()) else 400
