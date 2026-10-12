"""Admin interface: users.

List, add, remove, reset the password of, grant or revoke admin for, and
unlock accounts. Every change goes through the :class:`AuthManager` methods
that run under the users-file lock on the stored table (the command line uses
the same ones), so "at least one admin" holds across workers and processes.

A password the server generates is in the reply to the request that made it
and nowhere else: not in the logs, not in the audit log (see
``test_admin_users.py``).
"""

import logging
import os
import re
import secrets
import time
from datetime import datetime, timezone

from flask import current_app, jsonify, request

from .. import atomic_store, permissions, session_quota
from ..auth import LastAdminError
from . import audit
from .guard import require_admin

logger = logging.getLogger(__name__)

USERNAME_RE = re.compile(r"^[A-Za-z0-9._@-]{1,64}$")
MIN_PASSWORD = 10


def weak_password_reason(password, username):
    """Why ``password`` is refused, or None. Shared with the account page."""
    if not isinstance(password, str) or len(password) < MIN_PASSWORD:
        return f"Passwords need at least {MIN_PASSWORD} characters."
    if password.lower() == (username or "").lower():
        return "A password must differ from the username."
    return None


def generate_password():
    """A random password for an account, 16 characters of URL-safe base64."""
    return secrets.token_urlsafe(12)


def _error(status, reason, message, **extra):
    return jsonify(error=message, reason=reason, **extra), status


def _body():
    body = request.get_json(silent=True)
    return body if isinstance(body, dict) else {}


def _manager():
    return current_app.auth_manager


def _iso(epoch):
    try:
        return datetime.fromtimestamp(float(epoch), timezone.utc).isoformat()
    except (TypeError, ValueError, OverflowError, OSError):
        return None


def _sessions_dir():
    return os.path.join(current_app.config.get("data_dir") or "", "sessions")


def _locks(user, now):
    out = []
    for address, rec in sorted(user.failed_logins.items()):
        count, until = (list(rec) + [None, None])[:2]
        try:
            live = bool(until) and float(until) > now
        except (TypeError, ValueError):
            live = False
        if live:
            out.append({"address": address, "until": _iso(until), "failures": count})
    return out


def panel_set_counts():
    """{owner: number of panel sets}, from the cached per-file summaries."""
    counts = {}
    for item in session_quota.entries(_sessions_dir()):
        owner = item.data.get("owner")
        if owner:
            counts[owner] = counts.get(owner, 0) + 1
    return counts


def reassign_panel_sets(from_owner, to_owner):
    """Hand every panel set of ``from_owner`` to ``to_owner``; returns how many.

    Each file is re-read and rewritten atomically under the sessions directory's
    lock, which excludes other reassigns. Saves take that lock only once the
    panel-set slice moves this onto the shared session store, so until then a
    save racing this can still lose its write."""
    directory = _sessions_dir()
    if not os.path.isdir(directory):
        return 0
    moved = 0
    with atomic_store.locked(os.path.join(directory, ".lock")):
        for item in session_quota.entries(directory):
            if item.data.get("owner") != from_owner:
                continue
            fresh = atomic_store.read_json(item.path, None)   # not the cached summary
            if not isinstance(fresh, dict) or fresh.get("owner") != from_owner:
                continue
            permissions.stamp_session(fresh, existing=dict(fresh))
            fresh["owner"] = to_owner
            atomic_store.write_json(item.path, fresh, mode=os.stat(item.path).st_mode & 0o777)
            moved += 1
    return moved


def record_audit(action, target=None, detail=None, outcome="ok"):
    """Write an audit record for a change that is already made; True if it was written.

    A failure (disk full, a lock timeout, a directory another OS user owns) must
    not turn an applied change into a 500 the admin would retry: it is logged at
    ERROR, where the ``annzarro.audit`` logger line of earlier records is the
    only other evidence, and the reply says ``audit_failed``."""
    try:
        audit.record(action, target, detail, outcome)
        return True
    except Exception:
        logger.exception("Could not write the audit record of %s on %r (%s); the change itself was made",
                         action, target, outcome)
        return False


def _reply(data, audited, status=200):
    """A JSON success reply, marked when its audit record could not be written."""
    if not audited:
        data = dict(data, audit_failed=True)
    return jsonify(data), status


def _refused(action, reason, target, message):
    """A 409 that the audit log keeps: who tried what to whom, and why not."""
    record_audit(action, target, None, f"refused:{reason}")
    return _error(409, reason, message)


def _actor():
    return permissions.current_user()[0]


def _last_admin_message(verb):
    return f"That would leave the server without an administrator. Make another user an admin before you {verb}."


@require_admin
def list_users():
    """GET /api/v1/admin/users"""
    manager = _manager()
    now = time.time()
    counts = panel_set_counts()
    users = []
    for name, user in sorted(manager.get_users().items()):
        users.append({
            "username": name,
            "is_admin": bool(user.is_admin),
            "last_login": user.last_login,
            "password_changed_at": _iso(user.password_changed_at),
            "locked": _locks(user, now),
            "panel_sets": counts.get(name, 0),
            "last_seen": None,
        })
    return jsonify(users)


