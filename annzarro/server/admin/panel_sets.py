"""Admin interface: panel sets, by owner, with quota use; reassign and delete.

The files are the same ones ``/sessions/*`` writes. Reassign and delete hold
``session_store.locked`` for the whole batch, as every writer of a set does,
so a save that races with them neither loses their change nor undoes it.
"""

import logging
import os

from flask import current_app, jsonify, request

from .. import session_quota, session_store
from . import audit
from .guard import require_admin

logger = logging.getLogger(__name__)

LIST_MAX = 1000
BATCH_MAX = 1000
AUDIT_NAMES = 50


def _sessions_dir(create=False):
    path = os.path.join(current_app.config.get("data_dir"), "sessions")
    if create:
        os.makedirs(path, exist_ok=True)
    return path


def _bad(message, reason="bad_request", status=400, **extra):
    return jsonify(dict(error=message, reason=reason, **extra)), status


def _body():
    body = request.get_json(silent=True)
    return body if isinstance(body, dict) else {}


def _names(body):
    """The ``names`` of a request: a non-empty list of at most BATCH_MAX strings, or None."""
    names = body.get("names")
    if (not isinstance(names, list) or not 0 < len(names) <= BATCH_MAX
            or not all(isinstance(n, str) for n in names)):
        return None
    return names


def _stem(entry):
    return os.path.basename(entry.path)[:-len(".json")]


def _item(entry):
    data = entry.data
    return {"name": _stem(entry), "owner": data.get("owner"), "dataset": data.get("dataset") or "",
            "bytes": entry.size,
            "modified_at": data.get("modified_at") or data.get("timestamp"),
            "modified_by": data.get("modified_by")}


@require_admin
def list_panel_sets():
    """GET /api/v1/admin/panel-sets?owner=&offset=&limit=: the sets (filtered by
    owner, newest first, paged) and, for the whole server, each owner's use
    against the quotas."""
    try:
        offset = max(0, int(request.args.get("offset", 0)))
        limit = max(1, min(int(request.args.get("limit", 100)), LIST_MAX))
    except ValueError:
        return _bad("offset and limit must be integers.")
    owner = request.args.get("owner") or None
    config = current_app.config
    held = session_quota.entries(_sessions_dir())
    shown = [e for e in held if owner is None or e.data.get("owner") == owner]
    shown.sort(key=lambda e: (str(e.data.get("modified_at") or e.data.get("timestamp") or ""), _stem(e)),
               reverse=True)
    return jsonify(items=[_item(e) for e in shown[offset:offset + limit]], total=len(shown),
                   usage=session_quota.usage_by_owner(config, held),
                   server=session_quota.totals(config, held))


@require_admin
def reassign_panel_sets():
    """POST /api/v1/admin/panel-sets/reassign {names | from_owner, to_owner}.

    All or nothing: a name that is not a set, or a file that cannot be read,
    refuses the whole request. An admin may take a user past their quota; the
    answer says so (``over_quota``)."""
    body = _body()
    to_owner = body.get("to_owner")
    if not isinstance(to_owner, str) or not to_owner:
        return _bad("to_owner is required.")
    if ("names" in body) == ("from_owner" in body):
        return _bad("Give either names or from_owner.")
    if "from_owner" in body and (not isinstance(body["from_owner"], str) or not body["from_owner"]):
        return _bad("from_owner must be a username.")
    names = None
    if "names" in body:
        names = _names(body)
        if names is None:
            return _bad(f"names must be a list of 1 to {BATCH_MAX} panel-set names.")
    if current_app.auth_manager.get_user(to_owner) is None:
        return _bad(f"No such user: {to_owner}", "unknown_user", 404)
    sessions_dir = _sessions_dir(create=True)
    config = current_app.config
    moved, unchanged, previous = [], [], set()
    with session_store.locked(sessions_dir):
        if names is not None:
            files = {name: session_store.path_of(sessions_dir, name) for name in names}
            missing = [n for n, p in files.items() if p is None or not os.path.isfile(p)]
            if missing:
                return _bad("These panel sets do not exist.", "not_found", 404, names=missing[:BATCH_MAX])
            targets = {os.path.basename(p)[:-len(".json")]: p for p in files.values()}
        else:
            targets = {_stem(e): e.path for e in session_quota.entries(sessions_dir)
                       if e.data.get("owner") == body["from_owner"]}
        # read every file first, so a refusal moves nothing
        stored = {name: session_quota.summary(path) for name, path in targets.items()}
        unreadable = [name for name, found in stored.items() if found is None]
        if unreadable:
            return _bad("These panel sets cannot be read.", "unreadable", 409, names=unreadable[:BATCH_MAX])
        for name, path in targets.items():
            if stored[name].data.get("owner") == to_owner:
                unchanged.append(name)
                continue
            previous.add(session_store.assign_owner(path, to_owner))
            moved.append(name)
        held = session_quota.entries(sessions_dir)
    per_user = session_quota.limits(config)[0]
    mine = sum(1 for e in held if e.data.get("owner") == to_owner)
    if moved:
        audit.record("panelset.reassign", to_owner,
                     {"count": len(moved), "names": moved[:AUDIT_NAMES],
                      "from": sorted(p for p in previous if p) + (["(none)"] if None in previous else [])})
    return jsonify(moved=len(moved), unchanged=len(unchanged), over_quota=bool(per_user and mine > per_user))


@require_admin
def delete_panel_sets():
    """DELETE /api/v1/admin/panel-sets {names}: remove the sets; names that are
    not sets are listed in ``missing``."""
    names = _names(_body())
    if names is None:
        return _bad(f"names must be a list of 1 to {BATCH_MAX} panel-set names.")
    sessions_dir = _sessions_dir(create=True)
    deleted, missing, owners = [], [], {}
    with session_store.locked(sessions_dir):
        for name in names:
            path = session_store.path_of(sessions_dir, name)
            summary = session_quota.summary(path) if path else None
            try:
                if path is None or not os.path.isfile(path):
                    raise FileNotFoundError(name)
                os.remove(path)
            except FileNotFoundError:
                missing.append(name)
                continue
            deleted.append(os.path.basename(path)[:-len(".json")])
            owners[deleted[-1]] = summary.data.get("owner") if summary else None
    if deleted:
        audit.record("panelset.delete", None,
                     {"count": len(deleted), "names": [f"{n} ({owners[n] or 'none'})" for n in deleted[:AUDIT_NAMES]]})
    return jsonify(deleted=len(deleted), missing=missing)


def register(blueprint):
    blueprint.add_url_rule("/api/v1/admin/panel-sets", "panel_sets", list_panel_sets)
    blueprint.add_url_rule("/api/v1/admin/panel-sets/reassign", "panel_sets_reassign",
                           reassign_panel_sets, methods=["POST"])
    blueprint.add_url_rule("/api/v1/admin/panel-sets", "panel_sets_delete",
                           delete_panel_sets, methods=["DELETE"])
