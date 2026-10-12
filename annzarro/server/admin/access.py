"""
Admin interface: access
-----------------------

What a user may read, set by an administrator: switch a user to "restricted",
grant folders, stores and remote prefixes, revoke them, see what that adds up
to, and ask why a path is or is not readable. The model (``access.json``, the
resolution of grants, the gate) is ``server/access.py``; this module only
validates, calls it, and audits.

A refusal never changes the file. Every change goes through
``access.update_entry``, so it runs under the file's lock next to the writes of
the settings endpoints (a user's policy overrides live in the same entry and
are kept). A file that exists but cannot be parsed is answered 503
``store_unreadable`` and left alone: nothing here replaces it with an empty
one, and the data routes keep refusing every non-admin until it is repaired.
"""

import logging
import os

from flask import current_app, jsonify, request

from .. import access, confinement
from ...core.remote import is_remote_path
from . import audit, settings
from .guard import require_admin

logger = logging.getLogger(__name__)

MAX_PATH_CHARS = 4096
#: Stores one "effective access" answer lists at most; the reply says when it stopped there.
MAX_EFFECTIVE_STORES = 5000
DEFAULT_PAGE = 100
MAX_PAGE = 500

#: ``kind`` of a grant request. ``stores_in`` expands to one ``store`` grant per store in a folder.
REQUEST_KINDS = ("dir", "store", "remote", "stores_in")

#: Status of each refusal the access model gives for a grant.
GRANT_STATUS = {
    "bad_path": 400, "bad_kind": 400, "not_a_directory": 400, "too_many": 400,
    "outside_data_roots": 403, "remote_not_allowed": 403,
    "not_found": 404,
    "already_granted": 409,
}


def _error(status, reason, message, **extra):
    return jsonify(dict(error=message, reason=reason, **extra)), status


def _refused(action, target, reason, detail=None):
    try:
        audit.record(action, target, detail, "refused:" + reason)
    except Exception:
        logger.exception("Could not write the audit record of a refused %s", action)


def _unreadable(exc):
    logger.error("Cannot change access.json: %s", exc)
    return _error(503, settings.STORE_UNREADABLE,
                  f"The access file is unreadable: {exc}. Repair or remove it first; until then only "
                  "administrators can read data.")


def _record(user):
    """The admin's account record of ``user``, or None."""
    return current_app.auth_manager.get_user(user)


def _unknown():
    return _error(404, "unknown_user", "No such user.")


def _body():
    body = request.get_json(silent=True)
    return body if isinstance(body, dict) else {}


def _path_of(body):
    path = body.get("path")
    if not isinstance(path, str) or not path.strip() or "\0" in path or len(path) > MAX_PATH_CHARS:
        return None
    return path


def _actor():
    from .. import permissions
    return permissions.current_user()[0]


def _int_arg(name, default, low, high):
    raw = request.args.get(name)
    if raw is None or raw == "":
        return default
    try:
        value = int(raw)
    except ValueError:
        raise ValueError(f"{name} must be an integer")
    return max(low, min(high, value))


# -- what a restricted user reaches ---------------------------------------------------

