"""X2a: the JSON beside dotplot_matrixplot.npz (read by Node tests) is what its exporter writes from the .npz and the fixture.

If this fails, run ``python annzarro/tests/data/oracle/export_dotplot_json.py`` and commit the result. The JSON is
never edited by hand, and the .npz is never regenerated here (see tests/data/oracle/README.md).
"""
import importlib.util
import os

ORACLE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "oracle")


def _exporter():
    spec = importlib.util.spec_from_file_location("export_dotplot_json", os.path.join(ORACLE, "export_dotplot_json.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_the_json_is_what_the_exporter_writes_now():
    exporter = _exporter()
    with open(exporter.OUT, encoding="utf-8") as f:
        on_disk = f.read()
    assert on_disk == exporter.render(exporter.build()), (
        "dotplot_matrixplot.json is stale; run annzarro/tests/data/oracle/export_dotplot_json.py")


def test_the_json_covers_every_oracle_combination():
    import json
    exporter = _exporter()
    with open(exporter.OUT, encoding="utf-8") as f:
        doc = json.load(f)
    assert len(doc["dot"]) == 144 and len(doc["matrix"]) == 36
    assert len(doc["moments"]) == 3 * 4 * 2
    assert doc["genes"][3] == "GENE003"