@require_admin
def add_user():
    """POST /api/v1/admin/users {username, password? | generate?, is_admin?}"""
    body = _body()
    username = body.get("username")
    if not isinstance(username, str) or not USERNAME_RE.match(username):
        return _error(400, "invalid_username", "Usernames use letters, digits and . _ @ - (up to 64 characters).")
    is_admin = body.get("is_admin", False)
    if not isinstance(is_admin, bool):
        return _error(400, "bad_request", "is_admin must be true or false.")
    generate = body.get("generate", False)
    password = body.get("password")
    if generate is not False and generate is not True:
        return _error(400, "bad_request", "generate must be true or false.")
    if generate == (password is not None):
        return _error(400, "bad_request", "Give a password, or ask for one to be generated.")
    if generate:
        password = generate_password()
    else:
        problem = weak_password_reason(password, username)
        if problem:
            return _error(400, "weak_password", problem)
    if not _manager().create_user(username, password, is_admin=is_admin):
        return _refused("user.add", "user_exists", username, "A user with that name already exists.")
    audited = record_audit("user.add", username, {"is_admin": is_admin, "generated": bool(generate)})
    out = {"username": username}
    if generate:
        out["password"] = password
    return _reply(out, audited, 201)


@require_admin
def remove_user(username):
    """DELETE /api/v1/admin/users/<username> {reassign_to?}"""
    manager = _manager()
    reassign_to = _body().get("reassign_to")
    if reassign_to is not None and (not isinstance(reassign_to, str) or manager.get_user(reassign_to) is None):
        return _error(404, "unknown_user", "No such user to hand the panel sets to.")
    if manager.get_user(username) is None:
        return _error(404, "unknown_user", "No such user.")
    if username == reassign_to:
        return _error(400, "bad_request", "Pick someone else to receive the panel sets.")
    if username == _actor():
        return _refused("user.remove", "self", username, "You cannot remove your own account here. "
                        "Use another administrator or the command line.")
    try:
        removed = manager.remove_user(username)
    except LastAdminError:
        return _refused("user.remove", "last_admin", username, _last_admin_message("remove them"))
    if not removed:
        return _error(404, "unknown_user", "No such user.")
    audited = record_audit("user.remove", username, {"reassign_to": reassign_to})   # before anything else can fail
    moved = 0
    if reassign_to:
        try:
            moved = reassign_panel_sets(username, reassign_to)
        except Exception:
            logger.exception("Removed %r but could not hand their panel sets to %r", username, reassign_to)
            record_audit("panelset.reassign", username, {"to": reassign_to}, "failed")
            return _reply({"removed": username, "panel_sets_reassigned": 0, "reassign_failed": True}, audited)
        audited = record_audit("panelset.reassign", username, {"to": reassign_to, "moved": moved}) and audited
    return _reply({"removed": username, "panel_sets_reassigned": moved}, audited)


@require_admin
def reset_password(username):
    """POST /api/v1/admin/users/<username>/password {password? | generate?}

    Their logins end (``password_changed_at``). The caller's own login stays
    when they reset their own password."""
    from flask import session

    body = _body()
    manager = _manager()
    if manager.get_user(username) is None:
        return _error(404, "unknown_user", "No such user.")
    generate = body.get("generate", False)
    password = body.get("password")
    if generate is not False and generate is not True:
        return _error(400, "bad_request", "generate must be true or false.")
    if generate == (password is not None):
        return _error(400, "bad_request", "Give a password, or ask for one to be generated.")
    if generate:
        password = generate_password()
    else:
        problem = weak_password_reason(password, username)
        if problem:
            return _error(400, "weak_password", problem)
    if not manager.set_password(username, password):
        return _error(404, "unknown_user", "No such user.")
    if username == _actor():
        session["login_at"] = time.time()
    audited = record_audit("user.password", username, {"generated": bool(generate)})
    return _reply({"password": password} if generate else {}, audited)


@require_admin
def set_admin(username):
    """POST /api/v1/admin/users/<username>/admin {is_admin}"""
    is_admin = _body().get("is_admin")
    if not isinstance(is_admin, bool):
        return _error(400, "bad_request", "is_admin must be true or false.")
    manager = _manager()
    if manager.get_user(username) is None:
        return _error(404, "unknown_user", "No such user.")
    if not is_admin and username == _actor():
        return _refused("user.set_admin", "self", username, "You cannot revoke your own admin right here. "
                        "Use another administrator or the command line.")
    try:
        changed = manager.set_admin(username, is_admin)
    except LastAdminError:
        return _refused("user.set_admin", "last_admin", username, _last_admin_message("revoke this"))
    if not changed:
        return _error(404, "unknown_user", "No such user.")
    audited = record_audit("user.set_admin", username, {"is_admin": is_admin})
    return _reply({"is_admin": is_admin}, audited)


@require_admin
def unlock(username):
    """POST /api/v1/admin/users/<username>/unlock {address?}"""
    address = _body().get("address")
    if address is not None and not isinstance(address, str):
        return _error(400, "bad_request", "address must be a string.")
    cleared = _manager().unlock(username, address)
    if cleared is None:
        return _error(404, "unknown_user", "No such user.")
    audited = record_audit("user.unlock", username, {"address": address, "cleared": cleared})
    return _reply({"cleared": cleared}, audited)


def register(blueprint):
    blueprint.add_url_rule("/api/v1/admin/users", "users", list_users)
    blueprint.add_url_rule("/api/v1/admin/users", "users_add", add_user, methods=["POST"])
    blueprint.add_url_rule("/api/v1/admin/users/<username>", "users_remove", remove_user, methods=["DELETE"])
    blueprint.add_url_rule("/api/v1/admin/users/<username>/password", "users_password", reset_password,
                           methods=["POST"])
    blueprint.add_url_rule("/api/v1/admin/users/<username>/admin", "users_admin", set_admin, methods=["POST"])
    blueprint.add_url_rule("/api/v1/admin/users/<username>/unlock", "users_unlock", unlock, methods=["POST"])