def _stores_below(config, grants):
    """``(paths, capped)``: the stores a restricted user's active grants cover.

    A granted store is listed as is; a granted folder is walked, one budget
    (``dataset_scan_max_entries``) for the whole call, and a link that leads
    out of its folder is neither entered nor counted, exactly as the gate
    treats it. At most ``MAX_EFFECTIVE_STORES`` are collected."""
    from ...data.scan import DEFAULT_MAX_ENTRIES, is_store_root
    budget = int(config.get("dataset_scan_max_entries") or DEFAULT_MAX_ENTRIES)
    found, seen_dirs, capped = {}, set(), False
    for grant in grants.active():
        real = grant["real"]
        if os.path.isfile(real) or is_store_root(real, os.path.basename(real)):
            found[real] = grant
            continue
        fence = real.rstrip(os.sep) + os.sep
        stack = [real]
        while stack and not capped:
            directory = stack.pop()
            try:
                here = os.path.realpath(directory)
                if here in seen_dirs or (here != real and not here.startswith(fence)):
                    continue
                seen_dirs.add(here)
                entries = sorted(os.scandir(directory), key=lambda e: e.name)
            except OSError:
                continue
            for entry in entries:
                budget -= 1
                if budget < 0 or len(found) >= MAX_EFFECTIVE_STORES:
                    capped = True
                    break
                if entry.name.startswith("."):
                    continue
                try:
                    target = os.path.realpath(entry.path)
                    if not target.startswith(fence):
                        continue          # a link leading out of the folder
                    if entry.is_file() and entry.name.endswith(".h5ad"):
                        found.setdefault(target, grant)
                    elif entry.is_dir() and is_store_root(entry.path, entry.name):
                        found.setdefault(target, grant)
                    elif entry.is_dir():
                        stack.append(entry.path)
                except OSError:
                    continue
        if capped:
            break
    return sorted(found), capped


def _policy_overrides(entry):
    stored = entry.get("policy")
    return len(stored) if isinstance(stored, dict) else 0


def _access_view(config, username, record, offset, limit):
    view = access.describe(username, config)
    entry = access.entry_of(username, config)
    restricted = bool(view["restricted"]) and not record.is_admin
    everything = record.is_admin or not restricted
    view.update(is_admin=bool(record.is_admin), restricted=restricted, all=everything,
                policy_overrides=_policy_overrides(entry))
    view.pop("policy", None)
    if everything:
        view["stores"] = {"items": [], "total": 0, "offset": 0, "capped": False}
        view["remote_prefixes"] = 0
    else:
        paths, capped = _stores_below(config, access.grants_of(username, config))
        page = paths[offset:offset + limit]
        view["stores"] = {"items": [{"name": os.path.basename(p) or p, "path": p} for p in page],
                          "total": len(paths), "offset": offset, "capped": capped}
        view["remote_prefixes"] = sum(1 for g in view["grants"] if g["kind"] == "remote" and g["active"])
    return view


# -- endpoints ---------------------------------------------------------------------------

@require_admin
def overview():
    """GET /api/v1/admin/access: one line per user for the Users table, and who is granted each data directory.

    ``{store: {ok, error}, users: {name: {restricted, grants, active, policy_overrides}},
    roots: {<real path of a data directory>: [users with a grant in it]}}``.
    """
    from . import data_roots
    config = current_app.config
    state = settings.access_store_state(config)
    users, roots = {}, {}
    live_roots = [r["real"] for r in data_roots.effective_roots(config) if r["active"] and r["real"]]
    manager = current_app.auth_manager
    for name, record in sorted(manager.get_users().items()):
        entry = access.entry_of(name, config)
        grants = access.grants_of(name, config).all if state["ok"] else []
        # an unreadable file says nothing about who is restricted: None, not a guess
        restricted = None if not state["ok"] else (bool(access.is_restricted(name, config)) and not record.is_admin)
        users[name] = {"restricted": restricted, "is_admin": bool(record.is_admin),
                       "grants": len(grants), "active": sum(1 for g in grants if g["active"]),
                       "policy_overrides": _policy_overrides(entry)}
        if not restricted:
            continue
        for grant in grants:
            if not grant["active"] or grant["kind"] == "remote":
                continue
            for root in live_roots:
                if confinement.is_inside(grant["real"], [root]) or confinement.is_inside(root, [grant["real"]]):
                    held = roots.setdefault(root, [])
                    if name not in held:
                        held.append(name)
    return jsonify(store=state, users=users, roots=roots)


