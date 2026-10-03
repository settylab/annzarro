"""Categorical obs/var columns travel as integer codes (``categorical=codes``).

A categorical column went out as one JSON string per cell even with
``format=f32``: about 12 B per cell, 120 MB and 3 s for the 10M-cell Tahoe
store's cell line. With ``format=f32&categorical=codes`` it is one int8 per
cell plus the category list (core/array_response.py). A client that does not
ask for codes still gets the JSON it always got.
"""
import json

import numpy as np
import pytest

from annzarro.core import subset as cell_subset
from annzarro.core import zarr_reader
from annzarro.core.array_response import code_dtype
from annzarro.server.core import create_app
from annzarro.tests.zarr_compat import open_group, write_array, write_strings

N_OBS, N_VAR = 300, 5


def _categorical(group, name, codes, categories, strings=True):
    g = group.create_group(name)
    g.attrs.update({"encoding-type": "categorical", "encoding-version": "0.2.0", "ordered": False})
    write_array(g, "codes", np.asarray(codes, dtype=np.int8 if len(categories) < 128 else np.int16))
    if strings:
        write_strings(g, "categories", categories)
    else:
        write_array(g, "categories", np.asarray(categories))


def _frame(root, name, index, build):
    g = root.create_group(name)
    g.attrs.update({"encoding-type": "dataframe", "encoding-version": "0.2.0",
                    "_index": "_index", "column-order": []})
    write_strings(g, "_index", index)
    build(g)


@pytest.fixture
def ds(tmp_path):
    zarr_reader.clear_cache()
    cell_subset.clear()
    yield categorical_client(tmp_path)
    zarr_reader.clear_cache()
    cell_subset.clear()


def categorical_client(tmp_path):
    """(test client, dataset path) of a store with categorical obs/var columns."""
    rng = np.random.default_rng(0)
    path = str(tmp_path / "data" / "cat.zarr")
    root = open_group(path)
    root.attrs.update({"encoding-type": "anndata", "encoding-version": "0.1.0"})
    x = write_array(root, "X", np.zeros((N_OBS, N_VAR), dtype=np.float32))
    x.attrs.update({"encoding-type": "array", "encoding-version": "0.2.0"})
    line = rng.integers(0, 4, N_OBS)
    line[::17] = -1                                   # missing values
    many = rng.integers(0, 200, N_OBS)                # needs int16 codes
    ints = rng.integers(0, 3, N_OBS)

    def obs(g):
        _categorical(g, "line", line, ["A549", "HeLa", "K562", "é漢"])
        _categorical(g, "many", many, [f"c{i}" for i in range(200)])
        _categorical(g, "level", ints, [10, 20, 30], strings=False)
        write_strings(g, "label", [f"l{i}" for i in range(N_OBS)])
        a = write_array(g, "score", rng.random(N_OBS).astype(np.float32))
        a.attrs.update({"encoding-type": "array", "encoding-version": "0.2.0"})

    def var(g):
        _categorical(g, "kind", [0, 1, 1, 0, -1], ["protein", "lnc"])

    _frame(root, "obs", [f"c{i}" for i in range(N_OBS)], obs)
    _frame(root, "var", [f"g{i}" for i in range(N_VAR)], var)
    client = create_app({"TESTING": True, "data_dir": str(tmp_path / "data"),
                         "log_file": str(tmp_path / "t.log"), "auth_enabled": False}).test_client()
    return client, path


def decode(resp):
    """The Python twin of wire.js decodeVector for the categorical encoding."""
    assert resp.mimetype == "application/octet-stream", resp.get_data(as_text=True)[:200]
    h = resp.headers
    assert h["X-Annzarro-Encoding"] == "categorical"
    assert "X-Annzarro-Categories-Bytes" in h["Access-Control-Expose-Headers"]
    body = resp.get_data()
    lead = int(h["X-Annzarro-Categories-Bytes"])
    assert lead % 4 == 0
    categories = json.loads(body[:lead].decode("utf-8"))
    codes = np.frombuffer(body[lead:], dtype=np.dtype(h["X-Annzarro-Dtype"]).newbyteorder("<"))
    assert codes.size == int(h["X-Annzarro-Shape"])
    return codes, categories


