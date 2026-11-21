"""V3: the JSON beside kde.npz (read by Node tests) is what its exporter writes from the .npz and the fixture.

If this fails, run ``python annzarro/tests/data/oracle/export_kde_json.py`` and commit the result. The JSON is never
edited by hand, and the .npz is never regenerated here (see tests/data/oracle/README.md).
"""
import importlib.util
import json
import os

ORACLE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "oracle")


def _exporter():
    spec = importlib.util.spec_from_file_location("export_kde_json", os.path.join(ORACLE, "export_kde_json.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_the_json_is_what_the_exporter_writes_now():
    exporter = _exporter()
    with open(exporter.OUT, encoding="utf-8") as f:
        on_disk = f.read()
    assert on_disk == exporter.render(exporter.build()), "kde.json is stale; run annzarro/tests/data/oracle/export_kde_json.py"


def test_the_json_covers_every_case_and_counts_the_cells_in_range():
    exporter = _exporter()
    with open(exporter.OUT, encoding="utf-8") as f:
        doc = json.load(f)
    assert len(doc["cases"]) == 7 * 3
    for case in doc["cases"].values():
        assert sum(case["counts"]) == case["n_in"]
        assert len(case["counts"]) == case["bins"] ** case["dims"]
