"""
Browsing the data directory folder by folder (the dataset picker).

``/api/v1/datasets`` lists the first level of the data directory only, so a
store in a subfolder could only be typed in. ``/api/v1/datasets/folder`` lists
ONE folder: its subfolders and its stores, a page at a time. Counts come from
the listing's own probe and cache, and only for the entries of the page being
returned; a store's format and modification time are read from its root
metadata file (never by walking its files).

A restricted user (server/access.py) is never shown the data directory. Their
root is the list of their grants, a granted folder lists normally (entries
they may not read are dropped), and a search walks only their granted folders.
Paths are shown from the name of the granted folder or store down
(``access.display_path``), so the directories above a grant are not disclosed.
"""
import logging
import os
import re
import time

from flask import current_app as app, jsonify, request

from .. import access, confinement

logger = logging.getLogger(__name__)

DEFAULT_MAX_ENTRIES = 500
DEFAULT_SEARCH_DEPTH = 6
DEFAULT_SEARCH_VISITED = 20000
SEARCH_SECONDS = 3.0
MAX_QUERY_CHARS = 200


class SearchRefusedError(ValueError):
    """A search the server will not run (its ``reason`` goes in the 400)."""

    def __init__(self, reason, message):
        super().__init__(message)
        self.reason = reason


def is_store_dir(entry_path, entry):
    """Whether a directory looks like a zarr store (the listing's own rules)."""
    if entry.endswith(".zarr"):
        return True
    if os.path.exists(os.path.join(entry_path, ".zgroup")) or os.path.exists(os.path.join(entry_path, ".zarray")):
        return True
    return any(os.path.exists(os.path.join(entry_path, sub)) for sub in ("X", "obs", "var", "obsm", "layers"))


def _is_sharded(entry_path):
    """Whether X is written with the v3 sharding codec (one small file read)."""
    for rel in ("X", os.path.join("X", "data")):
        try:
            with open(os.path.join(entry_path, rel, "zarr.json")) as fh:
                if "sharding_indexed" in fh.read(65536):
                    return True
        except OSError:
            continue
    return False


def store_meta(entry_path):
    """``{"format", "modified"}`` of a store from its root metadata file and its mtime.

    format is "h5ad", "zarr format 2", "zarr format 3", "zarr format 3, sharded", or None when
    the root has no metadata file. modified is seconds since the epoch.
    """
    try:
        if os.path.isfile(entry_path):
            return {"format": "h5ad" if entry_path.endswith(".h5ad") else None,
                    "modified": os.stat(entry_path).st_mtime}
        if os.path.exists(os.path.join(entry_path, "zarr.json")):
            fmt = "zarr format 3, sharded" if _is_sharded(entry_path) else "zarr format 3"
        elif os.path.exists(os.path.join(entry_path, ".zgroup")):
            fmt = "zarr format 2"
        else:
            fmt = None
        marker = next((m for m in ("zarr.json", ".zgroup", ".zattrs") if os.path.exists(os.path.join(entry_path, m))), None)
        return {"format": fmt, "modified": os.stat(os.path.join(entry_path, marker) if marker else entry_path).st_mtime}
    except OSError:
        return {"format": None, "modified": None}


SORT_KEYS = ("name", "modified")
SORT_ORDERS = ("asc", "desc")

_STORE_MARKERS = ("zarr.json", ".zgroup", ".zattrs")


def _mtime(entry):
    """Modification time of an entry for sorting, from stat() alone (the same file ``store_meta`` reads); 0 when unreadable."""
    path = entry["path"]
    try:
        if entry["kind"] == "store" and os.path.isdir(path):
            marker = next((m for m in _STORE_MARKERS if os.path.exists(os.path.join(path, m))), None)
            if marker:
                return os.stat(os.path.join(path, marker)).st_mtime
        return os.stat(path).st_mtime
    except OSError:
        return 0


_DIGITS = re.compile(r"(\d+)")


def name_key(entry):
    """The order of names everywhere: case-insensitive, numbers by value (liver_2 before liver_10), ties by the exact
    name and then the path. The browser sorts the rows it holds the same way (dataset-browser-model.js sortRows)."""
    name = entry["name"]
    chunks = tuple((0, int(part)) if part.isdigit() else (1, part) for part in _DIGITS.split(name.casefold()) if part)
    return chunks, name, entry.get("path", "")


