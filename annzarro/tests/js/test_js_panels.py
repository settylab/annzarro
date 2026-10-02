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
    "cache-keys.test.mjs": os.path.join(REPO_ROOT, "static", "js", "cache-manager.js"),
    "color-range-ui.test.mjs": os.path.join(
        REPO_ROOT, "static", "js", "panels", "plot-utilities", "panel-ui-update.js"
    ),
    "focus-row.test.mjs": os.path.join(REPO_ROOT, "static", "js", "utils", "coverage.js"),
    "table-focus.test.mjs": os.path.join(
        REPO_ROOT, "static", "js", "panels", "table-utilities", "table-data.js"
    ),
    "table-listeners.test.mjs": os.path.join(
        REPO_ROOT, "static", "js", "panels", "table-utilities", "listeners.js"
    ),
    "focus-highlight.test.mjs": os.path.join(
        REPO_ROOT, "static", "js", "panels", "plot-utilities", "plot-update.js"
    ),
    "controls-visibility.test.mjs": os.path.join(
        REPO_ROOT, "static", "js", "utils", "controls-visibility.js"
    ),
    "legend-placement.test.mjs": os.path.join(
        REPO_ROOT, "static", "js", "panels", "plot-utilities", "plot-aesthetics-menu.js"
    ),
    "name-picker.test.mjs": os.path.join(REPO_ROOT, "static", "js", "utils", "name-picker.js"),
    "structure-keys.test.mjs": os.path.join(REPO_ROOT, "static", "js", "utils", "structure-keys.js"),
    "plot-titles.test.mjs": os.path.join(REPO_ROOT, "static", "js", "utils", "plot-titles.js"),
    "search-builder.test.mjs": os.path.join(REPO_ROOT, "static", "js", "utils", "search-builder.js"),
    "ui-config.test.mjs": os.path.join(REPO_ROOT, "static", "js", "config.js"),
    "click-overlap.test.mjs": os.path.join(
        REPO_ROOT, "static", "js", "panels", "plot-utilities", "plot-make-helper.js"
    ),
    "color-sort.test.mjs": os.path.join(
        REPO_ROOT, "static", "js", "panels", "plot-utilities", "plot-make.js"
    ),
    "hover-info.test.mjs": os.path.join(
        REPO_ROOT, "static", "js", "panels", "plot-utilities", "plot-make.js"
    ),
    "hide-filters.test.mjs": os.path.join(
        REPO_ROOT, "static", "js", "panels", "plot-utilities", "plot-make.js"
    ),
    "panelset-view.test.mjs": os.path.join(REPO_ROOT, "static", "js", "utils", "deeplink.js"),
    "panel-settings.test.mjs": os.path.join(REPO_ROOT, "static", "js", "utils", "panel-settings.js"),
    "pairwise-columns.test.mjs": os.path.join(
        REPO_ROOT, "static", "js", "panels", "table-utilities", "panel-tracker.js"
    ),
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
