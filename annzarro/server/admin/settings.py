"""Admin interface: the settings, which is the admin layer and the per-user
layer of the policy registry.

``GET/PUT /api/v1/admin/policy`` read and write ``overlay.json``'s ``policy``
dict; ``GET/PUT /api/v1/admin/users/<u>/policy`` read and write the ``policy``
of ``access.json``'s ``principals["user:<u>"]``. Both stores are written only
through :func:`atomic_store.update_json`, and the registry's
:meth:`PolicyEngine.apply_update` runs inside the lock on what the lock just
read, so two admins changing different keys never lose one. Stored names the
registry does not know, and stored values it ignores, are kept and reported
(``unknown`` and ``issues``), never dropped.

:func:`wire_sources` hands the engine its two stored layers: the overlay, and
the user layer, which is empty for an administrator.
"""
import json
import logging
import os
import re
from typing import Any, Dict, Mapping

from flask import current_app, jsonify, request

from .. import atomic_store
from ..policy import OVERLAY, USER, PolicyValueError, engine, status_for
from ..policy.resolver import CONFLICTS, UNKNOWN_KEY
from . import audit, overlay, state_dir
from .guard import require_admin

logger = logging.getLogger(__name__)

ACCESS_FILE = "access.json"
ACCESS_VERSION = 1
#: The reason a per-user override on an administrator is refused
ADMIN_USER = "admin_user"
STORE_UNREADABLE = "store_unreadable"

_SENTENCES = {
    "unknown_key": "is not a setting this server knows",
    "bad_type": "has the wrong type",
    "out_of_range": "is out of range",
    "bad_choice": "is not one of the allowed values",
    "locked_by_config": "is locked by the configuration file",
    "config_scope": "can only be changed in the configuration file",
    "server_scope": "applies to the whole server and cannot be set per user",
    "config_ceiling": "cannot be widened past what the configuration file allows",
    ADMIN_USER: "cannot be overridden for an administrator",
}


# -- the per-user store (access.json) ---------------------------------------------

def access_path(config):
    return os.path.join(state_dir(config), ACCESS_FILE)


def _access_default():
    return {"version": ACCESS_VERSION, "principals": {}}


def _access_watcher(config):
    return atomic_store.watched(access_path(config), _access_default())


def access_store_state(config):
    """``{"ok": bool, "error": str or None}``: whether ``access.json`` parses.

    A missing file is fine (nobody has an entry). An unreadable one cannot say
    who is restricted or overridden, so every reader must fail closed: the
    policy user layer below gives non-admins the most restrictive values, and
    the access model's ``may_read`` answers 503 ``access_unavailable``."""
    watcher = _access_watcher(config)
    watcher.get()
    return {"ok": watcher.error is None, "error": watcher.error}


def principal(user):
    return f"user:{user}"


def user_policy(config, user) -> Dict[str, Any]:
    """The stored per-user overrides of ``user``, as they are ({} if none)."""
    principals = _access_watcher(config).get().get("principals")
    entry = principals.get(principal(user)) if isinstance(principals, dict) else None
    stored = entry.get("policy") if isinstance(entry, dict) else None
    return dict(stored) if isinstance(stored, dict) else {}


def update_user_policy(config, user, mutate):
    """Change ``user``'s overrides under the lock of ``access.json``:
    ``mutate(stored)`` returns the new dict (or raises to refuse). The entry's
    other fields (restrictions, grants) are kept; an entry left empty is removed."""
    os.makedirs(state_dir(config, create=True), exist_ok=True)
    watcher = _access_watcher(config)

    def apply(data):
        principals = data.setdefault("principals", {})
        if not isinstance(principals, dict):
            raise ValueError("access.json: principals is not an object")
        entry = principals.get(principal(user))
        if entry is not None and not isinstance(entry, dict):
            raise ValueError(f"access.json: the entry of {principal(user)} is not an object")
        current = (entry or {}).get("policy")
        if current is not None and not isinstance(current, dict):
            raise ValueError(f"access.json: the policy of {principal(user)} is not an object")
        result, new = mutate(dict(current or {}))
        entry = dict(entry or {})
        if new:
            entry["policy"] = new
        else:
            entry.pop("policy", None)
        if entry:
            principals[principal(user)] = entry
        else:
            principals.pop(principal(user), None)
        data["version"] = ACCESS_VERSION
        return result

    try:
        return atomic_store.update_json(access_path(config), apply, _access_default())
    finally:
        watcher.invalidate()


def _most_restrictive(eng):
    """The most restrictive value of every restrict key a user layer can set."""
    out = {}
    for key in eng.registry:
        samples = key.type.samples() if key.scope == "user" and key.combine == "restrict" else None
        if samples:
            out[key.name] = samples[1]
    return out