@require_admin
def user_access(username):
    """GET /api/v1/admin/users/<u>/access?offset=&limit="""
    record = _record(username)
    if record is None:
        return _unknown()
    config = current_app.config
    state = settings.access_store_state(config)
    if not state["ok"]:
        return _unreadable(state["error"])
    try:
        offset = _int_arg("offset", 0, 0, 10 ** 9)
        limit = _int_arg("limit", DEFAULT_PAGE, 1, MAX_PAGE)
    except ValueError as exc:
        return _error(400, "bad_request", str(exc) + ".")
    return jsonify(_access_view(config, username, record, offset, limit))


@require_admin
def set_restricted(username):
    """PUT /api/v1/admin/users/<u>/access {restricted}"""
    record = _record(username)
    if record is None:
        return _unknown()
    wanted = _body().get("restricted")
    if not isinstance(wanted, bool):
        return _error(400, "bad_request", "restricted must be true or false.")
    config = current_app.config
    if wanted and record.is_admin:
        _refused("access.restrict", username, "admin_unrestricted")
        return _error(409, "admin_unrestricted",
                      "An administrator is never restricted. Take their admin right away first.")
    try:
        before = access.set_restricted(config, username, wanted)
    except ValueError as exc:
        return _unreadable(exc)
    if _record(username) is None:
        access.forget(config, username)      # removed while this ran: no stray entry for a later namesake
        return _unknown()
    audit.record("access.restrict" if wanted else "access.unrestrict", username,
                 {"restricted": wanted, "was": bool(before)})
    return jsonify(_access_view(config, username, record, 0, DEFAULT_PAGE))


@require_admin
def add_grant(username):
    """POST /api/v1/admin/users/<u>/grants {kind, path}"""
    record = _record(username)
    if record is None:
        return _unknown()
    body = _body()
    kind, path = body.get("kind"), _path_of(body)
    if path is None:
        return _error(400, "bad_request", "A path is required.")
    if kind not in REQUEST_KINDS:
        _refused("access.grant", username, "bad_kind", {"kind": kind if isinstance(kind, str) else None, "path": path})
        return _error(400, "bad_kind", f"kind is one of {', '.join(REQUEST_KINDS)}.")
    config = current_app.config
    actor = _actor()
    try:
        if kind == "stores_in":
            added, skipped = access.add_stores_in(config, username, path, actor=actor)
            added = [{"kind": "store", "path": p, "added_by": actor} for p in added]
        else:
            added, skipped = [access.add_grant(config, username, kind, path, actor=actor)], []
    except access.GrantError as exc:
        _refused("access.grant", username, exc.reason, {"kind": kind, "path": path})
        return _error(GRANT_STATUS.get(exc.reason, 400), exc.reason, str(exc))
    except ValueError as exc:
        return _unreadable(exc)
    except OSError:
        _refused("access.grant", username, "not_found", {"kind": kind, "path": path})
        return _error(404, "not_found", "That folder cannot be read.")
    if _record(username) is None:
        access.forget(config, username)
        return _unknown()
    audit.record("access.grant", username, {"kind": kind, "path": path, "added": len(added),
                                            "skipped": len(skipped)})
    return jsonify(added=added, skipped=skipped), 201


@require_admin
def remove_grant(username):
    """DELETE /api/v1/admin/users/<u>/grants {path}"""
    if _record(username) is None:
        return _unknown()
    path = _path_of(_body())
    if path is None:
        return _error(400, "bad_request", "A path is required.")
    try:
        removed = access.remove_grant(current_app.config, username, path)
    except ValueError as exc:
        return _unreadable(exc)
    if not removed:
        _refused("access.revoke", username, "not_found", {"path": path})
        return _error(404, "not_found", "That user has no such grant.")
    audit.record("access.revoke", username, {"path": path, "removed": len(removed)})
    return jsonify(removed=[{"kind": g.get("kind"), "path": g.get("path")} for g in removed])


def _covering(grants, real):
    """The active local grant that covers ``real``, the way ``Grants.allows_local`` walks up."""
    by_real = {g["real"]: g for g in grants.all if g["active"] and g["kind"] != "remote"}
    current = real
    while True:
        if current in by_real:
            return by_real[current]
        parent = os.path.dirname(current)
        if parent == current:
            return None
        current = parent


