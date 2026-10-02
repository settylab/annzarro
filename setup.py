"""
setup.py for Annzarro.

Project metadata lives in pyproject.toml. This file only describes what goes
into the distribution, because part of it needs a mapping that pyproject.toml
cannot express together with package discovery:

* the Python package ``annzarro`` (tests excluded), and
* the web frontend, kept at the repository root as ``static/`` and
  ``templates/`` (where the frontend tests and tooling expect it) but installed
  INSIDE the package as ``annzarro/static`` and ``annzarro/templates``, so a
  pip-installed server can find it next to its own code
  (see ``annzarro.utils.paths.frontend_dir``).
"""

from setuptools import find_packages, setup

PACKAGES = find_packages(include=["annzarro", "annzarro.*"],
                         exclude=["annzarro.tests", "annzarro.tests.*"])

STATIC_FILES = [
    "favicon.ico",
    "favicon.png",
    "css/*.css",
    "js/*.js",
    "js/package.json",
    "js/**/*.js",
]

setup(
    packages=PACKAGES + ["annzarro.static", "annzarro.templates"],
    package_dir={
        "annzarro.static": "static",
        "annzarro.templates": "templates",
    },
    package_data={
        # Built-in configuration defaults, read via annzarro.utils.paths.
        "annzarro": ["config/*.yaml"],
        "annzarro.static": STATIC_FILES,
        "annzarro.templates": ["*.html"],
    },
)
