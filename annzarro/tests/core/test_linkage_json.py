"""X1: ``tests/data/oracle/linkage.json`` (read by the Node tests of ``utils/hclust.js``) is the export of ``linkage.npz``."""
import importlib.util
import json
import os

ORACLE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "oracle")


def _exporter():
    spec = importlib.util.spec_from_file_location("export_linkage_json", os.path.join(ORACLE, "export_linkage_json.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_linkage_json_is_the_export_of_the_npz():
    path = os.path.join(ORACLE, "linkage.json")
    assert os.path.exists(path), "linkage.json is missing; run export_linkage_json.py in tests/data/oracle"
    with open(path) as fh:
        committed = json.load(fh)
    assert committed == json.loads(json.dumps(_exporter().build())), (
        "linkage.json is stale against linkage.npz; rerun export_linkage_json.py in tests/data/oracle")
