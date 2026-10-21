"""
Filesystem locations AnnZarro reads from and writes to.

One rule governs this module: nothing here depends on the current working
directory. A pip-installed AnnZarro must behave the same whether it is launched
from a source checkout, from a home directory or from ``/``.

* Read-only resources (built-in configuration defaults, the web frontend) are
  located relative to this package. A wheel ships them inside the package; a
  source checkout keeps the frontend at the repository root, so that is the
  fallback.
* Writable runtime state (logs, PID file, generated secrets, the default user
  database) goes to a per-user state directory, ``~/.annzarro`` by default,
  overridable with ``server.state_dir`` (``--state-dir``,
  ``ANNZARRO_SERVER_STATE_DIR``, or the older alias ``ANNZARRO_HOME``). It is
  never the package directory.
"""

import os
from pathlib import Path

PACKAGE_DIR = Path(__file__).resolve().parent.parent

#: Built-in configuration defaults (``base.yaml``, ``<env>.yaml``, ``schema.yaml``).
DEFAULTS_DIR = PACKAGE_DIR / "config"

#: The data directory when none is configured: the same folder the desktop
#: app uses. It used to be "data", i.e. relative to wherever annzarro was
#: started, so `annzarro start` in $HOME created and served ~/data.
DEFAULT_DATA_DIR = "~/annzarro-data"


#: The state directory when none is configured.
DEFAULT_STATE_DIR = "~/.annzarro"


def default_data_dir() -> str:
    """The unconfigured data directory, expanded (``~/annzarro-data``)."""
    return os.path.expanduser(DEFAULT_DATA_DIR)


#: Environment variable that relocates the per-user state directory (the
#: older name; ``ANNZARRO_SERVER_STATE_DIR`` is the configuration key's own).
STATE_DIR_ENV = "ANNZARRO_HOME"
STATE_DIR_ENVS = ("ANNZARRO_SERVER_STATE_DIR", STATE_DIR_ENV)

def systemd_dir(name: str):
    """The directory systemd hands a service in ``$STATE_DIRECTORY`` / ``$CACHE_DIRECTORY``
    (``StateDirectory=`` / ``CacheDirectory=``), or None. Several directories arrive colon
    separated; the first is the service's own."""
    first = os.environ.get(name, "").split(":")[0].strip()
    return first if first.startswith("/") else None


# Set once configuration is loaded (or by ``--state-dir`` for commands that
# load none, like ``annzarro stop``); None = decide from the environment.
_state_dir = None
_panel_sets_dir = None
_cache_dir = None


def frontend_dir(name: str) -> Path:
    """Return the directory holding the frontend's ``static`` or ``templates``.

    A wheel installs them inside the package (``annzarro/static``); a source
    checkout keeps them at the repository root (``<repo>/static``).
    """
    if name not in ("static", "templates"):
        raise ValueError(f"unknown frontend directory: {name!r}")
    packaged = PACKAGE_DIR / name
    if packaged.is_dir():
        return packaged
    return PACKAGE_DIR.parent / name


def source_checkout_root():
    """Return the repository root when running from a source checkout, else None."""
    root = PACKAGE_DIR.parent
    if (root / "pyproject.toml").is_file() and (root / "annzarro" / "cli.py").is_file():
        return root
    return None


def state_env_conflict():
    """``(name, value)`` pairs when ``ANNZARRO_HOME`` and ``ANNZARRO_SERVER_STATE_DIR``
    are both set and name different folders, else an empty list."""
    found = [(name, os.environ[name]) for name in STATE_DIR_ENVS if os.environ.get(name)]
    if len(found) == 2 and (os.path.abspath(os.path.expanduser(found[0][1]))
                            != os.path.abspath(os.path.expanduser(found[1][1]))):
        return found
    return []


def set_state_dir(path, panel_sets_dir=None, cache_dir=None) -> None:
    """Fix the state directory (and, if given, panel-set and cache directories)
    from the loaded configuration or ``--state-dir``. ``None`` goes back to the
    environment and the default."""
    global _state_dir, _panel_sets_dir, _cache_dir
    _state_dir = Path(path).expanduser() if path else None
    _panel_sets_dir = Path(panel_sets_dir).expanduser() if panel_sets_dir else None
    _cache_dir = Path(cache_dir).expanduser() if cache_dir else None


def user_state_dir() -> Path:
    """Directory for logs, the PID file and other runtime state."""
    if _state_dir is not None:
        return _state_dir
    for name in STATE_DIR_ENVS:
        override = os.environ.get(name)
        if override:
            return Path(override).expanduser()
    return Path.home() / ".annzarro"


def panel_sets_dir() -> Path:
    """Where panel sets live: ``server.panel_sets_dir``, else ``<state dir>/panel-sets``."""
    return _panel_sets_dir if _panel_sets_dir is not None else user_state_dir() / "panel-sets"


def cache_dir() -> Path:
    """Disposable caches: ``server.cache_dir``, else ``<state dir>/cache``."""
    return _cache_dir if _cache_dir is not None else user_state_dir() / "cache"


def locations_inside_data_roots(server: dict):
    """State, panel-set and cache directories that lie inside a data root, as
    ``(label, path, root)``. Symlinks are followed; a directory equal to a root
    counts as inside. ``server`` is the merged ``server`` section."""
    def real(p):
        return os.path.realpath(os.path.expanduser(str(p)))

    roots = [server.get("data_dir")] + list(server.get("allowed_dirs") or []) \
        + list(server.get("admin_data_roots") or [])
    roots = [real(r) for r in roots if isinstance(r, str) and r]
    found = []
    for label, key in (("state directory", "state_dir"), ("panel-sets directory", "panel_sets_dir"),
                       ("cache directory", "cache_dir")):
        value = server.get(key)
        if not value:
            continue
        path = real(value)
        # a cache or panel-sets directory under a refused state directory adds nothing
        if any(path.startswith(f[1].rstrip(os.sep) + os.sep) for f in found):
            continue
        for root in roots:
            if path == root or path.startswith(root.rstrip(os.sep) + os.sep):
                found.append((f"server.{key}", path, root))
                break
    return found


def state_dir_warnings(server: dict):
    """Readable warnings about state kept inside a data root. Not refusals: a data directory
    that holds ``~/.annzarro`` (``--data-dir ~``) has always worked."""
    return [f"{key} ({path}) lies inside the data root {root}. AnnZarro writes users, logs, "
            "panel sets and caches there, and a data root is better read-only and shared without "
            "that state. Move it with --state-dir or the config key; the folder is left out of "
            "dataset listings." for key, path, root in locations_inside_data_roots(server)]


def user_config_path() -> Path:
    """Per-user configuration file (XDG convention, ``~/.config/annzarro/config.yaml``)."""
    base = os.environ.get("XDG_CONFIG_HOME") or str(Path.home() / ".config")
    return Path(base).expanduser() / "annzarro" / "config.yaml"


def default_log_file() -> Path:
    return user_state_dir() / "logs" / "annzarro_server.log"


def pid_file() -> Path:
    return user_state_dir() / "server.pid"
