#!/usr/bin/env python3
"""Freeze the AnnZarro server for the desktop app.

Creates a clean virtual environment, installs this checkout into it as a
wheel (so the frontend, vendored libraries and configuration defaults land
where an installed annzarro has them) together with PyInstaller, and freezes
``annzarro/desktop/server/annzarro-server.spec`` into
``annzarro/desktop/electron/server/annzarro-server/``, which electron-builder
then ships as a resource.

Run it with the Python the server should be frozen with (3.11 in CI); the
result runs only on the platform and architecture it was built on.

    python annzarro/desktop/scripts/build_server.py
"""

import argparse
import os
import shutil
import subprocess
import sys
import venv
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
DESKTOP = REPO / "annzarro" / "desktop"
SPEC = DESKTOP / "server" / "annzarro-server.spec"
BUILD = DESKTOP / "build"
DIST = DESKTOP / "electron" / "server"
NAME = "annzarro-server"


def run(cmd, **kw):
    print("+", " ".join(str(c) for c in cmd), flush=True)
    subprocess.run([str(c) for c in cmd], check=True, **kw)


def venv_python(path: Path) -> Path:
    return path / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def strip_debug_symbols(root: Path):
    """Remove debug sections from the Linux bundle's shared objects.

    The manylinux wheels and setup-python's libpython ship with debug info
    (numcodecs' extensions alone are 34 MB, 3 MB on macOS). Libraries that
    auditwheel rewrote with patchelf (the ``*.libs`` directories, and
    extensions whose RPATH points there) are left alone: strip corrupts them
    ("ELF load command address/offset not page-aligned"), which is why
    PyInstaller's own strip option stays off.
    """
    saved = 0
    for path in root.rglob("*"):
        if not path.is_file() or path.is_symlink():
            continue
        if not (".so" in path.suffixes or path.name.startswith("libpython")):
            continue
        if any(part.endswith(".libs") for part in path.relative_to(root).parts):
            continue
        dyn = subprocess.run(["readelf", "-d", str(path)], capture_output=True, text=True).stdout
        if ".libs" in dyn and ("RPATH" in dyn or "RUNPATH" in dyn):
            continue
        before = path.stat().st_size
        if subprocess.run(["strip", "--strip-debug", str(path)]).returncode == 0:
            saved += before - path.stat().st_size
    print(f"Stripped debug symbols: {saved / 1048576:.1f} MB")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--reuse-venv", action="store_true",
                        help="Keep an existing build environment instead of recreating it")
    args = parser.parse_args(argv)

    env_dir = BUILD / "server-venv"
    if env_dir.exists() and not args.reuse_venv:
        shutil.rmtree(env_dir)
    if not env_dir.exists():
        # Symlinks as `python -m venv` makes them: a copied interpreter cannot
        # find its libpython on some macOS builds.
        venv.create(env_dir, with_pip=True, symlinks=os.name != "nt")
    py = venv_python(env_dir)
    run([py, "-m", "pip", "install", "--upgrade", "pip"])
    # Not editable: the frozen server must see the installed layout.
    run([py, "-m", "pip", "install", str(REPO), "pyinstaller>=6.10"])

    out = DIST / NAME
    if out.exists():
        shutil.rmtree(out)
    # Run from the build directory, never the repository root, so PyInstaller
    # analyses the installed annzarro rather than the checkout on sys.path[0].
    BUILD.mkdir(parents=True, exist_ok=True)
    run([py, "-m", "PyInstaller", "--noconfirm", "--clean",
         "--distpath", DIST, "--workpath", BUILD / "pyinstaller", SPEC], cwd=BUILD)

    if sys.platform.startswith("linux"):
        strip_debug_symbols(out)

    # Record exactly what was frozen, next to the binary.
    freeze = subprocess.run([str(py), "-m", "pip", "freeze", "--exclude-editable"],
                            check=True, capture_output=True, text=True).stdout
    (out / "server-requirements.txt").write_text(freeze)

    exe = out / (NAME + (".exe" if os.name == "nt" else ""))
    if not exe.is_file():
        sys.exit(f"error: PyInstaller did not produce {exe}")
    print(f"Frozen server: {exe}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
