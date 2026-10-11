"""
Who may read which dataset, and the gate that fails closed
-----------------------------------------------------------

Every route declares what kind of data it serves, with ``@gate(kind)`` placed
directly under its ``@app.route``:

``public``
    No dataset data (the page shell, assets, login, config, the requester's
    own account).
``dataset``
    Every dataset path the request names is checked by :func:`enforce`
    (``?dataset_path=``, ``/datasets/<path>``, ``?dir=``).
``remote``
    A remote store URL (``zarr/url``) is checked.
``listing``
    A folder argument is checked by :func:`enforce`, and the entries the view
    returns go through :func:`filter_entries`.
``panelset``
    Panel sets; filtered or checked inside the view.
``admin``
    Admin only. The views enforce it today.

:func:`enforce` is a ``before_request`` hook registered right after
``confinement.enforce``, so it sees the final absolute path. A route that
declares no gate is answered :func:`not_found` for everyone and logged at
ERROR: a new endpoint can never be open by accident. The test in
``tests/server/test_data_access_matrix.py`` fails first.

A requester who may not read a path gets exactly the reply a nonexistent
store gets, decided before any filesystem access beyond ``realpath``, so
neither the status nor the body tells "not allowed" from "not there".

Invariant: a cache whose value spans datasets (any listing) is filtered per
requester AFTER the lookup, never answered unfiltered. Per-dataset caches,
ETags and 304s are reached only after this hook.

Until the grants exist, :func:`is_restricted` is false for everyone and
:func:`may_read` allows everything, so the gate changes no reply.
"""

import logging
import os

from flask import current_app, jsonify, request

from ..core.remote import is_remote_path
from . import confinement, permissions

logger = logging.getLogger(__name__)

GATE_KINDS = ("public", "dataset", "remote", "listing", "panelset", "admin")

#: Kinds whose replies depend on who asks, so a shared cache must key on the cookie.
DATA_KINDS = ("dataset", "remote", "listing", "panelset")

#: Extra argument that carries a path or URL, by endpoint (the rest is in confinement).
URL_ENDPOINTS = {"validate_zarr_url": "url"}
FOLDER_ENDPOINTS = {"list_dataset_folder": "folder"}


def gate(kind):
    """Declare the gate of a route; place it directly under ``@app.route``."""
    if kind not in GATE_KINDS:
        raise ValueError(f"unknown gate kind {kind!r}; one of {', '.join(GATE_KINDS)}")

    def declare_on(view):
        view._annzarro_gate = kind
        return view
    return declare_on


def declare(app, endpoint, kind):
    """Declare the gate of an endpoint that has no view of ours to decorate (Flask's ``static``)."""
    if kind not in GATE_KINDS:
        raise ValueError(f"unknown gate kind {kind!r}; one of {', '.join(GATE_KINDS)}")
    app.extensions.setdefault("annzarro_gates", {})[endpoint] = kind


def gate_of(app, endpoint):
    """The declared gate of ``endpoint``, or None."""
    declared = app.extensions.get("annzarro_gates", {}).get(endpoint)
    if declared:
        return declared
    return getattr(app.view_functions.get(endpoint), "_annzarro_gate", None)


def is_restricted(user):
    """Whether ``user`` sees only granted datasets. Nobody does until grants exist."""
    return False


def may_read(user, path):
    """Whether ``user`` may read ``path`` (realpath'd when local, the URL when remote)."""
    return True


def entry_path(entry):
    """The path of a listing entry (a dict with ``path``), None for anything else."""
    return entry.get("path") if isinstance(entry, dict) else None


def filter_entries(entries, key=entry_path):
    """``entries`` of a listing the requester may see.

    Identity for admins, anonymous requests and unrestricted users, which is
    one lookup. For a restricted user, entries whose ``key`` they may not read
    are dropped.
    """
    user, is_admin = permissions.current_user()
    if user is None or is_admin or not is_restricted(user):
        return entries
    # an entry that names no path cannot be shown to a restricted user
    return [entry for entry in entries if key(entry) and _readable(user, key(entry))]


def missing_store(path):
    """Whether ``path`` names a local store that is not there (a remote URL never does)."""
    return bool(path) and not is_remote_path(path) and not os.path.exists(path)


def not_found(path=None, segment=False, endpoint=None):
    """The reply a nonexistent store gets (404 ``not_found``).

    ``segment`` is the ``/datasets/<path>`` form, which names the path in the
    URL instead of an argument. A listing answers as it does for a folder
    that does not exist.
    """
    if endpoint == "list_legacy_datasets":
        return jsonify({"datasets": []})
    if endpoint == "list_directory":
        return jsonify({"error": f"Directory not found: {path}"}), 404
    if endpoint == "list_dataset_folder":
        return jsonify({"error": "Folder not found", "reason": "not_found"}), 404
    if segment:
        return jsonify({"error": "Dataset not found. /datasets/<path> is relative "
                                 "to the server's data directory.",
                        "reason": "not_found"}), 404
    return jsonify({"error": f"Dataset not found: {path}" if path is not None else "Not found",
                    "exception": "FileNotFoundError",
                    "reason": "not_found"}), 404


def _readable(user, value):
    """``may_read`` for a path or URL as the request spells it."""
    if not value:
        return True
    if is_remote_path(value):
        return may_read(user, value)
    return may_read(user, os.path.realpath(os.path.expanduser(value)))


def _named(endpoint):
    """``[(spelling, is_segment)]``: every path or URL the request names that the gate checks."""
    segment = (request.view_args or {}).get("dataset_path")
    named = [(value, bool(segment) and value == segment) for value in confinement.request_paths(remote=True)]
    extra = URL_ENDPOINTS.get(endpoint)
    if extra and request.args.get(extra):
        named.append((request.args.get(extra), False))
    folder = FOLDER_ENDPOINTS.get(endpoint)
    if folder and request.args.get(folder):
        from .routes import dataset_folders
        named.append((dataset_folders._resolve_folder(current_app.config, request.args.get(folder)), False))
    return named


def enforce():
    """``before_request`` hook: undeclared endpoints and unreadable paths answer 404."""
    endpoint = request.endpoint
    if endpoint is None:
        return None   # no route matched: Flask answers 404/405 itself
    kind = gate_of(current_app, endpoint)
    if kind is None:
        logger.error(f"Endpoint {endpoint!r} ({request.path}) declares no access gate; refused for everyone. "
                     f"Add @access.gate(...) under its @app.route.")
        return not_found()
    if kind not in ("dataset", "remote", "listing"):
        return None
    user, is_admin = permissions.current_user()
    if user is None or is_admin or not is_restricted(user):
        return None
    for value, segment in _named(endpoint):
        if not _readable(user, value):
            logger.info(f"Refused {user!r} {request.path}: {value!r} is not in their grants")
            return not_found(value, segment=segment, endpoint=endpoint)
    return None


def mark_vary(response):
    """``after_request`` hook: replies that depend on the requester say so."""
    kind = gate_of(current_app, request.endpoint) if request.endpoint else None
    if kind in DATA_KINDS:
        response.vary.add("Cookie")
    return response


def install(app):
    """Register the gate's hooks (call right after ``confinement.enforce``)."""
    declare(app, "static", "public")
    app.before_request(enforce)
    app.after_request(mark_vary)
