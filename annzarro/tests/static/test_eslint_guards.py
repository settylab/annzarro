"""Guard (0.8.0): ESLint rejects ``Math.max(...x)``, ``Math.min(...x)`` and functions named confirm/alert/prompt.

Each rule is shown on a planted violation (linted from stdin under a ``static/js`` path), so the rule cannot rot
into a no-op; the legacy files that still spread into ``Math.max`` stay exempt from that rule only. Skipped without
Node and ESLint, failing under ``ANNZARRO_REQUIRE_LINT=1``, as ``test_eslint.py`` does.
"""
import json
import os
import shutil
import subprocess

import pytest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
ESLINT = os.path.join(REPO_ROOT, "node_modules", "eslint", "bin", "eslint.js")
NEW = "static/js/utils/planted-example.js"
LEGACY = "static/js/utils/line-select.js"


def lint(source, filename):
    node = shutil.which("node")
    missing = ("node is not on PATH" if node is None else None if os.path.isfile(ESLINT) else "run `npm ci` in the repo root")
    if missing:
        if os.environ.get("ANNZARRO_REQUIRE_LINT") == "1":
            pytest.fail(missing)
        pytest.skip(missing)
    proc = subprocess.run([node, ESLINT, "--format", "json", "--stdin", "--stdin-filename", filename],
                          input=source, cwd=REPO_ROOT, capture_output=True, text=True, timeout=120)
    messages = json.loads(proc.stdout)[0]["messages"]
    return [m for m in messages if m["severity"] == 2 and m["ruleId"] == "no-restricted-syntax"]


@pytest.mark.parametrize("source", [
    "export const f = (a) => Math.max(...a);\n",
    "export const f = (a) => Math.min(...a, 0);\n",
    "export const f = (a) => Math.max(0, ...a.map((x) => x * 2));\n",
])
def test_math_spread_is_an_error(source):
    errors = lint(source, NEW)
    assert len(errors) == 1 and "overflow the stack" in errors[0]["message"]


@pytest.mark.parametrize("source", [
    "export function confirm(text) { return text; }\n",
    "export function alert(text) { return text; }\n",
    "export const prompt = (text) => text;\n",
    "export const o = { confirm() {}, alert: function () {} };\n",
    "export class C { prompt() {} }\n",
])
def test_dialog_names_are_errors(source):
    assert lint(source, NEW), source


@pytest.mark.parametrize("source", [
    "export const f = (a) => Math.max(a[0], a[1]);\n",
    "export const confirmed = (a) => a;\n",
    "export function ask(a) { return window.confirm(a); }\n",
    "export const g = (...a) => a.length;\n",
])
def test_ordinary_code_is_clean(source):
    assert lint(source, NEW) == []


def test_legacy_spread_files_are_exempt_from_the_spread_rule_only():
    assert lint("export const f = (a) => Math.max(...a);\n", LEGACY) == []
    assert lint("export function confirm() {}\n", LEGACY)


def test_admin_pages_keep_their_markup_rules_and_gain_the_new_ones():
    admin = "static/js/admin/planted-example.js"
    assert lint("export const f = (s) => new DOMParser().parseFromString(s, 'text/html');\n", admin)
    assert lint("export const f = (a) => Math.max(...a);\n", admin)
    assert lint("export function prompt() {}\n", admin)


def test_tests_are_covered_too():
    assert lint("export const f = (a) => Math.min(...a);\n", "annzarro/tests/js/planted-example.test.mjs")
