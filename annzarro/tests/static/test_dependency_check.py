"""
The page's dependency check must not cry wolf.

templates/index.html checks that the DataTables extensions loaded. It looked
them up on ``$.fn.DataTable`` (``.buttons``, ``.searchBuilder``,
``.SearchBuilder``), where they never are: the extensions register their
classes on ``$.fn.dataTable`` (lower-case d). Every page load therefore
logged "DataTables.SearchBuilder not loaded properly!" and "buttons extension
not available!" although both worked (checked headless: ``$.fn.dataTable
.SearchBuilder`` and ``.Buttons`` are functions, ``$.fn.DataTable
.SearchBuilder`` is undefined). A real failure would read the same as the
noise, so the check was worse than none.
"""
import os
import re

TEMPLATE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))),
    "templates", "index.html",
)
VENDOR = os.path.join(os.path.dirname(TEMPLATE), "..", "static", "vendor", "js")


def _template():
    with open(TEMPLATE, encoding="utf-8") as fh:
        return fh.read()


def test_extension_checks_look_where_extensions_register():
    html = _template()
    # no extension lookup on the capitalised API object
    assert not re.search(r"\$\.fn\.DataTable\.(Buttons|SearchBuilder|select|FixedHeader|buttons|searchBuilder)", html)
    assert not re.search(r"\$\.fn\.DataTable\[", html)
    for name in ("Buttons", "SearchBuilder", "FixedHeader"):
        assert f"$.fn.dataTable.{name}" in html or f"'{name}'" in html, name


def test_vendor_bundles_register_the_checked_names():
    """When the vendor bundles are present, they define what is checked."""
    sb = os.path.join(VENDOR, "dataTables.searchBuilder.min.js")
    if not os.path.isfile(sb):
        import pytest
        pytest.skip("static/vendor not provisioned")
    with open(sb, encoding="utf-8") as fh:
        assert ".SearchBuilder=" in fh.read()
    with open(os.path.join(VENDOR, "dataTables.buttons.min.js"), encoding="utf-8") as fh:
        assert ".Buttons=" in fh.read()
