"""The public Python API and its reference page cannot drift apart.

``annzarro.__all__`` is the public surface. Every name in it resolves, is
documented in docs/reference/python-api.md, and every ``annzarro.<name>`` that
page documents is in it. Each documented function (and each listed method of a
documented class) has a docstring, with an ``Args:`` section when it takes
arguments.
"""
import inspect
import os
import re

import pytest

import annzarro

PAGE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                    "docs", "reference", "python-api.md")


@pytest.fixture(scope="module")
def page():
    with open(PAGE, encoding="utf-8") as fh:
        return fh.read()


def test_every_name_in_all_resolves():
    for name in annzarro.__all__:
        assert hasattr(annzarro, name), name
    assert len(set(annzarro.__all__)) == len(annzarro.__all__)


def test_every_name_in_all_is_documented_on_the_page(page):
    missing = [n for n in annzarro.__all__ if not re.search(r"annzarro\.%s\b" % re.escape(n), page)]
    assert not missing, f"not in docs/reference/python-api.md: {missing}"


def test_the_page_documents_nothing_outside_all(page):
    named = set(re.findall(r"^(?:\.\. auto\w+::|```\{py:data\}) annzarro\.(\w+)", page, re.M))
    assert named, "the page names no object"
    assert named <= set(annzarro.__all__), f"documented but not public: {sorted(named - set(annzarro.__all__))}"


def _documented_members(page):
    """{class name: [members]} from the ``:members:`` option of each autoclass."""
    out = {}
    for match in re.finditer(r"\.\. autoclass:: annzarro\.(\w+)\n((?:   .*\n?)*)", page):
        text = match.group(2)
        found = re.search(r":members:(.*?)(?=\n\s*:\w+:|\Z)", text, re.S)
        out[match.group(1)] = [m.strip() for m in found.group(1).replace("\n", " ").split(",") if m.strip()] if found else []
    return out


def _needs_args_section(func):
    params = [p for name, p in inspect.signature(func).parameters.items() if name not in ("self", "cls")]
    return bool(params)


def _check_doc(label, func):
    doc = inspect.getdoc(func)
    assert doc, f"{label} has no docstring"
    if _needs_args_section(func):
        assert "Args:" in doc, f"{label} documents no parameters (no Args: section)"


def test_documented_functions_and_methods_have_docstrings_with_parameters(page):
    for name in annzarro.__all__:
        obj = getattr(annzarro, name)
        if inspect.isfunction(obj):
            _check_doc(name, obj)
    for cls_name, members in _documented_members(page).items():
        cls = getattr(annzarro, cls_name)
        assert inspect.getdoc(cls), cls_name
        for member in members:
            assert hasattr(cls, member), f"{cls_name}.{member} does not exist"
            _check_doc(f"{cls_name}.{member}", getattr(cls, member))
