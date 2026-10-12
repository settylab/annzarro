"""Writing panel sets: the one lock, the name rule, and handing a set to a new owner.

Panel sets are JSON files in ``<data_dir>/sessions``. Every route that reads a
set and then writes it back (save, import, duplicate, rename, delete, and the
admin reassignment) holds :func:`locked` from the read to the write, and the
write itself is ``atomic_store.write_json``. Without that, an owner's save
that read the set before an admin reassigned it would write the old owner
back.
"""
import os
from typing import Optional

from . import atomic_store, permissions


def _read_umask() -> int:
    old = os.umask(0)
    os.umask(old)
    return old


#: The process umask, read once: sets are created as ``open('w')`` created them (gunicorn's 027 gives 0640).
_UMASK = _read_umask()


def write(path: str, data, like: Optional[str] = None) -> None:
    """Write a set atomically with the mode it would have had under ``open(path, 'w')``:
    an existing file keeps its mode, a new one gets ``0o666 & ~umask``. ``like``
    names the file whose mode a new ``path`` inherits (a renamed set keeps its mode).
    The caller holds :func:`locked`. A symlink at ``path`` is replaced, not followed."""
    if os.path.islink(path):
        os.unlink(path)
    source = path if os.path.exists(path) else like
    mode = (os.stat(source).st_mode & 0o777) if source and os.path.exists(source) else 0o666 & ~_UMASK
    atomic_store.write_json(path, data, mode=mode)


class Unreadable(Exception):
    """The file exists but is not a JSON object; rewriting it would destroy it."""


def locked(sessions_dir: str):
    """The lock of the panel-set directory (the file ``<dir>/.lock.lock``, the path slice 2 uses)."""
    return atomic_store.locked(os.path.join(sessions_dir, ".lock"))


def sanitize_name(name: str) -> str:
    """A panel-set name that is safe to use as a file name."""
    # Remove any path separators or potentially dangerous characters
    sanitized = name.replace('/', '_').replace('\\', '_').replace('..', '_')
    # Allow only alphanumeric characters, underscore, hyphen, and space
    return ''.join(c for c in sanitized if c.isalnum() or c in ' _-')


def path_of(sessions_dir: str, name: str) -> Optional[str]:
    """The file of the set called ``name``, or None when the name leaves nothing
    or the file would not sit directly in the directory (a link out of it)."""
    clean = sanitize_name(name)
    if not clean:
        return None
    path = os.path.join(sessions_dir, f"{clean}.json")
    if os.path.dirname(os.path.realpath(path)) != os.path.realpath(sessions_dir):
        return None
    return path


def assign_owner(file_path: str, owner: str) -> Optional[str]:
    """Make ``owner`` the owner of the set in ``file_path`` and return the previous
    owner. The caller holds :func:`locked` and runs inside a request (the admin
    is recorded as ``modified_by``). FileNotFoundError when there is no such set,
    :class:`Unreadable` when the file is not a JSON object."""
    try:
        data = atomic_store.read_json(file_path, None)
    except ValueError:
        raise Unreadable(file_path)
    if data is None:
        raise FileNotFoundError(file_path)
    if not isinstance(data, dict):
        raise Unreadable(file_path)
    previous = data.get("owner")
    permissions.stamp_session(data, existing=dict(data))
    data["owner"] = owner
    write(file_path, data)
    return previous


def reassign_owner(sessions_dir: str, from_owner: str, to_owner: str) -> int:
    """Hand every set of ``from_owner`` to ``to_owner``; returns how many moved.
    Takes :func:`locked` itself, so the caller must not hold it. Replaces
    ``users.reassign_panel_sets`` (user removal with a hand-over)."""
    from . import session_quota
    if not os.path.isdir(sessions_dir):
        return 0
    moved = 0
    with locked(sessions_dir):
        for item in session_quota.entries(sessions_dir):
            if item.data.get("owner") != from_owner:
                continue
            fresh = atomic_store.read_json(item.path, None)     # not the cached summary
            if not isinstance(fresh, dict) or fresh.get("owner") != from_owner:
                continue
            assign_owner(item.path, to_owner)
            moved += 1
    return moved
