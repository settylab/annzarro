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
  overridable with ``ANNZARRO_HOME``. It is never the package directory.
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


def default_data_dir() -> str:
    """The unconfigured data directory, expanded (``~/annzarro-data``)."""
    return os.path.expanduser(DEFAULT_DATA_DIR)


#: Environment variable that relocates the per-user state directory.
STATE_DIR_ENV = "ANNZARRO_HOME"


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


def user_state_dir() -> Path:
    """Per-user directory for logs, the PID file and other runtime state."""
    override = os.environ.get(STATE_DIR_ENV)
    if override:
        return Path(override).expanduser()
    return Path.home() / ".annzarro"


def user_config_path() -> Path:
    """Per-user configuration file (XDG convention, ``~/.config/annzarro/config.yaml``)."""
    base = os.environ.get("XDG_CONFIG_HOME") or str(Path.home() / ".config")
    return Path(base).expanduser() / "annzarro" / "config.yaml"


def default_log_file() -> Path:
    return user_state_dir() / "logs" / "annzarro_server.log"


def pid_file() -> Path:
    return user_state_dir() / "server.pid"
