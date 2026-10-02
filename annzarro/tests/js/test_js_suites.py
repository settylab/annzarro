"""Run every node suite in this directory from pytest.

Suites are discovered by glob (``*.test.mjs``), not listed by hand: a hand
list silently left new suites out of CI (settylab/annzarro#39), and an omitted
suite is indistinguishable from a passing one. Add a ``*.test.mjs`` here and it
runs; there is nothing else to register.

A missing ``node`` is a failure, not a skip, for the same reason. A suite whose
module under test was removed fails on its own import.
"""
import glob
import os
import shutil
import subprocess

import pytest

JS_TEST_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(JS_TEST_DIR)))
SUITES = sorted(os.path.basename(p) for p in glob.glob(os.path.join(JS_TEST_DIR, "*.test.mjs")))


def test_suites_discovered():
    assert SUITES, f"no *.test.mjs found in {JS_TEST_DIR}"


@pytest.mark.parametrize("suite", SUITES)
def test_js_suite(suite):
    node = shutil.which("node")
    assert node is not None, (
        "node is not on PATH; the JS suites cannot run. Install Node.js 22+ "
        "(see package.json) rather than skipping them."
    )
    proc = subprocess.run(
        [node, "--test", os.path.join(JS_TEST_DIR, suite)],
        cwd=REPO_ROOT, capture_output=True, text=True, timeout=120,
    )
    assert proc.returncode == 0, (
        f"node --test failed for {suite}:\n"
        f"STDOUT:\n{proc.stdout}\nSTDERR:\n{proc.stderr}"
    )
