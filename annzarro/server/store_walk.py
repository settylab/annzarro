"""
The walk over the stores under the data directory, shared by the dataset name search.

``iter_stores`` yields every store under a root as a listing entry (the ``_entry`` dict of the
dataset picker: name, path, rel_path, kind, h5ad, is_link), breadth first, never into a store.
It owns the rules a walk must honour: hidden entries and the ``sessions`` folder are skipped, links
a hosted server would refuse (``confinement.listable``) are not followed, a folder is entered once
by its real path, a restricted user's walk starts at their grants and never leaves them, and the
depth, entry and time limits stop it. What the walk reached is left in a ``WalkStats``.
"""
import os
import time

from . import access, panel_sets


class WalkStats:
    """What a walk did: ``visited`` entries looked at, and ``truncated`` when a limit stopped it.

    The consumer may set ``truncated`` itself (its own limit, its own clock) and stop iterating.
    """

    def __init__(self):
        self.visited = 0
        self.truncated = False


def iter_stores(config, scope=None, user=None, deadline=None, max_depth=6, max_visited=20000, stats=None):
    """The stores under the data directory (or under ``scope``), as a generator of listing entries.

    With a ``scope`` the walk starts there (depth 0) and the admin-added roots are not walked;
    FileNotFoundError at the call when it is not a directory, and a scope that is itself a store
    yields nothing. Otherwise a ``user`` (a restricted user) is walked from their grants (granted
    stores first), and anybody else from the data directory and the admin-added roots.

    ``deadline`` is a ``time.monotonic()`` value, ``max_depth`` the folders deep a walk goes,
    ``max_visited`` the entries it looks at; ``stats.truncated`` says one of them stopped it
    (also when a folder lies below ``max_depth``).
    """
    from .routes import data_routes, dataset_folders as df
    stats = stats if stats is not None else WalkStats()
    data_dir = os.path.expanduser(config.get("data_dir"))
    top_skip = panel_sets.top_level_skip(config)
    stores = []
    if scope is not None:
        if not os.path.isdir(scope):
            raise FileNotFoundError(scope)
        if df.is_store_dir(scope, os.path.basename(scope.rstrip(os.sep))):
            return _walk(data_dir, [], [], set(), None, user, deadline, max_depth, max_visited, stats, data_routes, df, top_skip)
        queue, seen = [(scope, 0)], {os.path.realpath(scope)}
    elif user:
        queue, seen = [], set()
        for entry in df._grant_entries(user):
            if entry["kind"] == "folder":
                queue.append((entry["path"], 0))
                seen.add(entry["path"])
            else:
                stores.append(entry)
    else:
        queue, seen = [(data_dir, 0)], {os.path.realpath(data_dir)}
    if scope is None and not user:
        # the data directories admins added are top-level folders of the picker, so they are walked too
        for root in df._admin_root_entries(config, data_dir, set()):
            real = os.path.realpath(root["path"])
            if real not in seen:
                seen.add(real)
                queue.append((root["path"], 1))
    return _walk(data_dir, stores, queue, seen, scope, user, deadline, max_depth, max_visited, stats, data_routes, df, top_skip)


def _walk(data_dir, stores, queue, seen, scope, user, deadline, max_depth, max_visited, stats, data_routes, df, top_skip):
    yield from stores
    while queue and not stats.truncated:
        folder, depth = queue.pop(0)
        skip = top_skip if os.path.realpath(folder) == os.path.realpath(data_dir) else ()
        for name in data_routes._listdir(folder):
            if name in skip or name.startswith("."):
                continue
            stats.visited += 1
            if stats.visited > max_visited or (deadline is not None and time.monotonic() > deadline):
                stats.truncated = True
                break
            entry = df._entry(data_dir, folder, name)
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
                    stats.truncated = True
                continue
            yield entry
            if stats.truncated:           # the consumer's own limit
                return