def sort_entries(entries, sort="name", order="asc"):
    """``entries`` in place: folders first, then by ``sort`` (name or modified) in ``order``, ties by name.

    Stat data only; a store is never opened. Stable, so a page boundary never moves between requests.
    """
    descending = order == "desc"
    entries.sort(key=name_key)
    if sort == "modified":
        for entry in entries:
            entry["_mtime"] = _mtime(entry)
        entries.sort(key=lambda e: e["_mtime"], reverse=descending)
        # reverse=True keeps equal times in their previous (name ascending) order
    elif descending:
        entries.sort(key=name_key, reverse=True)
    entries.sort(key=lambda e: e["kind"] != "folder")
    return entries


def _modified_of_folders(page):
    """A folder row carries its modification time (stat only) and drops the sort helper."""
    for entry in page:
        stamp = entry.pop("_mtime", None)
        if entry["kind"] == "folder":
            entry["modified"] = stamp if stamp is not None else _mtime(entry)


def _resolve_folder(config, folder):
    data_dir = os.path.expanduser(config.get("data_dir"))
    if not folder:
        return data_dir
    folder = os.path.expanduser(folder)
    return folder if os.path.isabs(folder) else os.path.join(data_dir, folder)


def rel_path(path, data_dir):
    """The ``rel_path`` of a listing entry: from the data directory, or for a restricted user from the granted folder's name."""
    user = access.restricted_user()
    if user:
        return access.display_path(user, os.path.realpath(path))
    try:
        return os.path.relpath(path, data_dir)
    except ValueError:                  # Windows: another drive than the data directory, no relative path
        return os.path.abspath(path)


def _entry(data_dir, parent, name):
    """One cheap classification: a folder, a store (counts filled later), or None to skip."""
    path = os.path.join(parent, name)
    if name.startswith(".") or not confinement.listable(app.config, path):
        return None
    base = {"name": name, "path": path, "is_link": os.path.islink(path),
            "rel_path": rel_path(path, data_dir)}
    if name.endswith(".h5ad") and os.path.isfile(path):
        return {**base, "kind": "store", "h5ad": True}
    if not os.path.isdir(path):
        return None
    if is_store_dir(path, name):
        return {**base, "kind": "store", "h5ad": False}
    return {**base, "kind": "folder"}


def fill_counts(entry):
    """``cells`` and ``genes`` of the store at ``entry["path"]``, or ``error`` with the reason it is unreadable (the probe cache is shared)."""
    from . import data_routes
    from ...core import get_reader, zarr_reader
    from ...core.zarr_reader import ZarrFormatError
    path = entry["path"]

    def h5ad_counts(p):
        shape = get_reader(p).get_metadata(p).get("shape", (0, 0))
        return int(shape[0]), int(shape[1])

    def zarr_counts(p):
        c = zarr_reader.get_basic_counts(p)
        return c["cell_count"], c["gene_count"]

    counts = data_routes._probe_dataset_counts(path, h5ad_counts if entry.pop("h5ad") else zarr_counts)
    if counts is None:
        entry.update(cells=None, genes=None, error="Not readable as an AnnData store")
    elif isinstance(counts, ZarrFormatError):
        entry.update(cells=None, genes=None, error=str(counts))
    else:
        entry.update(cells=counts[0], genes=counts[1])


def _fill_store(entry):
    """Counts (or the reason the store is unreadable), format and mtime for a page entry."""
    fill_counts(entry)
    entry.update(store_meta(entry["path"]))


def _admin_root_entries(config, data_dir, taken):
    """The data directories admins added, as folders of the data directory's
    own listing (the picker's top level). The path is the root as the admin
    typed it; browsing it is confined like any other (``allowed_roots``)."""
    from ..admin import overlay
    found = []
    for item in overlay.resolve_roots(config):
        path = item["path"]
        name = os.path.basename(path.rstrip(os.sep)) or path
        if not item["active"] or name.startswith(".") or path in taken:
            continue
        # no rel_path: it would spell out where the root lies relative to the data directory
        found.append({"name": name, "path": path, "is_link": os.path.islink(path),
                      "kind": "folder", "admin_root": True})
    return found


