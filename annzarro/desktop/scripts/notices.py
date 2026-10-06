"""Third-party notices for the desktop app's frozen server.

After PyInstaller has frozen the server, :func:`write_notices` reads what it
collected (its TOC files name the source of every module, library and data
file) and writes ``THIRD_PARTY_NOTICES/`` next to the executable:

* ``python/``: CPython's licence (PSF) and its acknowledgements for the
  software CPython incorporates;
* ``python-packages/<distribution>-<version>/``: every licence file of every
  pip distribution that contributed a file to the bundle (numpy's, for one,
  covers the OpenBLAS and GCC runtime libraries its wheel vendors);
* ``native/``: the licences of libraries copied from the build machine's
  Python installation or system (OpenSSL, libffi, zlib, ...), from
  ``annzarro/desktop/notices/``;
* ``README.txt``: an index.

A library nobody accounts for stops the build, and so does a library that
must not ship at all (GNU Readline and ncurses, GPL-3.0 / pulled in only by
the interactive ``readline`` module).
"""

import ast
import json
import fnmatch
import os
import re
import shutil
from pathlib import Path

NOTICES_SRC = Path(__file__).resolve().parents[1] / "notices"
OUT_NAME = "THIRD_PARTY_NOTICES"

#: Libraries that must never be in the bundle.
FORBIDDEN = [
    ("readline.cpython*", "Python's readline module links GNU Readline (GPL-3.0); "
     "freeze.EXCLUDES must keep it out"),
    ("readline.*.so", "Python's readline module links GNU Readline (GPL-3.0)"),
    ("libreadline*", "GNU Readline is GPL-3.0; only the interactive readline module needs it"),
    ("libhistory*", "GNU Readline's history library is GPL-3.0"),
    ("libtinfo*", "ncurses terminfo, needed only by readline/curses"),
    ("libncurses*", "ncurses, needed only by readline/curses"),
    ("libedit*", "libedit, needed only by readline"),
]

#: Native libraries from the build machine: (file pattern, component,
#: SPDX licence, notice files).
NATIVE = [
    ("libpython3*", "CPython", "PSF-2.0", ["python-LICENSE.txt"]),
    ("python3*.dll", "CPython", "PSF-2.0", ["python-LICENSE.txt"]),
    ("Python", "CPython", "PSF-2.0", ["python-LICENSE.txt"]),
    ("libssl*", "OpenSSL", "Apache-2.0", ["openssl-LICENSE.txt"]),
    ("libcrypto*", "OpenSSL", "Apache-2.0", ["openssl-LICENSE.txt"]),
    ("libffi*", "libffi", "MIT", ["libffi-LICENSE.txt"]),
    ("libz.*", "zlib", "Zlib", ["zlib-LICENSE.txt"]),
    ("zlib*.dll", "zlib", "Zlib", ["zlib-LICENSE.txt"]),
    ("libbz2*", "bzip2", "bzip2-1.0.6", ["bzip2-LICENSE.txt"]),
    ("liblzma*", "xz (liblzma)", "0BSD OR public domain", ["xz-COPYING.txt"]),
    ("libuuid*", "util-linux libuuid", "BSD-3-Clause", ["libuuid-BSD-3-Clause.txt"]),
    ("libexpat*", "Expat", "MIT", ["expat-COPYING.txt"]),
    ("libmpdec*", "libmpdec", "BSD-2-Clause", ["python-acknowledgements.txt"]),
    ("libstdc++*", "GCC runtime (libstdc++)", "GPL-3.0-or-later WITH GCC-exception-3.1",
     ["gpl-3.0.txt", "gcc-runtime-library-exception-3.1.txt"]),
    ("libgcc_s*", "GCC runtime (libgcc)", "GPL-3.0-or-later WITH GCC-exception-3.1",
     ["gpl-3.0.txt", "gcc-runtime-library-exception-3.1.txt"]),
    ("libgfortran*", "GCC runtime (libgfortran)", "GPL-3.0-or-later WITH GCC-exception-3.1",
     ["gpl-3.0.txt", "gcc-runtime-library-exception-3.1.txt"]),
    ("libquadmath*", "GCC libquadmath", "LGPL-2.1-or-later", ["lgpl-2.1.txt"]),
    ("libgomp*", "GCC runtime (libgomp)", "GPL-3.0-or-later WITH GCC-exception-3.1",
     ["gpl-3.0.txt", "gcc-runtime-library-exception-3.1.txt"]),
    ("libscipy_openblas*", "OpenBLAS", "BSD-3-Clause", ["openblas-LICENSE.txt"]),
    ("libopenblas*", "OpenBLAS", "BSD-3-Clause", ["openblas-LICENSE.txt"]),
    ("libaec*", "libaec", "BSD-2-Clause", ["libaec-LICENSE.txt"]),
    ("libsz*", "libaec (szip)", "BSD-2-Clause", ["libaec-LICENSE.txt"]),
    ("libcrc32c*", "google/crc32c", "BSD-3-Clause", ["crc32c-LICENSE.txt"]),
    ("VCRUNTIME140*.dll", "Microsoft Visual C++ runtime", "Microsoft redistributable",
     ["microsoft-vc-runtime.txt"]),
    ("MSVCP140*.dll", "Microsoft Visual C++ runtime", "Microsoft redistributable",
     ["microsoft-vc-runtime.txt"]),
    ("ucrtbase.dll", "Microsoft Universal C runtime", "Microsoft redistributable",
     ["microsoft-vc-runtime.txt"]),
    ("api-ms-win-*.dll", "Microsoft Universal C runtime", "Microsoft redistributable",
     ["microsoft-vc-runtime.txt"]),
]

