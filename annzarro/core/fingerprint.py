"""Which store a saved view was made on: a fingerprint of a dataset.

A share link or panel set names its store by path, and a path says little:
the same store sits at different paths on different servers, and one path
can hold another store tomorrow. The fingerprint records what the store
IS, so a view opened elsewhere can tell "this is the store I was saved on"
from "this is some other store that happens to have that name".

It has two tiers, compared separately:

* ``data`` (the cells and genes): n_obs, n_var and a digest of each axis'
  names (``cells``, ``genes``). The names are hashed by content: their
  UTF-8 bytes and lengths, streamed a chunk at a time, so the digest does
  not depend on chunking, compression, or zarr against h5ad. A store
  rewritten with other chunks, or converted, keeps this tier.
* ``meta`` (the fields): a digest of every metadata document of the store
  (``.zgroup``/``.zarray``/``.zattrs``, or ``zarr.json`` without its
  consolidated copy; for h5ad the tree of groups and datasets with their
  shapes, types and attributes), plus a short digest per top-level group
  (``groups``) and the names of the fields under obs, var, obsm, varm,
  obsp, varp, layers and uns (``fields``). Adding one obs column changes
  this tier and leaves ``data`` alone, so the browser can say "same cells
  and genes; obs/x added" instead of "another dataset".

Nothing reads X or any other data array; the cost is the two indexes. At
95.6M cells (Tahoe-100M) the cell names are about 600 MB on disk and the
content digest takes about 10 s, so it is computed in a background thread
(``get(..., wait=)`` never blocks longer than asked) and persisted in the
state directory (``~/.annzarro/fingerprints``), keyed by the store's stat
signature and freshness generation (core/freshness.py), so restarts do not
recompute it. The metadata tier is cheap (milliseconds) and is always
returned at once.

AnnZarro never writes into a store, and only metadata documents are read,
so files beside a store (or anything else in its directory) do not count.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout
from typing import Any, Dict, Iterable, Optional

import numpy as np

from . import freshness
from .remote import is_remote_path

logger = logging.getLogger(__name__)

#: Bump when the definition changes: fingerprints of different versions are
#: never compared (the browser treats a different ``v`` as no fingerprint).
FINGERPRINT_VERSION = 1

#: Groups whose members are listed in ``fields``.
FIELD_GROUPS = ("obs", "var", "obsm", "varm", "obsp", "varp", "layers", "uns")
#: A store with more field names than this records none (links stay short).
MAX_FIELD_NAMES = 600

_METADATA_FILES = (".zgroup", ".zarray", ".zattrs", "zarr.json")


def _canonical(value) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
                      default=_json_default).encode("utf-8")


def _json_default(value):
    if isinstance(value, bytes):
        return value.decode("utf-8", "replace")
    if isinstance(value, np.generic):
        return value.item()
    if isinstance(value, np.ndarray):
        return value.tolist()
    return str(value)


def _digest(data: bytes, n: int = 32) -> str:
    return hashlib.sha256(data).hexdigest()[:n]


# --- metadata --------------------------------------------------------------

def _zarr_local_metadata(root: str) -> Dict[str, Any]:
    """Every metadata document of a local zarr store, by its store key.

    Walks groups only: a directory holding ``.zarray`` (or a zarr.json of
    an array) is an array and is not listed, so the chunk files of X are
    never touched. Keys are those of consolidated metadata, so a
    consolidated and an unconsolidated copy give the same documents.
    """
    out: Dict[str, Any] = {}
    stack = [""]
    while stack:
        rel = stack.pop()
        here = os.path.join(root, rel) if rel else root
        is_array = False
        for name in _METADATA_FILES:
            path = os.path.join(here, name)
            if not os.path.isfile(path):
                continue
            try:
                with open(path, "rb") as fh:
                    doc = json.loads(fh.read().decode("utf-8"))
            except (OSError, ValueError):
                continue
            if name == "zarr.json" and isinstance(doc, dict):
                doc = {k: v for k, v in doc.items() if k != "consolidated_metadata"}
                is_array = is_array or doc.get("node_type") == "array"
            is_array = is_array or name == ".zarray"
            out[f"{rel}/{name}" if rel else name] = doc
        if is_array:
            continue
        try:
            entries = sorted(os.listdir(here))
        except OSError:
            continue
        for entry in entries:
            if entry.startswith(".") or entry == "zarr.json":
                continue
            if os.path.isdir(os.path.join(here, entry)):
                stack.append(f"{rel}/{entry}" if rel else entry)
    return out


def _zarr_remote_metadata(url: str) -> Optional[Dict[str, Any]]:
    """The metadata documents of a remote store from its consolidated
    metadata, under the keys a local walk gives; None without one."""
    from .remote import get_remote_policy, require_backend
    import fsspec

    require_backend(url)
    target = url.rstrip("/")
    policy = get_remote_policy()
    policy.check(url)
    fs, path = fsspec.core.url_to_fs(target, **policy.storage_options(target))
    try:
        doc = json.loads(fs.cat_file(f"{path}/.zmetadata"))
        return dict(doc.get("metadata") or {})
    except FileNotFoundError:
        pass
    except Exception as exc:  # noqa: BLE001 (a v3 store has no .zmetadata)
        logger.debug("No .zmetadata at %s: %s", url, exc)
    try:
        root = json.loads(fs.cat_file(f"{path}/zarr.json"))
    except Exception as exc:  # noqa: BLE001
        logger.debug("No zarr.json at %s: %s", url, exc)
        return None
    consolidated = (root.get("consolidated_metadata") or {}).get("metadata")
    if consolidated is None:
        return None
    out = {"zarr.json": {k: v for k, v in root.items() if k != "consolidated_metadata"}}
    for key, doc in consolidated.items():
        if isinstance(doc, dict):
            doc = {k: v for k, v in doc.items() if k != "consolidated_metadata"}
        out[f"{key}/zarr.json"] = doc
    return out


def _attrs(obj) -> Dict[str, Any]:
    out = {}
    for key in sorted(obj.attrs.keys()):
        try:
            value = obj.attrs[key]
        except Exception:  # noqa: BLE001 (an attribute h5py cannot read)
            value = "<unreadable>"
        out[key] = _plain(value)
    return out


def _plain(value):
    import h5py
    if isinstance(value, h5py.Reference):
        return "<reference>"
    if isinstance(value, bytes):
        return value.decode("utf-8", "replace")
    if isinstance(value, np.ndarray):
        return [_plain(v) for v in value.tolist()]
    if isinstance(value, (list, tuple)):
        return [_plain(v) for v in value]
    if isinstance(value, np.generic):
        return value.item()
    return value


def _h5ad_metadata(path: str) -> Dict[str, Any]:
    """The tree of an .h5ad file: each group's attributes, each dataset's
    shape, type, chunks, compression and attributes."""
    import h5py
    from .h5ad_reader import _open

    out: Dict[str, Any] = {}
    with _open(path) as f:
        out[""] = {"attrs": _attrs(f)}

        def visit(name, obj):
            if isinstance(obj, h5py.Dataset):
                out[name] = {"attrs": _attrs(obj), "shape": list(obj.shape), "dtype": obj.dtype.str,
                             "chunks": list(obj.chunks) if obj.chunks else None,
                             "compression": obj.compression}
            else:
                out[name] = {"attrs": _attrs(obj)}
        f.visititems(visit)
    return out


def _top(key: str) -> str:
    return key.split("/", 1)[0] if "/" in key else ""


def _fields(metadata: Dict[str, Any], h5ad: bool) -> Dict[str, list]:
    """The member names of each FIELD_GROUPS group."""
    fields: Dict[str, set] = {g: set() for g in FIELD_GROUPS}
    for key in metadata:
        parts = key.split("/")
        need = 2 if h5ad else 3   # zarr keys end in the metadata file name
        if len(parts) >= need and parts[0] in fields:
            fields[parts[0]].add(parts[1])
    return {g: sorted(names) for g, names in fields.items() if names}


def metadata_part(dataset_path: str) -> Dict[str, Any]:
    """The cheap tier: ``meta``, ``groups`` and ``fields`` (milliseconds)."""
    h5ad = not is_remote_path(dataset_path) and os.path.isfile(dataset_path)
    if is_remote_path(dataset_path):
        metadata = _zarr_remote_metadata(dataset_path)
    elif h5ad:
        metadata = _h5ad_metadata(dataset_path)
    else:
        metadata = _zarr_local_metadata(dataset_path)
    if metadata is None:
        return {"meta": None, "groups": {}, "fields": {}}
    by_group: Dict[str, Dict[str, Any]] = {}
    for key, doc in metadata.items():
        by_group.setdefault(_top(key) or "/", {})[key] = doc
    fields = _fields(metadata, h5ad)
    if sum(len(v) for v in fields.values()) > MAX_FIELD_NAMES:
        fields = {}
    return {
        "meta": _digest(_canonical(metadata)),
        "groups": {g: _digest(_canonical(docs), 8) for g, docs in sorted(by_group.items())},
        "fields": fields,
    }


# --- the names -------------------------------------------------------------

def _name_chunks(reader, dataset_path: str, entity: str) -> Iterable:
    chunks = None
    iterate = getattr(reader, "iter_cell_gene_name_chunks", None)
    if iterate is not None:
        chunks = iterate(dataset_path, entity)
    if chunks is None:
        names = reader.get_cell_gene_names(dataset_path, entity)
        step = 1 << 20
        chunks = (names[a:a + step] for a in range(0, len(names), step))
    return chunks


def index_digest(reader, dataset_path: str, entity: str):
    """``(n, digest)`` of one axis' names, by content: the UTF-8 bytes of
    every name, newline-terminated, and every name's byte length. The same
    names give the same digest however they are chunked or stored."""
    names_hash, lengths_hash, n = hashlib.sha256(), hashlib.sha256(), 0
    for chunk in _name_chunks(reader, dataset_path, entity):
        if isinstance(chunk, tuple):
            joined, lengths = chunk
            lengths = np.asarray(lengths)
            if lengths.size == 0:
                continue
        else:
            encoded = ["" if s is None else str(s) for s in chunk]
            if not encoded:
                continue
            encoded = [s.encode("utf-8") for s in encoded]
            joined = b"\n".join(encoded)
            lengths = np.fromiter((len(e) for e in encoded), dtype=np.int64, count=len(encoded))
        names_hash.update(joined)
        names_hash.update(b"\n")
        lengths_hash.update(lengths.astype("<u8").tobytes())
        n += int(lengths.size)
    combined = b"az-index-1" + n.to_bytes(8, "little") + names_hash.digest() + lengths_hash.digest()
    return n, _digest(combined)


def data_part(reader, dataset_path: str) -> Dict[str, Any]:
    """The tier that names the cells and genes (reads both indexes)."""
    n_obs, cells = index_digest(reader, dataset_path, "cells")
    n_var, genes = index_digest(reader, dataset_path, "genes")
    return {"n_obs": n_obs, "n_var": n_var, "cells": cells, "genes": genes,
            "data": _digest(_canonical({"n_obs": n_obs, "n_var": n_var, "cells": cells, "genes": genes}))}


def compute(reader, dataset_path: str) -> Dict[str, Any]:
    """The whole fingerprint, synchronously."""
    out = {"v": FINGERPRINT_VERSION}
    out.update(data_part(reader, dataset_path))
    out.update(metadata_part(dataset_path))
    return out


# --- cache -----------------------------------------------------------------

_lock = threading.Lock()
_memory: Dict[str, tuple] = {}         # path -> (key, fingerprint)
_pending: Dict[str, Any] = {}          # path -> (key, Future)
_executor: Optional[ThreadPoolExecutor] = None


def _cache_key(dataset_path: str) -> Optional[str]:
    """What must not change for a stored fingerprint to hold: the stat()
    signature of the store and its freshness generation (a refresh that
    found the store changed bumps it). Not the global generation: a cache
    reset does not change any store."""
    gen = freshness.generation(dataset_path)
    if is_remote_path(dataset_path):
        return f"v{FINGERPRINT_VERSION}|remote|{gen}"
    stat = freshness.store_fingerprint(dataset_path)
    return None if stat is None else f"v{FINGERPRINT_VERSION}|{stat}|{gen}"


def _cache_file(dataset_path: str):
    from annzarro.utils.paths import user_state_dir
    real = dataset_path if is_remote_path(dataset_path) else os.path.realpath(dataset_path)
    return user_state_dir() / "fingerprints" / (hashlib.sha1(real.encode("utf-8")).hexdigest() + ".json")


def _load_persisted(dataset_path: str, key: str) -> Optional[Dict[str, Any]]:
    try:
        with open(_cache_file(dataset_path), "r", encoding="utf-8") as fh:
            stored = json.load(fh)
    except (OSError, ValueError):
        return None
    if stored.get("key") != key:
        return None
    return stored.get("fingerprint")


def _persist(dataset_path: str, key: str, fp: Dict[str, Any]) -> None:
    path = _cache_file(dataset_path)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(f".{os.getpid()}.{threading.get_ident()}.tmp")
        tmp.write_text(json.dumps({"key": key, "path": dataset_path, "fingerprint": fp}), encoding="utf-8")
        os.replace(tmp, path)
    except OSError as exc:
        logger.warning("Fingerprint of %s kept in memory only: %s", dataset_path, exc)


def cached(dataset_path: str) -> Optional[Dict[str, Any]]:
    """The full fingerprint if it is known for the store as it is now."""
    key = _cache_key(dataset_path)
    if key is None:
        return None
    with _lock:
        hit = _memory.get(dataset_path)
        if hit and hit[0] == key:
            return hit[1]
    fp = _load_persisted(dataset_path, key)
    if fp is not None:
        with _lock:
            _memory[dataset_path] = (key, fp)
    return fp


def _run(reader, dataset_path: str, key: str) -> Dict[str, Any]:
    fp = compute(reader, dataset_path)
    with _lock:
        _memory[dataset_path] = (key, fp)
        _pending.pop(dataset_path, None)
    _persist(dataset_path, key, fp)
    return fp


def start(reader, dataset_path: str):
    """Start computing the fingerprint in the background (once); returns the
    Future, or None when it is already known."""
    global _executor
    if cached(dataset_path) is not None:
        return None
    key = _cache_key(dataset_path)
    if key is None:
        raise FileNotFoundError(dataset_path)
    with _lock:
        running = _pending.get(dataset_path)
        if running and running[0] == key and not running[1].done():
            return running[1]
        if _executor is None:
            # one at a time: a second large store waits rather than
            # competing for disk and CPU with the first
            _executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="fingerprint")
        future = _executor.submit(_run, reader, dataset_path, key)
        _pending[dataset_path] = (key, future)
    return future


def get(reader, dataset_path: str, wait: float = 0.0) -> Dict[str, Any]:
    """``{"status": "ready", "fingerprint": ...}`` or, while the names are
    still being hashed, ``{"status": "pending", "fingerprint": <the metadata
    tier and the counts>}``. Waits at most ``wait`` seconds."""
    fp = cached(dataset_path)
    if fp is None:
        future = start(reader, dataset_path)
        if future is not None and wait > 0:
            try:
                fp = future.result(timeout=wait)
            except FutureTimeout:
                fp = None
            except Exception as exc:  # noqa: BLE001
                with _lock:
                    _pending.pop(dataset_path, None)
                raise exc
        else:
            fp = cached(dataset_path)
    if fp is not None:
        return {"status": "ready", "fingerprint": fp}
    partial = {"v": FINGERPRINT_VERSION}
    partial.update(metadata_part(dataset_path))
    return {"status": "pending", "fingerprint": partial}


def forget() -> None:
    """Drop the in-memory cache (tests)."""
    with _lock:
        _memory.clear()
