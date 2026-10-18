"""Run ESLint (eslint.config.mjs) over static/js and the JS tests.

``no-undef`` is the reason this exists: a ReferenceError shipped in
settylab/annzarro#29 that ``node --check`` cannot see and this lint reports in
a second (settylab/annzarro#34). Lint errors fail; warnings do not.

Without Node.js or ESLint (``npm ci`` at the repo root installs the pinned
version) it is skipped with the reason, like the browser tests without
Playwright, so ``pip install ".[test]" && pytest`` on a fresh clone passes. CI
sets ANNZARRO_REQUIRE_LINT=1, where a missing install is a failure: an absent
control must not read as a passing one there.
"""
import os
import shutil
import subprocess

import pytest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
ESLINT = os.path.join(REPO_ROOT, "node_modules", "eslint", "bin", "eslint.js")


def test_eslint_reports_no_errors():
    node = shutil.which("node")
    missing = ("node is not on PATH; install Node.js 22+ and run `npm ci`." if node is None
               else None if os.path.isfile(ESLINT)
               else f"{ESLINT} not found. Run `npm ci` in {REPO_ROOT} to install the pinned ESLint.")
    if missing:
        if os.environ.get("ANNZARRO_REQUIRE_LINT") == "1":
            pytest.fail(missing)
        pytest.skip(missing)
    proc = subprocess.run(
        [node, ESLINT, "--quiet", "static/js", "annzarro/tests/js"],
        cwd=REPO_ROOT, capture_output=True, text=True, timeout=300,
    )
    assert proc.returncode == 0, f"ESLint errors:\n{proc.stdout}\n{proc.stderr}"
