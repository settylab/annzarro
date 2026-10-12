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
    Admin only. The admin interface's views guard themselves; for the older
    ``status`` and ``cache/info`` a restricted user is refused here (403
    ``admin_only``), because they name the data directory and every cached
    dataset.

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

A denied folder answers as a missing one does on each listing route:
``directories/list`` and ``datasets/folder`` 404, while the legacy
``core/datasets?dir=`` answers 200 with an empty list, exactly as it does for
a directory that is not there.

The reply echoes the path the way the client spelled it (``spelled``), never
the resolved absolute path, so the server's layout is not disclosed.

Grants
------

``annzarro_admin/access.json`` (beside ``users.json``) is keyed by principal::

    {"version": 1,
     "principals": {"user:carol": {"restricted": true,
                                   "grants": [{"kind": "dir", "path": "/srv/atlases/pbmc"},
                                              {"kind": "store", "path": "/srv/data/bm.zarr"},
                                              {"kind": "remote", "path": "s3://lab-public/pbmc/"}],
                                   "policy": {...}}}}

No entry, or ``restricted`` absent or false, is the default: the user reads
everything the server's data directories hold, and the check is one lookup.
A restricted user reads only what an *active* grant covers; none means
nothing. :func:`principals_of` is the one place a later group layer would add
its principals. Admins are never restricted (``is_restricted_requester``).

Grants name paths; they are matched on REAL paths and compared exactly:

* a ``dir`` or ``store`` grant is resolved with ``realpath`` (and spelled the
  way the directory spells it, :func:`canonical_spelling`) every time
  ``access.json`` changes and at least every ``RESOLVE_TTL_S`` seconds, and is
  active only while that real path lies inside an allowed data directory;
* a request path is ``realpath``'d first, then it is covered when it, or any
  of its parents, is a granted real path. A symlink inside a granted folder
  that leads out is therefore NOT covered, a link to a granted store from
  outside is, and ``/data/a`` does not cover ``/data/ab``;
* a spelling that differs by case or Unicode form is not the same string, so
  on a case-insensitive or normalising filesystem (APFS) it is refused: the
  check is an allow-list on exact strings and cannot be talked into a match.
  The listings hand out exact spellings, which are the ones that pass;
* a ``remote`` grant is a URL prefix on a ``/`` boundary, inside
  ``remote_allowlist`` and only while remote stores are enabled.

A malformed entry restricts its user to nothing. An ``access.json`` that
cannot be read or parsed says nothing about WHO is restricted, so every
non-admin is answered 503 ``access_unavailable`` on the data routes until an
admin repairs it (:func:`unavailable_reply`); admins keep working.
"""

import logging
import os
import threading
import time
import unicodedata
import urllib.parse

from flask import current_app, g, has_request_context, jsonify, request

from ..core.remote import _Prefix, get_remote_policy, is_remote_path, validate_remote_url
from . import atomic_store, confinement, permissions

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


#: Grant kinds, as stored.
GRANT_KINDS = ("dir", "store", "remote")

#: Seconds a user's grants stay resolved (``realpath``) before they are resolved again, so a
#: link re-pointed while the server runs cannot keep covering the old target for long.
RESOLVE_TTL_S = 2.0


def principals_of(user):
    """The principals whose entries of ``access.json`` apply to ``user``.

    Just the user. A group layer would add ``group:<name>`` for each group the
    user is in, here and nowhere else: the grants and the policy layer both
    ask this function.
    """
    return [f"user:{user}"]


# -- reading access.json ------------------------------------------------------------

_watchers = {}   # id(config): (config, watcher): finding the watcher resolves the file's real path, which a request must not repeat


def _watcher(config):
    # the file, its path and its watcher are slice S's (admin/settings.py): one store, one stamp
    hit = _watchers.get(id(config))
    if hit is not None and hit[0] is config:
        return hit[1]
    from .admin import settings
    watcher = settings._access_watcher(config)
    if len(_watchers) > 64:       # many short-lived configs (tests, the CLI): never grow without bound
        _watchers.clear()
    _watchers[id(config)] = (config, watcher)
    return watcher


def _read(config=None):
    """``(principals, error)``: the entries of ``access.json``, or why it cannot be trusted."""
    config = config or current_app.config
    from .admin import settings
    state = settings.access_store_state(config)          # slice S's shared check: does the file parse?
    data = _watcher(config).get()
    if not state["ok"]:
        return {}, state["error"]
    principals = data.get("principals") if isinstance(data, dict) else None
    if not isinstance(principals, dict):
        return {}, "access.json has no 'principals' object"
    return principals, None


def store_error(config=None):
    """Why ``access.json`` cannot be trusted (a sentence), or None when it can."""
    return _read(config)[1]


def _flag(entry):
    """Whether one principal's entry restricts. Only an absent, null or false flag does not."""
    if not isinstance(entry, dict):
        return True       # a malformed entry: unsure, so nothing
    flag = entry.get("restricted")
    return not (flag is None or flag is False)      # not `in (None, False)`: 0 == False


