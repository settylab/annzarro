"""
Admin interface: data directories
---------------------------------

An admin adds a directory the server may read from, in the browser, without
touching the operator's YAML or restarting. The directory is stored in the
overlay (``overlay.py``) and counts only while its real path lies inside an
entry of ``server.admin_data_roots``; ``confinement.allowed_roots`` merges the
active ones, so every dataset route, the listings and the folder picker see
a change in every worker on their next request.

Adding refuses, in this order: no parents configured (403
``admin_roots_disabled``), a path that is not absolute (400 ``not_absolute``),
outside every parent once ``..`` and symlinks are resolved (403
``outside_admin_parents``; decided before the disk says whether the path
exists), not a directory (400 ``not_a_directory``), already readable (409 ``already_allowed``). The path is stored as typed and
resolved again on every read. Nothing is ever created, linked or written
outside the overlay.
"""

import datetime
import logging
import os
import time

from flask import current_app, jsonify, request

from .. import confinement, panel_sets, permissions
from ..routes import dataset_folders
from . import audit, overlay
from .guard import require_admin

logger = logging.getLogger(__name__)

#: Roots one overlay keeps; the file is read on every request.
MAX_ADMIN_ROOTS = 100
MAX_PATH_CHARS = 4096


def _error(status, reason, message, **extra):
    return jsonify(dict(error=message, reason=reason, **extra)), status


def _refused(action, target, reason):
    try:
        audit.record(action, target, None, "refused:" + reason)
    except Exception:
        logger.exception("Could not write the audit record of a refused %s", action)


def _real(path):
    return os.path.realpath(os.path.expanduser(path))


def _entry(item):
    out = {"path": item["path"], "real": item["real"], "source": "admin", "active": item["active"]}
    if not item["active"]:
        out["inactive_reason"] = item["inactive_reason"]
    for key in ("added_by", "added_at"):
        if item.get(key):
            out[key] = item[key]
    return out


#: How long a root's store count is reused while its directory has not changed.
COUNT_CACHE_SECONDS = 60
_counts = {}


def _stamp(real):
    st = os.stat(real)
    return (st.st_ino, st.st_mtime_ns)


def _count_all(config, entries):
    """Fill ``stores`` and ``stores_capped`` of the active entries. One entry
    budget (``dataset_scan_max_entries``) covers the whole call, links leading
    out of a root are not followed, and a root's count is reused for
    ``COUNT_CACHE_SECONDS`` while its directory's stamp is unchanged."""
    from ...data.scan import DEFAULT_MAX_ENTRIES, count_stores_within
    limit = int(config.get("dataset_scan_max_entries") or DEFAULT_MAX_ENTRIES)
    left = limit
    now = time.monotonic()
    if len(_counts) > 4 * MAX_ADMIN_ROOTS:
        _counts.clear()
    for entry in entries:
        real = entry["real"]
        if not entry["active"] or not real or not os.path.isdir(real):
            continue
        try:
            stamp = _stamp(real)
        except OSError:
            continue
        key = (real, limit)
        hit = _counts.get(key)
        if hit and hit[0] == stamp and now - hit[1] < COUNT_CACHE_SECONDS:
            entry["stores"], entry["stores_capped"] = hit[2], hit[3]
            continue
        if left <= 0:
            entry["stores_capped"] = True       # no budget left for this one: no count
            continue
        count, capped, used = count_stores_within(real, left, within=real)
        left -= used
        entry["stores"], entry["stores_capped"] = count, capped
        _counts[key] = (stamp, now, count, capped)


def _configured(config):
    """(path, real, source) of the operator's roots."""
    out = [(config.get("data_dir"), "data_dir")]
    extra = config.get("allowed_dirs") or []
    if isinstance(extra, str):
        extra = [extra]
    out += [(p, "config") for p in extra]
    return [(p, _real(p), source) for p, source in out if p]


def effective_roots(config):
    """Every root the server reads from, each ``{path, real, source, active, ...}``."""
    roots = [{"path": p, "real": real, "source": source, "active": True}
             for p, real, source in _configured(config)]
    roots += [_entry(item) for item in overlay.resolve_roots(config)]
    return roots


def _parents(config):
    return [{"path": p, "ok": os.path.isdir(_real(p))} for p in config.get("admin_data_roots") or []]


def _server_state(config):
    """Real paths a data directory must not contain: the users file's
    directory (which holds the secret key and the admin state) and the saved
    panel sets."""
    from . import state_dir
    return [os.path.dirname(state_dir(config)), state_dir(config),
            _real(panel_sets.directory(config))]


