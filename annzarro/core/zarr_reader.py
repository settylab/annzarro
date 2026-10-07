"""
Zarr Reader - Handles loading AnnData in zarr format

This module provides functionality for loading zarr data from various sources:
- Local files (directory or archive)
- URL (HTTP/HTTPS)
- S3 and GCS buckets (see ``remote.py`` for the access policy)

Features:
- Lazy loading support for efficient memory usage
- Support for sparse matrices (CSR, CSC, COO formats)
- Multi-dataset support with stateless API
- Advanced shape discovery
- Subset selection for matrices (rows, columns)
- Paginated data access
- Handling of all AnnData components (X, obs, var, obsm, varm, layers, obsp, varp)
"""

import os
import logging
import threading
import numpy as np
import zarr
from typing import Dict, List, Tuple, Optional, Union, Any, Callable, Literal
from pathlib import Path
from collections import OrderedDict

_ZARR3 = int(zarr.__version__.split('.')[0]) >= 3

from .metadata_extraction import extract_metadata
from .caching import CacheSettings, DatasetCache, cached_method
from . import freshness
from . import string_chunks
from .remote import is_remote_path, check_remote_access, open_remote_group, raise_if_timeout

# Try to import optional dependencies
try:
    import dask.array as da
    DASK_AVAILABLE = True
except ImportError:
    DASK_AVAILABLE = False

try:
    import scipy.sparse as sp
    SCIPY_SPARSE_AVAILABLE = True
except ImportError:
    SCIPY_SPARSE_AVAILABLE = False

try:
    import s3fs
    S3FS_AVAILABLE = True
except ImportError:
    S3FS_AVAILABLE = False

try:
    import fsspec
    FSSPEC_AVAILABLE = True
except ImportError:
    FSSPEC_AVAILABLE = False

# Set up logging
logger = logging.getLogger(__name__)


class UnsupportedEncodingError(ValueError):
    """
    Raised when a zarr member uses an AnnData encoding this reader cannot read.

    Subclasses ValueError so existing callers that catch ValueError keep
    working, while giving the reader a type narrow enough to re-raise past the
    broad ``except Exception`` fallbacks without also promoting unrelated
    ValueErrors (numpy shape errors, bad casts) into user-visible failures.
    """


# Major version of the installed zarr library. zarr 2 reads only zarr FORMAT 2
# stores; zarr 3 reads formats 2 and 3.
ZARR_LIBRARY_MAJOR = int(zarr.__version__.split('.')[0])


class ZarrFormatError(ValueError):
    """
    Raised when a store is in a zarr format the installed zarr cannot read.

    A ValueError for the same reason as UnsupportedEncodingError: existing
    handlers keep working, and the type is narrow enough to surface past the
    broad fallbacks that otherwise turn an unopenable store into empty data.
    """


class StoreReadError(RuntimeError):
    """
    Reading an array that the store says exists failed.

    The readers used to log this and return an empty array, which the data
    routes served as ``200`` with ``"data": []``. ``reason`` is
    ``stale_metadata`` when the store's consolidated metadata no longer
    matches the array on disk (rewritten in place without re-consolidating),
    else ``read_failed``.
    """

    def __init__(self, message, reason="read_failed"):
        super().__init__(message)
        self.reason = reason


class MissingKeyError(KeyError):
    """
    A key the request named is not in a member that does exist -- a column of
    an obsm/varm DataFrame, a column index past a matrix's width. A KeyError,
    so the routes answer it ``404 key_not_found`` like a missing slot key; its
    own type so an unrelated KeyError from a bug does not read as "not in this
    dataset".
    """


def _metadata_mismatch(node) -> Optional[str]:
    """How ``node`` (opened through consolidated metadata) differs from its
    own metadata on disk, or None. Only arrays are compared; for a sparse
    group, its member arrays."""
    arrays = []
    if hasattr(node, 'keys'):
        arrays = [node[name] for name in node.keys() if not hasattr(node[name], 'keys')]
    else:
        arrays = [node]
    for array in arrays:
        try:
            fresh = zarr.open_array(store=array.store, path=array.path, mode='r')
        except Exception:
            continue
        for attr in ('shape', 'dtype', 'chunks'):
            said, real = getattr(array, attr, None), getattr(fresh, attr, None)
            if said != real:
                return f"{array.path}: consolidated metadata says {attr} {said}, the array on disk has {real}"
    return None


def store_read_error(node, exc, dataset_path=None) -> StoreReadError:
    """The StoreReadError for a failed read of ``node``, saying whether stale
    consolidated metadata is the cause and how to fix it."""
    where = getattr(node, 'path', '?')
    try:
        mismatch = _metadata_mismatch(node)
    except Exception:
        mismatch = None
    if mismatch:
        return StoreReadError(
            f"The store's consolidated metadata (.zmetadata) is out of date ({mismatch}). "
            "It was probably rewritten in place without re-consolidating. Click "
            "Refresh dataset (the server then reads the store without it), or run "
            "`zarr.consolidate_metadata(path)` on the store and then refresh.",
            reason="stale_metadata")
    return StoreReadError(f"Failed to read {where}: {exc}")


def _json(path):
    import json
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def consolidated_staleness(dataset_path) -> Optional[str]:
    """What the LOCAL store's consolidated metadata no longer describes, or
    None (also for a store without it, or a remote one).

    zarr opens a consolidated store from that one file: an element written
    afterwards without ``zarr.consolidate_metadata`` is not there (the API
    answered 404 key_not_found for it), and an array rewritten with another
    dtype or chunking is read with the old metadata (old values, or 500
    stale_metadata). Compares the listing with the nodes on disk: children
    of every listed group, and the metadata of every listed node. Reads
    only metadata files, so it runs on a refresh, not on every open.
    """
    if not dataset_path or is_remote_path(dataset_path) or not os.path.isdir(dataset_path):
        return None
    root = Path(dataset_path)
    try:
        if (root / ".zmetadata").is_file():
            listed = _json(root / ".zmetadata").get("metadata", {})
            meta = {}
            for key, value in listed.items():
                node, _, name = key.rpartition("/") if "/" in key else ("", "", key)
                meta.setdefault(node, {})[name] = value
            groups = {n for n, m in meta.items() if ".zgroup" in m}
            kinds = (".zgroup", ".zarray")
        elif (root / "zarr.json").is_file():
            cm = (_json(root / "zarr.json").get("consolidated_metadata") or {}).get("metadata")
            if cm is None:
                return None
            meta = {node: {"zarr.json": value} for node, value in cm.items()}
            meta[""] = {"zarr.json": {"node_type": "group"}}
            groups = {n for n, m in meta.items() if m["zarr.json"].get("node_type") == "group"}
            kinds = ("zarr.json",)
        else:
            return None
        for group in sorted(groups):
            folder = root / group if group else root
            try:
                children = sorted(e.name for e in os.scandir(folder) if e.is_dir())
            except OSError:
                return f"{group or 'the root group'} is listed but no longer on disk"
            for child in children:
                node = f"{group}/{child}" if group else child
                if node not in meta and any((folder / child / k).is_file() for k in kinds):
                    return f"{node} is on disk but not in it"
        for node, files in sorted(meta.items()):
            for name, said in files.items():
                path = (root / node / name) if node else (root / name)
                if not path.is_file():
                    return f"{node or 'the root'} is listed but no longer on disk"
                on_disk = _json(path)
                # zarr 3 adds an (empty) consolidated_metadata entry to groups
                if isinstance(on_disk, dict) and isinstance(said, dict):
                    on_disk.pop("consolidated_metadata", None)
                    said = {k: v for k, v in said.items() if k != "consolidated_metadata"}
                if node == "" and name == "zarr.json":
                    continue
                if on_disk != said:
                    return f"{node or 'the root'}: its metadata on disk differs (rewritten since)"
    except (OSError, ValueError) as exc:
        return f"it could not be compared with the store ({exc})"
    return None


def consolidated_notice(stale):
    """The notice for a store whose consolidated metadata is out of date, or None."""
    if not stale:
        return None
    return {"stale": True, "detail": stale,
            "message": (f"This store's consolidated metadata is out of date: {stale}. AnnZarro now reads "
                        "the store without it, which is slower to open. Run "
                        "zarr.consolidate_metadata(path) on the store, then Refresh dataset."),
            "fix": "zarr.consolidate_metadata(path)"}


def zarr_format_problem(dataset_path) -> Optional[str]:
    """
    Why the installed zarr cannot read the LOCAL store at `dataset_path`, or
    None when it can (or when the path is not a local directory).

    A zarr format 3 store has ``zarr.json`` in every node and no
    ``.zgroup``/``.zarray``. Under zarr 2 it used to be rejected by a marker
    check whose ValueError was swallowed by `_get_root`, so every data route
    answered ``200`` with ``"data": {}`` -- the dataset looked empty, not
    unreadable. The sentence says what the store is and how to fix it.
    """
    path_obj = Path(dataset_path)
    if not path_obj.is_dir():
        return None
    is_v3 = (path_obj / 'zarr.json').exists()
    is_v2 = (path_obj / '.zgroup').exists() or (path_obj / '.zarray').exists()
    if is_v3 and not is_v2 and ZARR_LIBRARY_MAJOR < 3:
        return (
            f"{dataset_path} is a zarr format 3 store (it has zarr.json and no "
            f".zgroup), and this server's zarr {zarr.__version__} reads only "
            "format 2. Rewrite it as format 2 -- in an environment with "
            "zarr>=3: `import anndata as ad; ad.settings.zarr_write_format = 2; "
            "ad.read_zarr(src).write_zarr(dst)` -- or run the server with zarr>=3."
        )
    return None


#: At most this many stored columns (CSC) or rows (CSR) are densified by
#: scatter (densify); more go through scipy's toarray.
SCATTER_MAX_MAJOR = 64


def densify(m) -> np.ndarray:
    """``m.toarray()`` for a scipy sparse matrix, the same array.

    A gene column of a CSC matrix (the whole-dataset colour of a plot) went
    through scipy's toarray, which converts CSC to CSR first (0.17 s) and
    then fills the dense vector (0.07 s): 0.24 s of the 0.47 s a 95.6M-cell
    column with a value in every cell took on the server. A few stored
    columns (or rows of a CSR) are written into a zero array directly
    instead; that column now takes 0.37 s, the scatter of its 95.6M values
    about 0.1 s of it. Duplicate or unsorted entries, which
    toarray sums, and wider selections keep toarray.
    """
    fmt = getattr(m, "format", None)
    if fmt not in ("csc", "csr"):
        return m.toarray()
    n_major = m.shape[1] if fmt == "csc" else m.shape[0]
    if n_major > SCATTER_MAX_MAJOR or not m.has_canonical_format:
        return m.toarray()
    out = np.zeros(m.shape, dtype=m.dtype)
    ptr, idx, data = m.indptr, m.indices, m.data
    for j in range(n_major):
        a, b = int(ptr[j]), int(ptr[j + 1])
        if a == b:
            continue
        if fmt == "csc":
            out[idx[a:b], j] = data[a:b]
        else:
            out[j, idx[a:b]] = data[a:b]
    return out


#: Bytes of stored rows one step of take_rows reads at once: several chunks,
#: so zarr still decodes them in parallel, and never the whole column.
GATHER_BLOCK_BYTES = 32 * 2 ** 20