def is_restricted(user, config=None):
    """Whether ``user`` sees only granted datasets.

    False for no entry (the default), for ``restricted: false`` and for a
    missing user name. True when ``access.json`` is unreadable: whoever asks
    cannot be shown to be unrestricted. Callers skip admins first.
    """
    if not user:
        return False
    principals, error = _read(config)
    if error:
        return True
    return any(_flag(principals[name]) for name in principals_of(user) if name in principals)


def _is_admin(user):
    manager = getattr(current_app, "auth_manager", None)
    record = manager.get_user(user) if manager is not None else None
    return bool(record and record.is_admin)


# -- grants, resolved ------------------------------------------------------------------

def _fold(text):
    return unicodedata.normalize("NFC", text).casefold()


def _name_on_disk(parent, name):
    """``name`` spelled the way directory ``parent`` spells it.

    Only a directory that answers to another spelling of a name (APFS, or any
    case-insensitive or normalising mount) can hold it under a different
    spelling; on a case-sensitive one the name is returned as it is, after
    two failed lookups.
    """
    others = {name.swapcase(), unicodedata.normalize("NFC", name), unicodedata.normalize("NFD", name)} - {name}
    if not any(os.path.lexists(os.path.join(parent, other)) for other in others):
        return name
    try:
        names = os.listdir(parent)
    except OSError:
        return name
    if name in names:
        return name
    folded = _fold(name)
    for candidate in names:
        if _fold(candidate) == folded:
            try:
                if os.path.samefile(os.path.join(parent, candidate), os.path.join(parent, name)):
                    return candidate
            except OSError:
                continue
    return name


def canonical_spelling(path):
    """The real path of ``path``, each component spelled as its directory spells it.

    ``realpath`` follows links and removes ``..`` but leaves a case or
    Unicode variant as typed, so a grant written ``/Srv/Atlas`` would never
    equal the ``/srv/atlas/x.zarr`` a listing hands out.
    """
    real = os.path.realpath(path)
    out = os.sep
    for part in real.split(os.sep):
        if part:
            out = os.path.join(out, _name_on_disk(out, part))
    return out


def _inside(path, root):
    return path == root or path.startswith(root.rstrip(os.sep) + os.sep)


def _covers(allowed, prefix):
    """Whether remote prefix ``prefix`` lies inside the allowlist entry ``allowed``."""
    return (allowed.scheme == prefix.scheme and allowed.netloc == prefix.netloc
            and (prefix.path or "/").startswith(allowed.path or "/"))