def _active_real_roots(config):
    return [r["real"] for r in effective_roots(config) if r["active"]]


@require_admin
def list_roots():
    """GET /api/v1/admin/data-roots"""
    config = current_app.config
    roots = effective_roots(config)
    _count_all(config, roots)
    return jsonify(parents=_parents(config), roots=roots, overlay=overlay.status(config))


@require_admin
def browse():
    """GET /api/v1/admin/data-roots/browse?path=: the directories of a candidate
    parent. Without ``path``, the allowed parents themselves."""
    config = current_app.config
    parents = overlay.parents(config)
    if not parents:
        return _error(403, "admin_roots_disabled", "Adding directories is off. Set server.admin_data_roots.")
    raw = request.args.get("path") or ""
    if not raw:
        active = _active_real_roots(config)
        return jsonify(path="", dirs=[
            {"name": p["path"], "path": p["path"], "is_root": _real(p["path"]) in active}
            for p in _parents(config) if p["ok"]], capped=False)
    if "\0" in raw or len(raw) > MAX_PATH_CHARS or not os.path.isabs(raw):
        return _error(400, "not_absolute", "Give an absolute path.")
    real = _real(raw)
    if not confinement.is_inside(real, parents):
        return _error(403, "outside_admin_parents", "That directory is outside the allowed parents.")
    if not os.path.isdir(real):
        return _error(404, "not_found", "That is not a directory.")
    cap = int(config.get("dataset_folder_max_entries") or dataset_folders.DEFAULT_MAX_ENTRIES)
    active = _active_real_roots(config)
    dirs, capped = [], False
    try:
        names = sorted(n for n in os.listdir(real) if not n.startswith("."))
    except OSError:
        return _error(404, "not_found", "That directory cannot be read.")
    for name in names:
        full = os.path.join(real, name)
        target = _real(full)
        # a link that leads out of every parent is not offered
        if not os.path.isdir(target) or not confinement.is_inside(target, parents):
            continue
        if len(dirs) >= cap:
            capped = True
            break
        dirs.append({"name": name, "path": full, "is_root": target in active})
    return jsonify(path=real, dirs=dirs, capped=capped)


@require_admin
def datasets():
    """GET /api/v1/admin/data-roots/datasets?root=&folder=&offset=&limit=: one
    page of a folder inside an effective root (the picker's folder listing)."""
    config = current_app.config
    root = request.args.get("root") or ""
    real_root = _real(root) if root and "\0" not in root else None
    if real_root is None or real_root not in _active_real_roots(config):
        return _error(403, "not_a_root", "That is not one of the data directories.")
    folder = request.args.get("folder") or ""
    if "\0" in folder:
        return _error(400, "bad_request", "Bad folder.")
    path = os.path.join(real_root, folder) if folder and not os.path.isabs(folder) else (folder or real_root)
    if not confinement.is_inside(path, [real_root]):
        return _error(403, "not_a_root", "That folder is outside the data directory.")
    try:
        offset = max(0, int(request.args.get("offset", 0)))
        limit = int(request.args["limit"]) if "limit" in request.args else None
    except ValueError:
        return _error(400, "bad_request", "offset and limit must be integers.")
    try:
        return jsonify(dataset_folders.list_folder(config, path, offset, limit))
    except FileNotFoundError:
        return _error(404, "not_found", "Folder not found.")


def _typed_path():
    body = request.get_json(silent=True)
    path = body.get("path") if isinstance(body, dict) else None
    if not isinstance(path, str) or not path or "\0" in path or len(path) > MAX_PATH_CHARS:
        return None
    return path


