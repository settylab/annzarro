"""
The admin web interface: server side
------------------------------------

Everything the admin interface owns on disk lives in ``annzarro_admin/``
beside the users file (the directory the operator already protects and backs
up, and the one that tells two servers apart). Everything it serves sits
behind :func:`guard.require_admin`.

``register_admin_routes`` is called from ``core.register_routes``. The
routes exist whether or not login is on; with login off every one answers
404 ``admin_requires_login``.
"""

import logging
import os

from ..auth import resolve_user_file

STATE_DIR_NAME = "annzarro_admin"

#: Overlay keys the admin interface may write and the server honours.
OVERLAY_KEYS = ("data_roots", "policy")


def state_dir(config, create=False):
    """The admin state directory for this configuration (0700 when created)."""
    users_dir = os.path.dirname(os.path.abspath(resolve_user_file(config.get("user_file") or "users.json")))
    path = os.path.join(users_dir, STATE_DIR_NAME)
    if create and not os.path.isdir(path):
        os.makedirs(path, mode=0o700, exist_ok=True)
        os.chmod(path, 0o700)
    return path


def reauth_minutes(config):
    """Minutes an admin's password confirmation lasts; 0 = never asked."""
    return float(config.get("admin_reauth_minutes", 30))


def rate_per_minute(config):
    """Admin mutations per minute per admin and worker (reads get eight times as many)."""
    return float(config.get("admin_rate_per_minute", 30))


def audit_max_mb(config):
    """Size at which the audit log rotates, in MB; 0 = never."""
    return float(config.get("admin_audit_max_mb", 50))


def validate_config(config):
    """Problems with the ``server.admin_*`` keys, one sentence each."""
    problems = []
    for key in ("admin_reauth_minutes", "admin_rate_per_minute", "admin_audit_max_mb"):
        value = config.get(key)
        if value is None:
            continue
        if isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0:
            problems.append(f"server.{key} must be a number >= 0, not {value!r}")
    if config.get("admin_rate_per_minute") == 0:
        problems.append("server.admin_rate_per_minute must be above 0 (the rate limit cannot be turned off)")
    roots = config.get("admin_data_roots")
    if roots is not None and (not isinstance(roots, (list, tuple))
                              or not all(isinstance(r, str) for r in roots)):
        problems.append(f"server.admin_data_roots must be a list of directories, not {roots!r}")
    return problems


def warn_about_proxy(config):
    """A hosted server that listens on loopback with login on is almost
    certainly behind a reverse proxy. Without ``server.proxy_count`` it sees
    its own http://127.0.0.1 origin, not the https:// one the browser sends,
    and the admin CSRF check refuses every change."""
    from .. import confinement
    if (config.get("auth_enabled") and not config.get("proxy_count", 0)
            and config.get("host") in ("127.0.0.1", "localhost", "::1")
            and confinement.is_hosted(config)):
        logging.getLogger(__name__).warning(
            "Admin interface: this server listens on %s with login on and server.proxy_count 0. "
            "Behind a reverse proxy that terminates TLS or rewrites Host, every admin change "
            "will fail with csrf_failed; set server.proxy_count to the number of proxies.",
            config.get("host"))


def register_admin_routes(app):
    """Register /admin and /api/v1/admin/* on ``app``."""
    from flask import Blueprint
    from . import pages, users, data_roots, health, panel_sets, settings, access, site_texts

    problems = validate_config(app.config)
    if problems:
        raise ValueError("; ".join(problems))
    warn_about_proxy(app.config)
    blueprint = Blueprint("admin", __name__)
    for section in (pages, users, data_roots, health, panel_sets, settings, access, site_texts):
        section.register(blueprint)
    app.register_blueprint(blueprint)