def _resolve(grant, roots, policy):
    """One stored grant with ``real`` (or ``prefix``), ``active`` and, when not, ``reason``."""
    info = {"kind": None, "path": None, "real": None, "prefix": None, "active": False,
            "reason": "malformed", "name": None}
    if not isinstance(grant, dict):
        return info
    kind, path = grant.get("kind"), grant.get("path")
    info.update(kind=kind if isinstance(kind, str) else None, path=path if isinstance(path, str) else None,
                added_by=grant.get("added_by"), added_at=grant.get("added_at"))
    if kind not in GRANT_KINDS or not isinstance(path, str) or not path or "\x00" in path:
        return info
    if kind == "remote":
        try:
            prefix = _Prefix.parse(path)
        except ValueError:
            info["reason"] = "invalid_url"
            return info
        info.update(prefix=prefix, name=str(prefix))
        if not policy.enabled:
            info["reason"] = "remote_stores_disabled"
        elif policy.allowlist and not any(_covers(allowed, prefix) for allowed in policy.allowlist):
            info["reason"] = "outside_remote_allowlist"
        else:
            info.update(active=True, reason=None)
        return info
    if not os.path.isabs(path):
        info["reason"] = "not_absolute"
        return info
    real = canonical_spelling(path)
    info.update(real=real, name=os.path.basename(real.rstrip(os.sep)) or real)
    if not any(_inside(real, root) for root in roots):
        info["reason"] = "outside_data_directories"
    else:
        info.update(active=True, reason=None)
    return info


class Grants:
    """The resolved grants of one user: what the gate and the listings read."""

    def __init__(self, resolved):
        self.all = resolved
        self.local = frozenset(g["real"] for g in resolved if g["active"] and g["kind"] != "remote")
        self.remote = tuple(g["prefix"] for g in resolved if g["active"] and g["kind"] == "remote")

    def allows_local(self, real):
        """Whether the real path ``real`` is a granted path or below one."""
        current = real
        while True:
            if current in self.local:
                return True
            parent = os.path.dirname(current)
            if parent == current:
                return False
            current = parent

    def allows_remote(self, url):
        try:
            parts = validate_remote_url(url)
        except ValueError:
            return False
        # a server may decode %2e%2e or read a backslash as a slash after the allowlist matched
        decoded = urllib.parse.unquote(parts.path)
        if "\\" in decoded or "." in decoded.split("/") or ".." in decoded.split("/"):
            return False
        return any(prefix.matches(parts) for prefix in self.remote)

    def active(self):
        """The active ``dir`` and ``store`` grants (dicts with ``real`` and ``name``), by name."""
        return sorted((g for g in self.all if g["active"] and g["kind"] != "remote"),
                      key=lambda g: (g["name"].lower(), g["real"]))


_resolved = {}   # user: (principals, overlay stamp, resolved at, Grants)


def _overlay_stamp(config):
    from .admin import overlay
    return atomic_store.stamp(overlay.path(config))


def grants_of(user, config=None):
    """The :class:`Grants` of ``user`` (none for a malformed or unreadable file).

    Re-resolved when ``access.json`` or ``overlay.json`` (which can add or drop
    data directories) changed, and every ``RESOLVE_TTL_S`` seconds otherwise.
    Memoised for one request.
    """
    config = config or current_app.config
    memo = g.__dict__.setdefault("_access_grants", {}) if has_request_context() else None
    if memo is not None and user in memo:
        return memo[user]
    principals, error = _read(config)
    stamp = _overlay_stamp(config)
    now = time.monotonic()
    hit = _resolved.get(user)
    if hit and hit[0] is principals and hit[1] == stamp and now - hit[2] < RESOLVE_TTL_S:
        grants = hit[3]
    else:
        stored = []
        if not error:
            for name in principals_of(user):
                entry = principals.get(name)
                raw = entry.get("grants") if isinstance(entry, dict) else None
                if isinstance(raw, list):
                    stored.extend(raw)
        roots = confinement.allowed_roots(config)
        policy = get_remote_policy()
        grants = Grants([_resolve(grant, roots, policy) for grant in stored])
        _resolved[user] = (principals, stamp, now, grants)
    if memo is not None:
        memo[user] = grants
    return grants


