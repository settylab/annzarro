"""
The desktop app copies the repository into its resources with the
extraResources filters in annzarro/desktop/electron/package.json, then runs
it as a source checkout. The filters left out annzarro/config/*.yaml (the
built-in defaults: without them the server refuses to start, "no built-in
production.yaml") and the third-party licenses; "config/**/*.yaml" matched
the repository-root config/ directory, which holds no YAML.

This mirrors electron-builder's matching (minimatch, dot files included,
"!" patterns exclude) closely enough for these paths.
"""
import json
import os
import re
import subprocess

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))


def _regex(glob):
    out, i = "", 0
    while i < len(glob):
        if glob.startswith("**/", i):
            out, i = out + "(?:.*/)?", i + 3
        elif glob.startswith("**", i):
            out, i = out + ".*", i + 2
        elif glob[i] == "*":
            out, i = out + "[^/]*", i + 1
        else:
            out, i = out + re.escape(glob[i]), i + 1
    return re.compile(out + r"\Z")


def _included(path, filters):
    pos = [_regex(p) for p in filters if not p.startswith("!")]
    neg = [_regex(p[1:]) for p in filters if p.startswith("!")]
    return any(r.match(path) for r in pos) and not any(r.match(path) for r in neg)


@pytest.fixture(scope="module")
def filters():
    with open(os.path.join(ROOT, "annzarro", "desktop", "electron", "package.json")) as f:
        build = json.load(f)["build"]
    (resource,) = [r for r in build["extraResources"] if r["to"] == "app"]
    return resource["filter"]


def _tracked(prefix):
    out = subprocess.run(["git", "ls-files", prefix], cwd=ROOT, capture_output=True, text=True)
    if out.returncode != 0:
        pytest.skip("not a git checkout")
    return out.stdout.split()


def test_built_in_config_defaults_are_bundled(filters):
    yamls = [p for p in _tracked("annzarro/config") if p.endswith(".yaml")]
    assert {"annzarro/config/base.yaml", "annzarro/config/production.yaml"} <= set(yamls)
    missing = [p for p in yamls if not _included(p, filters)]
    assert not missing, missing


def test_third_party_licenses_are_bundled(filters):
    notices = _tracked("annzarro/THIRD_PARTY_LICENSES")
    assert notices
    missing = [p for p in notices + ["LICENSE"] if not _included(p, filters)]
    assert not missing, missing


def test_users_and_secrets_are_not_bundled(filters):
    for path in ("config/auth/users.json", "annzarro/tests/server/test_wsgi.py",
                 "data/x.zarr/.zgroup"):
        assert not _included(path, filters), path
