"""Pytest wrapper that runs the node-based JS guard for the deep-link schema.

Lets a single ``pytest`` invocation cover the deep-link `view` serialization
contract (utils/deeplink.js) without a separate JS test framework. Skips cleanly
(with a reason) when ``node`` is unavailable or the module hasn't landed yet, so
it never false-fails an environment that simply can't run it.

Mirrors test_js_array_stats.py. Both rely on the co-located
``static/js/package.json`` (``{"type":"module"}``) so node loads the bare-``.js``
util modules as ES modules instead of choking on ``export`` as CommonJS.
"""
import os
import shutil
import subprocess

import pytest

_THIS = os.path.abspath(__file__)
JS_TEST_DIR = os.path.dirname(_THIS)
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(JS_TEST_DIR)))
HELPER = os.path.join(REPO_ROOT, "static", "js", "utils", "deeplink.js")
TEST_FILE = os.path.join(JS_TEST_DIR, "deeplink.test.mjs")


def test_deeplink_js_guard():
    node = shutil.which("node")
    if node is None:
        pytest.skip("node not on PATH -- cannot run the deep-link JS guard")
    if not os.path.isfile(HELPER):
        pytest.skip(
            "static/js/utils/deeplink.js not present -- the deep-link layout "
            "serialization has not landed in this checkout; JS guard inactive"
        )

    proc = subprocess.run(
        [node, "--test", TEST_FILE],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert proc.returncode == 0, (
        "node --test failed for the deep-link serialization guard:\n"
        f"STDOUT:\n{proc.stdout}\nSTDERR:\n{proc.stderr}"
    )


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
