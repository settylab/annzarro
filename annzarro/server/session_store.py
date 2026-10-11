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


class Unreadable(Exception):
    """The file exists but is not a JSON object; rewriting it would destroy it."""


def locked(sessions_dir: str):
    """The lock of the panel-set directory (the file ``<dir>/.sessions.lock``)."""
    return atomic_store.locked(os.path.join(sessions_dir, ".sessions"))


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
    atomic_store.write_json(file_path, data, mode=0o644)
    return previous
