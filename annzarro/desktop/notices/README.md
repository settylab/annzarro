Licence texts of native libraries that PyInstaller copies into the desktop
app's frozen server from the build machine's Python installation or system
(not from a Python wheel, whose own licence files are collected from its
dist-info). annzarro/desktop/scripts/notices.py maps each bundled library to
one of these files and refuses to build when a library has no entry.

Sources (upstream releases): OpenSSL 3.0, libffi 3.4.6, zlib 1.3.1, bzip2
1.0.8, xz 5.4.5, util-linux 2.39.3 (libuuid), libexpat 2.6.4, libaec 1.1.3,
google/crc32c 1.1.2, OpenBLAS 0.3.28, GCC 13.2 (COPYING3, COPYING.RUNTIME,
libquadmath/COPYING.LIB), CPython 3.11.9 (LICENSE, Doc/license.rst).