def wire_sources(app):
    """Give the app's policy engine the overlay and the per-user layer."""
    config = app.config
    eng = engine(app)

    def overlay_stamp():
        return str(atomic_store.stamp(overlay.path(config)))

    def user_layer(user):
        if not user:
            return {}
        manager = getattr(app, "auth_manager", None)
        record = manager.get_user(user) if manager is not None else None
        if record is not None and record.is_admin:
            return {}        # admins get no per-user overrides, even if the file holds some
        if not access_store_state(config)["ok"]:
            return _most_restrictive(eng)     # the file that says who is tightened is unreadable
        return user_policy(config, user)

    eng.set_source(OVERLAY, lambda: overlay.policy(config), overlay_stamp)
    eng.set_source(USER, user_layer, lambda: str(atomic_store.stamp(access_path(config))))


# -- answers ------------------------------------------------------------------

class _Refused(Exception):
    """An update the registry refused; nothing is written."""

    def __init__(self, errors):
        super().__init__(errors)
        self.errors = errors


def _sentence(errors: Mapping[str, str]) -> str:
    return "; ".join(f"{name} {_SENTENCES.get(reason, 'was refused (' + reason + ')')}"
                     for name, reason in sorted(errors.items()))


def _messages(eng, changes, errors):
    """The type's own sentence for each value it refused (which URL, and why)."""
    out = {}
    for name, reason in errors.items():
        key = eng.registry.get(name)
        if key is None or reason not in ("bad_type", "bad_choice", "out_of_range"):
            continue
        try:
            key.type.validate_stored(changes.get(name))
        except PolicyValueError as exc:
            out[name] = str(exc)
    return out


def _refusal(errors: Mapping[str, str], messages: Mapping[str, str] = ()):
    conflicts = CONFLICTS + (ADMIN_USER,)
    status = 409 if any(r in conflicts for r in errors.values()) else status_for(errors)
    body = {"error": "; ".join(f"{n} {messages[n]}" if n in messages else _sentence({n: r})
                                for n, r in sorted(errors.items())),
            "errors": dict(errors), **({"messages": dict(messages)} if messages else {})}
    if status == 409:
        body["reason"] = next(r for r in errors.values() if r in conflicts)
    else:
        body["reason"] = "invalid_settings"
    return jsonify(body), status


def _changes():
    """``{name: value | None}`` from the request, or an error response."""
    body = request.get_json(silent=True)
    if not isinstance(body, dict) or not body or not all(isinstance(n, str) and n for n in body):
        return None, (jsonify(error="Send an object of {setting: value}; null removes a value.",
                              reason="bad_request"), 400)
    return body, None


def _unreadable(exc):
    logger.error("Cannot change the stored settings: %s", exc)
    return jsonify(error=f"The stored settings file is unreadable: {exc}. Repair or remove it first.",
                   reason=STORE_UNREADABLE), 503


def _issue_list(eng, layer, stored):
    return [issue.as_dict() for issue in eng.audit(layer, stored)]


def _hosts_now(key, value, config):
    if key.outbound_hosts is None:
        return None
    try:
        return list(key.outbound_hosts(value, config))
    except Exception:
        logger.exception("outbound_hosts of %s failed", key.name)
        return None


def _key_entry(eng, key, res, config):
    return {**key.describe(),
            "default": res.layers.get("default", eng.default(key)),
            "outbound_hosts_now": _hosts_now(key, res.value, config),
            "locked": res.locked, "value": res.value, "source": res.source,
            **({"config_value": res.config_value,
                "config_origin": "env" if key.name in getattr(eng, "_env_keys", ()) else "config"}
               if res.has_config else {}),
            "layers": res.layers, "inherited": res.inherited}


def _server_view(eng, config):
    stored = eng.stored(OVERLAY)
    resolved = eng.resolve_all(None)
    issues = _issue_list(eng, OVERLAY, stored)
    return {"version": eng.version(), "store_problems": _problems(config),
            "keys": [_key_entry(eng, key, resolved[key.name], config) for key in eng.registry],
            "unknown": [{"name": i["name"], "value": i["value"]} for i in issues if i["reason"] == UNKNOWN_KEY],
            "issues": issues}


def _user_view(eng, user, config, is_admin):
    stored = user_policy(config, user)
    resolved = eng.resolve_all(user)
    ignored = {i.name for i in eng.audit(USER, stored)}
    keys = []
    for key in eng.registry:
        if key.scope != "user":
            continue
        res = resolved[key.name]
        entry = _key_entry(eng, key, res, config)
        entry["override"] = stored.get(key.name) if key.name in stored else None
        entry["has_override"] = key.name in stored and not is_admin and key.name not in ignored
        entry["inherited"] = res.inherited.get("user", res.value)
        keys.append(entry)
    issues = _issue_list(eng, USER, stored)
    if is_admin:
        issues = issues + [{"layer": "user", "name": n, "value": v, "reason": ADMIN_USER}
                           for n, v in stored.items()
                           if not any(i["name"] == n for i in issues)]
    return {"version": eng.version(), "store_problems": _problems(config), "user": user, "is_admin": is_admin, "values": stored,
            "effective": {n: r.value for n, r in resolved.items() if eng.registry.keys[n].scope == "user"},
            "keys": keys,
            "unknown": [{"name": i["name"], "value": i["value"]} for i in issues if i["reason"] == UNKNOWN_KEY],
            "issues": issues}


