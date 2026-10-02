"""Run ESLint (eslint.config.mjs) over static/js and the JS tests.

``no-undef`` is the reason this exists: a ReferenceError shipped in
settylab/annzarro#29 that ``node --check`` cannot see and this lint reports in
a second (settylab/annzarro#34). Lint errors fail; warnings do not.

A missing ESLint install is a failure, not a skip: an absent control must not
read as a passing one. ``npm ci`` at the repo root installs the pinned version.
"""
import os
import shutil
import subprocess

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
ESLINT = os.path.join(REPO_ROOT, "node_modules", "eslint", "bin", "eslint.js")


def test_eslint_reports_no_errors():
    node = shutil.which("node")
    assert node is not None, "node is not on PATH; install Node.js 22+ and run `npm ci`."
    assert os.path.isfile(ESLINT), (
        f"{ESLINT} not found. Run `npm ci` in {REPO_ROOT} to install the pinned ESLint."
    )
    proc = subprocess.run(
        [node, ESLINT, "--quiet", "static/js", "annzarro/tests/js"],
        cwd=REPO_ROOT, capture_output=True, text=True, timeout=300,
    )
    assert proc.returncode == 0, f"ESLint errors:\n{proc.stdout}\n{proc.stderr}"