def may_read(user, path):
    """Whether ``user`` may read ``path``: a local path (``realpath`` is applied here, first) or a remote URL.

    An unrestricted user and an admin may; a restricted one only what an
    active grant covers. Anything this function cannot tell is refused.
    """
    if not is_restricted(user) or _is_admin(user):
        return True
    if not isinstance(path, str) or not path or "\x00" in path:
        return False
    grants = grants_of(user)
    if is_remote_path(path):
        return grants.allows_remote(path)
    if "://" in path:
        return False      # file:// and the like are not paths of ours
    return grants.allows_local(os.path.realpath(os.path.expanduser(path)))


def display_path(user, real):
    """``real`` as a restricted ``user`` is shown it: from the name of the granted folder or store down.

    The directories above a grant are not theirs to learn.
    """
    best = None
    for grant in grants_of(user).active():
        if _inside(real, grant["real"]) and (best is None or len(grant["real"]) > len(best)):
            best = grant["real"]
    if best is None:
        return os.path.basename(real)
    return os.path.relpath(real, os.path.dirname(best.rstrip(os.sep)) or os.sep)


# -- panel sets --------------------------------------------------------------------------

def _resolve_name(config, value):
    """A dataset path from a stored panel set as the readers see it: a relative one is in the data directory."""
    if is_remote_path(value) or "://" in value or os.path.isabs(os.path.expanduser(value)):
        return value
    data_dir = config.get("data_dir")
    return os.path.join(os.path.expanduser(data_dir), os.path.normpath(value)) if data_dir else value


def unreadable_dataset(user, data, config=None):
    """The first dataset of the stored panel set ``data`` that ``user`` may not read (as the set spells it), else None.

    What opening the set would open must be readable. A path the set only
    remembers from another server (``datasetAbs``) counts only where it
    points inside this server's data directories.
    """
    config = config or current_app.config
    named, hints = permissions.panelset_datasets(data)
    for value in named:
        if not may_read(user, _resolve_name(config, value)):
            return value
    roots = confinement.allowed_roots(config)
    for value in hints:
        if not is_remote_path(value) and "://" not in value:
            real = os.path.realpath(os.path.expanduser(value))
            if any(_inside(real, root) for root in roots) and not may_read(user, real):
                return value
    return None


def panelset_visible(user, data, owner=None):
    """Whether a restricted ``user`` may see the stored panel set ``data``: their own, or one whose datasets they can all read."""
    if owner is None and isinstance(data, dict):
        owner = data.get("owner")
    return (owner is not None and owner == user) or unreadable_dataset(user, data) is None


def panelset_available(user, data):
    """Whether every dataset of the panel set is readable to ``user`` (shown beside their own sets)."""
    return unreadable_dataset(user, data) is None


# -- writing access.json -----------------------------------------------------------------

class GrantError(ValueError):
    """A grant change that is refused; ``reason`` is a stable word for the caller."""

    def __init__(self, reason, message):
        super().__init__(message)
        self.reason = reason


def update_entry(config, user, mutate):
    """Change ``user``'s entry in ``access.json`` under the file's lock.

    ``mutate(entry)`` edits the entry (a dict) and may return a value. Fields
    it does not touch, such as the per-user ``policy`` slice S writes, are
    kept; an entry left empty is removed. Raises ValueError when the file is
    corrupt rather than replace it.
    """
    from .admin import settings, state_dir
    os.makedirs(state_dir(config, create=True), exist_ok=True)
    watcher = _watcher(config)
    name = principals_of(user)[0]

    def apply(data):
        principals = data.setdefault("principals", {})
        if not isinstance(principals, dict):
            raise ValueError("access.json: principals is not an object")
        entry = principals.get(name)
        if entry is not None and not isinstance(entry, dict):
            raise ValueError(f"access.json: the entry of {name} is not an object")
        entry = dict(entry or {})
        result = mutate(entry)
        if entry:
            principals[name] = entry
        else:
            principals.pop(name, None)
        data["version"] = settings.ACCESS_VERSION
        return result

    try:
        return atomic_store.update_json(settings.access_path(config), apply, settings._access_default())
    finally:
        watcher.invalidate()


