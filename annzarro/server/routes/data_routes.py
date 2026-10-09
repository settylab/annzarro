"""
Data access routes for the Annzarro server.

This module contains routes for accessing AnnData matrix data,
including X, obs, var, obsm, varm, obsp, varp, etc.
"""

import os
import logging
import numpy as np
from pathlib import Path
from flask import jsonify, request, current_app as app
import json
import re

from ...core import zarr_reader
from ...core.zarr_reader import ZarrFormatError, UnsupportedEncodingError
from ...core import process_file
from ...core import get_reader
from ...core import name_index
from ...core import subset as cell_subset
from .. import confinement, permissions
from .. import http_cache
from ...core.array_response import wants_binary, wants_codes
from ...core import categories as category_rules
from ...core.remote import is_remote_path, is_timeout, timeout_message

logger = logging.getLogger(__name__)


# Per-entry result of probing a dataset for the /datasets listing, keyed by
# path and validated against a cheap stat signature. Listing used to OPEN every
# store on every call (1.3-4.9 s for 33 datasets on the live service); with
# this, a repeat listing costs a handful of stat() calls per entry and only a
# new or rewritten store is opened again. A value of None records "not a
# readable AnnData" so a broken entry is not re-probed on every listing either.
_LISTING_PROBE_CACHE = {}

# Members whose stat changes when a store is (re)written. anndata recreates
# groups on write, so their directory mtimes move; zarr.json covers v3 stores.
_LISTING_SIGNATURE_MEMBERS = (".zgroup", ".zattrs", "zarr.json", "obs", "var", "X")


def _listing_signature(entry_path):
    """Cheap fingerprint of a dataset entry: stat() only, never opens it."""
    st = os.stat(entry_path)
    if not os.path.isdir(entry_path):
        return (st.st_mtime_ns, st.st_size)
    parts = [st.st_mtime_ns]
    for member in _LISTING_SIGNATURE_MEMBERS:
        try:
            mst = os.stat(os.path.join(entry_path, member))
            parts.append((member, mst.st_mtime_ns, mst.st_size))
        except OSError:
            parts.append((member, None))
    return tuple(parts)


def _listdir(path):
    """Entries of ``path``, or none when it cannot be read."""
    try:
        return sorted(os.listdir(path))
    except OSError as exc:
        logger.warning(f"Error listing directory {path}: {exc}")
        return []


def _probe_dataset_counts(entry_path, probe):
    """
    (cells, genes) for a listing entry, None if it is not a readable
    dataset, or the ZarrFormatError when it is one in a zarr format this
    server cannot read. `probe` does the expensive open; it runs only when the entry's
    stat signature differs from the cached one.
    """
    try:
        signature = _listing_signature(entry_path)
    except OSError:
        return None
    cached = _LISTING_PROBE_CACHE.get(entry_path)
    if cached is not None and cached[0] == signature:
        return cached[1]
    try:
        counts = probe(entry_path)
    except ZarrFormatError as exc:
        # A real dataset this server cannot read. Listing it, with the
        # reason, beats dropping it: a store that silently vanishes from the
        # list is as unexplained as one that silently reads as empty.
        counts = exc
    except Exception as exc:
        # Not listed; say why once (the result is cached until it changes).
        logger.warning(f"Not listing {entry_path}: {type(exc).__name__}: {exc}")
        counts = None
    _LISTING_PROBE_CACHE[entry_path] = (signature, counts)
    return counts


def _category_rules_for(reader, dataset_path, entity, column_names, n_rows):
    """Apply core/categories.py to one obs/var request before it reads.

    Returns ``(n_categories, used_only, ranked)`` for a single requested
    column (None, False, False otherwise). No reply is refused for its
    labels: a compact one is streamed (core/array_response.py).
    """
    if not column_names or len(column_names) != 1:
        return None, False, False
    column = column_names[0]
    count = category_rules.category_count(reader.get_metadata(dataset_path), entity, column)
    wanted = (request.args.get("categories") or "").lower()
    if wanted == "ranked":
        return count, False, True
    return count, wanted == "used", False


def _category_labels_response(reader, dataset_path, entity, column_names):
    """``category_ranks=r1,r2,...`` with one column: the labels of those ranks
    of the column's whole-column ranking (the legend's names), or None when
    the request does not ask for them."""
    raw = request.args.get("category_ranks")
    if raw is None:
        return None
    if not column_names or len(column_names) != 1:
        raise DataRequestError(400, "bad_request", "category_ranks needs exactly one column")
    ranks = _parse_indices(raw) or []
    if len(ranks) > category_rules.MAX_RANK_LABELS:
        raise DataRequestError(400, "cap_exceeded",
                               f"at most {category_rules.MAX_RANK_LABELS} category_ranks per request")
    get_labels = getattr(reader, "get_category_labels", None)
    labels = get_labels(entity=entity, dataset_path=dataset_path, column_name=column_names[0],
                        ranks=ranks) if get_labels else None
    if labels is None:
        raise DataRequestError(400, "not_categorical", f"'{column_names[0]}' is not a categorical column")
    return jsonify({"column": column_names[0], "ranks": ranks, "labels": labels})


def _axis_rows(reader, dataset_path, indices, axis):
    """Rows a request reads: those named, else the axis length."""
    if indices:
        return len(indices)
    shape = (reader.get_metadata(dataset_path) or {}).get("shape") or (0, 0)
    return int(shape[axis]) if len(shape) > axis else 0


def _reader_error_response(exc, dataset_path):
    """Turn a reader-construction failure into a response that names the CAUSE.

    Every data route used to answer a bare catch-all handler with
    ``{"error": "Cannot handle this file type"}, 400`` -- one sentence that was
    wrong for most of the exceptions reaching it. A dataset path that does not
    exist is not a file-type problem, and reporting it as one sends whoever
    reads that message to the wrong question. Measured live 2026-08-28:
    ``/api/v1/data/obs?dataset_path=/nope/nothing.zarr`` answered
    ``400 Cannot handle this file type``.

    ``reason`` is a machine-readable code the front end maps onto a coverage
    state (``static/js/utils/coverage.js``); ``error`` stays the human sentence.
    Both are additive, so a client reading only ``error`` is unaffected.

    Remote stores add two causes that are neither "not found" nor "bad type":
    the server's remote-store policy (or the store itself) refusing access,
    and the optional remote dependencies not being installed. The exception
    text is returned as-is for those because it names the fix (the config key,
    the pip extra); it never contains credentials, which are not accepted in
    URLs (``core/remote.py``).

    A remote store that stops answering is a 504: the failure is upstream of
    this server, and retrying later may well succeed, unlike a 500.
    """
    if isinstance(exc, DataRequestError):
        return _data_request_error_response(exc)
    if isinstance(exc, KeyError):
        return jsonify({"error": exc.args[0] if exc.args else "Key not found",
                        "reason": "key_not_found"}), 404
    if is_timeout(exc):
        return jsonify({
            "error": (timeout_message(dataset_path) if is_remote_path(dataset_path)
                      else f"Timed out reading {dataset_path}: {exc}"),
            "reason": "remote_timeout",
            "exception": type(exc).__name__,
        }), 504
    if isinstance(exc, PermissionError):
        return jsonify({
            "error": str(exc),
            "reason": "access_denied",
            "exception": type(exc).__name__,
        }), 403
    if isinstance(exc, ImportError):
        return jsonify({
            "error": str(exc),
            "reason": "missing_dependency",
            "exception": type(exc).__name__,
        }), 501
    if isinstance(exc, FileNotFoundError):
        return jsonify({
            # A remote miss may also mean "needs credentials"; its text says so.
            "error": str(exc) if is_remote_path(dataset_path) else f"Dataset not found: {dataset_path}",
            "reason": "not_found",
            "exception": type(exc).__name__,
        }), 404
    if isinstance(exc, UnsupportedEncodingError):
        # One member of a readable dataset, not the dataset's type: the text
        # names the member and the encoding.
        return jsonify({
            "error": str(exc),
            "reason": "unsupported_type",
            "exception": type(exc).__name__,
        }), 400
    if isinstance(exc, ValueError):
        return jsonify({
            "error": f"Unsupported dataset type for {dataset_path}: {exc}",
            "reason": "unsupported_type",
            "exception": type(exc).__name__,
        }), 400
    reason = getattr(exc, "reason", None)
    if reason == "stale_metadata":
        return jsonify({
            "error": str(exc),
            "reason": reason,
            "exception": type(exc).__name__,
        }), 500
    logger.exception("Unhandled error serving %s", dataset_path)
    return jsonify({
        "error": f"Failed to read {dataset_path}: {exc}",
        "reason": "read_failed",
        "exception": type(exc).__name__,
    }), 500


def _request_cap(name):
    """The ``max_cells``/``max_genes`` cap a client asked for, or None.

    It is the client's own guard against asking for more than it can draw
    (the frontend sends ui.defaults.max_cells/max_genes). It is not a server
    limit: a client can send any value. The server-side settings that used
    to provide its default (max_cells_per_request, max_genes_per_request)
    were removed for that reason.
    """
    raw = request.args.get(name)
    if raw is None:
        return None
    try:
        return int(raw)
    except ValueError:
        return None


def _cap_error_response(requested, limit, unit, axis_hint):
    """A cap rejection that says it IS a cap, in a field a client can branch on.

    The wording is unchanged so existing clients keep working; ``reason`` lets
    the UI render "truncated by a cap" instead of a generic read failure.
    """
    return jsonify({
        "error": f"Too many {unit} requested: {requested}. "
                 f"Maximum allowed is {limit}. {axis_hint}",
        "reason": "cap_exceeded",
        "requested": requested,
        "limit": limit,
        "unit": unit,
    }), 400

#: Fallback for ``max_response_elements`` when the config does not set it.
DEFAULT_MAX_RESPONSE_ELEMENTS = 10_000_000


def _matrix_shape(reader, dataset_path, kind, key=None):
    """(rows, cols) of the matrix a route would slice, from cached metadata.

    None when the shape cannot be known cheaply; the guard then stands aside
    rather than refusing a request it cannot size.
    """
    try:
        meta = reader.get_metadata(dataset_path)
    except Exception:
        return None
    shape = tuple(meta.get("shape") or ())
    if len(shape) < 2:
        return None
    n_obs, n_vars = int(shape[0]), int(shape[1])
    if kind == "X":
        return (n_obs, n_vars)
    if kind == "layer":
        info = (meta.get("layers_info") or {}).get(key) or {}
        layer_shape = tuple(info.get("shape") or ())
        return tuple(int(d) for d in layer_shape) if len(layer_shape) == 2 else (n_obs, n_vars)
    if kind == "obsp":
        return (n_obs, n_obs)
    if kind == "varp":
        return (n_vars, n_vars)
    if kind in ("obsm", "varm"):
        info = (meta.get(f"{kind}_info") or {}).get(key) or {}
        width = tuple(info.get("shape") or ())
        cols = int(width[1]) if len(width) == 2 else None
        return (n_obs if kind == "obsm" else n_vars, cols)
    return None


def _response_too_large(reader, dataset_path, kind, key, rows, cols, single_column=False):
    """A 413 when the slice would exceed ``max_response_elements``, else None.

    One full row or column is always allowed: that is the unit every view in
    the client asks for (a gene column, a cell row, an embedding axis, a kNN
    row), and its size is fixed by the dataset, not by the request. The cap
    stops what no view needs -- whole matrices and multi-vector blocks, like
    the 838 MB ``/data/layer`` reply and the worker timeouts seen in
    production -- before anything is read.
    """
    shape = _matrix_shape(reader, dataset_path, kind, key)
    if shape is None:
        return None
    n_rows = len(rows) if rows is not None else shape[0]
    if single_column:
        n_cols = 1
    elif cols is not None:
        n_cols = len(cols)
    else:
        n_cols = shape[1]
    if n_cols is None or n_rows <= 1 or n_cols <= 1:
        return None
    limit = int(app.config.get("max_response_elements", DEFAULT_MAX_RESPONSE_ELEMENTS))
    requested = n_rows * n_cols
    if requested <= limit:
        return None
    return jsonify({
        "error": f"Response too large: {n_rows} x {n_cols} = {requested} elements requested "
                 f"from {kind}{'/' + key if key else ''}; the limit is {limit} "
                 "(max_response_elements). Request one row or column, or fewer of them.",
        "reason": "response_too_large",
        "requested": requested,
        "limit": limit,
        "shape": [n_rows, n_cols],
    }), 413


class DataRequestError(Exception):
    """A request the dataset cannot answer: a key it does not have, an index
    outside an axis. Answered as ``status`` with a ``reason`` code instead of
    ``200`` and empty data, which looked like a dataset with nothing in it."""

    def __init__(self, status, reason, message):
        super().__init__(message)
        self.status, self.reason, self.message = status, reason, message


