"""Which anchors a page of the docs has, read from its Markdown source.

The admin pages link each setting to "<page>.html#<anchor>" (the key's ``guide``, or an
entry of static/js/admin/help-catalog.js). ``guide_exists`` says whether that anchor is
there, by the rules the docs build uses (docs/conf.py: MyST heading anchors up to level 3,
``(label)=`` targets before a heading, and ``{#id}`` attributes on spans and code), so a test
can hold every link to the docs without building them. ``ANNZARRO_DOCS_HTML`` names a
built docs tree (``python -m sphinx -W docs build``) to check against instead; the docs
job of the release gate sets it.
"""
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
DOCS = os.path.join(ROOT, "docs")

_CLEAN = re.compile(r"[^\w一-鿿\- ]")
_HEADING = re.compile(r"^(#{1,3})\s+(.+?)\s*#*\s*$")
_LABEL = re.compile(r"^\(([^)\s]+)\)=\s*$")
_ATTR_ID = re.compile(r"\{#([A-Za-z][\w.:-]*)")
_HTML_ID = re.compile(r'\bid="([^"]+)"')


def slug(title: str) -> str:
    """MyST's default heading slug (GitHub style)."""
    return _CLEAN.sub("", title.lower().replace(" ", "-"))


def _plain(title: str) -> str:
    """The heading text MyST slugs: its text and code, without the markup around them."""
    return re.sub(r"[`*]", "", re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", title))


def source_anchors(page: str) -> set:
    """The anchors of docs/<page>.md ("deployment/admin")."""
    anchors, seen = set(), set()
    fenced = False
    with open(os.path.join(DOCS, page + ".md"), encoding="utf-8") as fh:
        for line in fh:
            if re.match(r"^\s*(```|~~~|:::)", line):
                fenced = not fenced
                continue
            if fenced:
                continue
            anchors.update(_ATTR_ID.findall(line))
            label = _LABEL.match(line)
            if label:
                anchors.add(label.group(1))
                continue
            heading = _HEADING.match(line)
            if heading:
                base = slug(_plain(heading.group(2)))
                found, i = base, 1
                while found in seen:
                    found = f"{base}-{i}"
                    i += 1
                seen.add(found)
                anchors.add(found)
    return anchors


def built_anchors(html_root: str, page: str) -> set:
    with open(os.path.join(html_root, page + ".html"), encoding="utf-8") as fh:
        return set(_HTML_ID.findall(fh.read()))


def guide_exists(guide: str) -> bool:
    """Whether "deployment/admin.html#panels" names a page and an anchor that exist."""
    page, _, anchor = guide.partition("#")
    if not page.endswith(".html") or not anchor:
        return False
    page = page[:-len(".html")]
    html_root = os.environ.get("ANNZARRO_DOCS_HTML")
    anchors = built_anchors(html_root, page) if html_root else source_anchors(page)
    return anchor in anchors
