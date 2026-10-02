"""
setup.py for Annzarro.

Project metadata lives in pyproject.toml. This file only describes what goes
into the distribution, because part of it needs a mapping and a build step that
pyproject.toml cannot express:

* the Python package ``annzarro`` (tests excluded);
* the web frontend, kept at the repository root as ``static/`` and
  ``templates/`` (where the frontend tests and tooling expect it) but installed
  INSIDE the package as ``annzarro/static`` and ``annzarro/templates``, so a
  pip-installed server can find it next to its own code
  (see ``annzarro.utils.paths.frontend_dir``);
* the pinned third-party bundles (jQuery, Bootstrap, Plotly, ...) listed in
  ``scripts/vendor-assets.json``. Every build first makes sure ``static/vendor``
  holds exactly those files with the pinned SHA-256 (downloading the missing
  ones, verified, when building from a git checkout; an sdist already contains
  them, so building a wheel from it needs no network). Only manifest files are
  packaged, never whatever else happens to sit in ``static/vendor``.
"""

import importlib.util
import os

from setuptools import find_packages, setup
from setuptools.command.build_py import build_py as _build_py
from setuptools.command.sdist import sdist as _sdist

HERE = os.path.dirname(os.path.abspath(__file__))


def _load_vendor_tool():
    path = os.path.join(HERE, "scripts", "vendor_assets.py")
    spec = importlib.util.spec_from_file_location("_annzarro_vendor_assets", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


vendor = _load_vendor_tool()
VENDOR_DIR = os.path.join(HERE, "static", "vendor")
VENDOR_FILES = ["vendor/" + item["path"] for item in vendor.iter_files(vendor.load_manifest())]


def _ensure_vendor(cmd, strict=True):
    try:
        vendor.ensure(VENDOR_DIR, log=print)
    except vendor.VendorError as e:
        if strict:
            raise SystemExit(f"error: {e}")
        cmd.warn(f"{e} -- the UI will be missing these files until "
                 "`python scripts/vendor_assets.py` succeeds")


class build_py(_build_py):
    def run(self):
        # An editable install of a checkout should not fail just because it is
        # offline; a real wheel without its UI must.
        _ensure_vendor(self, strict=not getattr(self, "editable_mode", False))
        super().run()


class sdist(_sdist):
    def run(self):
        _ensure_vendor(self)
        super().run()


PACKAGES = find_packages(include=["annzarro", "annzarro.*"],
                         exclude=["annzarro.tests", "annzarro.tests.*"])

STATIC_FILES = [
    "favicon.ico",
    "favicon.png",
    "css/*.css",
    "js/*.js",
    "js/package.json",
    "js/**/*.js",
] + VENDOR_FILES

setup(
    packages=PACKAGES + ["annzarro.static", "annzarro.templates"],
    package_dir={
        "annzarro.static": "static",
        "annzarro.templates": "templates",
    },
    package_data={
        # Built-in configuration defaults, read via annzarro.utils.paths, and
        # the notices/licenses of the vendored frontend files.
        "annzarro": ["config/*.yaml", "THIRD_PARTY_LICENSES/*"],
        "annzarro.static": STATIC_FILES,
        "annzarro.templates": ["*.html"],
    },
    cmdclass={"build_py": build_py, "sdist": sdist},
)
