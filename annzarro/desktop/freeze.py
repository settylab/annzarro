"""
What the desktop app's frozen server contains.

The desktop app does not need Python on the user's machine: each release
ships ``annzarro-server``, the ``annzarro`` command frozen with PyInstaller
(``annzarro/desktop/server/annzarro-server.spec``), and the Electron shell
runs ``annzarro-server start`` on a free 127.0.0.1 port.

The spec takes its file lists from here so that a test can check them
without running PyInstaller. Nothing in this module imports PyInstaller.
"""

import os
from pathlib import Path

from annzarro.utils import paths

#: Name of the frozen executable (``annzarro-server.exe`` on Windows) and of
#: the directory it sits in, inside the app's resources.
SERVER_NAME = "annzarro-server"

#: Packages that are dependencies of annzarro but are never imported by the
#: server (numba/llvmlite and matplotlib alone are ~170 MB), and tooling that
#: happens to be installed next to it. A test checks the server does not
#: import them.
EXCLUDES = [
    "numba",
    "llvmlite",
    "matplotlib",
    "PIL",
    "tkinter",
    "_tkinter",
    "IPython",
    "jupyter_client",
    "notebook",
    "pytest",
    "setuptools",
    "pip",
    "PyInstaller",
]

#: Subpackages of annzarro that the server never imports.
EXCLUDED_SUBPACKAGES = ("annzarro.tests", "annzarro.desktop")

#: Distributions whose metadata is read at run time:
#: ``annzarro.__version__`` comes from ``importlib.metadata``, and zarr finds
#: codecs through entry points.
METADATA = ["annzarro", "zarr", "numcodecs", "donfig"]


def _files_under(root: Path, dest: str, suffixes=None):
    out = []
    for dirpath, dirnames, filenames in os.walk(root, followlinks=True):
        dirnames[:] = [d for d in dirnames if d not in ("__pycache__", "node_modules")]
        rel = os.path.relpath(dirpath, root)
        target = dest if rel == "." else os.path.join(dest, rel)
        for name in filenames:
            if name.startswith(".") or (suffixes and not name.endswith(suffixes)):
                continue
            out.append((os.path.join(dirpath, name), target))
    return out


def datas():
    """(source file, destination directory) pairs for PyInstaller ``datas``.

    Destinations mirror an installed wheel (``annzarro/config``,
    ``annzarro/static``, ``annzarro/templates`` ...), which is where
    :mod:`annzarro.utils.paths` looks first, so the frozen server finds its
    defaults and frontend the same way a pip-installed one does. Works from a
    source checkout (frontend at the repository root) and from an installed
    wheel (frontend inside the package).
    """
    pkg = paths.PACKAGE_DIR
    out = []
    out += _files_under(paths.DEFAULTS_DIR, "annzarro/config", suffixes=(".yaml",))
    out += _files_under(pkg / "THIRD_PARTY_LICENSES", "annzarro/THIRD_PARTY_LICENSES")
    out += _files_under(paths.frontend_dir("static"), "annzarro/static")
    out += _files_under(paths.frontend_dir("templates"), "annzarro/templates", suffixes=(".html",))
    for license_file in (pkg / "LICENSE", pkg.parent / "LICENSE"):
        if license_file.is_file():
            out.append((str(license_file), "."))
            break
    return out


def hiddenimports():
    """Every annzarro module the server may import, by name.

    Routes and readers are imported inside functions in places, which
    PyInstaller's static analysis can miss.
    """
    out = []
    for dirpath, dirnames, filenames in os.walk(paths.PACKAGE_DIR):
        dirnames[:] = [d for d in dirnames if d != "__pycache__"]
        rel = os.path.relpath(dirpath, paths.PACKAGE_DIR.parent)
        package = rel.replace(os.sep, ".")
        if not os.path.isfile(os.path.join(dirpath, "__init__.py")):
            dirnames[:] = []
            continue
        if package.startswith(EXCLUDED_SUBPACKAGES):
            dirnames[:] = []
            continue
        out.append(package)
        out += [f"{package}.{f[:-3]}" for f in filenames
                if f.endswith(".py") and f != "__init__.py"]
    return sorted(out)
