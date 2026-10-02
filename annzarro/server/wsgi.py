"""
WSGI entry point for running AnnZarro under gunicorn (or any WSGI server)
-------------------------------------------------------------------------

    gunicorn -w 4 -b 127.0.0.1:8000 "annzarro.server.wsgi:create_wsgi_app()"

``annzarro start`` decides whether to require login from the address it binds
to. Under gunicorn the app never sees that address, so the old entry point
(``create_app()`` with no configuration) ran with DEFAULT_CONFIG: login off,
paths unconfined, and no warning -- while gunicorn listened on 0.0.0.0. This
factory closes that hole:

* it loads the same merged configuration as ``annzarro start`` (base,
  environment, /etc, ~/.config, ./config.yaml, then ``ANNZARRO_CONFIG`` and
  ``ANNZARRO_*`` environment overrides), environment ``ANNZARRO_ENV``
  (default ``production``);
* it is HOSTED by default (``server.hosted: true``): dataset paths are
  confined to the data directory and the remote-store policy for shared
  servers applies;
* login is ON unless the configuration says ``auth.enabled: false`` (or
  ``ANNZARRO_AUTH_DISABLED`` is set). That remains possible, and logs the
  same SECURITY banner as an exposed ``annzarro start``.
"""

import logging
import os

from .core import create_app

logger = logging.getLogger(__name__)


def load_hosted_config(config_path=None, env=None):
    """The flat Flask configuration a hosted (WSGI) server runs with.

    Args:
        config_path: Extra configuration file; defaults to ``$ANNZARRO_CONFIG``.
        env: ``development`` or ``production``; defaults to ``$ANNZARRO_ENV``
            or ``production``.

    Raises:
        RuntimeError: if the merged configuration does not validate.
    """
    from annzarro.utils.config_manager import ConfigManager

    manager = ConfigManager()
    env = env or os.environ.get("ANNZARRO_ENV", "production")
    config_path = config_path or os.environ.get("ANNZARRO_CONFIG")
    merged = manager.load_config(env=env, config_path=config_path)

    valid, errors = manager.validate_config()
    if not valid:
        raise RuntimeError("Invalid AnnZarro configuration: " + "; ".join(errors))

    flask_config = manager.to_flask_config()
    flask_config.pop("__using_config_manager", None)

    auth = merged.get("auth") or {}
    if os.environ.get("ANNZARRO_AUTH_DISABLED"):
        auth_enabled = False
    elif "enabled" in auth:
        auth_enabled = bool(auth["enabled"])
    else:
        auth_enabled = True
        logger.info("WSGI: login enabled by default (set auth.enabled: false to disable)")
    flask_config["auth_enabled"] = auth_enabled
    flask_config.setdefault("user_file", auth.get("user_file", "users.json"))

    hosted = (merged.get("server") or {}).get("hosted")
    flask_config["hosted"] = True if hosted is None else bool(hosted)
    return flask_config


def create_wsgi_app(config_path=None, env=None):
    """Build the Flask app for a WSGI server: hosted, login on by default."""
    return create_app(load_hosted_config(config_path=config_path, env=env))