def values_of(codes, categories):
    return [None if c < 0 else categories[c] for c in codes.tolist()]


def _get(client, path, url, codes=False, **query):
    if codes:
        query["categorical"] = "codes"
    return client.get(url, query_string={"dataset_path": path, **query})


@pytest.mark.parametrize("column", ["line", "many", "level"])
def test_codes_carry_exactly_the_json_values(ds, column):
    client, path = ds
    as_json = _get(client, path, "/api/v1/data/obs", columns=column, format="f32").get_json()
    coded = _get(client, path, "/api/v1/data/obs", columns=column, format="f32", codes=True)
    codes, categories = decode(coded)
    assert categories == as_json["categories"][column]
    assert values_of(codes, categories) == as_json["data"][column]
    assert coded.headers["X-Annzarro-Dtype"] == ("int16" if column == "many" else "int8")
    assert len(coded.get_data()) < len(json.dumps(as_json["data"]).encode())


def test_without_the_opt_in_an_old_client_still_gets_json(ds):
    client, path = ds
    resp = _get(client, path, "/api/v1/data/obs", columns="line", format="f32")
    assert resp.mimetype == "application/json"
    assert resp.get_json()["categories"]["line"][0] == "A549"


def test_codes_follow_the_subset_and_rows(ds):
    client, path = ds
    spec = json.dumps({"n": 40, "seed": 2})
    as_json = _get(client, path, "/api/v1/data/obs", columns="line", subset=spec).get_json()
    codes, cats = decode(_get(client, path, "/api/v1/data/obs", columns="line", subset=spec,
                              format="f32", codes=True))
    assert values_of(codes, cats) == as_json["data"]["line"]
    one = decode(_get(client, path, "/api/v1/data/obs", columns="line", subset=spec, rows="3,7",
                      format="f32", codes=True))
    assert values_of(*one) == [as_json["data"]["line"][3], as_json["data"]["line"][7]]


def test_var_columns_too(ds):
    client, path = ds
    codes, cats = decode(_get(client, path, "/api/v1/data/var", columns="kind", format="f32", codes=True))
    assert values_of(codes, cats) == ["protein", "lnc", "lnc", "protein", None]


def test_other_columns_are_unchanged_by_the_opt_in(ds):
    client, path = ds
    num = _get(client, path, "/api/v1/data/obs", columns="score", format="f32", codes=True)
    assert num.mimetype == "application/octet-stream"
    assert num.headers["X-Annzarro-Encoding"] in ("dense", "sparse")
    text = _get(client, path, "/api/v1/data/obs", columns="label", format="f32", codes=True)
    assert text.mimetype == "application/json"
    two = _get(client, path, "/api/v1/data/obs", columns="line,level", format="f32", codes=True)
    assert two.mimetype == "application/json"
    missing = _get(client, path, "/api/v1/data/obs", columns="nope", format="f32", codes=True)
    assert missing.status_code == 404


def test_code_dtype_bounds():
    assert code_dtype(1) == np.int8 and code_dtype(128) == np.int8
    assert code_dtype(129) == np.int16 and code_dtype(32768) == np.int16
    assert code_dtype(32769) == np.int32


def test_h5ad_reader_gives_codes(tmp_path):
    import h5py
    from annzarro.core.h5ad_reader import h5adReader
    path = str(tmp_path / "c.h5ad")
    with h5py.File(path, "w") as f:
        g = f.create_group("obs").create_group("line")
        g.attrs.update({"encoding-type": "categorical", "encoding-version": "0.2.0", "ordered": False})
        g.create_dataset("codes", data=np.array([1, 0, -1, 1], dtype=np.int8))
        g.create_dataset("categories", data=np.array(["a", "b"], dtype=object), dtype=h5py.string_dtype())
    codes, cats = h5adReader().get_obs_var_codes("cells", path, "line", [1, 3])
    assert codes.tolist() == [0, 1] and cats == ["a", "b"]
    assert h5adReader().get_obs_var_codes("cells", path, "nope") is None
