#!/usr/bin/env python3
"""Check the licences of everything in a built desktop app; print the inventory.

    python annzarro/desktop/scripts/licence_check.py APP_DIR [--json out.json]

APP_DIR is the unpacked app as users get it: the Linux install folder
(/opt/AnnZarro from the .deb, or the AppImage's squashfs-root), the Windows
folder (win-unpacked), or AnnZarro.app. Every executable or shared library in
it (found by its ELF / Mach-O / PE header, not its name) must be accounted
for:

* in the server, by server/THIRD_PARTY_NOTICES/inventory.json, which
  build_server.py writes from what PyInstaller collected;
* elsewhere, by the Electron/Chromium file list below.

The check fails when a file is unaccounted for, a licence is GPL or AGPL
(without an exception that permits distribution in other programs) or
unknown, an LGPL library is not a separate, replaceable shared library, a
server library links GNU Readline or ncurses, or a required notice file is
missing. Python package licences come from their wheel metadata.
"""

import argparse
import fnmatch
import json
import os
import sys
from pathlib import Path

#: Executables and libraries of Electron itself, by file name.
#: (pattern, component, licence, how shipped)
CHROMIUM = ("MIT (Electron) AND BSD-3-Clause (Chromium) AND others in LICENSES.chromium.html, "
            "including LGPL-2.1 code of Blink statically linked")
ELECTRON = [
    ("AnnZarro", "Electron / Chromium (app executable)", CHROMIUM, "Electron executable"),
    ("AnnZarro.exe", "Electron / Chromium (app executable)", CHROMIUM, "Electron executable"),
    ("annzarro-desktop", "Electron / Chromium (app executable)", CHROMIUM, "Electron executable"),
    ("AnnZarro Helper*", "Electron helper (macOS launcher stub; Chromium code is in Electron Framework)",
     "MIT AND BSD-3-Clause", "Electron helper executable"),
    ("Electron Framework", "Electron / Chromium (framework)", CHROMIUM, "Electron framework"),
    ("chrome_crashpad_handler", "Crashpad", "Apache-2.0", "separate executable"),
    ("chrome-sandbox", "Chromium setuid sandbox", "BSD-3-Clause", "separate executable"),
    ("libffmpeg.so", "FFmpeg (Chromium build, no GPL parts)", "LGPL-2.1-or-later",
     "separate shared library"),
    ("libffmpeg.dylib", "FFmpeg (Chromium build, no GPL parts)", "LGPL-2.1-or-later",
     "separate shared library"),
    ("ffmpeg.dll", "FFmpeg (Chromium build, no GPL parts)", "LGPL-2.1-or-later",
     "separate shared library"),
    ("libvk_swiftshader.*", "SwiftShader", "Apache-2.0", "separate shared library"),
    ("vk_swiftshader.dll", "SwiftShader", "Apache-2.0", "separate shared library"),
    ("libvulkan.so*", "Vulkan loader", "Apache-2.0", "separate shared library"),
    ("vulkan-1.dll", "Vulkan loader", "Apache-2.0", "separate shared library"),
    ("libEGL*", "ANGLE", "BSD-3-Clause", "separate shared library"),
    ("libGLESv2*", "ANGLE", "BSD-3-Clause", "separate shared library"),
    ("d3dcompiler_47.dll", "Microsoft D3D compiler", "Microsoft redistributable",
     "separate shared library"),
    ("dxil.dll", "Microsoft DXIL signer", "Microsoft redistributable", "separate shared library"),
    ("dxcompiler.dll", "DirectX Shader Compiler", "NCSA AND MIT", "separate shared library"),
    ("AppRun", "AppImage runtime (AppRun)", "MIT", "AppImage launcher"),
    ("libXss.so*", "libXScrnSaver (X11)", "MIT", "separate shared library (AppImage only)"),
    ("libXtst.so*", "libXtst (X11)", "MIT", "separate shared library (AppImage only)"),
    ("elevate.exe", "electron-builder elevate helper", "MIT", "separate executable"),
    ("Mantle", "Mantle (macOS updater framework)", "MIT", "separate framework"),
    ("ReactiveObjC", "ReactiveObjC (macOS updater framework)", "MIT", "separate framework"),
    ("Squirrel", "Squirrel.Mac (updater framework)", "MIT", "separate framework"),
    ("ShipIt", "Squirrel.Mac (updater framework)", "MIT", "separate executable"),
]

