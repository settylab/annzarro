#!/usr/bin/env python3
"""Remove the GPL/LGPL desktop-integration libraries electron-builder adds to the AppImage.

    python annzarro/desktop/scripts/repack_appimage.py AnnZarro-x.y.z-linux-x86_64.AppImage \\
        --appimagetool appimagetool-x86_64.AppImage

electron-builder copies a fixed set of libraries into every x64 AppImage's
usr/lib, with no option to leave them out: libindicator (GPL-3.0),
libappindicator (GPL-3.0/LGPL-2.1), libgconf-2 and libnotify (LGPL), and the
X11 libraries libXss and libXtst (MIT). AnnZarro uses none of the first four
(no tray icon, no desktop notifications; Electron loads libnotify only on
demand), so this unpacks the AppImage, deletes them, adds the X11 libraries'
licences as LICENSES.appimage-libraries.txt, and packs it again with
appimagetool and the original AppImage runtime. Any other library in usr/lib
stops the script.
"""

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

NOTICES = Path(__file__).resolve().parents[1] / "notices"
#: Libraries that are removed (licence; why AnnZarro does not need them).
REMOVE = {
    "libindicator.so": "GPL-3.0; tray-icon support, unused",
    "libappindicator.so": "GPL-3.0 / LGPL-2.1; tray-icon support, unused",
    "libgconf-2.so": "LGPL-2.0-or-later; obsolete GNOME settings store, unused",
    "libnotify.so": "LGPL-2.1-or-later; desktop notifications, unused",
}
#: Libraries that stay, with their licence notices.
KEEP = {
    "libXss.so": ("libXScrnSaver", "MIT (X11)", "libXss-copyright.txt"),
    "libXtst.so": ("libXtst", "MIT (X11)", "libXtst-copyright.txt"),
}
NOTICE_NAME = "LICENSES.appimage-libraries.txt"


def run(cmd, **kw):
    print("+", " ".join(str(c) for c in cmd), flush=True)
    return subprocess.run([str(c) for c in cmd], check=True, **kw)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("appimage")
    p.add_argument("--appimagetool", required=True)
    args = p.parse_args(argv)
    appimage = Path(args.appimage).resolve()
    tool = Path(args.appimagetool).resolve()
    for exe in (appimage, tool):
        exe.chmod(0o755)
    env = dict(os.environ, APPIMAGE_EXTRACT_AND_RUN="1", ARCH="x86_64")

    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        offset = int(subprocess.run([str(appimage), "--appimage-offset"], env=env, check=True,
                                    capture_output=True, text=True).stdout.strip())
        runtime = tmp / "runtime"
        with open(appimage, "rb") as f:
            runtime.write_bytes(f.read(offset))
        run([appimage, "--appimage-extract"], cwd=tmp, env=env, stdout=subprocess.DEVNULL)
        root = tmp / "squashfs-root"
        lib = root / "usr" / "lib"
        kept, removed, unknown = [], [], []
        for f in sorted(lib.iterdir()) if lib.is_dir() else []:
            stem = f.name.split(".so")[0] + ".so"
            if stem in REMOVE:
                removed.append(f"{f.name} ({REMOVE[stem]})")
                f.unlink()
            elif stem in KEEP:
                kept.append(stem)
            else:
                unknown.append(f.name)
        if unknown:
            sys.exit(f"error: unexpected libraries in the AppImage's usr/lib: {', '.join(unknown)}; "
                     "add them to REMOVE or KEEP in repack_appimage.py")
        if kept:
            parts = ["Libraries electron-builder adds to the AppImage (usr/lib)", ""]
            for stem in sorted(set(kept)):
                name, licence, notice = KEEP[stem]
                parts += [f"=== {name} ({stem}*): {licence} ===", "",
                          (NOTICES / notice).read_text(encoding="utf-8").strip(), ""]
            (root / NOTICE_NAME).write_text("\n".join(parts) + "\n", encoding="utf-8")
        out = tmp / appimage.name
        run([tool, "--no-appstream", "--runtime-file", runtime, root, out], env=env,
            stdout=subprocess.DEVNULL)
        shutil.move(str(out), str(appimage))
        appimage.chmod(0o755)
    print("removed: " + ("; ".join(removed) or "nothing"))
    print("kept with notices: " + (", ".join(sorted(set(kept))) or "nothing"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