def _data_request_error_response(exc):
    return jsonify({"error": exc.message, "reason": exc.reason}), exc.status


#: For each route: (metadata field holding its keys or None, row axis, col axis).
#: An axis is "obs" / "var" (length n_obs / n_vars), "key" (the second
#: dimension of the requested matrix) or None (no such index).
_SLOTS = {
    "X": (None, "obs", "var"),
    "layers": ("layers", "obs", "var"),
    "obs": (None, "obs", None),
    "var": (None, None, "var"),
    "obsm": ("obsm", "obs", "key"),
    "varm": ("varm", "var", "key"),
    "obsp": ("obsp", "obs", "obs"),
    "varp": ("varp", "var", "var"),
    "uns": ("uns", None, None),
}


def _check_request(dataset_path, reader, slot, key=None, rows=None, cols=None, columns=None):
    """Refuse what the dataset cannot answer, before reading anything.

    Raises DataRequestError: 404 ``key_not_found`` for a missing layer,
    obsm/varm/obsp/varp/uns key, obs/var column or X; 400
    ``index_out_of_range`` for an index at or beyond the axis length. Uses
    the (cached) metadata the routes already rely on; when the reader cannot
    say (no metadata), nothing is refused here.
    """
    metadata = reader.get_metadata(dataset_path)
    if not metadata:
        return
    field, row_axis, col_axis = _SLOTS[slot]
    if slot == "X" and metadata.get("has_X") is False:
        raise DataRequestError(404, "key_not_found", "This dataset has no X matrix.")
    if field and key is not None:
        keys = (metadata.get(field) or {}).get("keys")
        # A dataset WITHOUT the group (no obsp/varp/layers at all) lists no
        # keys rather than "unknown": every key is missing. It used to fall
        # through to the reader and answer 200 {"data": []}, which the client
        # must read as "listed but unreadable" and showed as "failed to read".
        if keys is None and metadata.get(f"has_{field}") is False:
            keys = []
        top = key.split("/", 1)[0] if slot == "uns" else key
        # layer 'X' is the X matrix when no layer has that name (readers' get_layer)
        x_as_layer = slot == "layers" and key == "X" and metadata.get("has_X") is not False
        if keys is not None and top not in keys and not x_as_layer:
            raise DataRequestError(404, "key_not_found", f"No {field} key '{key}' in this dataset.")
    if columns and slot in ("obs", "var"):
        known = metadata.get(f"{slot}_columns")
        missing = [c for c in columns if known is not None and c not in known]
        if missing:
            raise DataRequestError(404, "key_not_found",
                                   f"No {slot} column {', '.join(repr(c) for c in missing)} in this dataset.")
    shape = metadata.get("shape") or ()
    lengths = {"obs": shape[0] if len(shape) > 0 else None,
               "var": shape[1] if len(shape) > 1 else None}
    if field in ("obsm", "varm") and key is not None:
        key_shape = ((metadata.get(f"{field}_info") or {}).get(key) or {}).get("shape")
        lengths["key"] = key_shape[1] if key_shape and len(key_shape) > 1 else None
    row_length = lengths.get(row_axis) if row_axis else None
    if isinstance(reader, cell_subset.DatasetRowsView):
        # rows name dataset rows; columns stay positions among the cells shown
        row_length = reader.n_obs
    col_length = lengths.get(col_axis) if col_axis else None
    for name, indices, length in (("rows", rows, row_length), ("cols", cols, col_length)):
        if indices and length is not None:
            bad = [i for i in indices if i >= length]
            if bad:
                raise DataRequestError(
                    400, "index_out_of_range",
                    f"{name} index {bad[0]} is out of range: this axis has {length} entries (0-{length - 1}).")


def _reader_for(dataset_path, dataset_rows=False):
    """The reader for a cell-axis request: the dataset, or with a ``subset``
    parameter the subset of its cells (core/subset.py).

    With a subset, every cell position in the request and the response is a
    position in the subset, and whole-axis reads return the subset's cells,
    so obs, obsm, obsp, X and layers all describe the same cells. With
    ``dataset_rows`` the cells the request names are dataset rows instead
    (see _row_indices); everything else stays the subset's.
    """
    reader = get_reader(dataset_path)
    raw = request.args.get("subset")
    if raw is None:
        return reader
    try:
        # `client` (a page's id, sent with /data/subset) lets a newer request of
        # that page stop this subset's computation; `priority=low` is a
        # prefetch that any real request stops (core/subset.py claim)
        resolved = cell_subset.resolve(reader, dataset_path, raw, app.config,
                                       client=request.args.get("client"),
                                       low=request.args.get("priority") == "low")
    except cell_subset.SubsetError as exc:
        raise DataRequestError(exc.status, exc.reason, exc.message)
    if resolved is None:
        return reader
    view = cell_subset.SubsetView(reader, resolved)
    return view.at_dataset_rows() if dataset_rows else view


def _row_indices():
    """The cells a cell-axis read names: ``(indices, by_dataset_row)``.

    ``rows`` are positions among the cells shown (the subset's, when one
    is in effect). ``dataset_rows`` are rows of the dataset, so a cell the
    subset does not show (a focused cell from another part) can be read;
    without a subset the two are the same. They are separate names so the
    two index spaces never mix silently, and sending both is refused.
    """
    rows = _parse_indices(request.args.get("rows"))
    dataset_rows = _parse_indices(request.args.get("dataset_rows"))
    if dataset_rows is None:
        return rows, False
    if rows is not None:
        raise DataRequestError(400, "rows_conflict",
                               "Send rows (positions among the cells shown) or dataset_rows "
                               "(rows of the dataset), not both.")
    return dataset_rows, True


#: Cell-dependent routes that read the store directly and cannot apply a
#: subset. They refuse one rather than answer for every cell.
_SUBSET_UNAWARE_ENDPOINTS = ("get_paginated_data", "get_statistics", "get_data_by_path")

#: Routes that read cells by dataset row (``dataset_rows``). Any other route
#: refuses the parameter rather than ignore it and answer for every row.
_DATASET_ROWS_ENDPOINTS = ("get_data_X", "get_layer", "get_obs", "get_obsm", "get_obsp",
                           "locate_subset_rows")

#: What this server's cell-axis routes understand beyond rows=; the client
#: sends dataset_rows only to a server that lists it.
SUBSET_FEATURES = ["dataset_rows", "locate", "names_scope", "locate_parts"]

#: Rows one /data/subset/locate call translates.
MAX_LOCATE_ROWS = 1000


