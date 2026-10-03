"""The browser's binary decoder agrees with the server's encoder.

Runs ``wire.test.mjs`` (decoder and data-layer unit tests), then has the real
Flask app encode slices of a small store -- dense, sparse, float32, float64,
NaN -- and decodes those exact bytes with ``static/js/utils/wire.js``,
comparing against the same request's JSON reply.
"""
import json
import os
import shutil
import subprocess

import pytest

from annzarro.tests.server.test_fast_transfer import _client, ds  # noqa: F401  (fixture)

JS_TEST_DIR = os.path.dirname(os.path.abspath(__file__))


def _node():
    node = shutil.which("node")
    if node is None:
        pytest.skip("node not on PATH")
    return node


def test_wire_unit_tests():
    result = subprocess.run([_node(), "--test", os.path.join(JS_TEST_DIR, "wire.test.mjs")],
                            capture_output=True, text=True, timeout=120)
    assert result.returncode == 0, result.stdout[-4000:] + result.stderr[-2000:]


def test_server_bytes_decode_in_the_browser_decoder(ds, tmp_path):  # noqa: F811
    node = _node()
    client = _client(ds["tmp"])
    requests = [
        ("gene column with NaN", "X", {"cols": "0"}),
        ("cell row", "X", {"rows": "3"}),
        ("int layer column", "layer/counts", {"cols": "2"}),
        ("kNN row (sparse)", "obsp/connectivities", {"rows": "5"}),
        ("obsm axis", "obsm/X_umap", {"column_name": "1"}),
        ("float64 p-values", "obs", {"columns": "pval"}),
        ("two rows", "X", {"rows": "1,2"}),
    ]
    cases = []
    for i, (name, route, q) in enumerate(requests):
        query = {"dataset_path": ds["path"], **q}
        binary = client.get(f"/api/v1/data/{route}", query_string={**query, "format": "f32"})
        assert binary.mimetype == "application/octet-stream", name
        data = client.get(f"/api/v1/data/{route}", query_string=query).get_json()["data"]
        if isinstance(data, dict):
            data = data[q["columns"]]
        body = f"case{i}.bin"
        (tmp_path / body).write_bytes(binary.data)
        cases.append({"name": name, "body": body, "json": data,
                      "headers": {k: v for k, v in binary.headers.items() if k.startswith("X-Annzarro")}})
    assert {c["headers"]["X-Annzarro-Encoding"] for c in cases} == {"dense", "sparse"}
    assert {c["headers"]["X-Annzarro-Dtype"] for c in cases} == {"float32", "float64"}
    manifest = tmp_path / "manifest.json"
    manifest.write_text(json.dumps(cases))
    result = subprocess.run([node, os.path.join(JS_TEST_DIR, "wire-roundtrip.mjs"), str(manifest)],
                            capture_output=True, text=True, timeout=60)
    assert result.returncode == 0, result.stdout + result.stderr
    assert result.stdout.count("ok ") == len(requests)


def test_categorical_codes_decode_in_the_browser_decoder(tmp_path):
    from annzarro.tests.server.test_categorical_codes import categorical_client
    node = _node()
    client, path = categorical_client(tmp_path)
    cases = []
    for i, (route, column) in enumerate((("obs", "line"), ("obs", "many"), ("obs", "level"), ("var", "kind"))):
        query = {"dataset_path": path, "columns": column}
        coded = client.get(f"/api/v1/data/{route}", query_string={**query, "format": "f32",
                                                                   "categorical": "codes"})
        assert coded.headers["X-Annzarro-Encoding"] == "categorical", column
        data = client.get(f"/api/v1/data/{route}", query_string=query).get_json()["data"][column]
        body = f"cat{i}.bin"
        (tmp_path / body).write_bytes(coded.data)
        cases.append({"name": f"{route} {column}", "body": body, "json": data,
                      "headers": {k: v for k, v in coded.headers.items() if k.startswith("X-Annzarro")}})
    manifest = tmp_path / "manifest.json"
    manifest.write_text(json.dumps(cases))
    result = subprocess.run([node, os.path.join(JS_TEST_DIR, "wire-roundtrip.mjs"), str(manifest)],
                            capture_output=True, text=True, timeout=60)
    assert result.returncode == 0, result.stdout + result.stderr
    assert result.stdout.count("ok ") == len(cases)