def take_rows(array, rows, cols=None) -> np.ndarray:
    """``array[rows]`` (``array[rows][:, cols]`` for 2-D), read a block of
    chunks at a time and keeping only the selected rows.

    A cell subset is a sorted list of rows spread over the whole axis.
    Reading the column and then cutting it held the column itself: 3.7 GiB
    for X_umap's at 1B cells (settylab/annzarro#77). zarr 3's orthogonal
    selection already gathers chunk by chunk (bounded and parallel); zarr 2's
    held about the whole selection's chunks at once, so there the rows are
    read a block of chunks at a time: memory one block plus the result.
    ``rows`` may be unsorted or repeat; the result follows their order.
    """
    rows = np.asarray(rows, dtype=np.int64).reshape(-1)
    n = array.shape[0]
    if rows.size and (rows.min() < 0 or rows.max() >= n):
        bad = int(rows[(rows < 0) | (rows >= n)][0])
        raise IndexError(f"index {bad} is out of bounds for axis 0 with size {n}")
    two_d = len(array.shape) == 2
    width = (len(cols) if cols is not None else array.shape[1]) if two_d else 1
    out_shape = (rows.size, width) if two_d else (rows.size,)
    out = np.empty(out_shape, dtype=array.dtype)
    if rows.size == 0:
        return out
    if _ZARR3 and hasattr(array, "oindex"):
        # zarr 3 gathers an orthogonal integer selection chunk by chunk,
        # decoding a bounded number at once and in parallel: memory is
        # those chunks plus the result, and it is faster than blocks here
        sel = (rows, np.asarray(cols, dtype=np.int64)) if (two_d and cols is not None) else (rows,)
        return np.asarray(array.oindex[sel])
    order = np.argsort(rows, kind="stable")
    srows = rows[order]
    chunk = int(array.chunks[0]) if getattr(array, "chunks", None) else n
    cols_ix = np.asarray(cols, dtype=np.int64) if (two_d and cols is not None) else None
    row_bytes = max(1, int(np.dtype(array.dtype).itemsize) * width)
    step = max(chunk, (GATHER_BLOCK_BYTES // (row_bytes * chunk)) * chunk)
    # only the blocks some selected row falls in are read
    starts = np.unique((srows // step) * step)
    for start in starts.tolist():
        stop = min(start + step, n)
        lo, hi = np.searchsorted(srows, [start, stop])
        # only the selected columns' chunks: a dense layer stored a column
        # per chunk is not read four times over for one gene
        block = np.asarray(array.oindex[start:stop, cols_ix] if cols_ix is not None else array[start:stop])
        out[order[lo:hi]] = block[srows[lo:hi] - start]
    return out


class ZarrReader(CacheSettings):
    """
    Class for reading AnnData objects from zarr sources with lazy loading.
    
    This class provides methods to:
    1. Load zarr from different sources (local, URL, S3)
    2. Read metadata without loading full data
    3. Selectively load parts of the data
    4. Support multiple sparse matrix formats (CSR, CSC, COO)
    5. Support multiple datasets with dataset IDs
    6. Provide stateless access for improved concurrency
    
    The implementation emphasizes:
    - Efficient memory usage through lazy loading
    - Support for sparse matrices
    - Robust error handling
    - Clean separation of concerns
    """
    
    def __init__(self, max_memory_mb=1000, enable_caching=True, cache_limit=10):
        """
        Initialize the ZarrReader.
        
        Args:
            max_memory_mb: Maximum memory usage in MB for internal caching
            enable_caching: Whether to enable caching of data
            cache_limit: Maximum number of datasets to keep in memory
        """
        # Initialize the cache manager
        self.cache = DatasetCache(max_memory_mb=max_memory_mb, 
                                 enable_caching=enable_caching, 
                                 cache_limit=cache_limit)

        # url -> zarr root group for remote stores (see _get_remote_root)
        self._remote_roots = OrderedDict()
        self._remote_roots_lock = threading.Lock()
        
        # Optional initialization of backends
        self._check_backends()
    
    def _check_backends(self):
        """Check and log available optional backends."""
        backends = {
            "Dask": DASK_AVAILABLE,
            "SciPy Sparse": SCIPY_SPARSE_AVAILABLE,
            "S3FS": S3FS_AVAILABLE,
            "fsspec": FSSPEC_AVAILABLE
        }
        
        logger.info("Available backends:")
        for name, available in backends.items():
            logger.info(f"- {name}: {'Available' if available else 'Not available'}")
        
        # Check if sparse matrices can be supported
        if not SCIPY_SPARSE_AVAILABLE:
            logger.warning("SciPy sparse matrix support is not available. Sparse matrices will be converted to dense.")
            
    # Deprecated method - delegating to cache
    def _estimate_size_mb(self, obj):
        """Estimate the memory size of an object in MB."""
        return self.cache._estimate_memory_usage(obj)
    
    # Deprecated method - delegating to cache
    def _manage_cache_size(self):
        """Manage cache size by removing least recently used items when limits are exceeded."""
        self.cache._manage_cache_size()
    
    # Deprecated method - delegating to cache with dataset handling
    def _remove_dataset_from_cache(self, dataset_path):
        """Remove all cached items for a specific dataset."""
        logger.info(f"_REMOVE_DATASET: Removing all cache entries for {dataset_path}")
        # Use the cache manager to remove dataset from cache
        self.cache._remove_dataset_from_cache(dataset_path)
    
    # Deprecated method - delegating to cache
    def _add_to_cache(self, key, data, cache_type='matrix'):
        """Add an item to the appropriate cache with memory tracking."""
        # Log cache addition
        logger.info(f"_ADD_TO_CACHE: Adding to {cache_type} cache with key '{key}'")
        
        # Extract dataset_path from key if present
        # We expect keys in the format "path:encoded_dataset_path:..." where dataset_path is URL-encoded
        dataset_path = None
        if key.startswith("path:"):
            # Remove "path:" prefix and get the encoded dataset_path part
            parts = key[5:].split(":", 1)
            if len(parts) > 0:
                encoded_path = parts[0]
                # Decode the URL-encoded path
                import urllib.parse
                try:
                    dataset_path = urllib.parse.unquote(encoded_path)
                except Exception as e:
                    raise_if_timeout(e)
                    logger.warning(f"Error decoding dataset path from cache key: {e}")
                    dataset_path = encoded_path  # Use as-is as fallback
            
        # Use the cache manager to add item to cache
        self.cache._add_to_cache(key, data, dataset_path=dataset_path, cache_type=cache_type)
    
    # Deprecated method - delegating to cache
    def _get_from_cache(self, key, cache_type='matrix'):
        """Get an item from the appropriate cache and update access time."""
        return self.cache._get_from_cache(key, cache_type=cache_type)
    
    def get_cache_info(self):
        """
        Get information about the current cache state.
        
        Returns:
            dict: Information about the current cache
        """
        # Get cache info from cache manager
        cache_info = self.cache.get_cache_info()
        
        return cache_info
    
    def clear_cache(self, dataset_path=None):
        """
        Clear the internal data cache.
        
        Args:
            dataset_path: Optional dataset path to clear from cache.
                          If None, clears the entire cache.
                       
        Returns:
            dict: Information about the cleared cache
        """
        logger.info(f"CLEAR_CACHE: Called with dataset_path={dataset_path}")
        
        # Use the cache manager to clear cache
        result = self.cache.clear_cache(dataset_path=dataset_path)
        with self._remote_roots_lock:
            if dataset_path is None:
                self._remote_roots.clear()
            else:
                self._remote_roots.pop(dataset_path, None)
                
        logger.info(f"CLEAR_CACHE: Cache cleared with result: {result}")
        return result
        
    
    @cached_method
    def open_dataset_by_path(self, dataset_path: str, metadata: bool=True, metadata_level: str='full', use_cache: bool=True) -> Tuple[zarr.Group, Dict[str, Any]]:
        """
        Open a dataset by path.

        Args:
            path: Path to the zarr directory or file
            metadata: If metadata should be returned (Default=True)
            metadata_level: Level of metadata detail to extract:
                'minimal' - Basic structure only (fastest)
                'standard' - Column names and embeddings (faster)
                'full' - Complete detailed metadata (default)
            use_cache: Whether to cache the results (Default=True)

        Returns:
            Tuple of (zarr root, metadata dict)
            
        Raises:
            ValueError: For invalid paths or dataset formats
            RuntimeError: For other operational errors
        """
        logger.info(f"OPEN_DATASET_BY_PATH: Called with path={dataset_path}, metadata={metadata}, "
                   f"metadata_level={metadata_level}, use_cache={use_cache}")
        
        try:
            # Get the root once
            root = self._get_root(dataset_path)
            
            # Check if we got a valid root
            if root is None:
                raise ValueError(f"Unable to open zarr dataset at path: {dataset_path}")
            
            if not metadata:
                return root, {}
            
            # Check basic AnnData structure
            basic_structure = []
            if 'X' not in root:
                basic_structure.append("X matrix")
            if 'obs' not in root:
                basic_structure.append("obs annotations")
            if 'var' not in root:
                basic_structure.append("var annotations")
                
            if basic_structure:
                missing = ", ".join(basic_structure)
                logger.warning(f"Dataset at {dataset_path} is missing key AnnData components: {missing}")
            
            # Extract metadata with the appropriate caching behavior, passing the existing root
            metadata_dict = self.get_metadata(
                root=root,
                detail_level=metadata_level,
                dataset_path = dataset_path
            )
            
            return root, metadata_dict
            
        except (ValueError, ImportError, PermissionError, FileNotFoundError) as e:
            # For invalid paths, refused or unreachable remote stores, and
            # missing optional dependencies, propagate the error unchanged
            logger.error(f"Invalid dataset path or format: {dataset_path}: {e}")
            raise
        except Exception as e:
            raise_if_timeout(e)
            # Log details for unexpected errors
            logger.error(f"Error opening dataset by path {dataset_path}: {e}")
            import traceback
            logger.error(traceback.format_exc())
            raise RuntimeError(f"Failed to open dataset: {str(e)}")
    
    def _get_root(self, dataset_path: str) -> Optional[zarr.Group]:
        """
        Get the root group for a dataset.
        
        Args:
            dataset_path: Path to the zarr dataset
        
        Returns:
            zarr.Group: The zarr root group, or None if not found
            
        Raises:
            ValueError: If the dataset_path is invalid or the dataset cannot be found
            RuntimeError: If there's an error opening the dataset
        """
        if dataset_path is None:
            logger.error("_get_root: No dataset_path provided")
            raise ValueError("No dataset path provided")
            
        logger.debug(f"_get_root: Loading root for path {dataset_path}")

        # Outside the try below ON PURPOSE: its broad `except Exception` turns
        # any ValueError whose text it does not recognise into `None`, which
        # the data routes then serve as empty data.
        if not is_remote_path(dataset_path):
            problem = zarr_format_problem(dataset_path)
            if problem:
                logger.error(problem)
                raise ZarrFormatError(problem)
        
        # Look for the root using the path
        try:
            if is_remote_path(dataset_path):
                return self._get_remote_root(dataset_path)
            else:
                # Local file access - do more thorough validation
                path_obj = Path(dataset_path)
                
                # Check if path exists
                if not path_obj.exists():
                    raise ValueError(f"Path does not exist: {dataset_path}")
                
                # Check if it's a directory
                if not path_obj.is_dir():
                    # Check if it's a zarr file
                    if not dataset_path.endswith(('.zarr', '.zr')):
                        raise ValueError(f"Path is not a directory or zarr file: {dataset_path}")
                
                # For directories, check if it appears to be a zarr directory
                # by looking for .zarray or .zgroup files
                # zarr.json marks a format 3 store, readable under zarr>=3
                # (zarr_format_problem above rejects it under zarr 2).
                if path_obj.is_dir() and not any((path_obj / file).exists() 
                                              for file in ['.zarray', '.zgroup', 'zarr.json']):
                    raise ValueError(f"Directory does not appear to be a zarr dataset: {dataset_path}")
                
                try:
                    # Use regular open_group for existing paths, which works better with various zarr formats.
                    # A refresh that found the consolidated metadata out of
                    # date (consolidated_staleness) recorded it: read the
                    # nodes' own metadata until the store is consolidated again.
                    if _ZARR3 and freshness.recorded(dataset_path).get("consolidated_stale"):
                        return zarr.open_group(dataset_path, mode='r', use_consolidated=False)
                    return zarr.open_group(dataset_path, mode='r')
                except Exception as e:
                    raise_if_timeout(e)
                    # Check the error message to identify specific error types
                    if "path not found" in str(e).lower():
                        raise ValueError(f"Not a valid zarr dataset: {dataset_path}")
                    else:
                        raise ValueError(f"Failed to open zarr dataset: {dataset_path}, error: {e}")
        
        except (ValueError, ImportError, PermissionError, FileNotFoundError) as e:
            # Typed errors already say what went wrong (bad path, policy refusal,
            # missing optional dependency, no group at a URL); pass them through.
            logger.error(f"Error with dataset path {dataset_path}: {e}")
            raise
        except Exception as e:
            raise_if_timeout(e)
            # Identify specific zarr errors by their message content
            error_msg = str(e).lower()
            if "path not found" in error_msg:
                err_msg = f"Path not found or is not a valid zarr dataset: {dataset_path}"
                logger.error(err_msg)
                raise ValueError(err_msg) from e
            elif "contains an array" in error_msg:
                err_msg = f"Path contains an array instead of a group: {dataset_path}"
                logger.error(err_msg)
                raise ValueError(err_msg) from e
            elif "contains a group" in error_msg:
                err_msg = f"Path contains a group instead of an array: {dataset_path}"
                logger.error(err_msg)
                raise ValueError(err_msg) from e
            error_msg = f"Error opening dataset from path {dataset_path}: {e}"
            logger.error(error_msg)
            raise RuntimeError(error_msg) from e

    def _get_remote_root(self, url: str) -> zarr.Group:
        """Open (or reuse) the root group of a remote store.

        Local roots are cheap to re-open, so every data call re-opens them.
        A remote open is several round trips (.zgroup, .zattrs, .zmetadata,
        zarr.json probes), paid on EVERY request -- so remote roots are kept,
        keyed by URL and bounded by ``cache_limit``. The policy is checked on
        every call, including hits, so a cached root never outlives a refusal.
        Like every other cache here, it assumes the store is not rewritten
        while the server runs; ``clear_cache`` drops it.
        """
        check_remote_access(url)
        with self._remote_roots_lock:
            root = self._remote_roots.get(url)
            if root is not None:
                self._remote_roots.move_to_end(url)
                return root
        # Open outside the lock: a slow store must not stall the others.
        logger.info(f"_get_remote_root: opening remote store {url}")
        root = open_remote_group(url)
        with self._remote_roots_lock:
            self._remote_roots[url] = root
            while len(self._remote_roots) > max(1, self.cache_limit):
                self._remote_roots.popitem(last=False)
        return root
    
    def _get_dataset_shape(self, root: zarr.Group) -> Optional[Tuple[int, int]]:
        """
        Get the shape of a dataset from a zarr root.
        
        Args:
            root: Zarr root group
            
        Returns:
            Tuple of (n_obs, n_vars) or None if shape cannot be determined
        """
        shape = None
        
        # Method 1: Get from X shape directly
        if 'X' in root and hasattr(root['X'], 'shape'):
            try:
                shape = root['X'].shape
                logger.info(f"Got shape from X.shape: {shape}")
                return shape
            except Exception as e:
                raise_if_timeout(e)
                logger.debug(f"Could not get shape from X.shape: {e}")
        
        # Method 2: Get from X attributes (for sparse matrices)
        if 'X' in root and hasattr(root['X'], 'attrs') and 'shape' in root['X'].attrs:
            try:
                shape = tuple(root['X'].attrs['shape'])
                logger.info(f"Got shape from X.attrs: {shape}")
                return shape
            except Exception as e:
                raise_if_timeout(e)
                logger.debug(f"Could not get shape from X.attrs: {e}")
        
        # Method 3: Infer from obs and var lengths
        try:
            n_obs = self._get_encoded_length(root['obs']['_index']) if 'obs' in root and '_index' in root['obs'] else 0
            n_vars = self._get_encoded_length(root['var']['_index']) if 'var' in root and '_index' in root['var'] else 0
            if n_obs > 0 and n_vars > 0:
                shape = (n_obs, n_vars)
                logger.info(f"Inferred shape from obs and var: {shape}")
                return shape
        except Exception as e:
            raise_if_timeout(e)
            logger.debug(f"Could not infer shape from obs and var: {e}")
        
        # Method 4: Try other matrices (layers, etc.)
        if 'layers' in root and hasattr(root['layers'], 'keys'):
            for layer_name in root['layers'].keys():
                try:
                    layer = root['layers'][layer_name]
                    if hasattr(layer, 'shape'):
                        shape = layer.shape
                        logger.info(f"Got shape from layer {layer_name}: {shape}")
                        return shape
                    elif hasattr(layer, 'attrs') and 'shape' in layer.attrs:
                        shape = tuple(layer.attrs['shape'])
                        logger.info(f"Got shape from layer {layer_name} attrs: {shape}")
                        return shape
                except Exception as e:
                    raise_if_timeout(e)
                    logger.debug(f"Could not get shape from layer {layer_name}: {e}")
        
        logger.warning("Could not determine dataset shape")
        return None
    
    def _get_matrix_info(self, matrix) -> Dict[str, Any]:
        """
        Get information about a matrix.
        
        Args:
            matrix: Zarr array or group
            
        Returns:
            Dictionary of matrix information
        """
        info = {}
        
        # Regular array attributes
        if hasattr(matrix, 'shape'):
            info['shape'] = matrix.shape
        if hasattr(matrix, 'chunks'):
            info['chunks'] = matrix.chunks
        if hasattr(matrix, 'dtype'):
            info['dtype'] = str(matrix.dtype)
        
        # Get all attributes if available (including sparse format info)
        if hasattr(matrix, 'attrs'):
            # Copy all attributes
            for key, value in matrix.attrs.items():
                info[key] = value
            
            # Add shape from attributes if not already set
            if 'shape' in matrix.attrs and 'shape' not in info:
                info['shape'] = tuple(matrix.attrs['shape'])
                
            # Add encoding information for sparse matrices
            if 'encoding-type' in matrix.attrs:
                info['encoding-type'] = matrix.attrs['encoding-type']
                if 'encoding-version' in matrix.attrs:
                    info['encoding-version'] = matrix.attrs['encoding-version']
        
        return info
    
    def _is_dataframe(self, group) -> bool:
        """
        Check if a zarr group is a dataframe-encoded matrix.
        
        In AnnData zarr format, dataframes (obsm/varm) are encoded with special structure:
        - A group with encoding-type="dataframe" attribute
        - A column-order attribute listing the column names
        - Each column stored as a separate subgroup or dataset
        - Often an _index group for row names
        
        This method checks if a group has the essential attributes to be 
        identified as a dataframe.
        
        Args:
            group: Zarr group to check
            
        Returns:
            bool: True if the group is a dataframe-encoded matrix
        """
        if not hasattr(group, 'attrs'):
            return False
            
        # Check for dataframe encoding type
        return (
            'encoding-type' in group.attrs and 
            group.attrs['encoding-type'] == 'dataframe' and 
            'column-order' in group.attrs
        )

    def _get_dataframe_columns(self, group) -> List[str]:
        """
        Get column names for a dataframe-encoded group.
        
        Args:
            group: Zarr group containing dataframe data
            
        Returns:
            List of column names
        """
        if not self._is_dataframe(group):
            return []
            
        # Get column names from column-order attribute
        try:
            return list(group.attrs['column-order'])
        except Exception as e:
            raise_if_timeout(e)
            logger.error(f"Error getting dataframe columns: {e}")
            return []
    
    def _get_dataframe_columns_info(self, group) -> Dict[str, Dict]:
        """
        Get detailed information about dataframe columns.
        
        Args:
            group: Zarr group containing dataframe data
            
        Returns:
            Dict mapping column names to their information
        """
        if not self._is_dataframe(group):
            return {}
        
        column_info = {}
        
        try:
            # Get basic column names from column-order
            column_names = self._get_dataframe_columns(group)
            
            # For each column, gather additional information if available
            for col_name in column_names:
                col_info = {
                    'name': col_name,
                }
                
                # If the column exists as a subgroup, get its info
                if col_name in group and hasattr(group[col_name], 'attrs'):
                    # Add shape info if available
                    if hasattr(group[col_name], 'shape'):
                        col_info['shape'] = group[col_name].shape
                    
                    # Add attribute info
                    for key, value in group[col_name].attrs.items():
                        col_info[key] = value
                
                column_info[col_name] = col_info
        
        except Exception as e:
            raise_if_timeout(e)
            logger.error(f"Error getting dataframe column info: {e}")
        
        return column_info
                
    def get_basic_counts(self, path: str) -> Dict[str, int]:
        """
        Get only the cell and gene counts from a dataset without extracting full metadata.
        This is a faster alternative to open_dataset_by_path when only basic counts are needed.
        
        Args:
            path: Path to the zarr directory or file
            
        Returns:
            Dict with cell_count and gene_count
            
        Raises:
            ValueError: If the zarr store doesn't appear to be a valid AnnData structure
        """
        problem = zarr_format_problem(path)
        if problem:
            raise ZarrFormatError(problem)
        try:
            # Open the zarr store
            root = zarr.open_group(path, mode='r')
            
            # Initialize counts
            cell_count = 0
            gene_count = 0
            
            # Check if obs group exists
            if 'obs' in root:
                # Check for _index attribute in obs group to determine the column name
                index_column = '_index'
                if hasattr(root['obs'], 'attrs') and '_index' in root['obs'].attrs:
                    index_column = root['obs'].attrs['_index']
                    logger.debug(f"Using custom index column '{index_column}' for obs group from _index attribute")
                
                # Get cell count from index column
                if index_column in root['obs']:
                    cell_count = self._get_encoded_length(root['obs'][index_column])
            
            # Check if var group exists
            if 'var' in root:
                # Check for _index attribute in var group to determine the column name
                index_column = '_index'
                if hasattr(root['var'], 'attrs') and '_index' in root['var'].attrs:
                    index_column = root['var'].attrs['_index']
                    logger.debug(f"Using custom index column '{index_column}' for var group from _index attribute")
                
                # Get gene count from index column
                if index_column in root['var']:
                    gene_count = self._get_encoded_length(root['var'][index_column])
            
            # If counts are not found, try to get them from X shape if available
            if (cell_count == 0 or gene_count == 0) and 'X' in root and hasattr(root['X'], 'shape'):
                shape = root['X'].shape
                if len(shape) >= 2:
                    cell_count = shape[0] if cell_count == 0 else cell_count
                    gene_count = shape[1] if gene_count == 0 else gene_count
            
            # If both cell_count and gene_count are still 0, this isn't a valid AnnData structure
            if cell_count == 0 and gene_count == 0:
                raise ValueError("No cell or gene counts found in zarr store, not a valid AnnData structure")
            
            return {
                'cell_count': cell_count,
                'gene_count': gene_count
            }
        except Exception as e:
            raise_if_timeout(e)
            logger.error(f"Error getting basic counts from {path}: {e}")
            raise
    
    @cached_method
    def _extract_metadata(self, root: Optional[zarr.Group] = None, dataset_path: Optional[str] = None, 
                      detail_level: str = "full") -> Dict[str, Any]:
      """
      Extract metadata from a zarr root.

      Args:
          root: Zarr root group
          dataset_path: Path to the zarr dataset (used for caching)
          detail_level: Level of detail to extract ('minimal', 'standard', or 'full')

      Returns:
          Dict of metadata
      """
      # Use path-based extraction
      try:
          if root is None and (is_remote_path(dataset_path)
                               or freshness.recorded(dataset_path).get("consolidated_stale")):
              # extract_metadata would zarr.open_group() the bare URL: no
              # policy check, no anonymous-access options, a fresh open.
              # Nor would it skip consolidated metadata a refresh found stale.
              root, dataset_path = self._get_root(dataset_path), None
          metadata = extract_metadata(dataset_path, root, detail_level=detail_level)
          return metadata
      except Exception as e:
          raise_if_timeout(e)
          logger.error(f"Error in path-based metadata extraction: {e}")
          import traceback
          logger.error(traceback.print_exc())
          return {}

    
    @cached_method
    def get_metadata(self, dataset_path: str, detail_level: str = "full", root: Optional[zarr.Group] = None) -> Dict[str, Any]:
        """
        Get metadata for a dataset.
        
        Args:
            dataset_path: Path to the zarr dataset
            detail_level: Level of detail to extract ('minimal', 'standard', or 'full')
            root: Optional zarr root group, to avoid duplicate calls to _get_root
            
        Returns:
            Dict of metadata
        """
        logger.debug(f"GET_METADATA: Called with dataset_path={dataset_path}")
        
        # Extract metadata now that we have a root
        try:
            # Extract metadata
            if root is not None:
                metadata = self._extract_metadata(root=root, detail_level=detail_level)
            else:
                metadata = self._extract_metadata(dataset_path=dataset_path, detail_level=detail_level)
            
            return metadata
            
        except Exception as e:
            raise_if_timeout(e)
            logger.error(f"GET_METADATA: Error extracting metadata: {e}")
            import traceback
            logger.info(traceback.print_exc())
            return {}
            
    def _get_shape_from_root(self, root) -> Tuple[int, int]:
        """
        Get the shape of a dataset from its root group.
        
        Args:
            root: Zarr root group
            
        Returns:
            Tuple of (n_obs, n_vars) representing the dataset shape
        """
        shape = None
        
        # Method 1: Get from X attributes (for sparse matrices)
        if 'X' in root and hasattr(root['X'], 'attrs') and 'shape' in root['X'].attrs:
            shape = tuple(root['X'].attrs['shape'])
            logger.debug(f"Got shape from X.attrs: {shape}")
        
        # Method 2: Get from X shape directly (without loading data)
        elif 'X' in root and hasattr(root['X'], 'shape'):
            shape = root['X'].shape
            logger.debug(f"Got shape from X.shape: {shape}")
        
        # Method 3: Infer from obs and var indices
        elif 'obs' in root and 'var' in root:
            # Check for _index attribute in obs group
            obs_index_column = '_index'
            if hasattr(root['obs'], 'attrs') and '_index' in root['obs'].attrs:
                obs_index_column = root['obs'].attrs['_index']
                
            # Check for _index attribute in var group
            var_index_column = '_index'
            if hasattr(root['var'], 'attrs') and '_index' in root['var'].attrs:
                var_index_column = root['var'].attrs['_index']
                
            # Use custom index columns if they exist
            if obs_index_column in root['obs'] and var_index_column in root['var']:
                n_obs = self._get_encoded_length(root['obs'][obs_index_column])
                n_vars = self._get_encoded_length(root['var'][var_index_column])
                shape = (n_obs, n_vars)
                logger.debug(f"Inferred shape from obs/var indices: {shape}")
        
        # Method 4: Try from layers
        elif 'layers' in root and list(root['layers'].keys()):
            layer_name = list(root['layers'].keys())[0]
            layer = root['layers'][layer_name]
            
            if hasattr(layer, 'attrs') and 'shape' in layer.attrs:
                shape = tuple(layer.attrs['shape'])
                logger.debug(f"Got shape from layer {layer_name} attrs: {shape}")
            elif hasattr(layer, 'shape'):
                shape = layer.shape
                logger.debug(f"Got shape from layer {layer_name} shape: {shape}")
        
        return shape if shape is not None else (0, 0)
        
    def _is_sparse_matrix(self, matrix) -> Tuple[bool, Optional[str]]:
        """
        Check if a zarr array is a sparse matrix.
        
        Args:
            matrix: Zarr array or group
            
        Returns:
            Tuple of (is_sparse, sparse_format)
            sparse_format can be 'csr_matrix', 'csc_matrix', 'coo_matrix', or None
        """
        if not hasattr(matrix, 'attrs'):
            return False, None
            
        # Check for encoding-type attribute
        if 'encoding-type' in matrix.attrs:
            encoding_type = matrix.attrs['encoding-type']
            if encoding_type in ['csr_matrix', 'csc_matrix', 'coo_matrix']:
                return True, encoding_type
                
        return False, None
    
    def _lazy_sparse_slice(self, matrix, shape, indices, axis):
        """
        Extract a few major-axis slices from a CSC (columns) or CSR (rows)
        sparse zarr group without materializing the full matrix.

        For the major axis of a compressed-sparse layout, slice k occupies the
        contiguous range data[indptr[k]:indptr[k+1]]; reading only those ranges
        decompresses just the overlapping zarr chunks. The result is assembled
        as a sparse matrix in the SAME orientation/order as the equivalent
        ``M[:, indices]`` / ``M[indices, :]`` full-load slice, so callers see no
        behavioural difference.

        Args:
            matrix: zarr group with 'data'/'indices'/'indptr'.
            shape: (n_rows, n_cols) of the full matrix.
            indices: list of major-axis indices to extract (columns for CSC,
                rows for CSR).
            axis: 'col' (CSC) or 'row' (CSR).

        Returns:
            scipy.sparse matrix of shape (n_rows, len(indices)) for axis='col'
            or (len(indices), n_cols) for axis='row'.
        """
        indptr_full = matrix['indptr'][:]
        data_z = matrix['data']
        idx_z = matrix['indices']
        n_rows, n_cols = int(shape[0]), int(shape[1])

        data_parts = []
        ind_parts = []
        new_indptr = np.empty(len(indices) + 1, dtype=np.int64)
        new_indptr[0] = 0
        for n, k in enumerate(indices):
            k = int(k)
            s, e = int(indptr_full[k]), int(indptr_full[k + 1])
            if e > s:
                data_parts.append(data_z[s:e])
                ind_parts.append(idx_z[s:e])
            new_indptr[n + 1] = new_indptr[n] + (e - s)

        data = (np.concatenate(data_parts) if data_parts
                else np.array([], dtype=data_z.dtype))
        inner = (np.concatenate(ind_parts) if ind_parts
                 else np.array([], dtype=np.int64))

        if axis == 'col':
            return sp.csc_matrix((data, inner, new_indptr),
                                 shape=(n_rows, len(indices)))
        return sp.csr_matrix((data, inner, new_indptr),
                             shape=(len(indices), n_cols))

    def _rows_of_major_slices(self, matrix, shape, major, minor, axis):
        """
        ``M[minor, major]`` of a CSC group (axis='col': ``major`` columns,
        ``minor`` rows) or ``M[major, minor]`` of a CSR one (axis='row'),
        without building the major slices whole.

        A gene column of a cell subset is the case: 100,000 rows of a column
        of 50 million cells. Building the column first and cutting it after
        made a 50-million-row slice, 200 MB dense, cached as such, for every
        gene. Here each major slice's stored entries are read a block at a
        time and only those whose minor index is selected
        are kept, so memory is one block (``_SELECT_BLOCK``) plus the result. ``minor`` may be in
        any order and repeat; the result is what slicing the full matrix
        returns.
        """
        indptr = matrix['indptr']
        data_z, idx_z = matrix['data'], matrix['indices']
        n_minor = int(shape[0] if axis == 'col' else shape[1])
        want, inverse = np.unique(np.asarray(minor, dtype=np.int64), return_inverse=True)
        if want.size and (want[0] < 0 or want[-1] >= n_minor):
            bad = int(want[0] if want[0] < 0 else want[-1])
            raise IndexError(f"index {bad} is out of range for size {n_minor}")
        block = self._SELECT_BLOCK
        # Membership by a mask over the minor axis (1 byte per row: 50 MB at
        # 50M cells) is one lookup per stored entry; a binary search of every
        # entry into the selection was 6x slower than reading the column.
        selected = np.zeros(n_minor, dtype=bool)
        selected[want] = True
        positions, majors, values = [], [], []
        for n, k in enumerate(major):
            k = int(k)
            s, e = (int(v) for v in indptr[k:k + 2])
            for b in range(s, e, block):
                stop = min(b + block, e)
                idx = np.asarray(idx_z[b:stop])
                hit = selected[idx]
                if not hit.any():
                    continue
                positions.append(np.searchsorted(want, idx[hit]))
                majors.append(np.full(int(np.count_nonzero(hit)), n, dtype=np.int64))
                values.append(np.asarray(data_z[b:stop])[hit])
        dtype = data_z.dtype
        pos = np.concatenate(positions) if positions else np.empty(0, np.int64)
        maj = np.concatenate(majors) if majors else np.empty(0, np.int64)
        val = np.concatenate(values) if values else np.empty(0, dtype)
        # in the space of the unique selected minor indices, then expanded
        if axis == 'col':
            m = sp.csr_matrix((val, (pos, maj)), shape=(want.size, len(major)))
            return m[inverse.reshape(-1), :]
        m = sp.csr_matrix((val, (maj, pos)), shape=(len(major), want.size))
        return m[:, inverse.reshape(-1)]

    #: Stored entries read per block by _rows_of_major_slices: 16M, 64 MB of
    #: int32 indices plus as much data. Measured on a 50M-cell CSC column of
    #: 30M entries: 0.23 s in 4M blocks, 0.13 s in 16M ones (zarr call overhead).
    _SELECT_BLOCK = 1 << 24

    #: Stored entries of a sparse matrix's ``indices`` scanned per block by
    #: _minor_axis_slice (rounded to whole chunks): 4M int32, 16 MB.
    _SCAN_BLOCK = 1 << 22

    def _minor_axis_slice(self, matrix, shape, indices, axis):
        """
        Columns of a CSR group (axis='col') or rows of a CSC one (axis='row'),
        without materializing the matrix.

        An entry of the uncompressed axis can sit anywhere, so every stored
        index is looked at -- but ``_SCAN_BLOCK`` entries at a time, whole
        chunks per read, and only the data between a block's first and last
        hit is read. Peak memory is a block, not the matrix. Same result,
        orientation and order as ``M[indices, :]`` / ``M[:, indices]`` on the
        full load (repeats and any order allowed).

        Args:
            matrix: zarr group with 'data'/'indices'/'indptr'.
            shape: (n_rows, n_cols) of the full matrix.
            indices: rows (CSC) or columns (CSR) to extract.
            axis: 'col' (CSR) or 'row' (CSC).

        Returns:
            scipy.sparse matrix, (n_rows, len(indices)) for axis='col' or
            (len(indices), n_cols) for axis='row'.
        """
        n_rows, n_cols = int(shape[0]), int(shape[1])
        n_minor = n_cols if axis == 'col' else n_rows
        uniq, inverse = np.unique(np.asarray(indices, dtype=np.int64), return_inverse=True)
        if uniq.size and (uniq[0] < 0 or uniq[-1] >= n_minor):
            bad = uniq[0] if uniq[0] < 0 else uniq[-1]
            raise IndexError(f"index {bad} is out of range for an axis of {n_minor}")
        indptr = matrix['indptr'][:].astype(np.int64)
        n_major = len(indptr) - 1
        data_z, idx_z = matrix['data'], matrix['indices']
        nnz = int(indptr[-1])
        chunk = int(idx_z.chunks[0]) if getattr(idx_z, 'chunks', None) else self._SCAN_BLOCK
        block = max(chunk, (self._SCAN_BLOCK // chunk) * chunk)

        pos_parts, sel_parts, val_parts = [], [], []
        for s in range(0, nnz if uniq.size else 0, block):
            stored = idx_z[s:min(s + block, nnz)]
            if uniq.size == 1:
                hit = np.flatnonzero(stored == uniq[0])
                which = np.zeros(hit.size, dtype=np.int64)
            else:
                which = np.minimum(np.searchsorted(uniq, stored), uniq.size - 1)
                hit = np.flatnonzero(uniq[which] == stored)
                which = which[hit]
            if hit.size == 0:
                continue
            first = int(hit[0])
            values = data_z[s + first:s + int(hit[-1]) + 1]
            pos_parts.append(hit + s)
            sel_parts.append(which)
            val_parts.append(values[hit - first])
        if pos_parts:
            pos, which, values = (np.concatenate(p) for p in (pos_parts, sel_parts, val_parts))
        else:
            pos = which = np.empty(0, dtype=np.int64)
            values = np.empty(0, dtype=data_z.dtype)
        major = np.searchsorted(indptr, pos, side='right') - 1
        identity = np.array_equal(inverse, np.arange(uniq.size))
        if axis == 'col':
            m = sp.csr_matrix((values, (major, which)), shape=(n_major, uniq.size))
            return m if identity else m[:, inverse]
        m = sp.csc_matrix((values, (which, major)), shape=(uniq.size, n_major))
        return m if identity else m[inverse, :]

    def _load_sparse_matrix(self, matrix, row_indices=None, col_indices=None) -> Optional[np.ndarray]:
        """
        Load a sparse matrix from a zarr group.
        
        Args:
            matrix: Zarr group containing sparse matrix components
            row_indices: Optional list of row indices to select
            col_indices: Optional list of column indices to select
            
        Returns:
            numpy.ndarray or scipy.sparse matrix
        """
        if not SCIPY_SPARSE_AVAILABLE:
            logger.warning("SciPy sparse matrix support not available. Converting to dense.")
            return None  # Will fall back to dense conversion
            
        # Get sparse format
        is_sparse, sparse_format = self._is_sparse_matrix(matrix)
        if not is_sparse:
            return None
            
        # Get shape
        if 'shape' not in matrix.attrs:
            logger.error("Sparse matrix missing shape attribute")
            return None
            
        shape = tuple(matrix.attrs['shape'])

        try:
            # ---- Fast lazy paths: avoid materializing the whole matrix ----
            # The hot path for a UMAP colored by one gene is "all cells, one
            # column". For CSC, column j is stored contiguously at
            # data[indptr[j]:indptr[j+1]], so we read only that slice and let
            # zarr decompress just the overlapping chunks -- O(nnz in the
            # selected columns) instead of O(nnz total). Symmetrically, CSR
            # gives cheap row (single-cell) extraction. These two cases cover
            # the interactive coloring requests; everything else falls through
            # to the correct (if heavier) full-load path below.
            #
            # A selection on the other axis (a cell row of CSC X, a gene
            # column of a CSR layer) used to take the full-load path below:
            # 1.08 GB of peak RSS for one cell row of bm_aging.zarr. It is a
            # bounded scan of the stored indices now (_minor_axis_slice), and
            # a selection on both axes slices the compressed axis lazily and
            # cuts the other in memory.
            compressed = all(k in matrix for k in ['data', 'indices', 'indptr'])
            if sparse_format == 'csc_matrix' and compressed and (
                    col_indices is not None or row_indices is not None):
                if col_indices is None:
                    return self._minor_axis_slice(matrix, shape, row_indices, axis='row')
                if row_indices is not None:
                    return self._rows_of_major_slices(matrix, shape, col_indices, row_indices, axis='col')
                return self._lazy_sparse_slice(matrix, shape, col_indices, axis='col')
            if sparse_format == 'csr_matrix' and compressed and (
                    row_indices is not None or col_indices is not None):
                if row_indices is None:
                    return self._minor_axis_slice(matrix, shape, col_indices, axis='col')
                if col_indices is not None:
                    return self._rows_of_major_slices(matrix, shape, row_indices, col_indices, axis='row')
                return self._lazy_sparse_slice(matrix, shape, row_indices, axis='row')

            # Handle CSR format
            if sparse_format == 'csr_matrix':
                if not all(k in matrix for k in ['data', 'indices', 'indptr']):
                    logger.error("Missing required components for CSR matrix")
                    return None
                    
                data = matrix['data'][:]
                indices = matrix['indices'][:]
                indptr = matrix['indptr'][:]
                
                # Create the sparse matrix
                sparse_matrix = sp.csr_matrix((data, indices, indptr), shape=shape)
                
                # Handle subsetting
                if row_indices is not None and col_indices is not None:
                    return sparse_matrix[row_indices, :][:, col_indices]
                elif row_indices is not None:
                    return sparse_matrix[row_indices, :]
                elif col_indices is not None:
                    return sparse_matrix[:, col_indices]
                else:
                    return sparse_matrix
                    
            # Handle CSC format
            elif sparse_format == 'csc_matrix':
                if not all(k in matrix for k in ['data', 'indices', 'indptr']):
                    logger.error("Missing required components for CSC matrix")
                    return None
                    
                data = matrix['data'][:]
                indices = matrix['indices'][:]
                indptr = matrix['indptr'][:]
                
                # Create the sparse matrix
                sparse_matrix = sp.csc_matrix((data, indices, indptr), shape=shape)
                
                # Handle subsetting
                if row_indices is not None and col_indices is not None:
                    return sparse_matrix[row_indices, :][:, col_indices]
                elif row_indices is not None:
                    return sparse_matrix[row_indices, :]
                elif col_indices is not None:
                    return sparse_matrix[:, col_indices]
                else:
                    return sparse_matrix
                    
            # Handle COO format
            elif sparse_format == 'coo_matrix':
                if not all(k in matrix for k in ['data', 'row', 'col']):
                    logger.error("Missing required components for COO matrix")
                    return None
                    
                data = matrix['data'][:]
                row = matrix['row'][:]
                col = matrix['col'][:]
                
                # Create the sparse matrix
                sparse_matrix = sp.coo_matrix((data, (row, col)), shape=shape)
                
                # Convert to CSR for subsetting (COO doesn't support indexing)
                sparse_matrix = sparse_matrix.tocsr()
                
                # Handle subsetting
                if row_indices is not None and col_indices is not None:
                    return sparse_matrix[row_indices, :][:, col_indices]
                elif row_indices is not None:
                    return sparse_matrix[row_indices, :]
                elif col_indices is not None:
                    return sparse_matrix[:, col_indices]
                else:
                    return sparse_matrix
            
            else:
                logger.warning(f"Unknown sparse matrix format: {sparse_format}")
                return None
                
        except Exception as e:
            raise_if_timeout(e)
            logger.error(f"Error loading sparse matrix: {e}")
            raise store_read_error(matrix, e) from e
    
    def _get_dense_array(self, path: str, root: zarr.Group, row_indices=None, col_indices=None) -> np.ndarray:
        """
        Get a dense array from a zarr path, with optional subsetting.
        
        Args:
            path: Path to the zarr array within the root
            root: Zarr root group
            row_indices: Optional list of row indices to select
            col_indices: Optional list of column indices to select
            
        Returns:
            numpy.ndarray: The requested data
        """
        if path not in root:
            return np.array([])
            
        try:
            array = root[path]
            
            # Check for empty array
            if getattr(array, 'size', 0) == 0:
                return np.array([])
            
            # Handle subsetting
            if row_indices is not None and col_indices is not None:
                if len(array.shape) != 2:
                    # For non-2D arrays, flatten indices won't work right
                    logger.warning(f"Array {path} is not 2D, ignoring col_indices for subsetting")
                    return array[row_indices]
                # only the selected rows, a block of chunks at a time
                return take_rows(array, row_indices, col_indices)
            elif row_indices is not None:
                return take_rows(array, row_indices)
            elif col_indices is not None:
                if len(array.shape) != 2:
                    # For non-2D arrays, can't subset columns
                    logger.warning(f"Array {path} is not 2D, ignoring col_indices for subsetting")
                    return array[:]
                return array[:, col_indices]
            else:
                return array[:]
        except Exception as e:
            raise_if_timeout(e)
            logger.error(f"Error getting dense array {path}: {e}")
            raise store_read_error(root[path], e) from e
    
    @cached_method
    def get_X(self, dataset_path: Optional[str] = None, row_indices: Optional[List[int]] = None, 
              col_indices: Optional[List[int]] = None, disable_caching: bool = False) -> np.ndarray:
        """
        Get the X matrix from a dataset.
        
        Args:
            dataset_path: Path to the dataset (stateless operation)
            row_indices: Optional list of row indices to select
            col_indices: Optional list of column indices to select
            disable_caching: If True, don't use cache even if enabled
            
        Returns:
            numpy.ndarray: The X matrix data
        """
        root = self._get_root(dataset_path=dataset_path)
        
        if root is None or 'X' not in root:
            return np.array([])
        
        # Check if X is a sparse matrix
        is_sparse, _ = self._is_sparse_matrix(root['X'])
        if is_sparse:
            sparse_matrix = self._load_sparse_matrix(root['X'], row_indices, col_indices)
            if sparse_matrix is not None:
                # Convert to dense array for consistent return type
                return densify(sparse_matrix)
        
        # Handle as dense array
        return self._get_dense_array('X', root, row_indices, col_indices)
    
    @cached_method
    def get_layer(self, layer_name: str, dataset_path: Optional[str] = None, 
                 row_indices: Optional[List[int]] = None, col_indices: Optional[List[int]] = None) -> np.ndarray:
        """
        Get a layer from a dataset.
        
        Args:
            layer_name: Name of the layer to get
            dataset_path: Path to the dataset (stateless operation)
            row_indices: Optional list of row indices to select
            col_indices: Optional list of column indices to select
            disable_caching: If True, don't use cache even if enabled
            
        Returns:
            numpy.ndarray: The layer data
        """
        root = self._get_root(dataset_path=dataset_path)
        
        # 'X' is offered as a layer (the axis/column menus list it first): a
        # store without a layer of that name means the X matrix itself.
        if layer_name == 'X' and root is not None and 'X' in root and \
                ('layers' not in root or 'X' not in root['layers']):
            return self.get_X(dataset_path=dataset_path, row_indices=row_indices, col_indices=col_indices)

        if root is None or 'layers' not in root or layer_name not in root['layers']:
            return np.array([])
        
        # Get the layer
        layer = root['layers'][layer_name]
        
        # Check if it's a sparse matrix
        is_sparse, _ = self._is_sparse_matrix(layer)
        if is_sparse:
            sparse_matrix = self._load_sparse_matrix(layer, row_indices, col_indices)
            if sparse_matrix is not None:
                # Convert to dense array for consistent return type
                return densify(sparse_matrix)
        
        # Handle as dense array
        return self._get_dense_array(f'layers/{layer_name}', root, row_indices, col_indices)
    
    @staticmethod
    def _is_group(member) -> bool:
        """
        Whether a zarr member is a Group, under BOTH zarr 2 and zarr 3.

        This has to be answered without a membership test, and the reason
        differs by major -- so the O(n) hazard is real on both, but not for
        the same reason. Neither Array defines ``__contains__``. zarr 3's
        defines no ``__iter__`` either, so ``'values' in member`` falls back
        to the LEGACY SEQUENCE protocol: measured 20,001 integer-index
        ``__getitem__`` calls at n=20000, and the cause of the 837 s
        full-obs read 9f3d65b fixed. zarr 2's Array DOES define
        ``__iter__``, so the same expression iterates instead -- 20
        chunk-slice calls, cheap enough that a wall-clock budget cannot see
        it there at all.

        ``hasattr(member, 'members')`` is NOT the right predicate even though
        it is O(1): ``members`` exists only on zarr 3's Group, so under zarr
        2.18.7 it answers False for every group and silently disables the
        structural fallback below. ``isinstance`` against ``zarr.Group``
        holds in both majors (zarr 2 aliases ``zarr.hierarchy.Group``); the
        duck-typed clause is a backstop for a store class that is neither.
        """
        if isinstance(member, zarr.Group):
            return True
        return hasattr(member, 'keys') and not hasattr(member, 'shape')

    @staticmethod
    def _is_nullable_group(member) -> bool:
        """
        Check whether a zarr member uses an AnnData nullable encoding.

        AnnData writes nullable dtypes ('nullable-string-array',
        'nullable-integer', 'nullable-boolean') as a *group* holding two
        arrays, 'values' and 'mask', rather than as a plain array.

        Args:
            member: Zarr array or group

        Returns:
            True if member is a nullable-encoded group
        """
        if not hasattr(member, 'attrs'):
            return False

        encoding = member.attrs.get('encoding-type', '')
        if isinstance(encoding, str) and encoding.startswith('nullable-'):
            return True

        # Fall back to structure for writers that omit the attribute, but
        # only for groups -- see _is_group for why the membership test below
        # must never be reached with a zarr Array.
        if not ZarrReader._is_group(member):
            return False

        return 'values' in member and 'mask' in member

    def _read_member(self, member, indices=None) -> np.ndarray:
        """
        Read a zarr member that may be a plain array or a nullable group.

        Slicing a zarr group raises TypeError, so a nullable-encoded member
        must be read through its 'values'/'mask' children instead. Masked
        (missing) entries are returned as None.

        Args:
            member: Zarr array or nullable-encoded group
            indices: Optional list of row indices to select

        Returns:
            numpy.ndarray of values, with None in missing positions
        """
        if not self._is_nullable_group(member):
            return take_rows(member, indices) if indices is not None else member[:]

        values = member['values']
        mask = member['mask']

        data = take_rows(values, indices) if indices is not None else values[:]
        mask_data = take_rows(mask, indices) if indices is not None else mask[:]

        # mask=True marks a missing value, per the AnnData nullable encoding.
        mask_data = np.asarray(mask_data, dtype=bool)
        if mask_data.any():
            data = np.asarray(data, dtype=object)
            data[mask_data] = None

        return data

    def _get_encoded_length(self, member) -> int:
        """
        Length of a zarr member that may be a plain array or an encoded group.

        AnnData stores nullable and categorical columns as *groups*, which have
        no ``.shape``; their length lives on a child array ('values' or
        'codes'). Reading it that way keeps shape/count inference working for
        an index stored under either encoding.

        Args:
            member: Zarr array or encoded group

        Returns:
            Length along the first axis, or 0 if it cannot be determined.
        """
        if hasattr(member, 'shape'):
            return member.shape[0]

        # Only a Group can carry an AnnData encoding -- a zarr Array has
        # .shape and returned above. Guard on Group before ANY membership
        # test; see _is_group.
        if not self._is_group(member):
            return 0

        if self._is_nullable_group(member) and 'values' in member:
            return member['values'].shape[0]

        encoding = member.attrs.get('encoding-type', '') if hasattr(member, 'attrs') else ''
        if encoding == 'categorical' and 'codes' in member:
            return member['codes'].shape[0]

        if encoding:
            logger.warning(
                f"Cannot determine length for unsupported encoding '{encoding}' "
                f"(children: {list(member.keys()) if hasattr(member, 'keys') else []}). "
                f"Dataset may use a newer AnnData format."
            )
        return 0

    def _get_categorical_values(self, group, indices=None, return_categories=False):
        """
        Get values from a categorical data structure in AnnData.
        
        In AnnData zarr format, categorical data is stored as a group with:
        - 'codes': Array of category indices
        - 'categories': Array of category values
        
        Args:
            group: Zarr group containing categorical data
            indices: Optional list of row indices to select
            return_categories: If True, return a tuple of (values, categories)
            
        Returns:
            List of category values or tuple of (values, categories) if return_categories is True
        """
        try:
            # Check if this is a categorical encoding
            if (hasattr(group, 'attrs') and 
                'encoding-type' in group.attrs and 
                group.attrs['encoding-type'] == 'categorical' and
                'codes' in group and 'categories' in group):
                
                # Get codes and categories
                categories = self._read_member(group['categories'])
                if indices is not None:
                    codes = take_rows(group['codes'], indices)
                else:
                    codes = group['codes'][:]
                
                # Map codes to categories using NumPy vectorization
                # Create a mask for valid codes
                valid_mask = (codes >= 0) & (codes < len(categories))
                
                # Initialize values array with None or empty
                values = np.array([None] * len(codes), dtype=object)
                
                # Update only valid indices using vectorized indexing
                values[valid_mask] = categories[codes[valid_mask]]
                
                # Return values and categories if requested
                if return_categories:
                    return values.tolist(), categories.tolist() if hasattr(categories, 'tolist') else list(categories)
                return values
            
            # Not a categorical. A nullable encoding is also a group, and
            # _read_member reads it through its 'values'/'mask' children,
            # applying the mask; a plain array it slices directly.
            if self._is_group(group) and not self._is_nullable_group(group):
                # A group that is neither categorical nor nullable cannot be
                # sliced. Name the encoding instead of returning silence.
                encoding = group.attrs.get('encoding-type', 'unknown') if hasattr(group, 'attrs') else 'unknown'
                children = list(group.keys()) if hasattr(group, 'keys') else []
                raise UnsupportedEncodingError(
                    f"Unsupported AnnData encoding '{encoding}' "
                    f"(children: {children}). "
                    f"This dataset may have been created with a newer version of AnnData. "
                    f"Try updating annzarro or re-exporting the dataset."
                )

            result = self._read_member(group, indices)

            # For non-categorical data, return just the values
            if return_categories:
                return result, []
            return result
        except UnsupportedEncodingError:
            raise
        except Exception as e:
            raise_if_timeout(e)
            # A failed read is an error to report, not an empty column: an
            # empty list served at 200 cannot be told apart from a column that
            # legitimately has no values (settylab/annzarro#41). Callers that
            # want one bad column not to sink the rest catch this themselves.
            logger.error(f"Error processing encoded data: {e}")
            raise store_read_error(group, e) from e

    @cached_method
    def get_obs_var(self, entity = Literal["cells", "genes"], dataset_path: Optional[str] = None,
               indices: Optional[List[int]] = None, column_names: Optional[List[str]] = None,
               include_categories: bool = True) -> Dict[str, Any]:
        """
        Get observation annotations.
        
        Args:
            column_name: Optional specific column to get
            dataset_path: Path to the dataset (stateless operation)
            indices: Optional list of indices to select
            column_names: Optional list of column names to get
            include_categories: Include category lists for categorical columns
            root: Optional zarr root group, to avoid duplicate calls to _get_root
            
        Returns:
            Dict of column name -> list of values, or list of values for a specific column
        """
        root = self._get_root(dataset_path=dataset_path)
        obj = "obs" if entity == "cells" else "var"
        
        if root is None or obj not in root:
            return {}
        
        # Get multiple columns
        result = {'data': {}}
        categories_dict = {}
        
        # Determine which columns to get
        if column_names is not None:
            columns_to_get = [col for col in column_names if col in root[obj]]
        else:
            # Get the index column name from attributes or default to '_index'
            obs_index_column = '_index'
            if hasattr(root[obj], 'attrs') and '_index' in root[obj].attrs:
                obs_index_column = root[obj].attrs['_index']
                
            # Filter out the index column as it's a special key
            columns_to_get = [col for col in root[obj].keys() if col != obs_index_column]
            
            # Add _index as a column for backwards compatibility with tests
            if obs_index_column in root[obj]:
                try:
                    # Get cell names (handles categorical/nullable encodings)
                    cell_names = self._get_categorical_values(root[obj][obs_index_column], indices)
                    result['data']['_index'] = cell_names.tolist() if hasattr(cell_names, 'tolist') else list(cell_names)
                except Exception as e:
                    raise_if_timeout(e)
                    if isinstance(e, StoreReadError):
                        raise
                    logger.error(f"Error getting cell names: {e}")
                    result['data']['_index'] = []
        
        # Get each column. A column the caller NAMED that cannot be read is an
        # error for the route to answer with its reason (unsupported_type,
        # read_failed, stale_metadata). This used to be caught here and served
        # as `[]` at 200 -- the shape settylab/annzarro#29 was written about,
        # and the reason `UnsupportedEncodingError` never reached a client
        # (settylab/annzarro#41). When listing EVERY column, one unreadable
        # column must not sink the others, so it is recorded under `errors`
        # beside its empty list instead of passing as a legitimately empty one.
        explicit = column_names is not None
        for col in columns_to_get:
            col_data = None
            try:
                # Check if it's a categorical
                col_data = root[obj][col]
                
                if include_categories:
                    # Get values and categories directly from the method
                    values, categories = self._get_categorical_values(col_data, indices, return_categories=True)
                    
                    # Convert to Python list for JSON serialization
                    result['data'][col] = values.tolist() if hasattr(values, 'tolist') else list(values)
                    
                    # Add categories info if available
                    if categories:
                        categories_dict[col] = categories
                else:
                    # Just get the values without categories
                    values = self._get_categorical_values(col_data, indices)
                    
                    # Convert to Python list for JSON serialization
                    result['data'][col] = values.tolist() if hasattr(values, 'tolist') else list(values)
            except Exception as e:
                raise_if_timeout(e)
                if isinstance(e, UnsupportedEncodingError):
                    problem = UnsupportedEncodingError(f"{obj} column '{col}': {e}")
                    reason = "unsupported_type"
                elif isinstance(e, StoreReadError):
                    problem, reason = e, e.reason
                else:
                    problem = store_read_error(col_data, e)
                    reason = problem.reason
                if explicit or reason == "stale_metadata":
                    raise problem from e
                logger.error(f"Error getting {obj} column {col}: {e}")
                result['data'][col] = []
                result.setdefault('errors', {})[col] = {"reason": reason, "error": str(problem)}
        
        # Add categories if any were found
        if categories_dict and include_categories:
            result['categories'] = categories_dict
        
        return result
    
    @cached_method
    def get_obs_var_numeric(self, entity: Literal["cells", "genes"], dataset_path: Optional[str] = None,
                            column_name: Optional[str] = None,
                            indices: Optional[List[int]] = None) -> Optional[np.ndarray]:
        """One numeric obs/var column as the ndarray it is stored as, or None
        when it is not one (absent, categorical, string, boolean, or nullable
        with a missing entry); the caller then answers through get_obs_var.

        For the binary wire format: get_obs_var turns a column into a Python
        list for JSON, and the binary path turned it back into an array. At
        95.6M cells that round trip, plus costing the list for the cache, was
        most of a 16.6 s read. Same values as numeric_array(get_obs_var(...)):
        the nullable mask is applied the same way (_read_member), and a
        column with a missing entry is left to the JSON path, which says null.
        """
        root = self._get_root(dataset_path=dataset_path)
        obj = "obs" if entity == "cells" else "var"
        if root is None or obj not in root or column_name not in root[obj]:
            return None
        member = root[obj][column_name]
        if self._is_group(member) and not self._is_nullable_group(member):
            return None
        values = np.asarray(self._read_member(member, indices))
        if values.ndim != 1 or values.dtype.kind not in "iuf":
            return None
        return values

    @cached_method
    def get_obs_var_codes(self, entity: Literal["cells", "genes"], dataset_path: Optional[str] = None,
                          column_name: Optional[str] = None, indices: Optional[List[int]] = None):
        """``(codes, categories)`` of a categorical obs/var column, or None
        when the column is not categorical.

        The codes are the stored integer array, read by index; nothing is
        decoded into one string per cell, which is what made a categorical
        column cost 12 B per cell on the wire (see array_response).
        """
        root = self._get_root(dataset_path=dataset_path)
        obj = "obs" if entity == "cells" else "var"
        if root is None or obj not in root or column_name not in root[obj]:
            return None
        group = root[obj][column_name]
        if (not self._is_group(group) or group.attrs.get('encoding-type') != 'categorical'
                or 'codes' not in group or 'categories' not in group):
            return None
        try:
            categories = self._read_member(group['categories'])
            codes = take_rows(group['codes'], indices) if indices is not None else group['codes'][:]
        except Exception as e:
            raise_if_timeout(e)
            raise store_read_error(group, e) from e
        categories = categories.tolist() if hasattr(categories, 'tolist') else list(categories)
        return np.asarray(codes), categories

    def _get_dataframe_column(self, group, column_name: str, indices: Optional[List[int]] = None) -> np.ndarray:
        """
        Get a specific column from a dataframe-encoded group.
        
        Args:
            group: Zarr group containing dataframe data
            column_name: Name of the column to get
            indices: Optional list of row indices to select
            
        Returns:
            numpy.ndarray: The column data
        """
        if not self._is_dataframe(group):
            return np.array([])

        # A missing column is a missing key, and a failed read is a failed
        # read; neither is an empty column (settylab/annzarro#42).
        if column_name not in group:
            raise MissingKeyError(f"DataFrame {getattr(group, 'path', '')!r} has no column '{column_name}'")

        # Get the column data
        try:
            column = group[column_name]
            
            # A column is an array, or an encoded GROUP (categorical: codes +
            # categories; nullable: values + mask). Reading a categorical one
            # through _read_member sliced the group itself, which zarr refuses
            # with 'path=slice(None, None, None) is not a string': every
            # categorical column of an obsm/varm DataFrame came back empty and
            # logged that error (38 times in the live service's log).
            # _get_categorical_values decodes all three shapes.
            #
            # Only a group can hold a '0' child; asking an Array "'0' in
            # column" walks it element by element under zarr 3 (see _is_group).
            if self._is_group(column) and '0' in column:
                data_array = column['0']
                return take_rows(data_array, indices) if indices is not None else data_array[:]
            return self._get_categorical_values(column, indices)
        except (StoreReadError, UnsupportedEncodingError):
            raise
        except Exception as e:
            raise_if_timeout(e)
            logger.error(f"Error getting dataframe column {column_name}: {e}")
            raise store_read_error(group, e) from e
    
    @cached_method
    def get_obsm_varm(self, entity: Literal["cells", "genes"], key: str, dataset_path: Optional[str] = None,
                indices: Optional[List[int]] = None, col_indices: Optional[List[int]] = None,
                column_name: Optional[str] = None) -> np.ndarray:
        """
        Get observation multi-dimensional annotations.
        
        Args:
            obsm_key: Key in obsm to get
            dataset_path: Path to the dataset (stateless operation)
            indices: Optional list of row indices to select
            col_indices: Optional list of column indices to select
            column_name: Optional column name for dataframe-encoded obsm
            
        Returns:
            numpy.ndarray: The obsm data
        """
        root = self._get_root(dataset_path=dataset_path)
        obj = "obsm" if entity == "cells" else "varm"
        
        if root is None or obj not in root or key not in root[obj]:
            return np.array([])

        # Every LISTED member either reads or raises. An encoded group used to
        # reach `_get_dense_array`, whose `size == 0` test is true for any
        # group, and come back as `[]` at 200: 15 obsm keys across 10 served
        # datasets (sparse `X_cnv`, cell2location DataFrames) were listed by
        # `dataset_structure` and then read as empty, which the client could
        # only call "not in this dataset" (settylab/annzarro#42).
        member = root[obj][key]

        if self._is_dataframe(member):
            columns = self._get_dataframe_columns(member)
            if column_name is not None:
                name = column_name if column_name in columns else None
                if name is None:
                    position = self._column_position(column_name, len(columns), obj, key)
                    name = columns[position]
                return self._get_dataframe_column(member, name, indices)
            names = [columns[i] for i in col_indices] if col_indices is not None else columns
            stacked = [np.asarray(self._get_dataframe_column(member, n, indices)) for n in names]
            if not stacked:
                return np.array([])
            if any(col.dtype.kind not in 'biuf' for col in stacked):
                return np.column_stack([col.astype(object) for col in stacked])
            return np.column_stack(stacked)

        is_sparse, sparse_format = self._is_sparse_matrix(member)
        if is_sparse:
            width = tuple(member.attrs.get('shape', (0, 0)))[1]
            position = None
            if column_name is not None:
                position = self._column_position(column_name, width, obj, key)
                col_indices = [position]
            matrix = self._load_sparse_matrix(member, indices, col_indices)
            if matrix is None:
                raise UnsupportedEncodingError(
                    f"{obj} '{key}' is a {sparse_format} this reader cannot load "
                    f"(children: {list(member.keys())})")
            dense = densify(matrix) if hasattr(matrix, 'toarray') else np.asarray(matrix)
            return dense[:, 0] if position is not None else dense

        if self._is_group(member):
            encoding = member.attrs.get('encoding-type', 'unknown') if hasattr(member, 'attrs') else 'unknown'
            raise UnsupportedEncodingError(
                f"{obj} '{key}' uses an encoding this reader cannot read "
                f"('{encoding}', children: {list(member.keys())})")

        if column_name is not None:
            # A plain matrix addressed by column position: read that column
            # only, rather than the whole matrix and slicing afterwards.
            width = member.shape[1] if len(member.shape) > 1 else 1
            position = self._column_position(column_name, width, obj, key)
            if len(member.shape) < 2:
                return self._get_dense_array(f'{obj}/{key}', root, indices, None)
            arr = self._get_dense_array(f'{obj}/{key}', root, indices, [position])
            return np.asarray(arr)[:, 0]

        # Get the obsm data as a regular array
        return self._get_dense_array(f'{obj}/{key}', root, indices, col_indices)

    @staticmethod
    def _column_position(column_name, width, obj, key) -> int:
        """The column index ``column_name`` names in a matrix ``width`` wide,
        or MissingKeyError (answered 404 key_not_found)."""
        try:
            position = int(column_name)
        except (TypeError, ValueError):
            raise MissingKeyError(f"{obj} '{key}' has no column '{column_name}'") from None
        if not 0 <= position < width:
            raise MissingKeyError(
                f"{obj} '{key}' has no column {position} (it has {width})")
        return position
    
    @cached_method
    def get_obsp_varp(self, key: str, entity: Literal["cells", "genes"],
                 dataset_path: Optional[str] = None,
                 row_indices: Optional[List[int]] = None,
                 col_indices: Optional[List[int]] = None) -> np.ndarray:
        """
        Get observation-observation matrices.
    
        Args:
            obsp_key: Key in obsp to get.
            dataset_path: Path to the dataset (stateless operation).
            row_indices: Optional list of row indices to select.
            col_indices: Optional list of column indices to select.
    
        Returns:
            numpy.ndarray: The obsp data.
        """
        root = self._get_root(dataset_path=dataset_path)
        layer_to_get = "obsp" if entity == "cells" else "varp"
    
        if root is None or layer_to_get not in root or key not in root[layer_to_get]:
            return np.array([])
    
        obj = root[layer_to_get][key]
        is_sparse, _ = self._is_sparse_matrix(obj)
    
        if is_sparse:
            # For sparse matrices, pass distinct row and column indices.
            sparse_matrix = self._load_sparse_matrix(obj, row_indices, col_indices)
            if sparse_matrix is not None:
                return densify(sparse_matrix)
    
        # For dense obsp matrices, allow separate row and column selection.
        try:
            # Use provided indices, or default to full slice if None.
            row_sel = row_indices if row_indices is not None else slice(None)
            col_sel = col_indices if col_indices is not None else slice(None)
            data = root[layer_to_get][key][row_sel, :][:, col_sel]
            return np.asarray(data)
        except Exception as e:
            raise_if_timeout(e)
            logger.error(f"Error getting obsp data with row_indices {row_indices} and col_indices {col_indices}: {e}")
            raise store_read_error(obj, e) from e
    
    def _downsample_array(self, path: str, max_size: int = 1000, dataset_path: Optional[str] = None) -> np.ndarray:
        """
        Downsample a large array to a manageable size.
        
        Args:
            path: Path to the zarr array
            max_size: Maximum number of elements in each dimension
            dataset_path: Path to the dataset
            
        Returns:
            numpy.ndarray: The downsampled data
        """
        # Get the root for the dataset
        root = self._get_root(dataset_path=dataset_path)
        if root is None or path not in root:
            return np.array([])
            
        try:
            array = root[path]
            shape = array.shape
            
            if len(shape) != 2:
                logger.warning(f"Downsampling only supported for 2D arrays, got shape {shape}")
                return array[:]
                
            # Calculate stride for each dimension
            row_stride = max(1, shape[0] // max_size)
            col_stride = max(1, shape[1] // max_size)
            
            # Create index arrays for strided access
            row_indices = np.arange(0, shape[0], row_stride)
            col_indices = np.arange(0, shape[1], col_stride)
            
            # Limit the number of indices if still too large
            if len(row_indices) > max_size:
                row_indices = row_indices[:max_size]
            if len(col_indices) > max_size:
                col_indices = col_indices[:max_size]
                
            # Load the downsampled data
            return array[row_indices[:, np.newaxis], col_indices]
            
        except Exception as e:
            raise_if_timeout(e)
            logger.error(f"Error downsampling array {path} in dataset {dataset_path}: {e}")
            return np.array([])
    
    def _load_chunked_data(self, path: str, row_indices: Optional[List[int]] = None, 
                          col_indices: Optional[List[int]] = None,
                          dataset_path: Optional[str] = None) -> np.ndarray:
        """
        Load data using an optimized chunking strategy for large datasets.
        
        Args:
            path: Path to the zarr array
            row_indices: List of row indices to select
            col_indices: List of column indices to select
            dataset_path: Path to the dataset
            
        Returns:
            numpy.ndarray: The chunked data
        """
        # Get the root for the dataset
        root = self._get_root(dataset_path=dataset_path)
        if root is None or path not in root:
            return np.array([])
            
        try:
            array = root[path]
            chunks = getattr(array, 'chunks', None)
            
            # If chunks info is not available, fall back to regular loading
            if chunks is None:
                logger.warning(f"Chunk information not available for {path} in dataset {dataset_path}, using standard loading")
                if row_indices is not None and col_indices is not None:
                    return array[row_indices, :][:, col_indices]
                elif row_indices is not None:
                    return array[row_indices, :]
                elif col_indices is not None:
                    return array[:, col_indices]
                else:
                    return array[:]
            
            # Determine ranges to load
            if row_indices is not None:
                min_row = min(row_indices)
                max_row = max(row_indices)
                row_range = (min_row, max_row + 1)
            else:
                row_range = None
                
            if col_indices is not None:
                min_col = min(col_indices)
                max_col = max(col_indices)
                col_range = (min_col, max_col + 1)
            else:
                col_range = None
            
            # Calculate chunk boundaries for optimal loading
            if row_range and col_range:
                # Both dimensions have ranges defined
                chunk_row_start = (row_range[0] // chunks[0]) * chunks[0]
                chunk_row_end = ((row_range[1] + chunks[0] - 1) // chunks[0]) * chunks[0]
                
                chunk_col_start = (col_range[0] // chunks[1]) * chunks[1]
                chunk_col_end = ((col_range[1] + chunks[1] - 1) // chunks[1]) * chunks[1]
                
                # Adjust boundaries to array dimensions
                chunk_row_end = min(chunk_row_end, array.shape[0])
                chunk_col_end = min(chunk_col_end, array.shape[1])
                
                # Load data in chunks
                data_chunks = []
                for row_start in range(chunk_row_start, chunk_row_end, chunks[0]):
                    row_end = min(row_start + chunks[0], chunk_row_end)
                    row_data = []
                    
                    for col_start in range(chunk_col_start, chunk_col_end, chunks[1]):
                        col_end = min(col_start + chunks[1], chunk_col_end)
                        chunk = array[row_start:row_end, col_start:col_end]
                        row_data.append(chunk)
                    
                    if row_data:
                        data_chunks.append(np.concatenate(row_data, axis=1))
                
                if data_chunks:
                    full_data = np.concatenate(data_chunks, axis=0)
                    
                    # Now extract the exact indices requested
                    if row_indices is not None and col_indices is not None:
                        # Convert absolute indices to relative indices within the loaded chunk
                        rel_row_indices = [i - chunk_row_start for i in row_indices]
                        rel_col_indices = [i - chunk_col_start for i in col_indices]
                        return full_data[rel_row_indices, :][:, rel_col_indices]
                    
                    return full_data
            
            # Fall back to regular loading for simpler cases
            if row_indices is not None and col_indices is not None:
                # rows and columns in one orthogonal selection: the chunks
                # covering those rows are read one at a time and only the
                # selected cells kept (array[rows, :] first held every
                # column of the selected rows)
                if hasattr(array, 'oindex'):
                    return array.oindex[np.asarray(row_indices, dtype=np.int64), np.asarray(col_indices, dtype=np.int64)]
                return array[row_indices, :][:, col_indices]
            elif row_indices is not None:
                return array[row_indices, :]
            elif col_indices is not None:
                return array[:, col_indices]
            else:
                return array[:]
                
        except Exception as e:
            raise_if_timeout(e)
            logger.error(f"Error loading chunked data for {path} in dataset {dataset_path}: {e}")
            return np.array([])
            
    def load_progressively(self, path: str, chunk_size: int = 1000, 
                          callback: Optional[callable] = None,
                          dataset_path: Optional[str] = None) -> np.ndarray:
        """
        Load data progressively with callback for progress updates.
        
        Args:
            path: Path to the zarr array
            chunk_size: Size of chunks to load at once
            callback: Callback function called with (chunk, progress)
            dataset_path: Path to the dataset
            
        Returns:
            numpy.ndarray: The complete loaded data
        """
        # Get the root for the specified dataset
        root = self._get_root(dataset_path=dataset_path)
        
        if root is None or path not in root:
            return np.array([])
            
        try:
            array = root[path]
            shape = array.shape
            
            # For 1D arrays
            if len(shape) == 1:
                data = np.zeros(shape, dtype=array.dtype)
                chunks = [(i, min(i + chunk_size, shape[0])) 
                         for i in range(0, shape[0], chunk_size)]
                
                for i, (start, end) in enumerate(chunks):
                    data[start:end] = array[start:end]
                    progress = (i + 1) / len(chunks)
                    
                    if callback:
                        callback(data.copy(), progress)
                        
                return data
                
            # For 2D arrays
            elif len(shape) == 2:
                data = np.zeros(shape, dtype=array.dtype)
                chunks = [(i, min(i + chunk_size, shape[0])) 
                         for i in range(0, shape[0], chunk_size)]
                
                for i, (start, end) in enumerate(chunks):
                    data[start:end, :] = array[start:end, :]
                    progress = (i + 1) / len(chunks)
                    
                    if callback:
                        callback(data.copy(), progress)
                        
                return data
                
            # For higher dimensional arrays, load all at once
            else:
                data = array[:]
                if callback:
                    callback(data, 1.0)
                return data
                
        except Exception as e:
            raise_if_timeout(e)
            logger.error(f"Error loading data progressively from {path} for dataset {dataset_path}: {e}")
            return np.array([])
            
    def _get_paginated_data(self, data: np.ndarray, page: int, page_size: int) -> Tuple[np.ndarray, Dict[str, int]]:
        """
        Get a paginated subset of a data array.
        
        Args:
            data: The data array
            page: Page number (0-based)
            page_size: Number of items per page
            
        Returns:
            Tuple of (paginated data, pagination metadata)
        """
        try:
            # Calculate pagination
            total_rows = data.shape[0]
            total_pages = (total_rows + page_size - 1) // page_size
            
            # Adjust page if out of bounds
            page = max(0, min(page, total_pages - 1)) if total_pages > 0 else 0
            
            # Get the paginated subset
            start = page * page_size
            end = min(start + page_size, total_rows)
            
            paginated_data = data[start:end]
            
            # Pagination metadata
            pagination = {
                "page": page,
                "page_size": page_size,
                "total_rows": total_rows,
                "total_pages": total_pages
            }
            
            return paginated_data, pagination
        except Exception as e:
            raise_if_timeout(e)
            logger.error(f"Error getting paginated data: {e}")
            return np.array([]), {
                "page": page,
                "page_size": page_size,
                "total_rows": 0,
                "total_pages": 0
            }
    
    def get_X_paginated(self, dataset_path: str, row_indices: Optional[List[int]] = None,
                       col_indices: Optional[List[int]] = None, page: int = 0, page_size: int = 100) -> Tuple[np.ndarray, Dict[str, int]]:
        """
        Get paginated X matrix data.
        
        Args:
            dataset_path: Path to the dataset
            row_indices: Optional list of row indices to select
            col_indices: Optional list of column indices to select
            page: Page number (0-based)
            page_size: Number of items per page
            
        Returns:
            Tuple of (paginated data, pagination metadata)
        """
        # Get the data
        data = self.get_X(dataset_path=dataset_path, row_indices=row_indices, col_indices=col_indices)
        
        # Apply pagination
        return self._get_paginated_data(data, page, page_size)
    
    def get_layer_paginated(self, dataset_path: str, layer_name: str, row_indices: Optional[List[int]] = None,
                          col_indices: Optional[List[int]] = None, page: int = 0, page_size: int = 100) -> Tuple[np.ndarray, Dict[str, int]]:
        """
        Get paginated layer data.
        
        Args:
            dataset_path: Path to the dataset
            layer_name: Name of the layer to get
            row_indices: Optional list of row indices to select
            col_indices: Optional list of column indices to select
            page: Page number (0-based)
            page_size: Number of items per page
            
        Returns:
            Tuple of (paginated data, pagination metadata)
        """
        # Get the data
        data = self.get_layer(layer_name, dataset_path=dataset_path, row_indices=row_indices, col_indices=col_indices)
        
        # Apply pagination
        return self._get_paginated_data(data, page, page_size)
    
    def get_obsm_paginated(self, dataset_path: str, obsm_key: str, row_indices: Optional[List[int]] = None,
                         col_indices: Optional[List[int]] = None, page: int = 0, page_size: int = 100,
                         column_name: Optional[str] = None) -> Tuple[np.ndarray, Dict[str, int]]:
        """
        Get paginated obsm data.
        
        Args:
            dataset_path: Path to the dataset
            obsm_key: Key in obsm to get
            row_indices: Optional list of row indices to select
            col_indices: Optional list of column indices to select
            page: Page number (0-based)
            page_size: Number of items per page
            column_name: Optional column name for dataframe-encoded obsm
            
        Returns:
            Tuple of (paginated data, pagination metadata)
        """
        # Get the data
        data = self.get_obsm_varm(key = obsm_key, entity = "cells", dataset_path=dataset_path, indices=row_indices, 
                           col_indices=col_indices, column_name=column_name)
        
        # Apply pagination
        return self._get_paginated_data(data, page, page_size)
    
    def get_varm_paginated(self, dataset_path: str, varm_key: str, row_indices: Optional[List[int]] = None,
                         col_indices: Optional[List[int]] = None, page: int = 0, page_size: int = 100,
                         column_name: Optional[str] = None) -> Tuple[np.ndarray, Dict[str, int]]:
        """
        Get paginated varm data.
        
        Args:
            dataset_path: Path to the dataset
            varm_key: Key in varm to get
            row_indices: Optional list of row indices to select
            col_indices: Optional list of column indices to select
            page: Page number (0-based)
            page_size: Number of items per page
            column_name: Optional column name for dataframe-encoded varm
            
        Returns:
            Tuple of (paginated data, pagination metadata)
        """
        # Get the data
        data = self.get_obsm_varm(key = varm_key, entity = "genes", dataset_path=dataset_path, indices=row_indices, 
                           col_indices=col_indices, column_name=column_name)
        
        # Apply pagination
        return self._get_paginated_data(data, page, page_size)
    
    def get_dataframe_column_names(self, component: str, key: str, dataset_path: Optional[str] = None) -> List[str]:
        """
        Get column names for a dataframe-encoded component.
        
        Args:
            component: Component name ('obsm' or 'varm')
            key: Key within the component
            dataset_path: Path to the dataset (stateless operation)
            
        Returns:
            List of column names
        """
        root = self._get_root(dataset_path=dataset_path)
        
        if root is None or component not in root or key not in root[component]:
            return []
        
        # Check if the component has dataframe encoding
        if self._is_dataframe(root[component][key]):
            return self._get_dataframe_columns(root[component][key])
            
        # Check if it's a regular array and generate numbered column names
        if hasattr(root[component][key], 'shape'):
            shape = root[component][key].shape
            if len(shape) > 1:  # Only process 2D arrays
                # Return numbered columns (0, 1, 2, ...)
                return [str(i) for i in range(shape[1])]
        
        # Direct extraction of column names from data structure without using metadata
        try:
            if component in {'obsm', 'varm'} and key in root[component]:
                # Try to check if there's a columns attribute directly on the array
                if hasattr(root[component][key], 'attrs') and 'columns' in root[component][key].attrs:
                    return list(root[component][key].attrs['columns'])
                
                # For regular 2D arrays, just return numbered columns as a fallback
                if hasattr(root[component][key], 'shape') and len(root[component][key].shape) > 1:
                    return [str(i) for i in range(root[component][key].shape[1])]
        except Exception as e:
            raise_if_timeout(e)
            logger.error(f"Error extracting column names directly from structure: {e}")
        
        return []
    
    def get_obsm_dataframe_columns(self, obsm_key: str, dataset_path: Optional[str] = None) -> List[str]:
        """
        Get column names for a dataframe-encoded obsm key.
        
        Args:
            obsm_key: Key in obsm
            dataset_path: Path to the dataset (stateless operation)
            
        Returns:
            List of column names
        """
        return self.get_dataframe_column_names('obsm', obsm_key, dataset_path)
    
    def get_varm_dataframe_columns(self, varm_key: str, dataset_path: Optional[str] = None) -> List[str]:
        """
        Get column names for a dataframe-encoded varm key.
        
        Args:
            varm_key: Key in varm
            dataset_path: Path to the dataset (stateless operation)
            
        Returns:
            List of column names
        """
        return self.get_dataframe_column_names('varm', varm_key, dataset_path)
    
    def get_obsp_paginated(self, dataset_path: str, obsp_key: str, row_indices: Optional[List[int]] = None,
                         col_indices: Optional[List[int]] = None, page: int = 0, page_size: int = 100) -> Tuple[np.ndarray, Dict[str, int]]:
        """
        Get paginated obsp data.
        
        Args:
            dataset_path: Path to the dataset
            obsp_key: Key in obsp to get
            row_indices: Optional list of row indices to select
            col_indices: Optional list of column indices to select (ignored, uses row_indices)
            page: Page number (0-based)
            page_size: Number of items per page
            
        Returns:
            Tuple of (paginated data, pagination metadata)
        """
        # Get the data
        data = self.get_obsp_varp(key = obsp_key, entity = "cells", dataset_path=dataset_path, indices=row_indices)
        
        # Apply pagination
        return self._get_paginated_data(data, page, page_size)
    
    def get_varp_paginated(self, dataset_path: str, varp_key: str, row_indices: Optional[List[int]] = None,
                         col_indices: Optional[List[int]] = None, page: int = 0, page_size: int = 100) -> Tuple[np.ndarray, Dict[str, int]]:
        """
        Get paginated varp data.
        
        Args:
            dataset_path: Path to the dataset
            varp_key: Key in varp to get
            row_indices: Optional list of row indices to select
            col_indices: Optional list of column indices to select (ignored, uses row_indices)
            page: Page number (0-based)
            page_size: Number of items per page
            
        Returns:
            Tuple of (paginated data, pagination metadata)
        """
        # Get the data
        data = self.get_obsp_varp(key = varp_key, entity = "genes", dataset_path=dataset_path, indices=row_indices)
        
        # Apply pagination
        return self._get_paginated_data(data, page, page_size)
        
    def get_uns_keys(self, dataset_path: Optional[str] = None, use_cache: Optional[bool] = True) -> List[str]:
        """
        Get the keys in the uns section.
        
        Args:
            dataset_path: Path to the dataset (stateless operation)
            use_cache: Whether to use cached dataset if available
            
        Returns:
            List of keys in the uns section
        """
        root = self._get_root(dataset_path=dataset_path)
        
        if root is None or 'uns' not in root:
            return []
        
        # Return the keys in the uns section
        if hasattr(root['uns'], 'keys'):
            return list(root['uns'].keys())
        
        return []
    
    def get_uns_structure(self, dataset_path: Optional[str] = None) -> Dict[str, Any]:
        """
        Get the structure of the uns section including keys and their encoding types.
        
        Args:
            dataset_path: Path to the dataset (stateless operation)
            
        Returns:
            Dict with keys and their encoding types
        """
        root = self._get_root(dataset_path=dataset_path)
        
        if root is None or 'uns' not in root:
            return {}
        
        # Get the structure of the uns section
        uns_structure = {}
        
        for key in self.get_uns_keys(dataset_path):
            try:
                # Check if it has encoding-type attribute
                if hasattr(root['uns'][key], 'attrs') and 'encoding-type' in root['uns'][key].attrs:
                    encoding_type = root['uns'][key].attrs['encoding-type']
                else:
                    # Infer the type
                    if hasattr(root['uns'][key], 'shape'):
                        # It's a dataset/array
                        dtype = str(root['uns'][key].dtype)
                        shape = root['uns'][key].shape
                        encoding_type = f"array({dtype})"
                    elif hasattr(root['uns'][key], 'keys'):
                        # It's a group/dictionary
                        encoding_type = "dict"
                    else:
                        # Unknown
                        encoding_type = "unknown"
                
                uns_structure[key] = {"encoding-type": encoding_type}
                
                # Add shape information if available
                if hasattr(root['uns'][key], 'shape'):
                    uns_structure[key]["shape"] = root['uns'][key].shape
                
            except Exception as e:
                raise_if_timeout(e)
                logger.error(f"Error getting encoding type for uns/{key}: {e}")
                uns_structure[key] = {"encoding-type": "error", "error": str(e)}
        
        return uns_structure
    
    @staticmethod
    def _uns_value(node) -> Any:
        """A uns member as plain JSON-able Python.

        Arrays are read whole with ``[()]``, which also works for the 0-d
        arrays anndata writes for scalars (``[:]`` fails on those, and the
        old code then returned the array's repr). Strings come back as str
        whether stored as bytes, object or numpy StringDType; groups become
        dicts, to any depth.
        """
        if hasattr(node, 'keys'):
            return {name: ZarrReader._uns_value(node[name]) for name in node.keys()}
        value = node[()]
        if isinstance(value, np.ndarray):
            if value.dtype.kind in ('S', 'O', 'U', 'T'):
                flat = [v.decode('utf-8') if isinstance(v, bytes) else
                        (v if v is None or isinstance(v, (int, float, bool)) else str(v))
                        for v in value.ravel().tolist()]
                if value.ndim == 0:
                    return flat[0]
                return np.array(flat, dtype=object).reshape(value.shape).tolist()
            return value.tolist()
        if isinstance(value, bytes):
            return value.decode('utf-8')
        if isinstance(value, np.generic):
            return value.item()
        return value

    @cached_method
    def get_uns(self, key: str, dataset_path: Optional[str] = None) -> Any:
        """
        Get data from the uns section.
        
        Args:
            key: Key in uns to get; ``a/b`` reaches into nested dicts
            dataset_path: Path to the dataset (stateless operation)
            
        Returns:
            Plain Python: dict for a group, str/int/float/bool for a scalar,
            (nested) lists for an array.

        Raises:
            KeyError: ``key`` is not in uns. (It used to return None, which
                the route served as ``200 {"data": null}``.)
        """
        root = self._get_root(dataset_path=dataset_path)
        node = root['uns'] if root is not None and 'uns' in root else None
        for part in key.strip('/').split('/'):
            if node is None or not hasattr(node, 'keys') or part not in node:
                raise KeyError(f"No uns key '{key}' in this dataset.")
            node = node[part]
        return self._uns_value(node)

    @cached_method
    def get_cell_gene_names(self, dataset_path: str, entity: Literal["cells", "genes"], use_cache: bool = False) -> List[str]:
        """
        Get list of gene names.
        
        Args:
            dataset_path: Path to the dataset (stateless operation)
            use_cache: Whether to cache the dataset for future use
            
        Returns:
            List of gene names
            
        Raises:
            ValueError: If the dataset path is invalid
            RuntimeError: If there's an error opening or processing the dataset
        """
        try:
            logger.info(f"GET_{'GENE' if entity == 'genes' else 'CELL'}_NAMES: Opening dataset {dataset_path} with use_cache={use_cache}")
            root = self._get_root(dataset_path=dataset_path)
            logger.info(f"GET_{'GENE' if entity == 'genes' else 'CELL'}_NAMES: Successfully opened dataset {dataset_path}")
        except (ValueError, RuntimeError) as e:
            # Re-raise these specific exceptions to be handled by the route
            logger.error(f"Error opening dataset from path {dataset_path}: {e}")
            raise
        except Exception as e:
            raise_if_timeout(e)
            # Wrap other exceptions in a RuntimeError with a descriptive message
            error_msg = f"Unexpected error opening dataset {dataset_path}: {e}"
            logger.error(error_msg)
            raise RuntimeError(error_msg) from e
        
        if root is None:
            raise ValueError(f"Unable to access dataset at path: {dataset_path}")
        
        obj = 'var' if entity == 'genes' else 'obs'
        if obj not in root:
            # Return empty list for dataset without variables
            logger.warning(f"Dataset at {dataset_path} has no '{obj}' data")
            return []
            
        # Check for _index attribute in var group
        index_column = '_index'
        if hasattr(root[obj], 'attrs') and '_index' in root[obj].attrs:
            index_column = root[obj].attrs['_index']
            logger.debug(f"Using custom index column '{index_column}' for {obj} group from _index attribute")
        
        # Check if the index column exists
        if index_column not in root[obj]:
            logger.warning(f"Index column '{index_column}' not found in {obj} group")
            return []
        
        # Get names (handles categorical/nullable encodings)
        try:
            names = self._get_categorical_values(root[obj][index_column])
            return names.tolist() if hasattr(names, 'tolist') else list(names)
        except Exception as e:
            raise_if_timeout(e)
            logger.error(f"Error reading names from {dataset_path}: {type(e).__name__}: {e}")
            raise RuntimeError(str(e) or f"Failed to read names ({type(e).__name__})") from e
    
    def iter_cell_gene_name_chunks(self, dataset_path: str, entity: Literal["cells", "genes"]):
        """Every name of the axis, one zarr chunk at a time
        (``string_chunks.iter_chunks``), for building the name index without
        a list of every name: 50M names as Python strings took 7 GB that the
        process kept after the index was built. None for an index stored as
        a categorical or nullable group (then the caller reads the list).
        """
        root = self._get_root(dataset_path=dataset_path)
        if root is None:
            raise ValueError(f"Unable to access dataset at path: {dataset_path}")
        obj = 'var' if entity == 'genes' else 'obs'
        if obj not in root:
            return iter(())
        index_column = root[obj].attrs.get('_index', '_index') if hasattr(root[obj], 'attrs') else '_index'
        if index_column not in root[obj]:
            return iter(())
        member = root[obj][index_column]
        if self._is_group(member):
            return None
        local_dir = None
        if not is_remote_path(dataset_path) and os.path.isdir(dataset_path):
            local_dir = os.path.join(dataset_path, obj, index_column)
        return string_chunks.iter_chunks(member, local_dir)

    @cached_method
    def get_cell_gene_names_at(self, dataset_path: str, entity: Literal["cells", "genes"],
                               rows) -> List[str]:
        """Names at the sorted positions ``rows``: what a cell subset shows.

        Reads the index chunk by chunk and keeps only the wanted names
        (``string_chunks.take``), instead of decoding every name of the axis
        and picking afterwards: 0.25 s instead of 2.9 s for 100,000 of
        10 million Tahoe cells, and memory for one chunk, not every name.
        """
        root = self._get_root(dataset_path=dataset_path)
        if root is None:
            raise ValueError(f"Unable to access dataset at path: {dataset_path}")
        obj = 'var' if entity == 'genes' else 'obs'
        if obj not in root:
            return []
        index_column = root[obj].attrs.get('_index', '_index') if hasattr(root[obj], 'attrs') else '_index'
        if index_column not in root[obj]:
            return []
        member = root[obj][index_column]
        try:
            if self._is_group(member):
                # categorical or nullable: codes/values are read by index
                names = self._get_categorical_values(member, list(map(int, rows)))
                return names.tolist() if hasattr(names, 'tolist') else list(names)
            local_dir = None
            if not is_remote_path(dataset_path) and os.path.isdir(dataset_path):
                local_dir = os.path.join(dataset_path, obj, index_column)
            return string_chunks.take(member, rows, local_dir)
        except Exception as e:
            raise_if_timeout(e)
            logger.error(f"Error reading names from {dataset_path}: {type(e).__name__}: {e}")
            raise RuntimeError(str(e) or f"Failed to read names ({type(e).__name__})") from e

    def get_obs_names(self, dataset_path: Optional[str] = None) -> List[str]:
        """
        Get observation names (alias for get_cell_names for backward compatibility).
        
        Args:
            dataset_path: Path to the dataset
            
        Returns:
            List of observation names
        """
        return self.get_cell_gene_names(dataset_path=dataset_path, entity="cells")

    def get_var_names(self, dataset_path: Optional[str] = None) -> List[str]:
        """
        Get variable names (alias for get_gene_names for backward compatibility).
        
        Args:
            dataset_path: Path to the dataset
            
        Returns:
            List of variable names
        """
        return self.get_cell_gene_names(dataset_path=dataset_path, entity="genes")
    
    def get_data_by_path(self, path: str, dataset_path: Optional[str] = None, 
                    indices: Optional[List[int]] = None, col_indices: Optional[List[int]] = None) -> np.ndarray:
        """
        Get data using a path notation like "varm/kompot_de_mean_lfc_Young_to_Old_groups/B cells".
        
        This allows accessing dataframe columns with their path directly. The path notation
        supports the following formats:
        
        - "X" - Get the X matrix
        - "obsm/key" - Get the obsm matrix with the given key
        - "varm/key" - Get the varm matrix with the given key
        - "obsm/key/column" - Get a specific column from a dataframe-encoded obsm matrix
        - "varm/key/column" - Get a specific column from a dataframe-encoded varm matrix
        - "layers/key" - Get a layer with the given key
        - "obsp/key" - Get an obsp matrix with the given key
        - "varp/key" - Get a varp matrix with the given key
        
        This method is particularly useful for accessing dataframe columns that may have spaces
        or special characters in their names.
        
        Args:
            path: Path notation (e.g. "varm/key/column" or "obsm/key")
            dataset_path: Path to the dataset (stateless operation)
            indices: Optional list of row indices to select
            col_indices: Optional list of column indices to select
            
        Returns:
            numpy.ndarray: The requested data
        """
        parts = path.strip('/').split('/')
        
        # Handle invalid paths
        if len(parts) < 2:
            logger.error(f"Invalid path format: {path}. Expected format like 'varm/key' or 'varm/key/column'")
            return np.array([])
        
        component = parts[0]  # e.g., "varm", "obsm", "obsp", "layers"
        key = parts[1]        # e.g., "kompot_de_mean_lfc_Young_to_Old_groups"
        
        # Handle dataframe column access with 3-part path
        if len(parts) == 3 and (component == 'varm' or component == 'obsm'):
            column_name = parts[2]  # e.g., "B cells"
            
            if component == 'varm':
                return self.get_obsm_varm(key = key, entity= "genes", dataset_path=dataset_path, indices=indices, 
                                  col_indices=col_indices, column_name=column_name)
            elif component == 'obsm':
                return self.get_obsm_varm(key = key, entity = "cells", dataset_path=dataset_path, indices=indices, 
                                  col_indices=col_indices, column_name=column_name)
        
        # Handle regular 2-part path
        if component == 'X':
            return self.get_X(dataset_path=dataset_path, row_indices=indices, 
                           col_indices=col_indices)
        elif component == 'obsm':
            return self.get_obsm_varm(key = key, entity = "cells", dataset_path=dataset_path, indices=indices, 
                              col_indices=col_indices)
        elif component == 'varm':
            return self.get_obsm_varm(key = key, entity = "genes", dataset_path=dataset_path, indices=indices, 
                              col_indices=col_indices)
        elif component == 'layers':
            return self.get_layer(key, dataset_path=dataset_path, row_indices=indices, 
                               col_indices=col_indices)
        elif component == 'obsp':
            return self.get_obsp_varp(key = key, entity = "cells", dataset_path=dataset_path, indices=indices)
        elif component == 'varp':
            return self.get_obsp_varp(key= key, entity = "genes", dataset_path=dataset_path, indices=indices)
        else:
            logger.error(f"Unsupported component: {component} in path: {path}")
            return np.array([])
    
    def get_statistics(self, dataset_path: str, row_indices: Optional[List[int]] = None,
                     col_indices: Optional[List[int]] = None, data_path: Optional[str] = None) -> Dict[str, Any]:
        """
        Get basic statistics for a dataset.
        
        Args:
            dataset_path: Path to the dataset
            row_indices: Optional list of row indices to select
            col_indices: Optional list of column indices to select
            data_path: Optional path to the data to analyze (e.g., "varm/kompot_de_mean_lfc_Young_to_Old_groups/B cells")
                      If not provided, uses X matrix.
            
        Returns:
            Dict of statistics
        """
        try:
            # Get the data
            if data_path:
                data = self.get_data_by_path(data_path, dataset_path=dataset_path, 
                                          indices=row_indices, col_indices=col_indices)
            else:
                data = self.get_X(dataset_path=dataset_path, row_indices=row_indices, col_indices=col_indices)
            
            if data.size == 0:
                return {
                    "min": 0,
                    "max": 0,
                    "mean": 0,
                    "median": 0,
                    "std": 0,
                    "sum": 0,
                    "count": 0,
                    "nonzero_count": 0,
                    "nonzero_fraction": 0
                }
            
            # Calculate statistics
            stats = {
                "min": float(np.min(data)),
                "max": float(np.max(data)),
                "mean": float(np.mean(data)),
                "median": float(np.median(data)),
                "std": float(np.std(data)),
                "sum": float(np.sum(data)),
                "count": int(data.size),
                "nonzero_count": int(np.count_nonzero(data)),
                "nonzero_fraction": float(np.count_nonzero(data) / data.size)
            }
            
            return stats
        except Exception as e:
            raise_if_timeout(e)
            logger.error(f"Error calculating statistics: {e}")
            return {
                "error": str(e)
            }
    
    def get_anndata_structure(self, root: zarr.Group, metadata: Dict[str, Any]) -> Dict[str, Any]:
        """
        Create an AnnData-like structure from a zarr root.
        
        Args:
            root: Zarr root group
            metadata: Metadata dict from _extract_metadata
            
        Returns:
            Dict with AnnData-like structure
        """
        # Create structure
        result = {
            "n_obs": metadata.get("shape", (0, 0))[0],
            "n_vars": metadata.get("shape", (0, 0))[1],
            "var_names": [],
            "obs_names": [],
            "layers": [],
            "obsm": [],
            "varm": [],
            "obsp": [],
            "varp": [],
            "uns": [],
            "obs_columns_info": {},
            "var_columns_info": {},
            "obsm_info": {},
            "varm_info": {},
            "layers_info": {}
        }
        
        # Add variable names
        if metadata.get("has_var", False):
            # Check for _index attribute in var group to determine the column name
            var_index_column = '_index'
            if hasattr(root['var'], 'attrs') and '_index' in root['var'].attrs:
                var_index_column = root['var'].attrs['_index']
                logger.debug(f"Using custom index column '{var_index_column}' for var group from _index attribute")
            
            if var_index_column in root['var']:
                try:
                    preview_count = min(10, self._get_encoded_length(root['var'][var_index_column]))
                    var_names = self._get_categorical_values(root['var'][var_index_column], indices=list(range(preview_count)))
                    result["var_names"] = var_names.tolist() if hasattr(var_names, 'tolist') else list(var_names)
                except Exception as e:
                    raise_if_timeout(e)
                    logger.error(f"Error getting var names: {e}")
        
        # Add observation names
        if metadata.get("has_obs", False):
            # Check for _index attribute in obs group to determine the column name
            obs_index_column = '_index'
            if hasattr(root['obs'], 'attrs') and '_index' in root['obs'].attrs:
                obs_index_column = root['obs'].attrs['_index']
                logger.debug(f"Using custom index column '{obs_index_column}' for obs group from _index attribute")
            
            if obs_index_column in root['obs']:
                try:
                    preview_count = min(10, self._get_encoded_length(root['obs'][obs_index_column]))
                    obs_names = self._get_categorical_values(root['obs'][obs_index_column], indices=list(range(preview_count)))
                    result["obs_names"] = obs_names.tolist() if hasattr(obs_names, 'tolist') else list(obs_names)
                except Exception as e:
                    raise_if_timeout(e)
                    logger.error(f"Error getting obs names: {e}")
        
        # Add obs and var columns
        if metadata.get("has_obs", False):
            result["obs_columns"] = list(root['obs'].keys()) if hasattr(root['obs'], 'keys') else []
        
        if metadata.get("has_var", False):
            result["var_columns"] = list(root['var'].keys()) if hasattr(root['var'], 'keys') else []
        
        # Add layers
        if metadata.get("has_layers", False):
            result["layers"] = list(root['layers'].keys()) if hasattr(root['layers'], 'keys') else []
        
        # Add embeddings (obsm)
        if metadata.get("has_obsm", False):
            result["obsm"] = list(root['obsm'].keys()) if hasattr(root['obsm'], 'keys') else []
            
            # Add dataframe information for obsm
            if "obsm_dataframes" in metadata:
                result["obsm_dataframes"] = {}
                for key, df_info in metadata["obsm_dataframes"].items():
                    info_dict = {
                        "columns": df_info.get("columns", []),
                    }
                    
                    # Add array specific information if this is an array
                    if df_info.get("is_array", False):
                        info_dict["is_array"] = True
                        info_dict["array_shape"] = df_info.get("array_shape", ())
                        info_dict["array_dtype"] = df_info.get("array_dtype", "")
                    else:
                        # Add dataframe specific information
                        info_dict["encoding_type"] = df_info.get("encoding_type", "")
                        info_dict["encoding_version"] = df_info.get("encoding_version", "")
                    
                    result["obsm_dataframes"][key] = info_dict
        
        # Add varm
        if metadata.get("has_varm", False):
            result["varm"] = list(root['varm'].keys()) if hasattr(root['varm'], 'keys') else []
            
            # Add dataframe information for varm
            if "varm_dataframes" in metadata:
                result["varm_dataframes"] = {}
                for key, df_info in metadata["varm_dataframes"].items():
                    info_dict = {
                        "columns": df_info.get("columns", []),
                    }
                    
                    # Add array specific information if this is an array
                    if df_info.get("is_array", False):
                        info_dict["is_array"] = True
                        info_dict["array_shape"] = df_info.get("array_shape", ())
                        info_dict["array_dtype"] = df_info.get("array_dtype", "")
                    else:
                        # Add dataframe specific information
                        info_dict["encoding_type"] = df_info.get("encoding_type", "")
                        info_dict["encoding_version"] = df_info.get("encoding_version", "")
                    
                    result["varm_dataframes"][key] = info_dict
        
        # Add obsp
        if metadata.get("has_obsp", False):
            result["obsp"] = list(root['obsp'].keys()) if hasattr(root['obsp'], 'keys') else []
        
        # Add varp
        if metadata.get("has_varp", False):
            result["varp"] = list(root['varp'].keys()) if hasattr(root['varp'], 'keys') else []
        
        # Add uns
        if metadata.get("has_uns", False):
            result["uns"] = list(root['uns'].keys()) if hasattr(root['uns'], 'keys') else []
            
            # Add uns structure with encoding types directly from root
            uns_structure = {}
            for key in result["uns"]:
                try:
                    # Check if it has encoding-type attribute
                    if hasattr(root['uns'][key], 'attrs') and 'encoding-type' in root['uns'][key].attrs:
                        encoding_type = root['uns'][key].attrs['encoding-type']
                    else:
                        # Infer the type
                        if hasattr(root['uns'][key], 'shape'):
                            # It's a dataset/array
                            dtype = str(root['uns'][key].dtype)
                            shape = root['uns'][key].shape
                            encoding_type = f"array({dtype})"
                        elif hasattr(root['uns'][key], 'keys'):
                            # It's a group/dictionary
                            encoding_type = "dict"
                        else:
                            # Unknown
                            encoding_type = "unknown"
                    
                    uns_structure[key] = {"encoding-type": encoding_type}
                    
                    # Add shape information if available
                    if hasattr(root['uns'][key], 'shape'):
                        uns_structure[key]["shape"] = root['uns'][key].shape
                    
                except Exception as e:
                    raise_if_timeout(e)
                    logger.error(f"Error getting encoding type for uns/{key}: {e}")
                    uns_structure[key] = {"encoding-type": "error", "error": str(e)}
            
            if uns_structure:
                result["uns_structure"] = uns_structure
        
        # Add column type information
        if "obs_columns_info" in metadata:
            result["obs_columns_info"] = metadata["obs_columns_info"]
        
        if "var_columns_info" in metadata:
            result["var_columns_info"] = metadata["var_columns_info"]
        
        if "obsm_info" in metadata:
            result["obsm_info"] = metadata["obsm_info"]
        
        if "varm_info" in metadata:
            result["varm_info"] = metadata["varm_info"]
        
        if "layers_info" in metadata:
            result["layers_info"] = metadata["layers_info"]
        
        return result
    
    def validate_zarr_url(self, url: str) -> Tuple[bool, str]:
        """
        Validate if a URL points to a valid zarr archive.

        Goes through the same policy-checked opener as every data read, so a
        server that refuses remote stores refuses to probe them here too.
        
        Args:
            url: URL to validate
            
        Returns:
            Tuple of (is_valid, message)
        """
        if not is_remote_path(url):
            return False, "Not a remote URL (expected s3://, gs://, http:// or https://)"
        try:
            root = open_remote_group(url)
            
            # Check if it has basic AnnData structure
            has_x = 'X' in root
            has_obs = 'obs' in root
            has_var = 'var' in root
            
            if has_x or (has_obs and has_var):
                return True, "Valid zarr archive with AnnData structure"
            else:
                return False, "Zarr archive found but missing AnnData structure"
        except Exception as e:
            raise_if_timeout(e)
            return False, f"Error validating zarr URL: {str(e)}"

# Create a singleton instance
zarr_reader = ZarrReader()