def register_data_routes(app, api_version):
    """
    Register data access routes with the Flask app.
    
    Args:
        app: Flask application instance
        api_version: API version string
    """
    name_index.configure(app.config.get("name_index_max_mb"), app.config.get("name_search_scan_names"))

    http_cache.install_gzip(app)

    app.register_error_handler(DataRequestError, _data_request_error_response)

    @app.route(f"/api/{api_version}/data/info", methods=["GET"])
    def get_data_info():
        """
        Get information about a dataset.
        
        Query parameters:
            dataset_path: Path to the dataset.
        
        Returns:
            JSON response with dataset information
        """
        # Get dataset path
        dataset_path = request.args.get("dataset_path")
        
        # Handle legacy dataset_id parameter
        if not dataset_path:
            dataset_path = request.args.get("dataset_id")
        
        if not dataset_path:
            return jsonify({"error": "dataset_path parameter is required"}), 400
            
        # Use the direct access approach for stateless operation
        try:
            # h5ad files have their own reader; the zarr reader refuses them
            reader = get_reader(dataset_path)
            if reader is zarr_reader:
                _, metadata = zarr_reader.open_dataset_by_path(dataset_path, use_cache=True)
            else:
                metadata = reader.get_metadata(dataset_path)
            
            # Format basic info
            shape = metadata.get('shape', (0, 0))
            info = {
                "path": dataset_path,
                "name": Path(dataset_path).stem.replace("_", " ").title(),
                "shape": shape,
                "n_obs": shape[0] if len(shape) > 0 else 0,
                "n_vars": shape[1] if len(shape) > 1 else 0,
                "has_obs": metadata.get("has_obs", False),
                "has_var": metadata.get("has_var", False),
                "has_obsm": metadata.get("has_obsm", False),
                "has_varm": metadata.get("has_varm", False),
                "has_layers": metadata.get("has_layers", False),
                "has_uns": metadata.get("has_uns", False),
                "obs_columns": metadata.get("obs_columns", []),
                "var_columns": metadata.get("var_columns", []),
                "layers": metadata.get("layers", {}),
                "embeddings": metadata.get("embeddings", [])
            }
                
            return jsonify(info)
        except (PermissionError, ImportError, FileNotFoundError, TimeoutError) as e:
            return _reader_error_response(e, dataset_path)
        except Exception as e:
            logger.error(f"Error getting dataset info for path {dataset_path}: {e}")
            return jsonify({"error": f"Failed to get dataset info: {str(e)}"}), 500
    
    @app.route(f"/api/{api_version}/data/fingerprint", methods=["GET"])
    def get_fingerprint():
        """
        The store's fingerprint (core/fingerprint.py), for a saved view.

        Query parameters:
            dataset_path: Path to the dataset.
            wait: seconds to wait for the cell and gene names to be hashed
                (default 0, at most 10). Until they are, ``status`` is
                ``pending`` and the fingerprint holds the metadata tier only.

        Also returns ``rel_path``, the path relative to the data directory
        when the store is inside it (what a saved view records, so it opens
        on another server with another data directory), and the server's
        AnnZarro version. A missing store is a 404 with reason ``not_found``.
        """
        from ...core import fingerprint
        from annzarro import __version__
        dataset_path = request.args.get("dataset_path")
        if not dataset_path:
            return jsonify({"error": "dataset_path parameter is required"}), 400
        try:
            wait = min(max(float(request.args.get("wait", 0) or 0), 0.0), 10.0)
        except ValueError:
            return jsonify({"error": "wait must be a number of seconds"}), 400
        try:
            reader = get_reader(dataset_path)
            result = fingerprint.get(reader, dataset_path, wait=wait)
            if result["status"] != "ready":
                # the counts, from the metadata every route reads anyway
                if reader is zarr_reader:
                    counts = zarr_reader.get_basic_counts(dataset_path)
                    shape = (counts["cell_count"], counts["gene_count"])
                else:
                    shape = reader.get_metadata(dataset_path).get("shape", (None, None))
                result["fingerprint"]["n_obs"], result["fingerprint"]["n_var"] = int(shape[0]), int(shape[1])
        except Exception as exc:
            return _reader_error_response(exc, dataset_path)
        result["path"] = dataset_path
        result["rel_path"] = _relative_to_data_dir(dataset_path)
        result["annzarro_version"] = __version__
        return jsonify(result)

    def _relative_to_data_dir(dataset_path):
        """``dataset_path`` relative to the data directory, or None when it
        is outside it (or remote). Compared without following symlinks: an
        entry of the data directory that links elsewhere is still named by
        its name there, as the dataset listing names it."""
        if not dataset_path or is_remote_path(dataset_path):
            return None
        data_dir = app.config.get("data_dir")
        if not data_dir:
            return None
        base = os.path.abspath(os.path.expanduser(data_dir))
        path = os.path.abspath(os.path.expanduser(dataset_path))
        if path == base or not path.startswith(base.rstrip(os.sep) + os.sep):
            return None
        return os.path.relpath(path, base).replace(os.sep, "/")

    @app.route(f"/api/{api_version}/data/dataset_structure", methods=["GET"])
    @http_cache.conditional
    def get_dataset_structure():
        """
        Get complete structure information about a dataset including available matrices, embeddings, etc.
        
        Query parameters:
            dataset_path: Path to the dataset.
            
        Returns:
            JSON response with complete dataset structure.
        """
        # Get dataset identification
        dataset_path_str = request.args.get("dataset_path")
        if not dataset_path_str:
            return jsonify({"error": "dataset_path parameter is required"}), 400
        
        try:
            return process_file.extract_metadata(dataset_path_str, _reader_for(dataset_path_str))
        except Exception as exc:
            return _reader_error_response(exc, dataset_path_str)
    
    @app.route(f"/api/{api_version}/data/X", methods=["GET"])
    @http_cache.conditional
    def get_data_X():
        """
        Get data from the X matrix.
        
        Query parameters:
            dataset_path: Path to the dataset.
            rows: Comma-separated list of row indices to get.
            dataset_rows: Row indices of the dataset, also of cells the
                subset does not show. Not together with rows.
            cols: Comma-separated list of column indices to get.
            max_cells: Optional client-side cap on the cells requested; a request
                over it fails with reason cap_exceeded. No cap when omitted.
            
        Returns:
            JSON response with X matrix data
        """
        # Get dataset identification 
        dataset_path_str = request.args.get("dataset_path")
        
        if not dataset_path_str:
            return jsonify({"error": "dataset_path parameter is required"}), 400
        
        # Parse row and column indices
        cols = request.args.get("cols")
        
        # Parse max cells
        max_cells = _request_cap("max_cells")
        
        # Convert rows and cols to integer lists
        row_indices, by_dataset_row = _row_indices()
        col_indices = _parse_indices(cols)

        if max_cells is not None and row_indices and col_indices and len(row_indices) * len(col_indices) > max_cells:
            return _cap_error_response(
                len(row_indices) * len(col_indices), max_cells, "cells",
                "Please reduce the number of rows or columns."
            )

        try:
            reader = _reader_for(dataset_path_str, dataset_rows=by_dataset_row)
            _check_request(dataset_path_str, reader, "X", rows=row_indices, cols=col_indices)
            refusal = _response_too_large(reader, dataset_path_str, "X", None, row_indices, col_indices)
            if refusal is not None:
                return refusal
            return process_file.extract_X(dataset_path_str, row_indices, col_indices, reader,
                                          binary=wants_binary(request.args))
        except Exception as exc:
            return _reader_error_response(exc, dataset_path_str)
    
    @app.route(f"/api/{api_version}/data/layer/<path:layer_name>", methods=["GET"])
    @http_cache.conditional
    def get_layer(layer_name: str):
        """
        Get data from a specific layer.
        
        Path parameters:
            layer_name: Name of the layer to get.
            
        Query parameters:
            dataset_path: Path to the dataset.
            rows: Comma-separated list of row indices to get.
            dataset_rows: Row indices of the dataset, also of cells the
                subset does not show. Not together with rows.
            cols: Comma-separated list of column indices to get.
            max_cells: Optional client-side cap on the cells requested; a request
                over it fails with reason cap_exceeded. No cap when omitted.
            
        Returns:
            JSON response with layer data
        """
        # Get dataset identification
        dataset_path_str = request.args.get("dataset_path")
        
        if not dataset_path_str:
            return jsonify({"error": "dataset_path parameter is required"}), 400
        
        # Parse row and column indices
        cols = request.args.get("cols")
        
        # Parse max cells
        max_cells = _request_cap("max_cells")
        
        # Convert rows and cols to integer lists
        row_indices, by_dataset_row = _row_indices()
        col_indices = _parse_indices(cols)

        if max_cells is not None and row_indices and col_indices and len(row_indices) * len(col_indices) > max_cells:
            return _cap_error_response(
                len(row_indices) * len(col_indices), max_cells, "cells",
                "Please reduce the number of rows or columns."
            )
        
        try:
            reader = _reader_for(dataset_path_str, dataset_rows=by_dataset_row)
            _check_request(dataset_path_str, reader, "layers", key=layer_name, rows=row_indices, cols=col_indices)
            refusal = _response_too_large(reader, dataset_path_str, "layer", layer_name, row_indices, col_indices)
            if refusal is not None:
                return refusal
            return process_file.extract_layer(dataset_path_str, layer_name, row_indices, col_indices, reader,
                                              binary=wants_binary(request.args))
        except Exception as exc:
            return _reader_error_response(exc, dataset_path_str)
    
    @app.route(f"/api/{api_version}/data/obs", methods=["GET"])
    @http_cache.conditional
    def get_obs():
        """
        Get observation annotations.
        
        Query parameters:
            dataset_path: Path to the dataset.
            rows: Comma-separated list of row indices to get.
            dataset_rows: Row indices of the dataset, also of cells the
                subset does not show. Not together with rows.
            columns: Comma-separated list of column names to get.
            max_cells: Optional client-side cap on the cells requested; a request
                over it fails with reason cap_exceeded. No cap when omitted.
            format: "f32" for the binary encoding of one numeric column.
            categorical: "codes" (with format=f32) for one categorical column
                as integer codes plus its categories (core/array_response.py).
            categories: "used" (only the categories the rows use) or "ranked"
                (each row's category's rank over the whole column, no labels);
                core/categories.py.
            category_ranks: comma-separated ranks of that ranking: their labels,
                as {"labels": [...]} (the legend's names).
            
        Returns:
            JSON response with observation annotations
        """
        # Get dataset identification
        dataset_path_str = request.args.get("dataset_path")
        
        if not dataset_path_str:
            return jsonify({"error": "dataset_path parameter is required"}), 400
        
        # Parse row indices and column names
        columns = request.args.get("columns")
        
        # Parse max cells
        max_cells = _request_cap("max_cells")
        
        # Convert rows to integer list and columns to string list
        row_indices, by_dataset_row = _row_indices()
        column_names = _parse_strings(columns)
        
        # Check for too many cells
        if max_cells is not None and row_indices and len(row_indices) > max_cells:
            return _cap_error_response(
                len(row_indices), max_cells, "cells",
                "Please reduce the number of rows."
            )

        # Use direct zarr access for stateless operation
        include_categories = request.args.get("include_categories", "true").lower() not in ["false", "0", "no"]

        try:
            reader = _reader_for(dataset_path_str, dataset_rows=by_dataset_row)
            _check_request(dataset_path_str, reader, "obs", rows=row_indices, columns=column_names)
            labels = _category_labels_response(reader, dataset_path_str, "cells", column_names)
            if labels is not None:
                return labels
            n_categories, used_only, ranked = _category_rules_for(
                reader, dataset_path_str, "cells", column_names,
                _axis_rows(reader, dataset_path_str, row_indices, 0))
            if wants_codes(request.args) and column_names and len(column_names) == 1:
                coded = process_file.extract_obs_var_codes(dataset_path_str, reader, row_indices,
                                                           column_names[0], "cells", used_only, n_categories,
                                                           ranked)
                if coded is not None:
                    return coded
            return process_file.extract_obs_var(dataset_path_str, reader, row_indices, column_names, include_categories, "cells",
                                                binary=wants_binary(request.args))
        except Exception as exc:
            return _reader_error_response(exc, dataset_path_str)
    
    @app.route(f"/api/{api_version}/data/var", methods=["GET"])
    @http_cache.conditional
    def get_var():
        """
        Get variable annotations.
        
        Query parameters:
            dataset_path: Path to the dataset.
            cols: Comma-separated list of column indices to get.
            columns: Comma-separated list of column names to get.
            max_genes: Optional client-side cap on the genes requested; a request
                over it fails with reason cap_exceeded. No cap when omitted.
            format: "f32" for the binary encoding of one numeric column.
            categorical: "codes" (with format=f32) for one categorical column
                as integer codes plus its categories (core/array_response.py).
            categories: "used" or "ranked", as on /data/obs.
            
        Returns:
            JSON response with variable annotations
        """
        # Get dataset identification
        dataset_path_str = request.args.get("dataset_path")
        
        if not dataset_path_str:
            return jsonify({"error": "dataset_path parameter is required"}), 400
        
        # Parse column indices and column names
        cols = request.args.get("cols")
        columns = request.args.get("columns")
        
        # Parse max genes
        max_genes = _request_cap("max_genes")
        
        # Convert cols to integer list and columns to string list
        col_indices = _parse_indices(cols)
        column_names = _parse_strings(columns)

        if max_genes is not None and col_indices and len(col_indices) > max_genes:
            return _cap_error_response(
                len(col_indices), max_genes, "genes",
                "Please reduce the number of columns."
            )

        # Use direct zarr access for stateless operation
        include_categories = request.args.get("include_categories", "true").lower() not in ["false", "0", "no"]

        try:
            reader = get_reader(dataset_path_str)
            _check_request(dataset_path_str, reader, "var", cols=col_indices, columns=column_names)
            labels = _category_labels_response(reader, dataset_path_str, "genes", column_names)
            if labels is not None:
                return labels
            n_categories, used_only, ranked = _category_rules_for(
                reader, dataset_path_str, "genes", column_names,
                _axis_rows(reader, dataset_path_str, col_indices, 1))
            if wants_codes(request.args) and column_names and len(column_names) == 1:
                coded = process_file.extract_obs_var_codes(dataset_path_str, reader, col_indices,
                                                           column_names[0], "genes", used_only, n_categories,
                                                           ranked)
                if coded is not None:
                    return coded
            return process_file.extract_obs_var(dataset_path_str, reader, col_indices, column_names, include_categories, "genes",
                                                binary=wants_binary(request.args))
        except Exception as exc:
            return _reader_error_response(exc, dataset_path_str)
    
    @app.route(f"/api/{api_version}/data/obsm/<path:obsm_key>", methods=["GET"])
    @http_cache.conditional
    def get_obsm(obsm_key: str):
        """
        Get observation multidimensional data.
        
        Path parameters:
            obsm_key: Key in obsm to get.
            
        Query parameters:
            dataset_path: Path to the dataset.
            rows: Comma-separated list of row indices to get.
            dataset_rows: Row indices of the dataset, also of cells the
                subset does not show. Not together with rows.
            cols: Comma-separated list of column indices to get.
            max_cells: Optional client-side cap on the cells requested; a request
                over it fails with reason cap_exceeded. No cap when omitted.
            column_name: Optional column name for dataframe-encoded obsm matrices.
            
        Returns:
            JSON response with obsm data
        """
        # Get dataset identification
        dataset_path_str = request.args.get("dataset_path")
        
        if not dataset_path_str:
            return jsonify({"error": "dataset_path parameter is required"}), 400
        
        # Parse row and column indices
        cols = request.args.get("cols")
        
        # Get optional column name for dataframe-encoded matrices
        column_name = request.args.get("column_name")
        
        # Parse max cells
        max_cells = _request_cap("max_cells")
        
        # Convert rows and cols to integer lists
        row_indices, by_dataset_row = _row_indices()
        col_indices = _parse_indices(cols)

        # Check for too many genes
        if max_cells is not None and row_indices and len(row_indices) > max_cells:
            return _cap_error_response(
                len(row_indices), max_cells, "cells",
                "Please reduce the number of rows."
            )
        
        try:
            reader = _reader_for(dataset_path_str, dataset_rows=by_dataset_row)
            _check_request(dataset_path_str, reader, "obsm", key=obsm_key, rows=row_indices, cols=col_indices)
            refusal = _response_too_large(reader, dataset_path_str, "obsm", obsm_key, row_indices, col_indices,
                                          single_column=column_name is not None)
            if refusal is not None:
                return refusal
            return process_file.extract_obsm_varm(dataset_path_str, reader, obsm_key, row_indices, col_indices, column_name, "cells",
                                                  binary=wants_binary(request.args))
        except Exception as exc:
            return _reader_error_response(exc, dataset_path_str)
        
    
    @app.route(f"/api/{api_version}/data/varm/<path:varm_key>", methods=["GET"])
    @http_cache.conditional
    def get_varm(varm_key: str):
        """
        Get variable multidimensional data.
        
        Path parameters:
            varm_key: Key in varm to get.
            
        Query parameters:
            dataset_path: Path to the dataset.
            rows: Comma-separated list of row indices to get.
            cols: Comma-separated list of column indices to get.
            max_genes: Optional client-side cap on the genes requested; a request
                over it fails with reason cap_exceeded. No cap when omitted.
            column_name: Optional column name for dataframe-encoded varm matrices.
            
        Returns:
            JSON response with varm data
        """
        # Get dataset identification
        dataset_path_str = request.args.get("dataset_path")
        
        if not dataset_path_str:
            return jsonify({"error": "dataset_path parameter is required"}), 400
        
        # Parse row and column indices
        rows = request.args.get("rows")
        cols = request.args.get("cols")
        
        # Get optional column name for dataframe-encoded matrices
        column_name = request.args.get("column_name")
        
        # Parse max genes
        max_genes = _request_cap("max_genes")
        
        # Convert rows and cols to integer lists
        row_indices = _parse_indices(rows)
        col_indices = _parse_indices(cols)

        # Check for too many genes
        if max_genes is not None and row_indices and len(row_indices) > max_genes:
            return _cap_error_response(
                len(row_indices), max_genes, "genes",
                "Please reduce the number of rows."
            )

        try:
            reader = get_reader(dataset_path_str)
            _check_request(dataset_path_str, reader, "varm", key=varm_key, rows=row_indices, cols=col_indices)
            refusal = _response_too_large(reader, dataset_path_str, "varm", varm_key, row_indices, col_indices,
                                          single_column=column_name is not None)
            if refusal is not None:
                return refusal
            return process_file.extract_obsm_varm(dataset_path_str, reader, varm_key, row_indices, col_indices, column_name, "genes",
                                                  binary=wants_binary(request.args))
        except Exception as exc:
            return _reader_error_response(exc, dataset_path_str)
    
    @app.route(f"/api/{api_version}/data/obsp/<path:obsp_key>", methods=["GET"])
    @http_cache.conditional
    def get_obsp(obsp_key: str):
        """
        Get observation-observation matrices (cell-cell relationships).
        
        Path parameters:
            obsp_key: Key in obsp to get.
            
        Query parameters:
            dataset_path: Path to the dataset.
            rows: Comma-separated list of row indices to get.
            dataset_rows: Row indices of the dataset, also of cells the
                subset does not show. Not together with rows.
            cols: Comma-separated list of column indices to get.
            max_cells: Optional client-side cap on the cells requested; a request
                over it fails with reason cap_exceeded. No cap when omitted.
            
        Returns:
            JSON response with obsp data
        """
        # Get dataset identification
        dataset_path_str = request.args.get("dataset_path")
        
        if not dataset_path_str:
            return jsonify({"error": "dataset_path parameter is required"}), 400
        
        # Parse row and column indices
        cols = request.args.get("cols")
        
        # Parse max cells
        max_cells = _request_cap("max_cells")
        
        # Convert rows and cols to integer lists
        row_indices, by_dataset_row = _row_indices()
        col_indices = _parse_indices(cols)

        if max_cells is not None and row_indices and col_indices and len(row_indices) * len(col_indices) > max_cells:
            return _cap_error_response(
                len(row_indices) * len(col_indices), max_cells, "cells",
                "Please reduce the number of rows or columns."
            )

        try:
            reader = _reader_for(dataset_path_str, dataset_rows=by_dataset_row)
            _check_request(dataset_path_str, reader, "obsp", key=obsp_key, rows=row_indices, cols=col_indices)
            refusal = _response_too_large(reader, dataset_path_str, "obsp", obsp_key, row_indices, col_indices)
            if refusal is not None:
                return refusal
            return process_file.extract_obsp_varp(dataset_path_str, obsp_key, row_indices, col_indices, "cells", reader,
                                                  binary=wants_binary(request.args))
        except Exception as exc:
            return _reader_error_response(exc, dataset_path_str)
    
    @app.route(f"/api/{api_version}/data/varp/<path:varp_key>", methods=["GET"])
    @http_cache.conditional
    def get_varp(varp_key: str):
        """
        Get variable-variable matrices (gene-gene relationships).
        
        Path parameters:
            varp_key: Key in varp to get.
            
        Query parameters:
            dataset_path: Path to the dataset.
            rows: Comma-separated list of row indices to get.
            cols: Comma-separated list of column indices to get.
            max_genes: Optional client-side cap on the genes requested; a request
                over it fails with reason cap_exceeded. No cap when omitted.
            
        Returns:
            JSON response with varp data
        """
        # Get dataset identification
        dataset_path_str = request.args.get("dataset_path")
        
        if not dataset_path_str:
            return jsonify({"error": "dataset_path parameter is required"}), 400
        
        # Parse row and column indices
        rows = request.args.get("rows")
        cols = request.args.get("cols")
        
        # Parse max genes
        max_genes = _request_cap("max_genes")
        
        # Convert rows and cols to integer lists
        row_indices = _parse_indices(rows)
        col_indices = _parse_indices(cols)

        if max_genes is not None and row_indices and col_indices and len(row_indices) * len(col_indices) > max_genes:
            return _cap_error_response(
                len(row_indices) * len(col_indices), max_genes, "genes",
                "Please reduce the number of rows or columns."
            )

        try:
            reader = get_reader(dataset_path_str)
            _check_request(dataset_path_str, reader, "varp", key=varp_key, rows=row_indices, cols=col_indices)
            refusal = _response_too_large(reader, dataset_path_str, "varp", varp_key, row_indices, col_indices)
            if refusal is not None:
                return refusal
            return process_file.extract_obsp_varp(dataset_path_str, varp_key, row_indices, col_indices, "genes", reader,
                                                  binary=wants_binary(request.args))
        except Exception as exc:
            return _reader_error_response(exc, dataset_path_str)
             
    @app.route(f"/api/{api_version}/data/uns/<path:uns_key>", methods=["GET"])
    @http_cache.conditional
    def get_uns(uns_key: str):
        """
        Get unstructured annotations.
        
        Path parameters:
            uns_key: Key in uns to get.
            
        Query parameters:
            dataset_path: Path to the dataset.
            
        Returns:
            JSON response with unstructured annotations
        """
        # Get dataset identification
        dataset_path_str = request.args.get("dataset_path")
        
        if not dataset_path_str:
            return jsonify({"error": "dataset_path parameter is required"}), 400
        
        try:
            reader = get_reader(dataset_path_str)
            _check_request(dataset_path_str, reader, "uns", key=uns_key)
            return process_file.extract_uns(uns_key, dataset_path_str, reader)
        except Exception as exc:
            return _reader_error_response(exc, dataset_path_str)
        
    @app.route(f"/api/{api_version}/data/paginated", methods=["GET"])
    def get_paginated_data():
        """
        Get paginated data from any matrix type.
        
        Query parameters:
            dataset_path: Path to the dataset.
            matrix_type: Type of matrix to get ('X', 'layer', 'obsm', 'varm', 'obsp', 'varp').
            key: Key in matrix to get (required for all types except 'X').
            rows: Comma-separated list of row indices to get.
            cols: Optional comma-separated list of column indices to get.
            page: Page number (0-based).
            page_size: Number of items per page (max 1000).
            
        Returns:
            JSON response with paginated data and pagination metadata
        """
        # Get dataset identification
        dataset_path = request.args.get("dataset_path")
        
        if not dataset_path:
            return jsonify({"error": "dataset_path parameter is required"}), 400
        
        # Get matrix type and key
        matrix_type = request.args.get("matrix_type")
        key = request.args.get("key")
        
        if not matrix_type:
            return jsonify({"error": "matrix_type parameter is required"}), 400
        
        if matrix_type not in ["X", "layer", "obsm", "varm", "obsp", "varp"]:
            return jsonify({"error": f"Invalid matrix_type: {matrix_type}"}), 400
        
        if matrix_type != "X" and not key:
            return jsonify({"error": f"key parameter is required for matrix_type {matrix_type}"}), 400
        
        # Parse row and column indices
        rows = request.args.get("rows")
        cols = request.args.get("cols")
        
        # Parse pagination parameters
        try:
            page = int(request.args.get("page", 0))
            page_size = min(int(request.args.get("page_size", 100)), 1000)
        except ValueError:
            return jsonify({"error": "Invalid pagination parameters"}), 400
        
        # Convert rows and cols to integer lists
        row_indices = _parse_indices(rows)
        col_indices = _parse_indices(cols)
        
        if not row_indices:
            return jsonify({"error": "rows parameter is required"}), 400

        try:
            kind = {"X": "X", "layer": "layer", "obsm": "obsm", "varm": "varm",
                    "obsp": "obsp", "varp": "varp"}[matrix_type]
            page_rows = row_indices[page * page_size:(page + 1) * page_size]
            refusal = _response_too_large(get_reader(dataset_path), dataset_path, kind, key,
                                          page_rows, col_indices)
            if refusal is not None:
                return refusal
        except Exception as exc:
            return _reader_error_response(exc, dataset_path)

        try:
            # Get paginated data based on matrix type
            if matrix_type == "X":
                data, pagination = zarr_reader.get_X_paginated(dataset_path, row_indices, col_indices, page, page_size)
            elif matrix_type == "layer":
                data, pagination = zarr_reader.get_layer_paginated(dataset_path, key, row_indices, col_indices, page, page_size)
            elif matrix_type == "obsm":
                # Get optional column name for dataframe-encoded matrices
                column_name = request.args.get("column_name")
                data, pagination = zarr_reader.get_obsm_paginated(dataset_path, key, row_indices, col_indices, 
                                                              page, page_size, column_name=column_name)
            elif matrix_type == "varm":
                # Get optional column name for dataframe-encoded matrices
                column_name = request.args.get("column_name")
                data, pagination = zarr_reader.get_varm_paginated(dataset_path, key, row_indices, col_indices, 
                                                              page, page_size, column_name=column_name)
            elif matrix_type == "obsp":
                data, pagination = zarr_reader.get_obsp_paginated(dataset_path, key, row_indices, col_indices, page, page_size)
            elif matrix_type == "varp":
                data, pagination = zarr_reader.get_varp_paginated(dataset_path, key, row_indices, col_indices, page, page_size)
            
            # Convert NumPy arrays to Python lists for JSON serialization
            if hasattr(data, 'tolist'):
                # Direct conversion for simple ndarray
                serialized_data = data.tolist()
            elif isinstance(data, list) and data and hasattr(data[0], 'tolist'):
                # Handle list of ndarrays case
                serialized_data = [row.tolist() if hasattr(row, 'tolist') else row for row in data]
            else:
                # Already serializable or empty
                serialized_data = data
                
            logger.info(f"Successfully loaded paginated data: {type(data)}, shape: {getattr(data, 'shape', 'unknown')}")
            
            # Prepare response data
            response_data = {
                "data": serialized_data,
                "dataset_path": dataset_path,
                "pagination": pagination
            }
            
            # Add matrix key and column name if applicable
            if matrix_type != "X":
                response_data["key"] = key
                
                # Add column name for dataframe-encoded matrices
                if matrix_type in ["obsm", "varm"]:
                    column_name = request.args.get("column_name")
                    if column_name:
                        response_data["column_name"] = column_name
            
            # Add pagination headers
            response = jsonify(response_data)
            
            # Add pagination metadata to headers
            response.headers["X-Pagination-Page"] = pagination["page"]
            response.headers["X-Pagination-PageSize"] = pagination["page_size"]
            response.headers["X-Pagination-TotalRows"] = pagination["total_rows"]
            response.headers["X-Pagination-TotalPages"] = pagination["total_pages"]
            
            return response
        except Exception as e:
            logger.error(f"Error getting paginated data for {dataset_path}: {e}")
            return jsonify({"error": f"Failed to get paginated data: {str(e)}"}), 500
    
    @app.route(f"/api/{api_version}/data/genes", methods=["GET"])
    @http_cache.conditional
    def get_genes():
        """
        Get list of gene names.
        
        Query parameters:
            dataset_path: Path to the dataset.
            
        Returns:
            JSON response with gene names
        """
        # Get dataset identification
        dataset_path_str = request.args.get("dataset_path")
        
        if not dataset_path_str:
            return jsonify({"error": "dataset_path parameter is required"}), 400
        
        try:
            return process_file.extract_cells_genes(dataset_path_str, "genes", get_reader(dataset_path_str))
        except Exception as exc:
            return _reader_error_response(exc, dataset_path_str)
    
    @app.route(f"/api/{api_version}/data/cells", methods=["GET"])
    @http_cache.conditional
    def get_cells():
        """
        Get list of cell names.
        
        Query parameters:
            dataset_path: Path to the dataset.
            
        Returns:
            JSON response with cell names
        """
        # Get dataset identification
        dataset_path_str = request.args.get("dataset_path")
        
        if not dataset_path_str:
            return jsonify({"error": "dataset_path parameter is required"}), 400
        
        try:
            return process_file.extract_cells_genes(dataset_path_str, "cells", _reader_for(dataset_path_str))
        except Exception as exc:
            return _reader_error_response(exc, dataset_path_str)
    
    def _name_loader(reader, dataset_path_str, entity, searched):
        """A callable giving the names of one axis to name_index: a zarr
        store's a chunk at a time (with their number and a way to read them
        again, so the index can size itself first and a search can scan),
        else a list. ``searched``: the subset whose names are wanted, if any."""
        def load_names():
            # every name of the axis: read a zarr chunk at a time when the
            # reader can (no list of every name); a subset's names are few
            chunks_of = getattr(reader, "iter_cell_gene_name_chunks", None)
            if searched is None and chunks_of is not None:
                chunks = chunks_of(dataset_path_str, entity)
                if chunks is not None:
                    n_axis = None
                    if entity == "cells":
                        shape = (reader.get_metadata(dataset_path_str) or {}).get("shape") or ()
                        n_axis = int(shape[0]) if shape else None
                    return name_index.NameChunks(
                        chunks, n=n_axis, factory=lambda: chunks_of(dataset_path_str, entity))
            return reader.get_cell_gene_names(dataset_path_str, entity, use_cache=True)
        return load_names

    def _first_names(reader, dataset_path_str, entity, count):
        """(the first ``count`` names of an axis, how many names it has),
        read for those rows only; None when the reader cannot."""
        if isinstance(reader, cell_subset.SubsetView):
            reader = reader.base
        take = getattr(reader, "get_cell_gene_names_at", None)
        shape = (reader.get_metadata(dataset_path_str) or {}).get("shape") or ()
        at = 0 if entity == "cells" else 1
        if take is None or len(shape) <= at:
            return None
        n = int(shape[at])
        names = take(dataset_path_str, entity, list(range(min(count, n))))
        return [str(x) for x in names], n

    @app.route(f"/api/{api_version}/data/names/status", methods=["GET"])
    def names_index_status():
        """
        Whether a name search answers at once or waits for its index to be
        built (the first search of a large dataset; about 30 s at 95.6M
        cells). Never builds anything: the pickers ask while a search waits,
        to say "building name index" instead of "no match".

        Query parameters: dataset_path, entity, subset, scope, as for
        /data/names.

        Returns:
            {"state": "ready" | "building" | "absent" | "streaming"}; absent
            means the next search builds it, streaming that the dataset's
            names are too many for the memory budget
            (server.name_index_max_mb): searches scan them instead and
            may answer partially.
        """
        dataset_path_str = request.args.get("dataset_path")
        if not dataset_path_str:
            return jsonify({"error": "dataset_path parameter is required"}), 400
        entity = request.args.get("entity", "cells")
        if entity not in ("cells", "genes"):
            return jsonify({"error": "entity must be 'cells' or 'genes'"}), 400
        scope = request.args.get("scope", "subset")
        if scope not in ("subset", "dataset"):
            return jsonify({"error": "scope must be 'subset' or 'dataset'"}), 400
        try:
            reader = _reader_for(dataset_path_str)
        except Exception as exc:
            return _reader_error_response(exc, dataset_path_str)
        subset = reader.subset if isinstance(reader, cell_subset.SubsetView) and entity == "cells" else None
        searched = subset if scope == "subset" else None
        index_key = entity if searched is None else f"cells@{searched.spec.key()}"
        load_names = _name_loader(reader.base if searched is None and isinstance(reader, cell_subset.SubsetView)
                                  else reader, dataset_path_str, entity, searched)
        return jsonify({"state": name_index.index_state(dataset_path_str, index_key, load_names)})

    @app.route(f"/api/{api_version}/data/names", methods=["GET"])
    def search_names():
        """
        Search cell (obs) or gene (var) names; the typeahead behind the header
        pickers, so the browser never needs the full name list to pick one.

        Query parameters:
            dataset_path: Path to the dataset.
            entity: "cells" or "genes".
            q: Text to match (case-insensitive). Empty returns the first names.
            mode: "substring" (default: exact, then prefix, then contains),
                  "exact" or "regex".
            limit: Maximum matches (default 50, at most 500).
            subset: With entity=cells, the cells shown.
            scope: "subset" (default: only the cells shown are matched) or
                "dataset" (every cell of the dataset is; a cell the subset
                does not show has index null).

        Returns:
            {"matches": [{"name", "index", "row"}], "truncated": bool,
            "total": n} where index is the position among the cells shown,
            row the dataset row (the same as index without a subset), and
            total the number of names searched. A dataset whose names are
            too many for the memory budget (server.name_index_max_mb) is
            searched by scanning them, and the reply then also has
            "scanned" (names read), "partial" (true when the scan stopped
            before the end, so the answer may differ from a full search)
            and, if partial, "note" in words.
        """
        dataset_path_str = request.args.get("dataset_path")
        if not dataset_path_str:
            return jsonify({"error": "dataset_path parameter is required"}), 400
        entity = request.args.get("entity", "cells")
        if entity not in ("cells", "genes"):
            return jsonify({"error": "entity must be 'cells' or 'genes'"}), 400
        mode = request.args.get("mode", "substring")
        if mode not in ("substring", "exact", "regex"):
            return jsonify({"error": "mode must be 'substring', 'exact' or 'regex'"}), 400
        try:
            limit = int(request.args.get("limit", name_index.DEFAULT_LIMIT))
        except ValueError:
            return jsonify({"error": "limit must be an integer"}), 400
        query = request.args.get("q", "")
        scope = request.args.get("scope", "subset")
        if scope not in ("subset", "dataset"):
            return jsonify({"error": "scope must be 'subset' or 'dataset'"}), 400

        try:
            reader = _reader_for(dataset_path_str)
            subset = reader.subset if isinstance(reader, cell_subset.SubsetView) else None
            if entity != "cells":
                subset = None
            # A subset's cells are their own index: matches are subset
            # positions, and a cell outside the subset is not found. With
            # scope=dataset the dataset's index is searched (the one a
            # request without a subset uses), and positions are mapped.
            searched = subset if scope == "subset" else None
            if subset is not None and searched is None:
                reader = reader.base
            index_key = entity if searched is None else f"cells@{searched.spec.key()}"
            load_names = _name_loader(reader, dataset_path_str, entity, searched)

            # The first names ask for no index: a picker lists them as soon as
            # its box is focused, and an index of every cell for that (30 s at
            # 95.6M cells, 30 GB at 1B) is what a click should not build
            first = None
            if query == "" and mode != "exact" and searched is None:
                first = _first_names(reader, dataset_path_str, entity, max(1, min(limit, name_index.MAX_LIMIT)))

            stream_source = None
            try:
                if first is None:
                    index = name_index.get_index(dataset_path_str, index_key, load_names)
            except name_index.IndexOverBudget as exc:
                # too large to keep resident: answer by scanning the names
                stream_source = load_names()
                if not isinstance(stream_source, name_index.NameChunks) or stream_source.factory is None:
                    raise
                app.logger.info("Name index of %s (%s) over budget (%s); searching by scan",
                                dataset_path_str, index_key, exc)
        except Exception as exc:
            return _reader_error_response(exc, dataset_path_str)

        try:
            if first is not None:
                names, n_axis = first
                result = {"matches": [{"name": nm, "index": i} for i, nm in enumerate(names)],
                          "truncated": n_axis > len(names), "total": n_axis}
            elif stream_source is not None:
                result = name_index.stream_search(stream_source, query, limit=limit, mode=mode)
                result["total"] = stream_source.n if stream_source.n is not None else result["scanned"]
            else:
                result = index.search(query, limit=limit, mode=mode)
                result["total"] = len(index)
        except re.error as exc:
            return jsonify({"error": f"Invalid regular expression: {exc}"}), 400
        matches = result["matches"]
        found = [m["index"] for m in matches]
        if subset is None:
            rows, positions = found, found
        elif searched is not None:
            rows, positions = subset.to_rows(found), found
        else:
            rows, positions = found, [p if p >= 0 else None for p in subset.to_positions(found)]
        for match, row, position in zip(matches, rows, positions):
            match["index"], match["row"] = position, int(row)
        return jsonify(result)

    @app.before_request
    def _refuse_unapplied_subset():
        if "subset" in request.args and request.endpoint in _SUBSET_UNAWARE_ENDPOINTS:
            return jsonify({"error": f"{request.path} cannot apply a cell subset; "
                                     "request it without the subset parameter.",
                            "reason": "subset_unsupported"}), 400
        if ("dataset_rows" in request.args and f"/{api_version}/data/" in request.path
                and request.endpoint not in _DATASET_ROWS_ENDPOINTS):
            return jsonify({"error": f"{request.path} does not read cells by dataset row; "
                                     "request it without the dataset_rows parameter.",
                            "reason": "dataset_rows_unsupported"}), 400
        return None

    @app.route(f"/api/{api_version}/data/subset", methods=["GET"])
    def get_subset_info():
        """
        Resolve a cell subset and describe it.

        Query parameters:
            dataset_path: Path to the dataset.
            subset: The subset spec (JSON), "auto" for the server's default
                for this dataset's size, or "all".

        Returns:
            {"subset": <canonical spec> or null, "key": <the spec as the
            subset parameter to send>, "n": cells in the subset, "n_total":
            cells in the dataset, "n_eligible": cells passing the filter,
            "groups": per-group counts when balanced, "defaults": the
            server's threshold/size/seed, "features": what the cell-axis
            routes understand beyond rows= (SUBSET_FEATURES)}. With no
            subset (all cells, or "auto" below the threshold) subset and
            key are null and n is n_total.
        """
        dataset_path_str = request.args.get("dataset_path")
        if not dataset_path_str:
            return jsonify({"error": "dataset_path parameter is required"}), 400
        try:
            reader = _reader_for(dataset_path_str)
            if isinstance(reader, cell_subset.SubsetView):
                body = reader.subset.describe()
            else:
                shape = (reader.get_metadata(dataset_path_str) or {}).get("shape") or (0,)
                n_total = int(shape[0])
                body = {"subset": None, "key": None, "n": n_total, "n_total": n_total,
                        "n_eligible": n_total}
            body["defaults"] = cell_subset.defaults(app.config)
            body["features"] = list(SUBSET_FEATURES)
            return jsonify(body)
        except Exception as exc:
            if isinstance(exc, DataRequestError) and exc.reason == "subset_superseded":
                # Expected, not an error: the page asked for another part while
                # this one was computed. A 2xx keeps the browser from logging a
                # failed request; the client reads `superseded` and drops it.
                response = jsonify({"superseded": True, "reason": exc.reason, "error": exc.message})
                response.headers["Cache-Control"] = "no-store"
                return response
            return _reader_error_response(exc, dataset_path_str)

    @app.route(f"/api/{api_version}/data/subset/locate", methods=["GET"])
    def locate_subset_rows():
        """
        Translate cells between positions in a subset and dataset rows,
        without names: what a focused or locked cell is called in the next
        subset is its dataset row, recorded while it was shown.

        Query parameters:
            dataset_path: Path to the dataset.
            subset: The subset spec (as for every cell-axis route).
            rows: Positions in the subset, or
            dataset_rows: rows of the dataset (one of the two, at most
                1,000).

        Returns:
            {"dataset_rows": [...]} for rows, or {"rows": [position or -1,
            ...]} for dataset_rows, -1 for a row the subset does not show.
            With dataset_rows and parts=1 also {"parts": [part or null, ...]}:
            the part of the subset's partition that shows each row (null for
            a row its filter leaves out).
            Without a subset both are the same numbers.
        """
        dataset_path_str = request.args.get("dataset_path")
        if not dataset_path_str:
            return jsonify({"error": "dataset_path parameter is required"}), 400
        indices, by_dataset_row = _row_indices()
        if indices is None:
            return jsonify({"error": "rows or dataset_rows is required", "reason": "bad_indices"}), 400
        if len(indices) > MAX_LOCATE_ROWS:
            return _cap_error_response(len(indices), MAX_LOCATE_ROWS, "rows",
                                       "Locate fewer cells per request.")
        try:
            reader = _reader_for(dataset_path_str, dataset_rows=by_dataset_row)
            _check_request(dataset_path_str, reader, "obs", rows=indices)
            if not isinstance(reader, cell_subset.SubsetView):
                return jsonify({"rows" if by_dataset_row else "dataset_rows": list(indices)})
            if by_dataset_row:
                out = {"rows": reader.subset.to_positions(indices)}
                if request.args.get("parts") == "1":
                    out["parts"] = cell_subset.locate_parts(get_reader(dataset_path_str), dataset_path_str,
                                                            reader.subset.spec, indices)
                return jsonify(out)
            return jsonify({"dataset_rows": reader.subset.to_rows(indices)})
        except Exception as exc:
            return _reader_error_response(exc, dataset_path_str)

    @app.route(f"/api/{api_version}/data/statistics", methods=["GET"])
    def get_statistics():
        """
        Get statistical analysis of expression data.
        
        Query parameters:
            dataset_path: Path to the dataset.
            rows: Comma-separated list of row indices to get.
            cols: Comma-separated list of column indices to get.
            data_path: Optional path to the data (e.g., "varm/matrix_name/column_name").
                      If not provided, uses X matrix.
            
        Returns:
            JSON response with statistics
        """
        # Get dataset identification
        dataset_path = request.args.get("dataset_path")
        
        if not dataset_path:
            return jsonify({"error": "dataset_path parameter is required"}), 400
        
        # Parse row and column indices
        rows = request.args.get("rows")
        cols = request.args.get("cols")
        
        # Get optional data path
        data_path = request.args.get("data_path")
        
        # Convert rows and cols to integer lists
        row_indices = _parse_indices(rows)
        col_indices = _parse_indices(cols)
        
        try:
            # Use direct zarr access for stateless operation
            stats = zarr_reader.get_statistics(dataset_path, row_indices, col_indices, data_path)
            
            return jsonify({
                "statistics": stats,
                "dataset_path": dataset_path,
                "data_path": data_path
            })
        except Exception as e:
            logger.error(f"Error getting statistics for {dataset_path}: {e}")
            return jsonify({"error": f"Failed to get statistics: {str(e)}"}), 500
            
    @app.route(f"/api/{api_version}/data/obsm_dataframe_columns", methods=["GET"])
    def get_obsm_dataframe_columns():
        """
        Get column names for a dataframe-encoded obsm matrix.
        
        Query parameters:
            dataset_path: Path to the dataset.
            key: Key in obsm to get columns for.
            
        Returns:
            JSON response with column names
        """
        # Get dataset identification
        dataset_path = request.args.get("dataset_path")
        
        if not dataset_path:
            return jsonify({"error": "dataset_path parameter is required"}), 400
        
        # Get obsm key
        obsm_key = request.args.get("key")
        
        if not obsm_key:
            return jsonify({"error": "key parameter is required"}), 400
        
        try:
            # Use direct zarr access for stateless operation
            columns = zarr_reader.get_obsm_dataframe_columns(obsm_key, dataset_path=dataset_path)
            
            return jsonify({
                "columns": columns,
                "obsm_key": obsm_key,
                "dataset_path": dataset_path
            })
        except Exception as e:
            logger.error(f"Error getting obsm dataframe columns for {obsm_key} in {dataset_path}: {e}")
            return jsonify({"error": f"Failed to get obsm dataframe columns: {str(e)}"}), 500
            
    @app.route(f"/api/{api_version}/data/varm_dataframe_columns", methods=["GET"])
    def get_varm_dataframe_columns():
        """
        Get column names for a dataframe-encoded varm matrix.
        
        Query parameters:
            dataset_path: Path to the dataset.
            key: Key in varm to get columns for.
            
        Returns:
            JSON response with column names
        """
        # Get dataset identification
        dataset_path = request.args.get("dataset_path")
        
        if not dataset_path:
            return jsonify({"error": "dataset_path parameter is required"}), 400
        
        # Get varm key
        varm_key = request.args.get("key")
        
        if not varm_key:
            return jsonify({"error": "key parameter is required"}), 400
        
        try:
            # Use direct zarr access for stateless operation
            columns = zarr_reader.get_varm_dataframe_columns(varm_key, dataset_path=dataset_path)
            
            return jsonify({
                "columns": columns,
                "varm_key": varm_key,
                "dataset_path": dataset_path
            })
        except Exception as e:
            logger.error(f"Error getting varm dataframe columns for {varm_key} in {dataset_path}: {e}")
            return jsonify({"error": f"Failed to get varm dataframe columns: {str(e)}"}), 500
            
    @app.route(f"/api/{api_version}/data/by_path", methods=["GET"])
    def get_data_by_path():
        """
        Get data using a path notation (e.g., "varm/matrix_name/column_name").
        
        This endpoint provides a unified way to access any data in the zarr file,
        including specific columns from dataframe-encoded matrices.
        
        Query parameters:
            dataset_path: Path to the dataset.
            path: Path to the data (e.g., "varm/matrix_name/column_name" or "obsm/matrix_name/column_name").
            rows: Optional comma-separated list of row indices to get.
            cols: Optional comma-separated list of column indices to get.
            
        Returns:
            JSON response with the requested data
        """
        # Get dataset identification
        dataset_path = request.args.get("dataset_path")
        
        if not dataset_path:
            return jsonify({"error": "dataset_path parameter is required"}), 400
        
        # Get data path
        data_path = request.args.get("path")
        
        if not data_path:
            return jsonify({"error": "path parameter is required"}), 400
        
        # Parse row and column indices
        rows = request.args.get("rows")
        cols = request.args.get("cols")
        
        # Convert rows and cols to integer lists
        row_indices = _parse_indices(rows)
        col_indices = _parse_indices(cols)
        
        parts = data_path.strip("/").split("/")
        kind = {"X": "X", "layers": "layer", "obsm": "obsm", "varm": "varm",
                "obsp": "obsp", "varp": "varp"}.get(parts[0])
        if kind is not None:
            try:
                refusal = _response_too_large(
                    get_reader(dataset_path), dataset_path, kind,
                    parts[1] if len(parts) > 1 else None, row_indices, col_indices,
                    single_column=len(parts) == 3)
            except Exception as exc:
                return _reader_error_response(exc, dataset_path)
            if refusal is not None:
                return refusal

        try:
            # Use direct zarr access for stateless operation
            data = zarr_reader.get_data_by_path(data_path, dataset_path=dataset_path,  
                                             indices=row_indices, col_indices=col_indices)
            
            # Convert NumPy arrays to Python lists for JSON serialization
            if hasattr(data, 'tolist'):
                # Direct conversion for simple ndarray
                serialized_data = data.tolist()
            elif isinstance(data, list) and data and hasattr(data[0], 'tolist'):
                # Handle list of ndarrays case
                serialized_data = [row.tolist() if hasattr(row, 'tolist') else row for row in data]
            else:
                # Already serializable or empty
                serialized_data = data
                
            logger.info(f"Successfully loaded data from path {data_path}: {type(data)}, shape: {getattr(data, 'shape', 'unknown')}")
            
            return jsonify({
                "data": serialized_data,
                "path": data_path,
                "dataset_path": dataset_path
            })
        except Exception as e:
            logger.error(f"Error getting data at path {data_path} in {dataset_path}: {e}")
            return jsonify({"error": f"Failed to get data at path {data_path}: {str(e)}"}), 500
    
    @app.route(f"/api/{api_version}/directories/home", methods=["GET"])
    def get_home_directory():
        """
        Get the home directory for data browsing.
        
        Returns:
            JSON response with home directory path
        """
        try:
            # Get data directory from config
            data_dir = app.config.get("data_dir")
            
            return jsonify({
                "directory": data_dir
            })
        except Exception as e:
            logger.error(f"Error getting home directory: {e}")
            return jsonify({"error": f"Failed to get home directory: {str(e)}"}), 500
    
    @app.route(f"/api/{api_version}/directories/list", methods=["GET"])
    def list_directory():
        """
        List contents of a directory.
        
        Query parameters:
            path: Path to directory to list.
            
        Returns:
            JSON response with directory contents
        """
        # Get directory path
        directory_path = request.args.get("path")
        
        if not directory_path:
            return jsonify({"error": "path parameter is required"}), 400
        
        try:
            # Get data directory from config for validation
            data_dir = app.config.get("data_dir")
            
            # Verify the requested path is within the data directory or is an absolute path
            if not os.path.isabs(directory_path) and not directory_path.startswith(data_dir):
                directory_path = os.path.join(data_dir, directory_path)
            
            # Check if the directory exists
            if not os.path.exists(directory_path) or not os.path.isdir(directory_path):
                return jsonify({"error": f"Directory not found: {directory_path}"}), 404
            
            # List directories and zarr stores separately
            directories = []
            zarr_stores = []
            
            # List all entries in the directory
            for entry in os.listdir(directory_path):
                entry_path = os.path.join(directory_path, entry)
                
                # Skip if not a directory
                if not os.path.isdir(entry_path):
                    continue

                # A link a hosted server would refuse to open is not offered
                if not confinement.listable(app.config, entry_path):
                    continue
                
                # Enhanced zarr store detection
                is_zarr = False
                
                # 1. Check for .zarr extension
                if entry.endswith(".zarr"):
                    is_zarr = True
                # 2. Check for .zgroup file (standard zarr marker)
                elif os.path.exists(os.path.join(entry_path, ".zgroup")):
                    is_zarr = True
                # 3. Check for .zarray file (used in some zarr stores)
                elif os.path.exists(os.path.join(entry_path, ".zarray")):
                    is_zarr = True
                # 4. Check for zarr subdir structure (X, obs, var, obsm, layers are common)
                elif any(os.path.exists(os.path.join(entry_path, subdir)) 
                        for subdir in ["X", "obs", "var", "obsm", "layers"]):
                    is_zarr = True
                
                if is_zarr:
                    # Try to get some basic info about the zarr store
                    try:
                        # Use the fast method to get only cell and gene counts
                        counts = zarr_reader.get_basic_counts(entry_path)
                        cells = counts['cell_count']
                        genes = counts['gene_count']
                    except Exception:
                        # Not a valid AnnData zarr store - skip and move to regular directories
                        continue
                    
                    zarr_stores.append({
                        "name": entry,
                        "path": entry_path,
                        "is_link": os.path.islink(entry_path),
                        "cells": cells,
                        "genes": genes
                    })
                else:
                    # It's a regular directory
                    directories.append({
                        "name": entry,
                        "path": entry_path,
                        "is_link": os.path.islink(entry_path)
                    })
            
            # Sort zarr stores and directories by name
            zarr_stores.sort(key=lambda x: x["name"])
            directories.sort(key=lambda x: x["name"])
            
            return jsonify({
                "directories": directories,
                "zarr_stores": zarr_stores,
                "path": directory_path
            })
        except Exception as e:
            logger.error(f"Error listing directory {directory_path}: {e}")
            return jsonify({"error": f"Failed to list directory: {str(e)}"}), 500
    
    @app.route(f"/api/{api_version}/datasets", methods=["GET"])
    def list_all_datasets():
        """
        List available datasets.
        
        Returns:
            JSON response with available datasets
        """
        try:
            # Get data directory from config
            data_dir = app.config.get("data_dir")
            
            # The top level of data_dir AND its datasets/ subdirectory (the
            # desktop app creates one). Listing only datasets/ whenever it
            # existed hid every store placed directly in the data directory.
            datasets_dir = os.path.join(data_dir, "datasets")
            search = [(data_dir, entry) for entry in _listdir(data_dir)
                      if entry not in ("datasets", "sessions")]
            if os.path.isdir(datasets_dir):
                search += [(datasets_dir, entry) for entry in _listdir(datasets_dir)]
            
            # List for storing zarr datasets
            zarr_stores = []
            
            try:
                # Only the first level of each directory
                for parent, entry in search:
                    entry_path = os.path.join(parent, entry)
                    
                    # Skip hidden files and directories
                    if entry.startswith('.'):
                        continue

                    # A link a hosted server would refuse to open is not offered
                    if not confinement.listable(app.config, entry_path):
                        continue

                    # H5AD files are served directly by the h5ad reader (no zarr
                    # conversion needed); list them alongside zarr stores so
                    # plain .h5ad datasets are browsable. isfile() follows
                    # symlinks, so symlinked .h5ad entries are picked up too.
                    if entry.endswith(".h5ad") and os.path.isfile(entry_path):
                        def _h5ad_counts(path):
                            # get_metadata reads only the file's structure (not
                            # the matrices), and it is the cached metadata every
                            # route uses once the dataset is opened: get_reader
                            # returns the same reader the routes read through.
                            shape = get_reader(path).get_metadata(path).get("shape", (0, 0))
                            return int(shape[0]), int(shape[1])

                        counts = _probe_dataset_counts(entry_path, _h5ad_counts)
                        if counts is None:
                            # Not a readable AnnData h5ad — skip it.
                            continue
                        cells, genes = counts

                        zarr_stores.append({
                            "name": entry,
                            "path": entry_path,
                            "is_link": os.path.islink(entry_path),
                            "cells": cells,
                            "genes": genes,
                            "rel_path": os.path.relpath(entry_path, data_dir)
                        })
                        continue

                    # Skip if not a directory
                    if not os.path.isdir(entry_path):
                        continue

                    # Enhanced zarr store detection
                    is_zarr = False
                    
                    # 1. Check for .zarr extension
                    if entry.endswith(".zarr"):
                        is_zarr = True
                    # 2. Check for .zgroup file (standard zarr marker)
                    elif os.path.exists(os.path.join(entry_path, ".zgroup")):
                        is_zarr = True
                    # 3. Check for .zarray file (used in some zarr stores)
                    elif os.path.exists(os.path.join(entry_path, ".zarray")):
                        is_zarr = True
                    # 4. Check for zarr subdir structure (X, obs, var, obsm, layers are common)
                    elif any(os.path.exists(os.path.join(entry_path, subdir)) 
                            for subdir in ["X", "obs", "var", "obsm", "layers"]):
                        is_zarr = True
                        
                    if is_zarr:
                        # Try to get basic info about the zarr store
                        def _zarr_counts(path):
                            # Use the fast method to get only cell and gene counts
                            c = zarr_reader.get_basic_counts(path)
                            return c['cell_count'], c['gene_count']

                        counts = _probe_dataset_counts(entry_path, _zarr_counts)
                        if counts is None:
                            # If we can't open the zarr store or it's not a valid AnnData structure, skip it
                            continue
                        if isinstance(counts, ZarrFormatError):
                            zarr_stores.append({
                                "name": entry,
                                "path": entry_path,
                                "is_link": os.path.islink(entry_path),
                                "cells": None,
                                "genes": None,
                                "error": str(counts),
                                "rel_path": os.path.relpath(entry_path, data_dir)
                            })
                            continue
                        cells, genes = counts
                        
                        zarr_stores.append({
                            "name": entry,
                            "path": entry_path,
                            "is_link": os.path.islink(entry_path),
                            "cells": cells,
                            "genes": genes,
                            "rel_path": os.path.relpath(entry_path, data_dir)
                        })
            except Exception as e:
                logger.warning(f"Error listing directory {datasets_dir}: {e}")
            
            # Sort datasets by name
            zarr_stores.sort(key=lambda x: x["name"])
            
            return jsonify(zarr_stores)
        except Exception as e:
            logger.error(f"Error listing datasets: {e}")
            return jsonify({"error": f"Failed to list datasets: {str(e)}"}), 500

    def _get_sessions_dir():
        """
        Get the sessions directory path and ensure it exists.
        
        Returns:
            Path to the sessions directory.
        """
        sessions_dir = os.path.join(app.config.get("data_dir"), "sessions")
        os.makedirs(sessions_dir, exist_ok=True)
        return sessions_dir
        
    def _is_safe_session_path(file_path, sessions_dir=None):
        """
        Check if a file path is within the sessions directory.
        
        Args:
            file_path: Path to check.
            sessions_dir: Optional sessions directory path. If not provided, will be determined.
            
        Returns:
            Boolean indicating if the path is safe.
        """
        if sessions_dir is None:
            sessions_dir = _get_sessions_dir()

        # A string-prefix test is not containment: "/data/sessions_old/x.json"
        # starts with "/data/sessions". Resolve symlinks and require the file
        # to sit DIRECTLY in the sessions directory -- sessions are never
        # nested -- and to be a .json file, since delete honours a
        # caller-supplied ``file`` and must not remove anything else.
        sessions_dir = os.path.realpath(sessions_dir)
        file_path = os.path.realpath(file_path)
        return (os.path.dirname(file_path) == sessions_dir
                and file_path.endswith(".json"))
    
    def _sanitize_session_name(name):
        """
        Sanitize a session name to prevent path traversal attacks.
        
        Args:
            name: Session name to sanitize.
            
        Returns:
            Sanitized session name.
        """
        # Remove any path separators or potentially dangerous characters
        sanitized = name.replace('/', '_').replace('\\', '_').replace('..', '_')
        # Allow only alphanumeric characters, underscore, hyphen, and space
        return ''.join(c for c in sanitized if c.isalnum() or c in ' _-')

    def _read_stored_session(file_path):
        """
        Read a stored panel set for a permission check.

        Returns None when the file does not exist. A file that exists but
        cannot be parsed is returned as an empty dict: it has no recorded
        owner, so it is treated like a legacy set (admin-only), never as
        absent -- absent would let anyone overwrite it.
        """
        if not os.path.exists(file_path):
            return None
        try:
            with open(file_path, 'r') as f:
                data = json.load(f)
            return data if isinstance(data, dict) else {}
        except Exception as e:
            logger.warning(f"Unreadable session file {file_path}: {e}")
            return {}

    @app.route(f"/api/{api_version}/sessions/save", methods=["POST"])
    def save_session():
        """
        Save a session.
        
        Expected JSON input:
        {
            "name": "Session name",
            "dataset": "Dataset path",
            ...
        }
        
        Returns:
            JSON response with save status
        """
        try:
            # Get session data from request
            session_data = request.json
            
            if not session_data:
                return jsonify({"error": "No session data provided"}), 400
            
            if "name" not in session_data:
                return jsonify({"error": "Session name is required"}), 400
            
            # Sanitize session name to prevent path traversal
            original_name = session_data["name"]
            session_data["name"] = _sanitize_session_name(session_data["name"])
            
            # Add timestamp if not present
            if "timestamp" not in session_data:
                from datetime import datetime
                session_data["timestamp"] = datetime.now().isoformat()
            
            # Get sessions directory
            sessions_dir = _get_sessions_dir()
            
            # Construct safe file path
            session_file = os.path.join(sessions_dir, f"{session_data['name']}.json")
            
            # Verify the file is within the sessions directory
            if not _is_safe_session_path(session_file, sessions_dir):
                return jsonify({"error": "Invalid session name"}), 400
            
            # Saving over an existing set replaces it: same rule as delete
            existing = _read_stored_session(session_file)
            if not permissions.can_modify(existing):
                return permissions.forbidden("overwrite", session_data["name"], existing)
            permissions.stamp_session(session_data, existing)
            
            # Save session file
            with open(session_file, 'w') as f:
                json.dump(session_data, f, indent=2)
            
            # Notice if sanitization changed the name
            message = f"Session saved as {session_data['name']}"
            if original_name != session_data["name"]:
                message += f" (original name '{original_name}' was sanitized)"
            
            return jsonify({
                "status": "success",
                "message": message,
                "file": session_file,
                "sanitized_name": session_data["name"]
            })
        except Exception as e:
            logger.error(f"Error saving session: {e}")
            return jsonify({"error": f"Failed to save session: {str(e)}"}), 500
    
    @app.route(f"/api/{api_version}/sessions/list", methods=["GET"])
    def list_sessions():
        """
        List available sessions.
        
        Returns:
            JSON response with available sessions
        """
        try:
            # Get sessions directory
            sessions_dir = _get_sessions_dir()
            
            # List session files
            sessions = []
            for entry in os.listdir(sessions_dir):
                if entry.endswith(".json"):
                    session_path = os.path.join(sessions_dir, entry)
                    
                    # Verify the file is within the sessions directory
                    if not _is_safe_session_path(session_path, sessions_dir):
                        logger.warning(f"Skipping file outside sessions directory: {session_path}")
                        continue
                    
                    try:
                        with open(session_path, 'r') as f:
                            session_data = json.load(f)
                            
                            # Include basic information
                            sessions.append({
                                "name": session_data.get("name", entry.replace(".json", "")),
                                "dataset": session_data.get("dataset", ""),
                                "timestamp": session_data.get("timestamp", ""),
                                "datasetName": session_data.get("datasetName", ""),
                                "file": session_path,
                                "owner": session_data.get("owner"),
                                "created_at": session_data.get("created_at"),
                                "modified_at": session_data.get("modified_at"),
                                "can_modify": permissions.can_modify(session_data)
                            })
                    except Exception as e:
                        logger.warning(f"Error reading session file {entry}: {e}")
            
            # Sort sessions by timestamp (newest first)
            sessions.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
            
            return jsonify(sessions)
        except Exception as e:
            logger.error(f"Error listing sessions: {e}")
            return jsonify({"error": f"Failed to list sessions: {str(e)}"}), 500
    
    @app.route(f"/api/{api_version}/sessions/load", methods=["GET"])
    def load_session():
        """
        Load a session.
        
        Query parameters:
            name: Session name to load.
            file: Optional path to session file.
            
        Returns:
            JSON response with session data
        """
        # Get session name
        session_name = request.args.get("name")
        session_file = request.args.get("file")
        
        if not session_name and not session_file:
            return jsonify({"error": "Either name or file parameter is required"}), 400
        
        try:
            # Get sessions directory
            sessions_dir = _get_sessions_dir()
            
            # Find session file
            if session_file:
                # Use provided file path but verify it's in the sessions directory
                file_path = session_file
                if not _is_safe_session_path(file_path, sessions_dir):
                    return jsonify({"error": "Invalid session file path"}), 400
            else:
                # Find by name
                sanitized_name = _sanitize_session_name(session_name)
                file_path = os.path.join(sessions_dir, f"{sanitized_name}.json")
            
            # Check if file exists
            if not os.path.exists(file_path):
                return jsonify({"error": f"Session file not found: {sanitized_name if 'sanitized_name' in locals() else os.path.basename(file_path)}"}), 404
            
            # Load session data
            with open(file_path, 'r') as f:
                session_data = json.load(f)
            
            return jsonify(session_data)
        except Exception as e:
            logger.error(f"Error loading session: {e}")
            return jsonify({"error": f"Failed to load session: {str(e)}"}), 500
    
    @app.route(f"/api/{api_version}/sessions/delete", methods=["DELETE"])
    def delete_session():
        """
        Delete a session.
        
        Query parameters:
            name: Session name to delete.
            file: Optional path to session file.
            
        Returns:
            JSON response with deletion status
        """
        # Get session name
        session_name = request.args.get("name")
        session_file = request.args.get("file")
        
        if not session_name and not session_file:
            return jsonify({"error": "Either name or file parameter is required"}), 400
        
        try:
            # Get sessions directory
            sessions_dir = _get_sessions_dir()
            
            # Find session file
            if session_file:
                # Use provided file path but verify it's in the sessions directory
                file_path = session_file
                if not _is_safe_session_path(file_path, sessions_dir):
                    return jsonify({"error": "Invalid session file path"}), 400
            else:
                # Find by name
                sanitized_name = _sanitize_session_name(session_name)
                file_path = os.path.join(sessions_dir, f"{sanitized_name}.json")
            
            # Check if file exists
            if not os.path.exists(file_path):
                return jsonify({"error": f"Session file not found: {sanitized_name if 'sanitized_name' in locals() else os.path.basename(file_path)}"}), 404
            
            # Verify again that file is within sessions directory (belt and suspenders)
            if not _is_safe_session_path(file_path, sessions_dir):
                return jsonify({"error": "Cannot delete file outside sessions directory"}), 403
            
            existing = _read_stored_session(file_path)
            if not permissions.can_modify(existing):
                display_name = session_name or os.path.basename(file_path)[:-len(".json")]
                return permissions.forbidden("delete", display_name, existing)
                
            # Delete the file
            os.remove(file_path)
            
            return jsonify({
                "status": "success",
                "message": f"Session {session_name or os.path.basename(file_path)} deleted successfully"
            })
        except Exception as e:
            logger.error(f"Error deleting session: {e}")
            return jsonify({"error": f"Failed to delete session: {str(e)}"}), 500
    
    @app.route(f"/api/{api_version}/sessions/export", methods=["GET"])
    def export_session():
        """
        Export a session for download.
        
        Query parameters:
            name: Session name to export.
            file: Optional path to session file.
            
        Returns:
            Session file as attachment for download
        """
        # Get session name
        session_name = request.args.get("name")
        session_file = request.args.get("file")
        
        if not session_name and not session_file:
            return jsonify({"error": "Either name or file parameter is required"}), 400
        
        try:
            # Get sessions directory
            sessions_dir = _get_sessions_dir()
            
            # Find session file
            if session_file:
                # Use provided file path but verify it's in the sessions directory
                file_path = session_file
                if not _is_safe_session_path(file_path, sessions_dir):
                    return jsonify({"error": "Invalid session file path"}), 400
            else:
                # Find by name
                sanitized_name = _sanitize_session_name(session_name)
                file_path = os.path.join(sessions_dir, f"{sanitized_name}.json")
            
            # Check if file exists
            if not os.path.exists(file_path):
                return jsonify({"error": f"Session file not found: {sanitized_name if 'sanitized_name' in locals() else os.path.basename(file_path)}"}), 404
            
            # Verify again that file is within sessions directory
            if not _is_safe_session_path(file_path, sessions_dir):
                return jsonify({"error": "Cannot export file outside sessions directory"}), 403
            
            # Load session data to get the original name for download
            with open(file_path, 'r') as f:
                session_data = json.load(f)
                download_name = session_data.get("name", os.path.basename(file_path))
            
            # Send file as attachment
            from flask import send_file
            return send_file(
                file_path,
                mimetype='application/json',
                as_attachment=True,
                download_name=f"{download_name}.json"
            )
        except Exception as e:
            logger.error(f"Error exporting session: {e}")
            return jsonify({"error": f"Failed to export session: {str(e)}"}), 500
    
    @app.route(f"/api/{api_version}/sessions/exists", methods=["GET"])
    def check_session_exists():
        """
        Check if a session with the given name exists.
        
        Query parameters:
            name: Session name to check.
            
        Returns:
            JSON response with existence status
        """
        # Get session name
        session_name = request.args.get("name")
        
        if not session_name:
            return jsonify({"error": "Name parameter is required"}), 400
        
        try:
            # Get sessions directory
            sessions_dir = _get_sessions_dir()
            
            # Sanitize the session name
            sanitized_name = _sanitize_session_name(session_name)
            
            # Check if file exists
            file_path = os.path.join(sessions_dir, f"{sanitized_name}.json")
            existing = _read_stored_session(file_path)
            exists = existing is not None
            
            return jsonify({
                "exists": exists,
                "file": file_path if exists else None,
                "sanitized_name": sanitized_name,
                "owner": existing.get("owner") if exists else None,
                "can_modify": permissions.can_modify(existing)
            })
        except Exception as e:
            logger.error(f"Error checking session existence: {e}")
            return jsonify({"error": f"Failed to check session existence: {str(e)}"}), 500
    
    @app.route(f"/api/{api_version}/sessions/rename", methods=["POST"])
    def rename_session():
        """
        Rename a session.
        
        Expected JSON input:
        {
            "old_name": "Current session name",
            "new_name": "New session name"
        }
        
        Returns:
            JSON response with rename status
        """
        try:
            # Get rename data from request
            rename_data = request.json
            
            if not rename_data:
                return jsonify({"error": "No rename data provided"}), 400
            
            if "old_name" not in rename_data or "new_name" not in rename_data:
                return jsonify({"error": "Both old_name and new_name are required"}), 400
            
            old_name = rename_data["old_name"]
            new_name = rename_data["new_name"]
            
            # Get sessions directory
            sessions_dir = _get_sessions_dir()
            
            # Sanitize names to prevent path traversal
            sanitized_old_name = _sanitize_session_name(old_name)
            sanitized_new_name = _sanitize_session_name(new_name)
            
            # Find old session file
            old_file_path = os.path.join(sessions_dir, f"{sanitized_old_name}.json")
            
            # Verify the file is within the sessions directory
            if not _is_safe_session_path(old_file_path, sessions_dir):
                return jsonify({"error": "Invalid session file path"}), 400
            
            # Check if old file exists
            if not os.path.exists(old_file_path):
                return jsonify({"error": f"Session not found: {old_name}"}), 404
            
            # Load session data
            with open(old_file_path, 'r') as f:
                session_data = json.load(f)
            
            # Renaming removes the set from under its old name: same rule as delete
            if not permissions.can_modify(session_data):
                return permissions.forbidden("rename", sanitized_old_name, session_data)
            
            # Update session name
            # Store the SANITIZED name: list_sessions hands "name" to a client
            # that renders it as HTML, and save/import already store it this way.
            session_data["name"] = sanitized_new_name
            
            # Create new file path
            new_file_path = os.path.join(sessions_dir, f"{sanitized_new_name}.json")
            
            # Verify the new file is within the sessions directory
            if not _is_safe_session_path(new_file_path, sessions_dir):
                return jsonify({"error": "Invalid new session name"}), 400
            
            # Check if new file already exists
            if os.path.exists(new_file_path) and old_file_path != new_file_path:
                return jsonify({
                    "status": "conflict",
                    "message": f"Session with name '{new_name}' already exists."
                }), 409
            
            # Ownership and creation time travel with the set
            permissions.stamp_session(session_data, existing=dict(session_data))
            
            # Write session data to new file
            with open(new_file_path, 'w') as f:
                json.dump(session_data, f, indent=2)
            
            # Delete old file if names are different
            if old_file_path != new_file_path:
                os.remove(old_file_path)
            
            return jsonify({
                "status": "success",
                "message": f"Session renamed from '{old_name}' to '{new_name}'",
                "old_file": old_file_path,
                "new_file": new_file_path,
                "session": session_data,
                "sanitized_old_name": sanitized_old_name,
                "sanitized_new_name": sanitized_new_name
            })
        except Exception as e:
            logger.error(f"Error renaming session: {e}")
            return jsonify({"error": f"Failed to rename session: {str(e)}"}), 500
    
    @app.route(f"/api/{api_version}/sessions/owner", methods=["POST"])
    def set_session_owner():
        """
        Assign a panel set to a user. Admins only.

        This is how a set saved before owners were recorded -- admin-only to
        change until then -- is handed back to the person who made it. It can
        also reassign any set, e.g. when someone leaves.

        Expected JSON input:
        {
            "name": "Session name",
            "owner": "existing username"
        }

        Returns:
            JSON response with the updated owner
        """
        if not permissions.auth_enabled():
            return jsonify({
                "error": "Owners only matter when login is enabled; this server runs without login.",
                "reason": "auth_disabled",
            }), 400
        _, is_admin = permissions.current_user()
        if not is_admin:
            return jsonify({
                "error": "Only an admin can assign a panel set's owner.",
                "reason": "admin_only",
            }), 403

        data = request.json or {}
        name = data.get("name")
        owner = data.get("owner")
        if not name or not owner:
            return jsonify({"error": "Both name and owner are required"}), 400
        if app.auth_manager.get_user(owner) is None:
            return jsonify({"error": f"No such user: {owner}", "reason": "unknown_user"}), 400

        try:
            sessions_dir = _get_sessions_dir()
            sanitized_name = _sanitize_session_name(name)
            file_path = os.path.join(sessions_dir, f"{sanitized_name}.json")
            if not _is_safe_session_path(file_path, sessions_dir):
                return jsonify({"error": "Invalid session name"}), 400
            existing = _read_stored_session(file_path)
            if existing is None:
                return jsonify({"error": f"Session not found: {name}"}), 404
            if not existing and os.path.getsize(file_path) > 0:
                return jsonify({"error": f"Session file for '{sanitized_name}' cannot be parsed"}), 400

            previous = existing.get("owner")
            permissions.stamp_session(existing, existing=dict(existing))
            existing["owner"] = owner
            with open(file_path, 'w') as f:
                json.dump(existing, f, indent=2)
            logger.info(f"Panel set '{sanitized_name}' owner changed from {previous!r} to {owner!r}")

            return jsonify({
                "status": "success",
                "message": f"Panel set '{sanitized_name}' now belongs to {owner}",
                "name": sanitized_name,
                "owner": owner,
                "previous_owner": previous,
            })
        except Exception as e:
            logger.error(f"Error assigning session owner: {e}")
            return jsonify({"error": f"Failed to assign owner: {str(e)}"}), 500

    @app.route(f"/api/{api_version}/sessions/duplicate", methods=["POST"])
    def duplicate_session():
        """
        Create a duplicate copy of a session.
        
        Expected JSON input:
        {
            "source_name": "Source session name",
            "new_name": "New session name"
        }
        
        Returns:
            JSON response with duplicate status
        """
        try:
            # Get duplicate data from request
            duplicate_data = request.json
            
            if not duplicate_data:
                return jsonify({"error": "No duplicate data provided"}), 400
            
            if "source_name" not in duplicate_data or "new_name" not in duplicate_data:
                return jsonify({"error": "Both source_name and new_name are required"}), 400
            
            source_name = duplicate_data["source_name"]
            new_name = duplicate_data["new_name"]
            
            # Get sessions directory
            sessions_dir = _get_sessions_dir()
            
            # Sanitize names to prevent path traversal
            sanitized_source_name = _sanitize_session_name(source_name)
            sanitized_new_name = _sanitize_session_name(new_name)
            
            # Find source session file
            source_file_path = os.path.join(sessions_dir, f"{sanitized_source_name}.json")
            
            # Verify the source file is within the sessions directory
            if not _is_safe_session_path(source_file_path, sessions_dir):
                return jsonify({"error": "Invalid source session file path"}), 400
            
            # Check if source file exists
            if not os.path.exists(source_file_path):
                return jsonify({"error": f"Session not found: {source_name}"}), 404
            
            # Load session data
            with open(source_file_path, 'r') as f:
                session_data = json.load(f)
            
            # Update session name and timestamp
            # Store the SANITIZED name: list_sessions hands "name" to a client
            # that renders it as HTML, and save/import already store it this way.
            session_data["name"] = sanitized_new_name
            from datetime import datetime
            session_data["timestamp"] = datetime.now().isoformat()
            
            # Create new file path
            new_file_path = os.path.join(sessions_dir, f"{sanitized_new_name}.json")
            
            # Verify the new file is within the sessions directory
            if not _is_safe_session_path(new_file_path, sessions_dir):
                return jsonify({"error": "Invalid new session name"}), 400
            
            # Check if new file already exists
            if os.path.exists(new_file_path):
                return jsonify({
                    "status": "conflict",
                    "message": f"Session with name '{new_name}' already exists."
                }), 409
            
            # A copy is a new set: it belongs to whoever made it
            permissions.stamp_session(session_data, existing=None)
            
            # Write session data to new file
            with open(new_file_path, 'w') as f:
                json.dump(session_data, f, indent=2)
            
            return jsonify({
                "status": "success",
                "message": f"Session duplicated from '{source_name}' to '{new_name}'",
                "source_file": source_file_path,
                "new_file": new_file_path,
                "session": session_data,
                "sanitized_source_name": sanitized_source_name,
                "sanitized_new_name": sanitized_new_name
            })
        except Exception as e:
            logger.error(f"Error duplicating session: {e}")
            return jsonify({"error": f"Failed to duplicate session: {str(e)}"}), 500
    
    @app.route(f"/api/{api_version}/sessions/import", methods=["POST"])
    def import_session():
        """
        Import a session from uploaded file.
        
        Form parameters:
            file: Session file to upload.
            overwrite: Optional boolean to overwrite existing session with the same name (default: false).
            
        Returns:
            JSON response with import status
        """
        try:
            # Check if file was uploaded
            if 'file' not in request.files:
                return jsonify({"error": "No file provided"}), 400
            
            file = request.files['file']
            
            # Check if file has a name
            if file.filename == '':
                return jsonify({"error": "No file selected"}), 400
            
            # Check if file has JSON extension
            if not file.filename.endswith('.json'):
                return jsonify({"error": "File must be a JSON file"}), 400
            
            # Get overwrite flag
            overwrite = request.form.get('overwrite', 'false').lower() == 'true'
            
            # Get sessions directory
            sessions_dir = _get_sessions_dir()
            
            # Load session data to validate and get name
            try:
                session_data = json.loads(file.read())
                file.seek(0)  # Reset file pointer after reading
            except json.JSONDecodeError:
                return jsonify({"error": "Invalid session file: not a valid JSON file"}), 400
            
            # Validate session data
            if "name" not in session_data:
                return jsonify({"error": "Invalid session file: missing name property"}), 400
            
            # Get custom name from form if provided
            custom_name = request.form.get('name')
            
            # Sanitize the session name
            if custom_name:
                # Use custom provided name (from frontend)
                original_name = session_data["name"]
                session_data["name"] = _sanitize_session_name(custom_name)
            else:
                # Use the name from the file's JSON content
                original_name = session_data["name"]
                session_data["name"] = _sanitize_session_name(session_data["name"])
            
            # Construct safe file path
            file_path = os.path.join(sessions_dir, f"{session_data['name']}.json")
            
            # Verify the file is within the sessions directory
            if not _is_safe_session_path(file_path, sessions_dir):
                return jsonify({"error": "Invalid session name in imported file"}), 400
            
            # Check if session with this name already exists
            existing = _read_stored_session(file_path)
            if existing is not None and not overwrite:
                return jsonify({
                    "status": "conflict",
                    "message": f"Session with name '{session_data['name']}' already exists.",
                    "exists": True
                }), 409
            
            # Importing over an existing set replaces it: same rule as delete.
            # Any owner recorded INSIDE the uploaded file is discarded.
            if not permissions.can_modify(existing):
                return permissions.forbidden("overwrite", session_data["name"], existing)
            permissions.stamp_session(session_data, existing)
            
            # Add timestamp if not present
            if "timestamp" not in session_data:
                from datetime import datetime
                session_data["timestamp"] = datetime.now().isoformat()
            
            # Write session data to file
            with open(file_path, 'w') as f:
                json.dump(session_data, f, indent=2)
            
            # Notice if sanitization changed the name
            message = f"Session imported as {session_data['name']}"
            if original_name != session_data["name"]:
                message += f" (original name '{original_name}' was sanitized)"
            
            return jsonify({
                "status": "success",
                "message": message,
                "file": file_path,
                "session": session_data,
                "sanitized_name": session_data["name"]
            })
        except Exception as e:
            logger.error(f"Error importing session: {e}")
            return jsonify({"error": f"Failed to import session: {str(e)}"}), 500


