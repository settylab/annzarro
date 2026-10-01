"""Pytest wrapper for the node-based panel behaviour suites.

Same shape as ``test_js_coverage.py``: one ``pytest`` run also executes these
JavaScript suites, and a missing module is a failure rather than a skip.
"""
import os
import shutil
import subprocess

import pytest

_THIS = os.path.abspath(__file__)
JS_TEST_DIR = os.path.dirname(_THIS)
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(JS_TEST_DIR)))
SUITES = {
    "panel-axis-selector.test.mjs": os.path.join(
        REPO_ROOT, "static", "js", "panels", "plot-utilities", "panel-ui-update.js"
    ),
}


@pytest.mark.parametrize("suite", sorted(SUITES))
def test_panel_js_suite(suite):
    node = shutil.which("node")
    if node is None:
        pytest.skip("node not on PATH -- cannot run the panel suites")
    module = SUITES[suite]
    assert os.path.isfile(module), f"{module} is missing"
    proc = subprocess.run(
        [node, "--test", os.path.join(JS_TEST_DIR, suite)],
        cwd=REPO_ROOT, capture_output=True, text=True, timeout=120,
    )
    assert proc.returncode == 0, (
        f"node --test failed for {suite}:\n"
        f"STDOUT:\n{proc.stdout}\nSTDERR:\n{proc.stderr}"
    )


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
