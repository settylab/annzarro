# PyInstaller spec for the desktop app's server. Build it with
# annzarro/desktop/scripts/build_server.py, which runs PyInstaller in a clean
# virtual environment holding annzarro and nothing else it does not need.
# -*- mode: python -*-
import os

from PyInstaller.utils.hooks import copy_metadata

from annzarro.desktop import freeze

datas = freeze.datas()
for dist in freeze.METADATA:
    datas += copy_metadata(dist)

a = Analysis(
    [os.path.join(SPECPATH, "annzarro_server.py")],
    datas=datas,
    hiddenimports=freeze.hiddenimports(),
    excludes=freeze.EXCLUDES,
    noarchive=False,
)
# No strip: the manylinux wheels' bundled libraries (OpenBLAS, HDF5) are
# rewritten by auditwheel/patchelf, and strip breaks them ("ELF load command
# address/offset not page-aligned"). Not on macOS either (code signatures).
STRIP = False

pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name=freeze.SERVER_NAME,
    console=True,
    strip=STRIP,
    # UPX is off: compressed DLLs trip antivirus heuristics on Windows and
    # break code signatures on macOS, and the installers are compressed anyway.
    upx=False,
    # Not signed here: electron-builder signs every binary in the app bundle
    # (ad-hoc by default, or with the Developer ID the release workflow is
    # given), using annzarro/desktop/electron/entitlements.mac.plist.
)
coll = COLLECT(exe, a.binaries, a.datas, name=freeze.SERVER_NAME, strip=STRIP, upx=False)