@require_admin
def add_root():
    """POST /api/v1/admin/data-roots {path}"""
    config = current_app.config
    path = _typed_path()
    if path is None:
        return _error(400, "bad_request", "A path is required.")
    parents = overlay.parents(config)
    if not parents:
        _refused("data_roots.add", path, "admin_roots_disabled")
        return _error(403, "admin_roots_disabled", "Adding directories is off. Set server.admin_data_roots.")
    if not os.path.isabs(path):
        _refused("data_roots.add", path, "not_absolute")
        return _error(400, "not_absolute", "Give an absolute path.")
    real = _real(path)
    if not confinement.is_inside(real, parents):
        _refused("data_roots.add", path, "outside_admin_parents")
        return _error(403, "outside_admin_parents",
                      "That directory is outside the parents this server allows (server.admin_data_roots).")
    if not os.path.isdir(real):
        _refused("data_roots.add", path, "not_a_directory")
        return _error(400, "not_a_directory", "That is not a directory on the server.")
    username, _ = permissions.current_user()
    added_at = datetime.datetime.now(datetime.timezone.utc).isoformat()

    def mutate(data):
        roots = data.setdefault("data_roots", [])
        if confinement.is_inside(real, confinement.configured_roots(config)):
            return "already_allowed"
        for item in roots:
            stored = item.get("path") if isinstance(item, dict) else None
            if isinstance(stored, str) and os.path.isabs(stored):
                held = _real(stored)
                if os.path.isdir(held) and confinement.is_inside(held, parents) \
                        and confinement.is_inside(real, [held]):
                    return "already_allowed"
        if real in parents:
            return "is_a_parent"
        if any(confinement.is_inside(_real(state), [real]) for state in _server_state(config)):
            return "contains_server_state"
        if len(roots) >= MAX_ADMIN_ROOTS:
            return "too_many"
        roots.append({"path": path, "added_by": username, "added_at": added_at})
        return None

    try:
        problem = overlay.update(config, mutate)
    except ValueError:
        logger.exception("The overlay could not be updated")
        return _error(503, "overlay_unreadable", "The admin state file cannot be read; see the server log.")
    if problem == "already_allowed":
        _refused("data_roots.add", path, "already_allowed")
        return _error(409, "already_allowed", "The server already reads from that directory.")
    if problem in ("is_a_parent", "contains_server_state"):
        _refused("data_roots.add", path, problem)
        return _error(403, problem, "Choose a directory below an allowed parent that holds no server state "
                                    "(the users file's directory, the admin state, saved panel sets)."
                      if problem == "contains_server_state" else
                      "That is an allowed parent itself; add a directory below it.")
    if problem == "too_many":
        _refused("data_roots.add", path, "too_many")
        return _error(409, "too_many", f"At most {MAX_ADMIN_ROOTS} directories can be added.")
    audit.record("data_roots.add", path, {"real": real})
    item = next(r for r in overlay.resolve_roots(config) if r["path"] == path)
    entry = _entry(item)
    _count_all(config, [entry])
    return jsonify(entry), 201


def _panel_sets_under(config, roots):
    """How many saved panel sets name a dataset inside one of ``roots``."""
    from .. import session_quota
    sessions = panel_sets.directory(config)
    count = 0
    for stored in session_quota.entries(sessions):
        dataset = stored.data.get("dataset")
        if isinstance(dataset, str) and os.path.isabs(dataset) and "\0" not in dataset \
                and confinement.is_inside(dataset, roots):
            count += 1
    return count


@require_admin
def remove_root():
    """DELETE /api/v1/admin/data-roots {path}"""
    config = current_app.config
    path = _typed_path()
    if path is None:
        return _error(400, "bad_request", "A path is required.")
    real = _real(path)
    if any(real == r for _, r, _ in _configured(config)):
        _refused("data_roots.remove", path, "from_config")
        return _error(409, "from_config", "That directory comes from the server's configuration; edit the YAML.")
    gone = []

    def mutate(data):
        roots = data.get("data_roots")
        if not isinstance(roots, list):
            return
        keep = []
        for item in roots:
            stored = item.get("path") if isinstance(item, dict) else None
            if isinstance(stored, str) and (stored == path or (os.path.isabs(stored) and _real(stored) == real)):
                gone.append(item)
            else:
                keep.append(item)
        roots[:] = keep

    try:
        overlay.update(config, mutate)
    except ValueError:
        logger.exception("The overlay could not be updated")
        return _error(503, "overlay_unreadable", "The admin state file cannot be read; see the server log.")
    if not gone:
        _refused("data_roots.remove", path, "unknown_root")
        return _error(404, "unknown_root", "That is not a directory an admin added.")
    removed = {_real(g["path"]) for g in gone if os.path.isabs(g["path"])} | {real}
    affected = _panel_sets_under(config, sorted(removed))
    audit.record("data_roots.remove", path, {"real": real, "panel_sets_affected": affected})
    return jsonify(removed=path, panel_sets_affected=affected)


def register(blueprint):
    """Add this section's routes to the admin blueprint."""
    blueprint.add_url_rule("/api/v1/admin/data-roots", "data_roots", list_roots)
    blueprint.add_url_rule("/api/v1/admin/data-roots/browse", "data_roots_browse", browse)
    blueprint.add_url_rule("/api/v1/admin/data-roots/datasets", "data_roots_datasets", datasets)
    blueprint.add_url_rule("/api/v1/admin/data-roots", "data_roots_add", add_root, methods=["POST"])
    blueprint.add_url_rule("/api/v1/admin/data-roots", "data_roots_remove", remove_root, methods=["DELETE"])