#: Native libraries a pip wheel vendors: the notice of the library itself,
#: in addition to the distribution's own licence files.
WHEEL_VENDORED = [p for p in NATIVE if p[1] in (
    "OpenBLAS", "GCC runtime (libgfortran)", "GCC libquadmath", "GCC runtime (libgomp)",
    "libaec", "libaec (szip)", "google/crc32c", "zlib")]

#: Build tools. PyInstaller contributes its bootloader and runtime hooks,
#: which its licence lets anyone distribute under any terms (see README.txt);
#: the others are never frozen in.
TOOLING = {"pip", "setuptools", "wheel", "pyinstaller", "pyinstaller-hooks-contrib",
           "altgraph", "macholib", "pefile", "pywin32-ctypes"}

LICENCE_FILE = re.compile(r"^(licen[cs]e|copying|notice|authors?)([._-].*)?$", re.I)
NATIVE_SUFFIX = re.compile(r"\.(so(\.[0-9.]+)?|dylib|dll|pyd)$|^Python$", re.I)


def is_native(name):
    return bool(NATIVE_SUFFIX.search(name))


def forbidden(name):
    for pattern, why in FORBIDDEN:
        if fnmatch.fnmatch(name, pattern):
            return why
    return None


def native_entry(name, table=NATIVE):
    for entry in table:
        if fnmatch.fnmatch(name, entry[0]):
            return entry
    return None


def read_toc(path):
    """The entries of a PyInstaller TOC file: (name, source path, type)."""
    data = ast.literal_eval(Path(path).read_text())
    entries = []

    def walk(node):
        if isinstance(node, (list, tuple)):
            if len(node) == 3 and all(isinstance(x, str) for x in node):
                entries.append(tuple(node))
            else:
                for item in node:
                    walk(item)
    walk(data)
    return entries


