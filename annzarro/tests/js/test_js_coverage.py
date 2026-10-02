"""Pytest wrapper for the node-based Coverage guard.

Mirrors ``test_js_array_stats.py`` so one ``pytest`` run covers the JavaScript
side. Unlike that wrapper this one does NOT skip when the module is absent:
``static/js/utils/coverage.js`` ships together with these tests, so a missing
module means the change was partially reverted, and a silent skip there would
be the very failure mode the module exists to prevent.
"""
import os
import shutil
import subprocess

import pytest

_THIS = os.path.abspath(__file__)
JS_TEST_DIR = os.path.dirname(_THIS)
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(JS_TEST_DIR)))
SUITES = {
    "coverage.test.mjs": os.path.join(REPO_ROOT, "static", "js", "utils", "coverage.js"),
    "panel-surface.test.mjs": os.path.join(REPO_ROOT, "static", "js", "utils", "panel-surface.js"),
    # Drives the REAL table loader against real response bodies and asserts its
    # verdict equals the plot's. A suite that only re-implemented the table's
    # logic would have stayed green while the two implementations drifted --
    # which is exactly what happened.
    "table-coverage.test.mjs": os.path.join(
        REPO_ROOT, "static", "js", "panels", "table-utilities", "table-data.js"
    ),
    # Executes the PLOT's real loader. table-coverage compares the table's code
    # path against the plot's CLASSIFIER, which is not the same as the plot's
    # code path -- it was fully green while the two surfaces gave opposite
    # reasons at opposite severities for obsm/obsp/layer, and while
    # `loadAxisData`'s catch block could not execute at all.
    "axis-coverage.test.mjs": os.path.join(
        REPO_ROOT, "static", "js", "panels", "plot-utilities", "plot-make.js"
    ),
    # What the panel-set dialog offers and says when the server refuses a
    # delete/overwrite (owner/admin rule in annzarro/server/permissions.py).
    "session-permissions.test.mjs": os.path.join(
        REPO_ROOT, "static", "js", "utils", "session-permissions.js"
    ),
}


@pytest.mark.parametrize("suite", sorted(SUITES))
def test_coverage_js_guard(suite):
    node = shutil.which("node")
    if node is None:
        pytest.skip("node not on PATH -- cannot run the Coverage guards")
    module = SUITES[suite]
    assert os.path.isfile(module), (
        f"{module} is missing. It ships with this test; its absence means the "
        "coverage mechanism was removed, not that the guard is inapplicable."
    )
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