def forget(config, user):
    """Drop everything ``access.json`` holds for a removed user (grants, flag and policy)."""
    def drop(entry):
        entry.clear()
    from .admin import settings
    if not os.path.exists(settings.access_path(config)):
        return
    update_entry(config, user, drop)


def entry_of(user, config=None):
    """The stored entry of ``user`` as a copy (``{}`` if none)."""
    principals, _ = _read(config)
    entry = principals.get(principals_of(user)[0])
    return dict(entry) if isinstance(entry, dict) else {}


def normalise_grant(config, kind, path):
    """``(kind, stored path)`` for a grant an admin asks for, or GrantError.

    ``kind`` is ``dir``, ``store``, ``remote`` or ``auto`` (a URL is remote, a
    store or ``.h5ad`` is a store, any other directory is a dir). A local path
    must exist and, once resolved, lie inside an allowed data directory; a
    remote URL must be inside ``remote_allowlist`` with remote stores enabled.
    The path is stored as written (made absolute), not resolved, so a link
    that is re-pointed later stops being covered if its target leaves the
    data directories.
    """
    if not isinstance(path, str) or not path.strip():
        raise GrantError("bad_path", "A grant needs a path.")
    path = path.strip()
    if kind == "auto":
        kind = "remote" if is_remote_path(path) else None
    if kind == "remote" or (kind is None and is_remote_path(path)):
        try:
            prefix = _Prefix.parse(path)
        except ValueError as exc:
            raise GrantError("bad_path", str(exc))
        policy = get_remote_policy()
        if not policy.enabled or (policy.allowlist and not any(_covers(a, prefix) for a in policy.allowlist)):
            raise GrantError("remote_not_allowed", "That URL is not inside the server's remote allowlist.")
        return "remote", str(prefix)
    if kind not in (None, "dir", "store"):
        raise GrantError("bad_kind", f"A grant is a dir, a store or a remote prefix, not {kind!r}.")
    absolute = os.path.abspath(os.path.expanduser(path))
    if not os.path.exists(absolute):
        raise GrantError("not_found", f"{path} does not exist.")
    real = canonical_spelling(absolute)
    if not any(_inside(real, root) for root in confinement.allowed_roots(config)):
        raise GrantError("outside_data_roots", f"{path} is outside every data directory of this server.")
    if kind is None:
        from .routes.dataset_folders import is_store_dir
        is_store = (os.path.isfile(real) and real.endswith(".h5ad")) or \
                   (os.path.isdir(real) and is_store_dir(real, os.path.basename(real)))
        kind = "store" if is_store else "dir"
    if kind == "dir" and not os.path.isdir(real):
        raise GrantError("not_a_directory", f"{path} is not a directory.")
    return kind, absolute


def add_grant(config, user, kind, path, actor=None, now=None):
    """Grant ``user`` a folder, a store or a remote prefix; the stored grant.

    Raises GrantError (``already_granted`` when that path is granted already).
    """
    from datetime import datetime
    kind, stored = normalise_grant(config, kind, path)

    def add(entry):
        grants = entry.setdefault("grants", [])
        if not isinstance(grants, list):
            raise ValueError("access.json: grants is not a list")
        if any(isinstance(g, dict) and g.get("path") == stored for g in grants):
            raise GrantError("already_granted", f"{stored} is already granted.")
        grant = {"kind": kind, "path": stored, "added_by": actor,
                 "added_at": now or datetime.now().isoformat(timespec="seconds")}
        grants.append(grant)
        return grant

    return update_entry(config, user, add)