def _parse_indices(indices_str):
    """
    Parse a comma-separated string of indices into a list of integers.
    
    Args:
        indices_str: Comma-separated string of indices.
        
    Returns:
        List of integers, or None if indices_str is None or empty.
    """
    if indices_str is None:
        return None

    # A present-but-unparseable parameter used to come back as None, which
    # every route reads as "all rows" / "all columns": `rows=` (what
    # `[undefined].join(',')` sends) or `cols=abc` asked for the WHOLE matrix.
    # That is refused now instead of being widened to everything.
    try:
        indices = [int(i) for i in indices_str.split(",")]
    except ValueError:
        try:
            parsed = json.loads(indices_str)
        except (ValueError, TypeError):
            parsed = None
        if not isinstance(parsed, list) or not all(
                isinstance(i, int) and not isinstance(i, bool) for i in parsed):
            raise _bad_indices(indices_str)
        indices = parsed
    if any(i < 0 for i in indices):
        # numpy would wrap -1 to the last entry; an index is a position, not an offset
        raise _bad_indices(indices_str)
    return indices


def _bad_indices(indices_str):
    """The one 400 ``bad_indices`` answer, for an unparseable, empty or
    negative index list alike."""
    return DataRequestError(
        400, "bad_indices",
        f"Indices must be comma-separated non-negative integers, got {indices_str[:80]!r}")

def _parse_strings(strings_str):
    """
    Parse a comma-separated string into a list of strings.
    
    Args:
        strings_str: Comma-separated string.
        
    Returns:
        List of strings, or None if strings_str is None or empty.
    """
    if not strings_str:
        return None
    
    try:
        # Handle case where the input might be JSON-encoded
        parsed = json.loads(strings_str)
        if isinstance(parsed, list):
            return parsed
    except (ValueError, TypeError):
        pass
    
    # Default to simple comma splitting
    return strings_str.split(",")