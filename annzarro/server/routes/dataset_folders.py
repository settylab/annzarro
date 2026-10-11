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
    return os.path.relpath(path, data_dir)


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


def _fill_store(entry):
    """Counts (or the reason the store is unreadable), format and mtime for a page entry."""
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
    entry.update(store_meta(path))
    if counts is None:
        entry.update(cells=None, genes=None, error="Not readable as an AnnData store")
    elif isinstance(counts, ZarrFormatError):
        entry.update(cells=None, genes=None, error=str(counts))
    else:
        entry.update(cells=counts[0], genes=counts[1])


def list_folder(config, folder, offset=0, limit=None):
    """One page of ``folder``: subfolders first, then stores, each by name.

    Raises FileNotFoundError when it is not a directory.
    """
    from . import data_routes
    data_dir = os.path.expanduser(config.get("data_dir"))
    cap = int(config.get("dataset_folder_max_entries") or DEFAULT_MAX_ENTRIES)
    limit = max(1, min(int(limit or cap), cap))
    user = access.restricted_user()
    if user and not folder:
        return _grants_folder(config, user, data_dir, offset, limit)
    path = _resolve_folder(config, folder)
    if not os.path.isdir(path):
        raise FileNotFoundError(path)
    skip = ("sessions",) if os.path.realpath(path) == os.path.realpath(data_dir) else ()
    entries = [e for e in (_entry(data_dir, path, n) for n in data_routes._listdir(path) if n not in skip) if e]
    entries = access.filter_entries(entries)
    entries.sort(key=lambda e: (e["kind"] != "folder", e["name"]))
    page = entries[offset:offset + limit]
    for entry in page:
        if entry["kind"] == "store":
            _fill_store(entry)
    parent = os.path.dirname(path.rstrip(os.sep))
    at_top = os.path.realpath(path) == os.path.realpath(data_dir)
    if user and not access.may_read(user, parent):
        parent, at_top = None, True    # the folder above a grant is not theirs
    return {
        "folder": path,
        "rel_path": rel_path(path, data_dir),
        "parent": None if at_top else parent,
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
    entries.sort(key=lambda e: (e["kind"] != "folder", e["name"].lower(), e["path"]))
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


def _grants_folder(config, user, data_dir, offset, limit):
    """``list_folder`` of the virtual root of a restricted user: their grants, with no folder behind it."""
    entries = _grant_entries(user)
    page = entries[offset:offset + limit]
    for entry in page:
        if entry["kind"] == "store":
            _fill_store(entry)
    return {"folder": "", "rel_path": "", "parent": None, "entries": page, "total": len(entries),
            "offset": offset, "limit": limit, "more": offset + len(page) < len(entries)}


def register_dataset_folder_routes(app_, api_version):
    @app_.route(f"/api/{api_version}/datasets/search", methods=["GET"])
    @access.gate("listing")
    def list_dataset_search():
        query = request.args.get("q", "")
        if not query:
            return jsonify({"results": [], "truncated": False, "visited": 0})
        try:
            return jsonify(search_tree(app_.config, query, request.args.get("mode") == "regex",
                                       request.args.get("limit", type=int)))
        except SearchRefusedError as exc:
            return jsonify({"error": str(exc), "reason": exc.reason}), 400

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
        path = _resolve_folder(config, folder)
        # The same rule as every path: a confined server lists only inside its roots
        # (a restricted user's root is their grants, which access.enforce has checked)
        if not access.restricted_user() and confinement.is_confined(config) and not confinement.is_inside(path, confinement.allowed_roots(config)) \
                and not confinement.may_open_any_path(config):
            logger.warning(f"Refused folder listing outside the data directory: {path!r}")
            return jsonify({"error": "That folder is outside the data directory this server shares.",
                            "reason": "outside_data_dir"}), 403
        try:
            return jsonify(list_folder(config, folder, offset, limit))
        except FileNotFoundError:
            return jsonify({"error": "Folder not found", "reason": "not_found"}), 404
        except Exception as exc:
            logger.error(f"Error listing folder {path}: {exc}")
            return jsonify({"error": "Failed to list the folder"}), 500


def _compile_query(query, regex):
    """A case-insensitive matcher for ``query``; SearchRefusedError when it may not run.

    A regex goes through ``name_index.check_regex`` (the name search's guard
    against patterns that take exponential time) and is refused outright
    (``regex_unavailable``) when this build has no such guard. ``re`` cannot be
    interrupted, so a pattern the guard lets through is still bounded by the
    walk's own caps.
    """
    if len(query) > MAX_QUERY_CHARS:
        raise SearchRefusedError("query_too_long", f"The search has {len(query)} characters; at most {MAX_QUERY_CHARS}.")
    if not regex:
        needle = query.lower()
        return lambda text: needle in text.lower()
    from ...core import name_index
    check = getattr(name_index, "check_regex", None)
    if check is None:
        # `re` cannot be interrupted and holds the GIL: an unguarded user pattern over
        # thousands of names could stop the worker for everyone. A build with the
        # guard (name_index.check_regex) allows regex searches again by itself.
        raise SearchRefusedError("regex_unavailable", "Regular-expression search of the subfolders is not available on this server.")
    try:
        check(query)
    except ValueError as exc:
        raise SearchRefusedError(getattr(exc, "reason", "regex_refused"), str(exc))
    try:
        rx = re.compile(query, re.IGNORECASE)
    except re.error as exc:
        raise SearchRefusedError("invalid_regex", f"Invalid regular expression: {exc}")
    return lambda text: rx.search(text) is not None


def search_tree(config, query, regex=False, limit=None):
    """Stores of the data directory's whole tree whose name or relative path matches.

    Breadth first from the data directory, never into a store, at most
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
    if user:
        # only their grants: a granted store is matched by name, a granted folder is walked
        queue, seen = [], set()
        for entry in _grant_entries(user):
            if entry["kind"] == "folder":
                queue.append((entry["path"], 0))
                seen.add(entry["path"])
            elif matches_text(entry["name"]):
                found.append(entry)
    else:
        queue, seen = [(data_dir, 0)], {os.path.realpath(data_dir)}
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
            if matches_text(name) or matches_text(entry["rel_path"]):
                found.append(entry)
                if len(found) >= limit:
                    truncated = True
                    break
    found = access.filter_entries(found)[:limit]
    found.sort(key=lambda e: (e["rel_path"].count(os.sep), e["rel_path"]))
    for entry in found:
        _fill_store(entry)
    return {"results": found, "truncated": truncated, "visited": visited}