def add_stores_in(config, user, folder, actor=None, limit=None):
    """Grant ``user`` every store directly inside ``folder`` (one ``store`` grant each); ``(added, skipped)``.

    For a curated folder of links: the grants name the links, which are
    followed to their targets, so a link leading outside the data directories
    is skipped (with its reason) rather than granted. Bounded by ``limit``
    (default ``dataset_folder_max_entries``) stores; all written in one change.
    """
    from datetime import datetime
    from .routes.dataset_folders import DEFAULT_MAX_ENTRIES, is_store_dir
    limit = int(limit or config.get("dataset_folder_max_entries") or DEFAULT_MAX_ENTRIES)
    _, root = normalise_grant(config, "dir", folder)
    candidates = []
    for name in sorted(os.listdir(root)):
        path = os.path.join(root, name)
        if name.startswith("."):
            continue
        if (name.endswith(".h5ad") and os.path.isfile(path)) or (os.path.isdir(path) and is_store_dir(path, name)):
            candidates.append(path)
    if len(candidates) > limit:
        raise GrantError("too_many", f"{folder} holds {len(candidates)} stores; at most {limit} can be granted at once.")
    wanted, skipped = [], []
    for path in candidates:
        try:
            wanted.append(normalise_grant(config, "store", path)[1])
        except GrantError as exc:
            skipped.append({"path": path, "reason": exc.reason})
    now = datetime.now().isoformat(timespec="seconds")

    def add(entry):
        grants = entry.setdefault("grants", [])
        if not isinstance(grants, list):
            raise ValueError("access.json: grants is not a list")
        have = {g.get("path") for g in grants if isinstance(g, dict)}
        added = []
        for path in wanted:
            if path in have:
                skipped.append({"path": path, "reason": "already_granted"})
                continue
            grants.append({"kind": "store", "path": path, "added_by": actor, "added_at": now})
            added.append(path)
        if not grants:
            entry.pop("grants")
        return added

    return update_entry(config, user, add), skipped


def remove_grant(config, user, path):
    """Revoke ``path`` (as stored, or any spelling of the same real path); the removed grants."""
    wanted = {path.strip(), os.path.abspath(os.path.expanduser(path.strip())), str(_prefix_or(path))}
    wanted_real = canonical_spelling(os.path.abspath(os.path.expanduser(path.strip())))

    def remove(entry):
        grants = entry.get("grants")
        if not isinstance(grants, list):
            return []
        kept, removed = [], []
        for grant in grants:
            stored = grant.get("path") if isinstance(grant, dict) else None
            same = isinstance(stored, str) and (stored in wanted or (
                grant.get("kind") != "remote" and canonical_spelling(stored) == wanted_real))
            (removed if same else kept).append(grant)
        if removed:
            if kept:
                entry["grants"] = kept
            else:
                entry.pop("grants", None)
        return removed

    return update_entry(config, user, remove)


def _prefix_or(path):
    try:
        return _Prefix.parse(path.strip()) if is_remote_path(path.strip()) else ""
    except ValueError:
        return ""


def set_restricted(config, user, restricted):
    """Turn the restriction of ``user`` on or off (the grants stay); the previous value."""
    def change(entry):
        before = _flag(entry) if entry else False
        if restricted:
            entry["restricted"] = True
        else:
            entry.pop("restricted", None)
        return before

    return update_entry(config, user, change)


def describe(user, config=None):
    """What an admin sees of ``user``'s access: ``{restricted, grants: [...]}`` with each grant's state."""
    entry = entry_of(user, config)
    grants = grants_of(user, config)
    return {"restricted": is_restricted(user, config),
            "grants": [{"kind": g["kind"], "path": g["path"], "real": g["real"] if g["kind"] != "remote" else None,
                        "active": g["active"], "inactive_reason": g["reason"],
                        "added_by": g.get("added_by"), "added_at": g.get("added_at")} for g in grants.all],
            "policy": entry.get("policy") or {}}


def unavailable_reply():
    """The 503 for a logged-in non-admin while ``access.json`` cannot be trusted; None otherwise.

    Admins are not held up, so they can repair the file. With login off there
    are no users, so no restriction.
    """
    user, is_admin = permissions.current_user()
    if not user or is_admin:
        return None
    error = store_error()
    if error is None:
        return None
    _log_unavailable(error)
    return jsonify({"error": "Dataset access is unavailable right now. Ask an administrator.",
                    "reason": "access_unavailable",
                    "code": "store_unreadable"}), 503


