"""
Runtime overrides: the overlay
------------------------------

``<state dir>/overlay.json`` holds what the admin interface changes while the
server runs, so the operator's YAML is never written::

    {"version": 1,
     "data_roots": [{"path": "/srv/atlases/lab2", "added_by": "alice", "added_at": "..."}],
     "policy": {...}}

Only the keys in ``OVERLAY_KEYS`` are honoured. ``data_roots`` is bounded by
the YAML: a root counts only while its real path is a directory inside the
real path of an entry of ``server.admin_data_roots``, checked again on every
read (a symlink swapped after the root was added, or a parent dropped from
the YAML, deactivates it). ``policy`` is the admin layer of the policy
registry; this module passes it through untouched.

Every worker notices a change by the file's stamp (``atomic_store.Watched``):
one ``stat`` per request, and it also sees edits made outside any worker.
A corrupt overlay fails closed: no overlay roots, an ERROR in the log, and
``status()`` says so; the YAML roots keep working.
"""

import os

from .. import atomic_store
from . import OVERLAY_KEYS, state_dir

FILE_NAME = "overlay.json"
VERSION = 1


def path(config):
    return os.path.join(state_dir(config), FILE_NAME)


def _default():
    return {"version": VERSION}


def _watcher(config):
    return atomic_store.watched(path(config), _default())


def load(config):
    """The overlay as parsed (read-only), ``{"version": 1}`` when missing or corrupt."""
    return _watcher(config).get()


def status(config):
    """``{"ok": bool, "error": str or None}``: whether the overlay file parsed."""
    watcher = _watcher(config)
    watcher.get()
    return {"ok": watcher.error is None, "error": watcher.error}


def data_roots(config):
    """The recorded roots (``[{path, added_by, added_at}]``), active or not."""
    roots = load(config).get("data_roots")
    if not isinstance(roots, list):
        return []
    return [r for r in roots if isinstance(r, dict) and isinstance(r.get("path"), str)]


def parents(config):
    """Real paths of ``server.admin_data_roots``."""
    entries = config.get("admin_data_roots") or []
    return [os.path.realpath(os.path.expanduser(p)) for p in entries]


def resolve_roots(config):
    """Every recorded root with ``real``, ``active`` and, when not active,
    ``inactive_reason`` (``not_absolute``, ``missing`` or ``outside_parents``).

    Resolved on every call, memoised for one Flask request."""
    memo = None
    try:
        from flask import g, has_request_context
        if has_request_context():
            memo = g.__dict__.setdefault("_overlay_roots", {})
            if id(config) in memo:
                return memo[id(config)]
    except ImportError:
        pass
    from ..confinement import is_inside
    allowed = parents(config)
    out = []
    for entry in data_roots(config):
        item = dict(entry)
        raw = entry["path"]
        if not os.path.isabs(raw):
            item.update(real=None, active=False, inactive_reason="not_absolute")
        else:
            real = os.path.realpath(raw)
            item["real"] = real
            if not os.path.isdir(real):
                item.update(active=False, inactive_reason="missing")
            elif not is_inside(real, allowed):
                item.update(active=False, inactive_reason="outside_parents")
            else:
                item["active"] = True
        out.append(item)
    if memo is not None:
        memo[id(config)] = out
    return out


def active_data_roots(config):
    """Real paths of the overlay roots that count now."""
    return [r["real"] for r in resolve_roots(config) if r["active"]]


def policy(config):
    """The admin layer of the policy registry, exactly as stored ({} if none)."""
    layer = load(config).get("policy")
    return layer if isinstance(layer, dict) else {}


def update(config, mutate):
    """Change the overlay under its lock: ``mutate(overlay)`` edits the dict
    (only ``OVERLAY_KEYS`` may be added or changed; other keys are kept as
    they are) and may return a value. Raises if the file is corrupt rather
    than replace it."""
    os.makedirs(state_dir(config, create=True), exist_ok=True)
    watcher = _watcher(config)

    def apply(data):
        before = {k: v for k, v in data.items() if k not in OVERLAY_KEYS}
        result = mutate(data)
        if {k: v for k, v in data.items() if k not in OVERLAY_KEYS} != before:
            raise ValueError("the overlay only takes the keys " + ", ".join(OVERLAY_KEYS))
        data["version"] = VERSION
        return result

    try:
        return atomic_store.update_json(path(config), apply, _default())
    finally:
        watcher.invalidate()
        try:
            from flask import g, has_request_context
            if has_request_context():
                g.__dict__.pop("_overlay_roots", None)
        except ImportError:
            pass