def _is_admin_root(config, path):
    from ..admin import overlay
    return os.path.realpath(path) in overlay.active_data_roots(config)


def list_folder(config, folder, offset=0, limit=None, sort="name", order="asc"):
    """One page of ``folder``: subfolders first, then stores, each by ``sort`` (``name`` or ``modified``, ``order`` asc or desc).
    The data directory's own listing also carries the data directories an
    admin added, as folders.

    Raises FileNotFoundError when it is not a directory.
    """
    from . import data_routes
    data_dir = os.path.expanduser(config.get("data_dir"))
    cap = int(config.get("dataset_folder_max_entries") or DEFAULT_MAX_ENTRIES)
    limit = max(1, min(int(limit or cap), cap))
    user = access.restricted_user()
    if user and not folder:
        return _grants_folder(config, user, data_dir, offset, limit, sort, order)
    path = _resolve_folder(config, folder)
    if not os.path.isdir(path):
        raise FileNotFoundError(path)
    at_top = os.path.realpath(path) == os.path.realpath(data_dir)
    skip = ("sessions",) if at_top else ()
    entries = [e for e in (_entry(data_dir, path, n) for n in data_routes._listdir(path) if n not in skip) if e]
    if at_top:
        entries += _admin_root_entries(config, data_dir, {e["path"] for e in entries})
    entries = access.filter_entries(entries)
    sort_entries(entries, sort, order)
    page = entries[offset:offset + limit]
    _modified_of_folders(page)
    for entry in page:
        if entry["kind"] == "store":
            _fill_store(entry)
    parent = os.path.dirname(path.rstrip(os.sep))
    if user and not access.may_read(user, parent):
        parent, at_top = None, True    # the folder above a grant is not theirs
    return {
        "folder": path,
        "rel_path": rel_path(path, data_dir),
        "parent": None if at_top or _is_admin_root(config, path) else parent,
        "entries": page,
        "total": len(entries),
        "offset": offset,
        "limit": limit,
        "more": offset + len(page) < len(entries),
    }


def _grant_entries(user):
    """The picker's root for a restricted user: one entry per active grant, folders first."""
    entries = []
    for grant in access.grants_of(user).active():
        real, name = grant["real"], grant["name"]
        if os.path.isfile(real):
            entry = {"kind": "store", "h5ad": real.endswith(".h5ad")} if real.endswith(".h5ad") else None
        elif os.path.isdir(real):
            entry = {"kind": "store", "h5ad": False} if is_store_dir(real, name) else {"kind": "folder"}
        else:
            entry = None      # a granted path that is not there (yet) shows nothing
        if entry is not None:
            entries.append({"name": name, "path": real, "is_link": False, "rel_path": name, **entry})
    entries.sort(key=lambda e: (e["kind"] != "folder", name_key(e)))
    return entries


def granted_sources(user):
    """``[(parent, name)]`` of what a restricted user's flat dataset list is built from.

    Each granted store, and the first level of each granted folder (a folder
    that is itself a store counts as the store). Hidden names are left to the
    caller's own rule.
    """
    from . import data_routes
    sources, seen = [], set()
    for entry in _grant_entries(user):
        real = entry["path"]
        if entry["kind"] == "folder":
            batch = [(real, name) for name in data_routes._listdir(real)]
        else:
            batch = [(os.path.dirname(real), entry["name"])]
        for source in batch:
            if os.path.join(*source) not in seen:
                seen.add(os.path.join(*source))
                sources.append(source)
    return sources


def _grants_folder(config, user, data_dir, offset, limit, sort="name", order="asc"):
    """``list_folder`` of the virtual root of a restricted user: their grants, with no folder behind it."""
    entries = sort_entries(_grant_entries(user), sort, order) if (sort, order) != ("name", "asc") else _grant_entries(user)
    page = entries[offset:offset + limit]
    _modified_of_folders(page)
    for entry in page:
        if entry["kind"] == "store":
            _fill_store(entry)
    return {"folder": "", "rel_path": "", "parent": None, "entries": page, "total": len(entries),
            "offset": offset, "limit": limit, "more": offset + len(page) < len(entries)}