class Distributions:
    """Which installed distribution a file under site-packages belongs to."""

    def __init__(self, site_packages):
        self.site = Path(site_packages).resolve()
        self.owner = {}
        self.dists = {}
        for info in self.site.glob("*.dist-info"):
            meta = (info / "METADATA").read_text(encoding="utf-8", errors="replace") \
                if (info / "METADATA").exists() else ""
            name = re.search(r"^Name: (.+)$", meta, re.M)
            version = re.search(r"^Version: (.+)$", meta, re.M)
            if not name:
                continue
            key = name.group(1).strip()
            self.dists[key] = {
                "version": version.group(1).strip() if version else "",
                "license": _licence_of(meta),
                "info": info,
            }
            record = info / "RECORD"
            if record.exists():
                for line in record.read_text(encoding="utf-8", errors="replace").splitlines():
                    rel = line.split(",", 1)[0]
                    if rel:
                        self.owner[os.path.normpath(rel)] = key

    def of(self, path):
        try:
            rel = os.path.normpath(str(Path(path).resolve().relative_to(self.site)))
        except ValueError:
            return None
        return self.owner.get(rel)

    def licence_files(self, key):
        info = self.dists[key]["info"]
        files = [p for p in info.rglob("*") if p.is_file() and (
            p.parent.name == "licenses" or "licenses" in p.relative_to(info).parts
            or LICENCE_FILE.match(p.name))]
        return sorted(files)


def _licence_of(meta):
    """A short licence name from wheel METADATA: the SPDX expression, else a
    short License field, else the classifiers."""
    expr = re.search(r"^License-Expression: (.+)$", meta, re.M)
    if expr:
        return expr.group(1).strip()
    field = re.search(r"^License: (.+)$", meta, re.M)
    if field and len(field.group(1)) <= 40 and "copyright" not in field.group(1).lower():
        return field.group(1).strip()
    classifiers = re.findall(r"^Classifier: License :: (?:OSI Approved :: )?(.+)$", meta, re.M)
    return " AND ".join(c.strip() for c in classifiers)


