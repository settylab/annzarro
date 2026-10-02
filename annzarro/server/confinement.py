"""
Keep a shared server's file access inside its data directory
------------------------------------------------------------

Every dataset route takes a filesystem path from the request
(``?dataset_path=``, ``/datasets/<path>``, ``?dir=``, ``directories/list?path=``)
and hands it straight to a reader. On a laptop that is the point: the user
browses their own disk. On a shared server it means anyone who can log in --
or anyone at all, with login disabled -- can list any directory and open any
``.zarr``/``.h5ad`` the server process can read.

So when the server is *hosted* -- login enabled, or listening beyond
localhost -- every local path in a request must resolve (``realpath``, so
``..`` and symlinks are followed to where they really lead) inside one of the
allowed roots: ``data_dir`` plus any ``allowed_dirs`` from the configuration.
Anything else is refused with a 403 (after the login check, and without
naming the roots: absolute server paths stay in the server log).

Local single-user mode (localhost, login disabled -- including the desktop
app) is unchanged: free browsing.

Remote stores (``s3://``, ``http(s)://``, anything with a URL scheme) are not
local paths and are left alone here; they get their own allowlist elsewhere.
"""

import logging
import os

from flask import current_app, jsonify, request

from .permissions import is_shared

logger = logging.getLogger(__name__)

#: Query parameters that carry a dataset or directory path on every route.
PATH_ARGS = ("dataset_path", "dataset_id", "dir")

#: Endpoints whose ``path`` argument is a filesystem directory. Elsewhere
#: (``data/by_path``) ``path`` names an array INSIDE a dataset, not a file.
DIRECTORY_PATH_ENDPOINTS = ("list_directory",)


def is_hosted(config):
    """True when other people can reach this server: login on, or shared
    (explicit ``server.hosted``, else a network bind host)."""
    return bool(config.get("auth_enabled", False)) or is_shared(config)


def allowed_roots(config):
    """Real paths of the directories a hosted server may read from."""
    roots = [config.get("data_dir") or "data"]
    extra = config.get("allowed_dirs") or []
    if isinstance(extra, str):
        extra = [extra]
    roots.extend(extra)
    return [os.path.realpath(os.path.expanduser(r)) for r in roots]


def is_remote(path):
    """A URL-style store (``s3://``, ``https://`` ...), not a local path."""
    return "://" in path


def is_inside(path, roots):
    """Whether ``path`` really resolves to one of ``roots`` or below it.

    Relative paths resolve against the working directory, exactly as the
    readers resolve them.
    """
    real = os.path.realpath(os.path.expanduser(path))
    for root in roots:
        if real == root or real.startswith(root.rstrip(os.sep) + os.sep):
            return True
    return False


def _requested_paths():
    """Every local filesystem path named by the current request."""
    paths = [request.args.get(name) for name in PATH_ARGS]
    if request.view_args:
        paths.append(request.view_args.get("dataset_path"))
    if request.endpoint in DIRECTORY_PATH_ENDPOINTS:
        directory = request.args.get("path")
        if directory:
            # list_directory resolves a relative path against data_dir
            data_dir = current_app.config.get("data_dir") or "data"
            if not os.path.isabs(directory) and not directory.startswith(data_dir):
                directory = os.path.join(data_dir, directory)
            paths.append(directory)
    return [p for p in paths if p and not is_remote(p)]


def resolve_relative_dataset_paths():
    """``before_request`` hook: a relative ``dataset_path`` names a dataset in
    the data directory.

    A share link written by hand or by another tool (``?dataset_path=
    bm_aging_showcase.zarr``) named a path relative to the server's working
    directory, so it opened nothing (500 from /data/info). When the path does
    not exist there but does under ``data_dir``, the request is rewritten to
    that absolute path, before confinement checks it.
    """
    data_dir = current_app.config.get("data_dir")
    if not data_dir:
        return None
    args = None
    for name in ("dataset_path", "dataset_id"):
        value = request.args.get(name)
        if not value or is_remote(value) or os.path.isabs(os.path.expanduser(value)):
            continue
        candidate = os.path.join(os.path.expanduser(data_dir), value)
        if not os.path.exists(value) and os.path.exists(candidate):
            if args is None:
                args = request.args.copy()
            args[name] = os.path.abspath(candidate)
    if args is not None:
        from werkzeug.datastructures import ImmutableMultiDict
        request.args = ImmutableMultiDict(args)
    return None


def enforce():
    """``before_request`` hook: refuse local paths outside the allowed roots."""
    config = current_app.config
    if not is_hosted(config):
        return None
    paths = _requested_paths()
    if not paths:
        return None
    # Login comes first. This hook runs before the views' login check, so
    # without this an anonymous client was told which paths exist outside
    # the data directory (403 vs 401), and the 403 named the server's roots.
    if config.get("auth_enabled", False):
        from .core import is_logged_in, login_required_response
        if not is_logged_in():
            return login_required_response()
    roots = allowed_roots(config)
    for path in paths:
        if not is_inside(path, roots):
            # The roots go to the log for the administrator, never to the
            # client: absolute server paths are nobody else's business.
            logger.warning(f"Refused path outside the data directory: {path!r} "
                           f"({request.path}); allowed roots: {', '.join(roots)}")
            return jsonify({
                "error": (f"'{path}' is outside the data directory this server "
                          f"shares, so it cannot be opened here. Open a dataset "
                          f"from the dataset list, or ask an administrator to "
                          f"add its directory to server.allowed_dirs."),
                "reason": "outside_data_dir",
                "path": path,
            }), 403
    return None


def listable(config, path):
    """Whether a directory listing may show ``path``.

    A hosted server refuses to open a link whose target is outside every
    allowed root, so listing it only offers a dataset that fails with 403
    when clicked. Local single-user mode lists everything.
    """
    if not is_hosted(config):
        return True
    return is_inside(path, allowed_roots(config))


def warn_about_escaping_links(config):
    """Name datasets in data_dir that a hosted server will refuse.

    ``ln -s /elsewhere/x.zarr data/`` is the documented way to add a dataset.
    In hosted mode a link whose target is outside every allowed root is
    refused, so say so at startup rather than at the first 403.
    """
    if not is_hosted(config):
        return
    data_dir = config.get("data_dir") or "data"
    roots = allowed_roots(config)
    try:
        entries = os.listdir(data_dir)
    except OSError:
        return
    escaping = []
    for entry in sorted(entries):
        full = os.path.join(data_dir, entry)
        if os.path.islink(full) and not is_inside(full, roots):
            escaping.append(f"{entry} -> {os.path.realpath(full)}")
    if escaping:
        logger.warning(
            "These links in the data directory point outside it and will be refused "
            "while the server is shared; add their targets' directories to "
            "server.allowed_dirs to serve them: " + "; ".join(escaping)
        )