def register_dataset_folder_routes(app_, api_version):
    from .dataset_details import register_dataset_details_routes
    register_dataset_details_routes(app_, api_version)
    from .dataset_info import register_dataset_info_routes
    register_dataset_info_routes(app_, api_version)

    @app_.route(f"/api/{api_version}/datasets/search", methods=["GET"])
    @access.gate("listing")
    def list_dataset_search():
        query = request.args.get("q", "")
        folder = request.args.get("folder") or ""
        if folder:
            refused = _confined_refusal(app_.config, folder)
            if refused:
                return refused
        if not query:
            return jsonify({"results": [], "truncated": False, "visited": 0})
        try:
            return jsonify(search_tree(app_.config, query, request.args.get("mode") == "regex",
                                       request.args.get("limit", type=int), folder))
        except SearchRefusedError as exc:
            return jsonify({"error": str(exc), "reason": exc.reason}), 400
        except FileNotFoundError:
            return jsonify({"error": "Folder not found", "reason": "not_found"}), 404

    @app_.route(f"/api/{api_version}/datasets/folder", methods=["GET"])
    @access.gate("listing")
    def list_dataset_folder():
        config = app_.config
        folder = request.args.get("folder") or ""
        try:
            offset = max(0, int(request.args.get("offset", 0)))
            limit = int(request.args["limit"]) if "limit" in request.args else None
        except ValueError:
            return jsonify({"error": "offset and limit must be integers"}), 400
        sort, order = request.args.get("sort", "name"), request.args.get("order", "asc")
        if sort not in SORT_KEYS or order not in SORT_ORDERS:
            return jsonify({"error": f"sort is one of {', '.join(SORT_KEYS)} and order one of {', '.join(SORT_ORDERS)}",
                            "reason": "bad_sort"}), 400
        refused = _confined_refusal(config, folder)
        if refused:
            return refused
        try:
            return jsonify(list_folder(config, folder, offset, limit, sort, order))
        except FileNotFoundError:
            return jsonify({"error": "Folder not found", "reason": "not_found"}), 404
        except Exception as exc:
            logger.error(f"Error listing folder {_resolve_folder(config, folder)}: {exc}")
            return jsonify({"error": "Failed to list the folder"}), 500


def _confined_refusal(config, folder):
    """The 403 for a folder outside a confined server's roots, else None.

    The same rule as every path: a confined server lists only inside its roots (a restricted
    user's root is their grants, which access.enforce has checked).
    """
    path = _resolve_folder(config, folder)
    if not access.restricted_user() and confinement.is_confined(config) and not confinement.is_inside(path, confinement.allowed_roots(config)) \
            and not confinement.may_open_any_path(config):
        logger.warning(f"Refused folder listing outside the data directory: {path!r}")
        return jsonify({"error": "That folder is outside the data directory this server shares.",
                        "reason": "outside_data_dir"}), 403
    return None


def _compile_query(query, regex):
    """A case-insensitive matcher for ``query``; SearchRefusedError when it may not run.

    A regex goes through ``name_index.compile_regex``, the name search's guard
    (``/data/names``): a pattern that is too long or can take exponential time
    is refused (400, ``regex_too_long`` / ``regex_too_complex``) before the walk
    starts, and every match runs under the walk's deadline (the ``regex``
    package stops inside a match; the stdlib ``re`` cannot be interrupted).
    """
    if len(query) > MAX_QUERY_CHARS:
        raise SearchRefusedError("query_too_long", f"The search has {len(query)} characters; at most {MAX_QUERY_CHARS}.")
    if not regex:
        needle = query.lower()
        return lambda text, deadline: needle in text.lower()
    from ...core import name_index
    try:
        rx = name_index.compile_regex(query)
    except name_index.RegexRefusedError as exc:
        raise SearchRefusedError(exc.reason, str(exc))
    except re.error as exc:
        raise SearchRefusedError("invalid_regex", f"Invalid regular expression: {exc}")
    return rx.search      # (text, deadline): TimeoutError inside a match once the walk's clock is up