def write_notices(dist_dir, build_dir, site_packages, python_prefix, exe_name=None):
    """Write ``dist_dir/THIRD_PARTY_NOTICES`` and return the inventory.

    ``build_dir`` is PyInstaller's work directory for the spec (holding
    COLLECT-00.toc and PYZ-00.toc), ``site_packages`` the build venv's,
    ``python_prefix`` the base Python installation (``sys.base_prefix``),
    ``exe_name`` the launcher executable's file name.

    The inventory (also ``inventory.json``) has one entry per component:
    its licence, how it is shipped and the bundle files that are its.
    """
    dist_dir, build_dir = Path(dist_dir), Path(build_dir)
    out = dist_dir / OUT_NAME
    if out.exists():
        shutil.rmtree(out)
    for sub in ("python", "python-packages", "native", "launcher"):
        (out / sub).mkdir(parents=True)

    dists = Distributions(site_packages)
    prefix = Path(python_prefix).resolve()
    used_dists, natives, cpython_files, problems = {}, {}, set(), []

    def bundle_path(name, kind):
        # PyInstaller puts COLLECT entries under _internal/; modules in the
        # PYZ archive live inside the executable.
        return f"{exe_name or 'launcher'}:{name}" if kind == "PYMODULE" else f"_internal/{name}"

    entries = read_toc(build_dir / "COLLECT-00.toc") + read_toc(build_dir / "PYZ-00.toc")
    for name, source, kind in entries:
        if not source or source == "-" or not os.path.isabs(source):
            continue
        base = os.path.basename(name)
        why = forbidden(base)
        if why:
            problems.append(f"{name}: must not be bundled ({why})")
            continue
        path = bundle_path(name, kind)
        owner = dists.of(source)
        if owner:
            if owner not in TOOLING:
                used_dists.setdefault(owner, set()).add(path)
            if is_native(base):
                vendored = native_entry(base, WHEEL_VENDORED)
                if vendored:
                    natives.setdefault(vendored[1], (vendored, set(), owner))[1].add(path)
            continue
        entry = native_entry(base) if is_native(base) else None
        if entry:
            natives.setdefault(entry[1], (entry, set(), None))[1].add(path)
        elif _under(source, prefix):
            cpython_files.add(path)  # stdlib module, extension module or data of CPython
        elif not is_native(base):
            cpython_files.add(path)
        else:
            problems.append(f"{name} (from {source}): no licence notice known; add it to "
                            "NATIVE in annzarro/desktop/scripts/notices.py")
    if problems:
        raise SystemExit("third-party notices:\n  " + "\n  ".join(problems))

    inventory = []
    # CPython itself, always
    python_licence = next((p for p in (prefix / "LICENSE.txt",
                                        prefix / "lib" / f"python{_pyver(prefix)}" / "LICENSE.txt",
                                        prefix / "LICENSE") if p.is_file()), None)
    shutil.copy(python_licence or NOTICES_SRC / "python-LICENSE.txt", out / "python" / "LICENSE.txt")
    shutil.copy(NOTICES_SRC / "python-acknowledgements.txt",
                out / "python" / "acknowledgements-for-incorporated-software.txt")
    inventory.append({"component": "CPython (standard library, extension modules)",
                      "licence": "PSF-2.0", "shipped": "Python modules in the launcher and _internal",
                      "notice": "python/", "files": sorted(cpython_files)})

    for key in sorted(used_dists, key=str.lower):
        d = dists.dists[key]
        folder = out / "python-packages" / f"{key}-{d['version']}"
        folder.mkdir()
        files = dists.licence_files(key)
        for f in files:
            rel = f.relative_to(d["info"])
            target = folder / Path(*[p for p in rel.parts if p != "licenses"] or [f.name])
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(f, target)
        if not files:
            (folder / "NO-LICENSE-FILE.txt").write_text(
                f"{key} {d['version']} ships no licence file in its wheel; its metadata "
                f"declares: {d['license'] or 'nothing'}.\n")
        inventory.append({"component": f"{key} {d['version']}", "licence": d["license"] or "UNKNOWN",
                          "shipped": "Python package (pip wheel)",
                          "notice": f"python-packages/{folder.name}/",
                          "files": sorted(used_dists[key])})

    for component in sorted(natives):
        (pattern, comp, spdx, files), names, owner = natives[component]
        for f in files:
            shutil.copy(NOTICES_SRC / f, out / "native" / f)
        how = (f"separate shared library from the {owner} wheel" if owner
               else "separate shared library from the build machine's Python or system")
        inventory.append({"component": comp, "licence": spdx, "shipped": how,
                          "notice": ", ".join(f"native/{f}" for f in files),
                          "files": sorted(names)})

    # The launcher executable is PyInstaller's bootloader.
    pyi = dists.dists.get("pyinstaller") or dists.dists.get("PyInstaller")
    if pyi:
        for f in dists.licence_files("pyinstaller" if "pyinstaller" in dists.dists else "PyInstaller"):
            shutil.copy(f, out / "launcher" / f.name)
    inventory.append({"component": f"PyInstaller bootloader {pyi['version'] if pyi else ''}".strip(),
                      "licence": "GPL-2.0-or-later WITH PyInstaller-bootloader-exception",
                      "shipped": "launcher executable", "notice": "launcher/",
                      "files": [exe_name] if exe_name else []})

    (out / "inventory.json").write_text(json.dumps(inventory, indent=1) + "\n", encoding="utf-8")
    lines = [
        "Third-party software in the AnnZarro desktop app's server",
        "",
        "The server bundles CPython, the Python packages and the native libraries",
        "below. Each keeps its own licence; the texts are in this folder. AnnZarro",
        "itself is MIT (../LICENSE in the app's resources); the web interface's",
        "libraries are listed in _internal/annzarro/THIRD_PARTY_LICENSES/. Electron",
        "and Chromium: LICENSE.electron.txt and LICENSES.chromium.html in the app.",
        "The executable's launcher is PyInstaller's bootloader (GPL-2.0-or-later",
        "with the PyInstaller exception, which permits distributing it with any",
        "program under any licence). Every native library is a separate file that",
        "can be replaced. inventory.json lists every bundled file by component.",
        "",
    ]
    rows = [(e["component"], e["licence"], e["notice"]) for e in inventory]
    width = max(len(r[0]) for r in rows)
    lic_width = max(len(r[1]) for r in rows)
    for comp, spdx, where in rows:
        lines.append(f"{comp.ljust(width)}  {spdx.ljust(lic_width)}  {where}")
    (out / "README.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return inventory


def _under(path, prefix):
    try:
        Path(path).resolve().relative_to(prefix)
        return True
    except ValueError:
        return False


def _pyver(prefix):
    for p in sorted((prefix / "lib").glob("python3.*")):
        return p.name[len("python"):]
    return ""
