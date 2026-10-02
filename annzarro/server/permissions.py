"""
Who may change a shared panel set
---------------------------------

AnnZarro never writes datasets. The one thing users write is panel sets, stored
as JSON in a sessions directory that every user of the server shares. Without
a rule, anyone who can reach the server can delete or overwrite anyone else's
work, so when login is enabled:

* Reading, loading, exporting and duplicating a panel set is open to every
  logged-in user.
* Deleting, renaming or overwriting one is allowed to its ``owner`` (the user
  who first saved it) and to admins (``annzarro user add --admin``).
* A panel set saved before ownership was recorded has no owner and can only be
  changed by an admin. Guessing an owner would hand someone else's work to
  whoever touched it first.

When login is disabled (``auth_enabled`` false) there is a single, anonymous
user, everything is allowed and nothing changes from earlier behaviour.

The ``owner``/``created_at``/``modified_at``/``modified_by`` fields are written
by the server only; :func:`stamp_session` discards whatever a client sends for
them, so ownership cannot be claimed by editing a JSON file and importing it.
"""

from datetime import datetime

from flask import current_app, jsonify, session

#: Fields owned by the server. A client-supplied value is always discarded.
SERVER_FIELDS = ("owner", "created_at", "modified_at", "modified_by")

LOCAL_HOSTS = ("127.0.0.1", "localhost", "::1")


def auth_enabled():
    """Whether login is enforced for this app."""
    return bool(current_app.config.get("auth_enabled", False))


def current_user():
    """Return ``(username, is_admin)`` for the requester.

    ``(None, False)`` when login is disabled or nobody is logged in.

    Admin status is read from the user store rather than trusted from the
    session cookie, so removing a user or revoking admin takes effect for an
    existing session; the cookie value is only a fallback when no store is
    attached.
    """
    if not auth_enabled():
        return None, False
    username = session.get("user_id")
    if not username:
        return None, False
    manager = getattr(current_app, "auth_manager", None)
    if manager is None:
        return username, bool(session.get("is_admin", False))
    user = manager.get_user(username)
    if user is None:
        return None, False
    return username, bool(user.is_admin)


def can_modify(session_data):
    """Whether the requester may delete, rename or overwrite ``session_data``.

    ``session_data`` is the stored panel set (a dict) or ``None`` when it does
    not exist yet, in which case anyone allowed to save may create it.
    """
    if not auth_enabled():
        return True
    if session_data is None:
        return True
    username, is_admin = current_user()
    if is_admin:
        return True
    owner = session_data.get("owner") if isinstance(session_data, dict) else None
    return owner is not None and username is not None and owner == username


def forbidden(action, name, session_data):
    """A 403 that says WHY, in a field the client can branch on.

    ``reason`` is ``"not_owner"`` or ``"legacy_admin_only"``; ``owner`` is the
    recorded owner (``None`` for a legacy set) so the UI can name them.
    """
    owner = session_data.get("owner") if isinstance(session_data, dict) else None
    if owner is None:
        message = (f"Panel set '{name}' was saved before owners were recorded, "
                   f"so only an admin can {action} it. Save your changes under "
                   f"a new name instead.")
        reason = "legacy_admin_only"
    else:
        message = (f"Panel set '{name}' belongs to {owner}; only {owner} or an "
                   f"admin can {action} it. Save your changes under a new name "
                   f"instead.")
        reason = "not_owner"
    return jsonify({
        "error": message,
        "reason": reason,
        "owner": owner,
        "action": action,
    }), 403


def stamp_session(session_data, existing=None):
    """Set the server-owned metadata on ``session_data`` before it is written.

    ``existing`` is the panel set being replaced, if any. Ownership and the
    creation time carry over from it; a new set is owned by the requester
    (``None`` when login is disabled). Returns ``session_data``.
    """
    for field in SERVER_FIELDS:
        session_data.pop(field, None)

    username, _ = current_user()
    now = datetime.now().isoformat()

    if existing is not None:
        owner = existing.get("owner")
        created_at = existing.get("created_at") or existing.get("timestamp") or now
    else:
        owner = username
        created_at = now

    session_data["owner"] = owner
    session_data["created_at"] = created_at
    session_data["modified_at"] = now
    session_data["modified_by"] = username
    return session_data


def is_shared(config):
    """Whether people other than the operator can reach this server.

    An explicit ``hosted`` setting (``server.hosted``) decides. The WSGI entry
    point sets it True by default because gunicorn, not the app, owns the
    bind address. Without it, ``annzarro start`` judges by its own bind host.
    """
    hosted = config.get("hosted")
    if hosted is not None:
        return bool(hosted)
    host = config.get("host") or "127.0.0.1"
    return host not in LOCAL_HOSTS


def is_exposed(config):
    """True when the server is shared with login disabled."""
    return is_shared(config) and not config.get("auth_enabled", False)
