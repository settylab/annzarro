"""Pytest wrapper that runs the node-based JS guard for BUG #2.

Lets a single ``pytest`` invocation cover the JavaScript stack-overflow guard
without standing up a separate JS test framework. Skips cleanly (with a reason)
when ``node`` is unavailable or the helper module hasn't landed yet, so it never
false-fails an environment that simply can't run it.
"""
import os
import shutil
import subprocess

import pytest

_THIS = os.path.abspath(__file__)
JS_TEST_DIR = os.path.dirname(_THIS)
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(JS_TEST_DIR)))
HELPER = os.path.join(REPO_ROOT, "static", "js", "utils", "array-stats.js")
TEST_FILE = os.path.join(JS_TEST_DIR, "array-stats.test.mjs")


def test_array_stats_js_guard():
    node = shutil.which("node")
    if node is None:
        pytest.skip("node not on PATH -- cannot run the JS stack-overflow guard")
    if not os.path.isfile(HELPER):
        pytest.skip(
            "static/js/utils/array-stats.js not present -- the stack-overflow "
            "fix has not landed in this checkout; JS guard inactive"
        )

    proc = subprocess.run(
        [node, "--test", TEST_FILE],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert proc.returncode == 0, (
        "node --test failed for the array-stats guard:\n"
        f"STDOUT:\n{proc.stdout}\nSTDERR:\n{proc.stderr}"
    )


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