_unavailable_logged = [0.0]


def _log_unavailable(error):
    now = time.monotonic()
    if now - _unavailable_logged[0] >= LOG_WINDOW_S:
        _unavailable_logged[0] = now
        logger.error(f"access.json cannot be read ({error}): every non-admin is refused with 503 "
                     f"access_unavailable until an administrator repairs or removes it")


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


def remember_spelling(resolved, original):
    """Note how the client spelled a path the server resolved against ``data_dir``."""
    if resolved != original:
        if "requested_paths" not in g:
            g.requested_paths = {}
        g.requested_paths[resolved] = original


def spelled(path):
    """``path`` as the client wrote it (itself when it was not resolved)."""
    return g.get("requested_paths", {}).get(path, path)


def restricted_user():
    """The name of the current requester when they are a logged-in non-admin who is restricted, else None."""
    user, is_admin = permissions.current_user()
    return user if user and not is_admin and is_restricted(user) else None


def is_restricted_requester():
    """Whether the current requester is a logged-in non-admin who is restricted."""
    return restricted_user() is not None


def refusal(value):
    """The reply for a path of the current request that the requester may not open."""
    segment = (request.view_args or {}).get("dataset_path")
    return not_found(value, segment=bool(segment) and value == segment, endpoint=request.endpoint)


def not_found(path=None, segment=False, endpoint=None):
    """The reply a nonexistent store gets (404 ``not_found``).

    ``segment`` is the ``/datasets/<path>`` form, which names the path in the
    URL instead of an argument. A listing answers as it does for a folder
    that does not exist.
    """
    if endpoint == "list_legacy_datasets":
        return jsonify({"datasets": []})
    path = spelled(path) if path is not None else None
    if endpoint == "list_directory":
        return jsonify({"error": f"Directory not found: {request.args.get('path')}"}), 404
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
    """``may_read`` for a path or URL as the request spells it (a blank one names nothing)."""
    return True if not value else may_read(user, value)


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
    if kind in DATA_KINDS:
        unavailable = unavailable_reply()
        if unavailable is not None:
            return unavailable
    if kind == "admin" and not getattr(current_app.view_functions.get(endpoint), "_annzarro_admin", False):
        # `status` and `cache/info` do not check the role themselves (the admin interface's slice 4
        # will); they name the data directory and every dataset in the cache, which a restricted
        # user is never told. The routes that guard themselves answer for themselves.
        if is_restricted_requester():
            return jsonify({"error": "Only an admin can do that.", "reason": "admin_only"}), 403
        return None
    if kind not in ("dataset", "remote", "listing"):
        return None
    if not is_restricted_requester():
        return None
    user = permissions.current_user()[0]
    for value, segment in _named(endpoint):
        if not _readable(user, value):
            _log_refusal(user, value)
            return not_found(value, segment=segment, endpoint=endpoint)
    return None


#: At most this many refusals per requester per window reach the log; the rest are counted.
LOG_BURST = 10
LOG_WINDOW_S = 60
_refusals = {}   # user: [window start, logged, suppressed]
_refusals_lock = threading.Lock()


def _log_refusal(user, value):
    """Log a refusal at INFO, but not more than ``LOG_BURST`` a minute per user, then one summary."""
    now = time.monotonic()
    with _refusals_lock:
        state = _refusals.get(user)
        if state is None or now - state[0] >= LOG_WINDOW_S:
            if state and state[2]:
                logger.info(f"{state[2]} further refusals for {user!r} were not logged in the last minute")
            state = _refusals[user] = [now, 0, 0]
        if state[1] < LOG_BURST:
            state[1] += 1
            logger.info(f"Refused {user!r} {request.path}: {value!r} is not in their grants")
            return
        state[2] += 1
        if state[2] == 1:
            logger.info(f"More than {LOG_BURST} refusals a minute for {user!r}: the rest are counted, "
                        f"and summarised when the minute ends")


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