#: Statically linked LGPL accepted in exactly these files: the Electron
#: executable (and, on macOS, the Electron Framework it consists of), which
#: contains Chromium's LGPL WebKit/Blink code. Operator decision 2026-10-07:
#: standard Electron practice, with LICENSES.chromium.html shipped. Any other
#: LGPL that is not a separate shared library fails the check.
LGPL_STATIC_ALLOWED = {"AnnZarro", "AnnZarro.exe", "annzarro-desktop", "Electron Framework"}
LGPL_STATIC_VERDICT = ("lgpl-static (Chromium/Blink, accepted: standard Electron practice, "
                       "LICENSES.chromium.html shipped)")

#: Notices every app must carry, relative to its resources folder (macOS)
#: or install folder (Windows, Linux); per platform.
REQUIRED = {
    "linux": ["LICENSE.electron.txt", "LICENSES.chromium.html", "resources/LICENSE",
              "resources/server/THIRD_PARTY_NOTICES/README.txt"],
    "win": ["LICENSE.electron.txt", "LICENSES.chromium.html", "resources/LICENSE",
            "resources/server/THIRD_PARTY_NOTICES/README.txt"],
    "mac": ["Contents/Resources/LICENSE.electron.txt", "Contents/Resources/LICENSES.chromium.html",
            "Contents/Resources/LICENSE", "Contents/Resources/LICENSES.macos-frameworks.txt",
            "Contents/Resources/server/THIRD_PARTY_NOTICES/README.txt"],
}

#: Byte strings that show a library links GNU Readline or ncurses.
BANNED_LINKS = (b"libreadline.so", b"libreadline.", b"libhistory.so", b"libtinfo.so",
                b"libncurses.so", b"libncursesw.so")

PERMISSIVE = ("mit", "bsd", "apache", "isc", "zlib", "psf", "python software foundation",
              "0bsd", "public domain", "unlicense", "cc0", "bzip2", "microsoft redistributable",
              "ncsa", "blueoak", "hpnd")


def classify(licence):
    """'ok', 'exception' (GPL with a distribution exception), 'lgpl', 'gpl' or 'unknown'."""
    low = licence.lower()
    if "gcc-exception" in low or "bootloader-exception" in low:
        return "exception"
    if "lgpl" in low or "lesser general public" in low:
        return "lgpl"
    if "gpl" in low or "general public license" in low:
        return "gpl"
    return "ok" if any(word in low for word in PERMISSIVE) else "unknown"


def binary_kind(path):
    try:
        with open(path, "rb") as f:
            head = f.read(4)
    except OSError:
        return None
    if head == b"\x7fELF":
        return "ELF"
    if head in (b"\xcf\xfa\xed\xfe", b"\xce\xfa\xed\xfe", b"\xca\xfe\xba\xbe", b"\xfe\xed\xfa\xcf"):
        return "Mach-O"
    if head[:2] == b"MZ":
        return "PE"
    return None


def platform_of(app):
    if app.suffix == ".app" or (app / "Contents" / "MacOS").is_dir():
        return "mac"
    return "win" if (app / "resources").is_dir() and any(app.glob("*.exe")) else "linux"


def server_dir(app, plat):
    return app / ("Contents/Resources/server" if plat == "mac" else "resources/server")