def _diff(before, after, names, eng=None):
    out = {n: {"from": before.get(n), "to": after.get(n)} for n in names
           if before.get(n) != after.get(n) or (n in before) != (n in after)}
    for name, entry in out.items():
        key = eng.registry.get(name) if eng is not None else None
        describe = getattr(key.type, "describe_change", None) if key is not None else None
        if describe:
            entry.update(describe(entry["from"], entry["to"]))
    return out


_URL_CREDENTIALS = re.compile(r"(://)[^/@\s\"']+@")


def _redacted(value):
    """``value`` with the user:password part of any URL in it hidden (a refused URL is logged as typed)."""
    return json.loads(_URL_CREDENTIALS.sub(r"\1***@", json.dumps(value)))


def _record(target, changes, diff, outcome="ok"):
    """Write the audit record; False (and an ERROR in the log) if it could not
    be written. The change is already stored, so the caller still answers 200."""
    try:
        audit.record("policy.update", target, {"requested": _redacted(changes), "changed": _redacted(diff)}, outcome)
        return True
    except Exception:
        logger.exception("Could not write the audit record of a settings change")
        return False


def _problems(config):
    """Stored files that do not parse, for the red banner of the page."""
    found = []
    for name, state in (("overlay.json", overlay.status(config)), (ACCESS_FILE, access_store_state(config))):
        if not state["ok"]:
            found.append({"store": name, "error": state["error"]})
    return found


# -- views --------------------------------------------------------------------

@require_admin
def policy():
    """GET /api/v1/admin/policy, PUT /api/v1/admin/policy {name: value | null}."""
    eng = engine()
    config = current_app.config
    if request.method == "GET":
        return jsonify(_server_view(eng, config))
    changes, bad = _changes()
    if bad:
        return bad

    def mutate(data):
        layer = data.get("policy")
        if layer is not None and not isinstance(layer, dict):
            raise ValueError("overlay.json: policy is not an object")
        before = dict(layer or {})
        update = eng.apply_update(OVERLAY, before, changes)
        if update.errors:
            raise _Refused(update.errors)
        if update.stored:
            data["policy"] = update.stored
        else:
            data.pop("policy", None)
        return before, update

    try:
        before, update = overlay.update(config, mutate)
    except _Refused as refused:
        _record("overlay", changes, {}, "refused:" + ",".join(sorted(set(refused.errors.values()))))
        return _refusal(refused.errors, _messages(eng, changes, refused.errors))
    except ValueError as exc:
        return _unreadable(exc)
    saved = _record("overlay", changes, _diff(before, update.stored, changes, eng))
    return jsonify({**_server_view(eng, config), "capped": update.capped, **({} if saved else {"audit_failed": True})})


@require_admin
def user_policy_view(username):
    """GET /api/v1/admin/users/<u>/policy, PUT the same with {name: value | null}."""
    eng = engine()
    config = current_app.config
    record = current_app.auth_manager.get_user(username)
    if record is None:
        return jsonify(error="No such user.", reason="unknown_user"), 404
    if request.method == "GET":
        return jsonify(_user_view(eng, username, config, record.is_admin))
    changes, bad = _changes()
    if bad:
        return bad
    if record.is_admin and any(v is not None for v in changes.values()):
        errors = {n: ADMIN_USER for n, v in changes.items() if v is not None}
        _record(principal(username), changes, {}, "refused:" + ADMIN_USER)
        return _refusal(errors)

    def mutate(stored):
        update = eng.apply_update(USER, stored, changes)
        if update.errors:
            raise _Refused(update.errors)
        return (stored, update), update.stored

    try:
        before, update = update_user_policy(config, username, mutate)
    except _Refused as refused:
        _record(principal(username), changes, {}, "refused:" + ",".join(sorted(set(refused.errors.values()))))
        return _refusal(refused.errors)
    except ValueError as exc:
        return _unreadable(exc)
    saved = _record(principal(username), changes, _diff(before, update.stored, changes))
    return jsonify({**_user_view(eng, username, config, record.is_admin), "capped": update.capped,
                    **({} if saved else {"audit_failed": True})})


def register(blueprint):
    """Add this section's routes to the admin blueprint."""
    blueprint.add_url_rule("/api/v1/admin/policy", "policy", policy, methods=["GET", "PUT"])
    blueprint.add_url_rule("/api/v1/admin/users/<username>/policy", "user_policy", user_policy_view,
                           methods=["GET", "PUT"])