def _explain(config, username, path, restricted):
    """``(allowed, via, reason)`` for a path, a sentence for the admin."""
    remote = is_remote_path(path)
    if not remote and (not os.path.isabs(path) or "://" in path):
        return None
    if not restricted:
        if remote:
            try:
                access.normalise_grant(config, "remote", path)
            except access.GrantError:
                return False, None, "Remote stores are off, or this URL is outside the server's remote allowlist."
            return True, None, "This user is not restricted; every remote store the server allows is readable."
        real = os.path.realpath(path)
        if not confinement.is_inside(real, confinement.allowed_roots(config)):
            return False, None, "It is outside every data directory of this server, which is refused for everyone."
        return True, None, "This user is not restricted: everything in the data directories is readable."
    grants = access.grants_of(username, config)
    if remote:
        if not access.may_read(username, path):
            return False, None, "No active remote grant covers this URL."
        parts = _parts(path)
        match = next((g for g in grants.all if g["active"] and g["kind"] == "remote" and g["prefix"].matches(parts)), None)
        via = {"kind": "remote", "path": match["path"]} if match else None
        return True, via, f"Covered by the remote prefix {match['path']}." if match else "Covered by a remote grant."
    real = os.path.realpath(path)
    grant = _covering(grants, real)
    if access.may_read(username, path):
        via = {"kind": grant["kind"], "path": grant["path"]} if grant else None
        return True, via, (f"Covered by the {'folder' if grant['kind'] == 'dir' else 'store'} {grant['path']}."
                           if grant else "Covered by a grant.")
    inactive = next((g for g in grants.all if not g["active"] and g["kind"] != "remote" and g["real"]
                     and confinement.is_inside(real, [g["real"]])), None)
    if inactive:
        return False, None, (f"Only the grant {inactive['path']} would cover it, and that grant is inactive "
                             f"({inactive['reason']}).")
    return False, None, "No active grant covers it."


def _parts(url):
    from ...core.remote import validate_remote_url
    return validate_remote_url(url)


@require_admin
def check():
    """GET /api/v1/admin/access/check?user=&path="""
    username, path = request.args.get("user") or "", request.args.get("path") or ""
    record = _record(username) if username else None
    if record is None:
        return _unknown()
    if not path.strip() or "\0" in path or len(path) > MAX_PATH_CHARS:
        return _error(400, "bad_request", "A path or URL is required.")
    path = path.strip()
    config = current_app.config
    state = settings.access_store_state(config)
    if record.is_admin:
        return jsonify(allowed=True, via=None, reason="Administrators read everything the server serves.")
    if not state["ok"]:
        return jsonify(allowed=False, via=None,
                       reason="The access file is unreadable, so no non-administrator can read data until it is repaired.")
    restricted = access.is_restricted(username, config)
    try:
        verdict = _explain(config, username, path, restricted)
    except ValueError:
        verdict = (False, None, "That is not a valid remote URL.")
    if verdict is None:
        return _error(400, "bad_request", "Give an absolute path or a remote URL.")
    allowed, via, reason = verdict
    return jsonify(allowed=allowed, via=via, reason=reason)


def register(blueprint):
    """Add this section's routes to the admin blueprint."""
    blueprint.add_url_rule("/api/v1/admin/access", "access_overview", overview)
    blueprint.add_url_rule("/api/v1/admin/access/check", "access_check", check)
    blueprint.add_url_rule("/api/v1/admin/users/<username>/access", "user_access", user_access)
    blueprint.add_url_rule("/api/v1/admin/users/<username>/access", "user_access_set", set_restricted,
                           methods=["PUT"])
    blueprint.add_url_rule("/api/v1/admin/users/<username>/grants", "user_grants_add", add_grant, methods=["POST"])
    blueprint.add_url_rule("/api/v1/admin/users/<username>/grants", "user_grants_remove", remove_grant,
                           methods=["DELETE"])