def check(app):
    app = Path(app)
    plat = platform_of(app)
    server = server_dir(app, plat)
    failures, rows = [], []

    required = list(REQUIRED[plat])
    if (app / "usr" / "lib").is_dir():  # an AppImage with electron-builder's libraries
        required.append("LICENSES.appimage-libraries.txt")
    for rel in required:
        if not (app / rel).is_file():
            failures.append(f"missing notice file: {rel}")

    inv_path = server / "THIRD_PARTY_NOTICES" / "inventory.json"
    inventory = json.loads(inv_path.read_text()) if inv_path.is_file() else []
    if not inventory:
        failures.append(f"missing or empty {inv_path.relative_to(app)}")
    owner = {}
    for entry in inventory:
        verdict = classify(entry["licence"])
        natives = [f for f in entry["files"] if not f.startswith(("annzarro-server:", "launcher:"))]
        rows.append((entry["component"], entry["licence"], entry["shipped"], verdict, len(entry["files"])))
        for f in entry["files"]:
            owner[f] = entry
        if verdict in ("gpl", "unknown"):
            failures.append(f"server: {entry['component']}: licence {entry['licence']!r} is {verdict}")
        if verdict == "lgpl" and not all(_is_library(f) for f in natives):
            failures.append(f"server: {entry['component']} is LGPL but not a separate shared library")

    # Every binary in the server must be in the inventory, and none may link
    # GNU Readline or ncurses.
    exe_names = {"annzarro-server", "annzarro-server.exe"}
    for path in sorted(server.rglob("*")):
        if path.is_symlink() or not path.is_file():
            continue
        rel = path.relative_to(server).as_posix()
        if rel.startswith("THIRD_PARTY_NOTICES/"):
            continue
        kind = binary_kind(path)
        if not kind:
            continue
        if rel not in owner and rel not in exe_names:
            failures.append(f"server: {rel} ({kind}) is not in the inventory")
        data = path.read_bytes()
        for banned in BANNED_LINKS:
            if banned in data:
                failures.append(f"server: {rel} refers to {banned.decode()} (GNU Readline/ncurses)")
                break

    # Everything else: Electron's own files.
    electron = {}
    for path in sorted(app.rglob("*")):
        if path.is_symlink() or not path.is_file() or server in path.parents:
            continue
        kind = binary_kind(path)
        if not kind:
            continue
        entry = next((e for e in ELECTRON
                      if fnmatch.fnmatchcase(path.name.lower(), e[0].lower())), None)
        rel = path.relative_to(app).as_posix()
        if not entry:
            failures.append(f"app: {rel} ({kind}) is not a known Electron file")
            continue
        electron.setdefault(entry[1:], []).append(rel)
    for (component, licence, shipped), files in sorted(electron.items()):
        verdict = classify(licence)
        if verdict == "lgpl" and not shipped.startswith("separate shared library"):
            if all(os.path.basename(f) in LGPL_STATIC_ALLOWED for f in files):
                verdict = LGPL_STATIC_VERDICT
            else:
                failures.append(f"app: {component} ({', '.join(files)}) is LGPL but not a "
                                "separate shared library")
        rows.append((component, licence, shipped, verdict, len(files)))
        if verdict in ("gpl", "unknown"):
            failures.append(f"app: {component}: licence {licence!r} is {verdict}")
    return plat, rows, failures


def _is_library(name):
    base = os.path.basename(name)
    return base.endswith((".dll", ".dylib", ".pyd")) or ".so" in base


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("app", help="unpacked app: /opt/AnnZarro, squashfs-root, win-unpacked or AnnZarro.app")
    p.add_argument("--json", help="also write the inventory and verdict here")
    args = p.parse_args(argv)
    plat, rows, failures = check(args.app)
    w = [max(len(str(r[i])) for r in rows) if rows else 10 for i in range(4)]
    print(f"Licence inventory of {args.app} ({plat})")
    print(f"{'component'.ljust(w[0])}  {'licence'.ljust(min(w[1], 60))}  {'how shipped'.ljust(w[2])}  verdict  files")
    for comp, lic, shipped, verdict, n in rows:
        lic_short = lic if len(lic) <= 60 else lic[:57] + "..."
        print(f"{comp.ljust(w[0])}  {lic_short.ljust(min(w[1], 60))}  {shipped.ljust(w[2])}  {verdict}  {n}")
    if args.json:
        Path(args.json).write_text(json.dumps({"platform": plat, "inventory": [
            dict(zip(("component", "licence", "shipped", "verdict", "files"), r)) for r in rows],
            "failures": failures}, indent=1))
    if failures:
        print("\nLICENCE CHECK FAILED:")
        for f in failures:
            print(f"  {f}")
        return 1
    print("\nlicence check passed: no GPL/AGPL component, no unknown licence, every binary "
          "accounted for, all notices present")
    return 0


if __name__ == "__main__":
    sys.exit(main())
