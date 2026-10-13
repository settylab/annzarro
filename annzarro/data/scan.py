"""Find zarr stores under a directory without walking their chunks.

``Path.rglob("*.zarr")`` and ``os.walk`` descend into every store they find: a
95-million-cell store is hundreds of thousands of chunk files, and the legacy
dataset listing and /status visited each of them on every request, for any
user (anonymously with login off). ``scan_stores`` stops at a store, and at
``max_entries`` directory entries altogether, so a request costs a bounded
walk and the reply says when the walk was cut short.
"""
import os
from typing import List, Tuple

#: Directory entries one scan reads before it gives up (server.dataset_scan_max_entries)
DEFAULT_MAX_ENTRIES = 200_000


def is_store_root(path: str, name: str) -> bool:
    """Whether the directory ``path`` is the root of a zarr store: named
    ``*.zarr``, or holding a zarr v2 ``.zgroup`` or a v3 ``zarr.json``."""
    return (name.endswith(".zarr") or os.path.exists(os.path.join(path, ".zgroup"))
            or os.path.exists(os.path.join(path, "zarr.json")))


def scan_stores(root: str, recursive: bool = True, follow_symlinks: bool = True,
                max_entries: int = DEFAULT_MAX_ENTRIES) -> Tuple[List[str], bool]:
    """(the paths of the ``*.zarr`` stores under ``root``, whether the scan
    stopped at ``max_entries`` entries before it had seen everything).

    A store is listed when its directory is named ``*.zarr`` and never
    searched inside, whatever it is called. With ``recursive`` false only
    ``root`` and its subdirectories are looked at. A directory link is
    followed when ``follow_symlinks`` is true, once per real directory.
    """
    found: List[str] = []
    seen = set()
    budget = int(max_entries) if max_entries else DEFAULT_MAX_ENTRIES
    stack = [(root, 0)]
    while stack:
        directory, depth = stack.pop()
        try:
            real = os.path.realpath(directory)
            if real in seen:
                continue
            seen.add(real)
            entries = sorted(os.scandir(directory), key=lambda e: e.name)
        except OSError:
            continue
        for entry in entries:
            budget -= 1
            if budget < 0:
                return found, True
            try:
                if not entry.is_dir(follow_symlinks=follow_symlinks):
                    continue
                is_link = entry.is_symlink()
            except OSError:
                continue
            if entry.name.endswith(".zarr"):
                found.append(entry.path)
            elif (recursive or depth == 0) and not is_store_root(entry.path, entry.name):
                stack.append((entry.path, depth + 1))
    return found, False


def count_stores_within(root: str, max_entries: int = DEFAULT_MAX_ENTRIES, within: str = None) -> Tuple[int, bool, int]:
    """(stores under ``root``, whether the scan was cut short, directory entries read).

    With ``within`` (a real path), a directory whose real path lies outside it
    is not entered: a link inside ``root`` that leads elsewhere is neither
    walked nor counted. The entries read let a caller share one budget."""
    count = used = 0
    seen = set()
    budget = int(max_entries) if max_entries else DEFAULT_MAX_ENTRIES
    fence = within.rstrip(os.sep) + os.sep if within else None
    stack = [root]
    while stack:
        directory = stack.pop()
        try:
            real = os.path.realpath(directory)
            if real in seen or (fence and real != within and not real.startswith(fence)):
                continue
            seen.add(real)
            entries = list(os.scandir(directory))
        except OSError:
            continue
        for entry in entries:
            if used >= budget:
                return count, True, used
            used += 1
            try:
                if not entry.is_dir():
                    continue
            except OSError:
                continue
            if is_store_root(entry.path, entry.name):
                count += 1
            else:
                stack.append(entry.path)
    return count, False, used


def count_stores(root: str, max_entries: int = DEFAULT_MAX_ENTRIES) -> Tuple[int, bool]:
    """(how many zarr stores lie under ``root``, whether the scan was cut short).
    A store is a directory named ``*.zarr`` or holding ``.zgroup`` / ``zarr.json``."""
    count, truncated, _ = count_stores_within(root, max_entries)
    return count, truncated
