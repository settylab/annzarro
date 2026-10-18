"""Every setting of the admin pages has a help text and a guide link into the docs.

A registry key brings its ``description`` and ``guide`` to the pages (GET /api/v1/admin/policy);
a control that is no key has an entry in static/js/admin/help-catalog.js. Both are held here to
text that says something and to a docs anchor that exists
(tests/browser/test_admin_help.py holds the rendered pages to showing them).
"""
import os
import re

import pytest

from annzarro.server.policy.registry import REGISTRY, load_declarations
from annzarro.tests.server.docs_anchors import ROOT, guide_exists, slug, source_anchors

load_declarations()
KEYS = sorted(REGISTRY.names())
CATALOG = os.path.join(ROOT, "static", "js", "admin", "help-catalog.js")


def _catalog():
    with open(CATALOG, encoding="utf-8") as fh:
        text = fh.read()
    entries = re.findall(r"'([a-z-]+\.[a-z-]+)': \{\s*title: '([^']+)',\s*text: ['\"](.+?)['\"],\s*guide: `([^`]+)`", text, re.S)
    guides = [g.replace("${ADMIN}", "deployment/admin.html") for _, _, _, g in entries]
    return entries, guides


@pytest.mark.parametrize("name", KEYS)
def test_a_key_explains_itself_and_links_the_docs(name):
    key = REGISTRY.get(name)
    words = key.description.split()
    assert len(words) >= 8, f"{name}: the help is too terse: {key.description!r}"
    assert not key.description.startswith("server."), f"{name}: the help only names the YAML key"
    assert key.label and len(key.label) <= 45, f"{name}: needs a short human label, got {key.label!r}"
    assert not re.search(r"[._]", key.label), f"{name}: the label {key.label!r} reads like a key"
    assert key.guide, f"{name} has no guide"
    assert guide_exists(key.guide), f"{name}: {key.guide} is not an anchor of the docs"


def test_describe_sends_the_guide_to_the_pages():
    key = REGISTRY.get("panel.cell-plot.enabled")
    assert key.describe()["guide"] == key.guide
    assert key.describe()["label"] == key.label == "Cell Plot panel"


def test_every_control_of_the_catalog_has_an_existing_anchor():
    entries, guides = _catalog()
    assert len(entries) >= 9, "the catalog was not read"
    for (cid, title, text, _), guide in zip(entries, guides):
        assert len(text.split()) >= 8, f"{cid}: too terse"
        assert guide_exists(guide), f"{cid}: {guide} is not an anchor of the docs"


def test_the_anchor_reader_follows_the_docs_build():
    assert slug("Imprint checklist for Germany") == "imprint-checklist-for-germany"
    assert "panels" in source_anchors("deployment/admin")
    assert "limit-max-requests" in source_anchors("deployment/resource-limits")
    assert "no-such-anchor" not in source_anchors("deployment/admin")
    assert not guide_exists("deployment/admin.html")
    assert not guide_exists("deployment/admin.html#no-such-anchor")


def test_the_admin_page_states_the_override_rule():
    with open(os.path.join(ROOT, "docs", "deployment", "admin.md"), encoding="utf-8") as fh:
        intro = fh.read().split("## Setup")[0]
    assert "YAML always wins" not in intro
    assert "policy.locked" in intro