def search_tree(config, query, regex=False, limit=None, folder=""):
    """Stores of the data directory's whole tree, or of ``folder`` and below, whose name or relative path matches.

    With a ``folder`` the walk starts there (depth 0), a path is matched relative to it, and the
    admin-added roots are walked only when the folder is the data directory. Raises
    FileNotFoundError when it is not a directory; a store is never searched into, so a folder
    that is a store has no results.

    Breadth first from the data directory and the admin-added roots, never into a store, at most
    ``dataset_search_max_depth`` folders deep, ``dataset_search_max_entries``
    entries looked at and SEARCH_SECONDS long; ``truncated`` says a cap stopped it.
    Hidden entries, the sessions folder and links a hosted server would refuse
    (``confinement.listable``) are skipped, and a folder is entered once by its
    real path. At most ``dataset_folder_max_entries`` matches are returned, with
    their counts, format and modified time.
    """
    from . import data_routes
    matches_text = _compile_query(query, regex)
    data_dir = os.path.expanduser(config.get("data_dir"))
    cap = int(config.get("dataset_folder_max_entries") or DEFAULT_MAX_ENTRIES)
    limit = max(1, min(int(limit or cap), cap))
    max_depth = int(config.get("dataset_search_max_depth") or DEFAULT_SEARCH_DEPTH)
    max_visited = int(config.get("dataset_search_max_entries") or DEFAULT_SEARCH_VISITED)
    deadline = time.monotonic() + SEARCH_SECONDS
    user = access.restricted_user()
    found, visited, truncated = [], 0, False
    scope = None
    if folder:
        scope = _resolve_folder(config, folder)
        if not os.path.isdir(scope):
            raise FileNotFoundError(scope)
        if is_store_dir(scope, os.path.basename(scope.rstrip(os.sep))):
            return {"results": [], "truncated": False, "visited": 0}
        queue, seen = [(scope, 0)], {os.path.realpath(scope)}
    elif user:
        # only their grants: a granted store is matched by name, a granted folder is walked
        queue, seen = [], set()
        for entry in _grant_entries(user):
            if entry["kind"] == "folder":
                queue.append((entry["path"], 0))
                seen.add(entry["path"])
            else:
                try:
                    if matches_text(entry["name"], deadline):
                        found.append(entry)
                except TimeoutError:          # the clock ran out inside a match
                    truncated = True
    else:
        queue, seen = [(data_dir, 0)], {os.path.realpath(data_dir)}
    if scope is None and not user:
        # the data directories admins added are top-level folders of the picker, so they are searched too
        for root in _admin_root_entries(config, data_dir, set()):
            real = os.path.realpath(root["path"])
            if real not in seen:
                seen.add(real)
                queue.append((root["path"], 1))
    while queue and not truncated:
        folder, depth = queue.pop(0)
        skip = ("sessions",) if os.path.realpath(folder) == os.path.realpath(data_dir) else ()
        for name in data_routes._listdir(folder):
            if name in skip or name.startswith("."):
                continue
            visited += 1
            if visited > max_visited or time.monotonic() > deadline:
                truncated = True
                break
            entry = _entry(data_dir, folder, name)
            if entry is None:
                continue
            if user and not access.may_read(user, entry["path"]):
                continue      # a link leading out of the grant is not entered, listed or counted
            if entry["kind"] == "folder":
                real = os.path.realpath(entry["path"])
                if depth + 1 < max_depth and real not in seen:
                    seen.add(real)
                    queue.append((entry["path"], depth + 1))
                elif depth + 1 >= max_depth:
                    truncated = True
                continue
            try:
                below = os.path.relpath(entry["path"], scope) if scope else entry["rel_path"]
                hit = matches_text(name, deadline) or matches_text(below, deadline)
            except TimeoutError:         # the clock ran out inside a match
                truncated = True
                break
            if hit:
                found.append(entry)
                if len(found) >= limit:
                    truncated = True
                    break
    found = access.filter_entries(found)[:limit]
    found.sort(key=lambda e: (e["rel_path"].count(os.sep), e["rel_path"]))
    for entry in found:
        _fill_store(entry)
    return {"results": found, "truncated": truncated, "visited": visited}
