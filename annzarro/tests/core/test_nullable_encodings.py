"""Regression tests for AnnData nullable / categorical encodings in ZarrReader.

AnnData does not always write an obs/var member as a plain zarr array. Three
shapes reach ZarrReader and each has produced a distinct production defect:

  A. a categorical whose ``categories`` member is itself a
     ``nullable-string-array`` GROUP (``values`` + ``mask``) rather than an
     array.  Slicing a group raises ``TypeError: path=slice(...) is not a
     string``; the enclosing ``except Exception`` turned that into ``[]``, so
     the API answered HTTP 200 with an empty column.  This is the shape found
     in every served dataset.
  B. a direct nullable column carrying MASKED (missing) entries.  Reading
     ``values`` without applying ``mask`` returns whatever the writer left in
     the masked slots -- wrong data rather than absent data.
  C. an INDEX member (``obs.attrs['_index']``) stored as a nullable or
     categorical group.  Cell/gene counts, obs/var names and the structure
     preview all read it directly and fail or return empty.

Each test below builds the minimal store that isolates one shape.  The plain
control at the end is the discriminator: if it ever fails, the fixtures are
broken rather than the reader.
"""

import numpy as np
import pytest
import zarr

from annzarro.core.zarr_reader import ZarrReader

# The store must be written through whichever zarr major version is installed:
# this suite is exercised under zarr 2.x, while the deployed service runs 3.x.
# Under zarr 3 the store is pinned to zarr FORMAT 2 -- the on-disk layout the
# served datasets actually use -- so the fixture matches production either way.
_ZARR_V3 = int(zarr.__version__.split(".")[0]) >= 3

CELLS = [f"cell_{i}" for i in range(6)]
GENES = [f"gene_{j}" for j in range(4)]
LABELS = ["Endothelial", "Fibroblast", "Liver"]
CODES = np.array([0, 1, 2, 0, 1, 2], dtype=np.int8)
EXPANDED = [LABELS[c] for c in CODES]


# --------------------------------------------------------------------------
# fixture builders
# --------------------------------------------------------------------------

def _open_root(path, mode="w"):
    if _ZARR_V3:
        return zarr.open_group(str(path), mode=mode, zarr_format=2)
    return zarr.open_group(str(path), mode=mode)


def _strarr(group, name, values):
    """Write a variable-length UTF-8 string array, as AnnData does."""
    if _ZARR_V3:
        arr = group.create_array(name, shape=(len(values),), dtype=str)
        arr[:] = list(values)
        return arr
    numcodecs = pytest.importorskip("numcodecs")
    return group.create_dataset(
        name, data=np.array(values, dtype=object), dtype=object,
        object_codec=numcodecs.VLenUTF8(), shape=(len(values),))


def _numarr(group, name, values, dtype=None):
    """Write a plain numeric / boolean array."""
    arr = np.asarray(values) if dtype is None else np.asarray(values, dtype=dtype)
    if _ZARR_V3:
        out = group.create_array(name, shape=arr.shape, dtype=arr.dtype)
        out[:] = arr
        return out
    return group.create_dataset(name, data=arr)


def _nullable(parent, name, values, mask, encoding, writer):
    grp = parent.create_group(name)
    grp.attrs["encoding-type"] = encoding
    grp.attrs["encoding-version"] = "0.1.0"
    writer(grp, "values", values)
    _numarr(grp, "mask", mask, dtype=bool)
    return grp


def _nullable_str(parent, name, values, mask):
    return _nullable(parent, name, values, mask, "nullable-string-array", _strarr)


def _nullable_int(parent, name, values, mask):
    def _int(g, n, v):
        return _numarr(g, n, v, dtype=np.int64)
    return _nullable(parent, name, values, mask, "nullable-integer", _int)


def _categorical(parent, name, codes, categories_writer):
    grp = parent.create_group(name)
    grp.attrs["encoding-type"] = "categorical"
    grp.attrs["encoding-version"] = "0.2.0"
    grp.attrs["ordered"] = False
    _numarr(grp, "codes", codes)
    categories_writer(grp)
    return grp


def _skeleton(path, obs_index="_index", with_x=True):
    root = _open_root(path)
    root.attrs["encoding-type"] = "anndata"
    root.attrs["encoding-version"] = "0.1.0"
    if with_x:
        _numarr(root, "X",
                np.arange(len(CELLS) * len(GENES), dtype=np.float32)
                  .reshape(len(CELLS), len(GENES)))
    obs = root.create_group("obs")
    obs.attrs.update({"encoding-type": "dataframe", "encoding-version": "0.2.0",
                      "_index": obs_index, "column-order": []})
    var = root.create_group("var")
    var.attrs.update({"encoding-type": "dataframe", "encoding-version": "0.2.0",
                      "_index": "_index", "column-order": []})
    _strarr(var, "_index", GENES)
    return root, obs, var


def _reader():
    # Caching is disabled so each assertion reads the store rather than a
    # memoised answer from an earlier test in the same process.
    return ZarrReader(enable_caching=False)


# --------------------------------------------------------------------------
# A. categorical with nullable-encoded `categories`
# --------------------------------------------------------------------------

def test_categorical_with_nullable_categories(tmp_path):
    """The live shape: `categories` is a group, not an array.

    Before the fix this returned `[]` with HTTP 200 -- a read failure wearing
    the costume of an empty column.
    """
    p = tmp_path / "nested.zarr"
    _, obs, _ = _skeleton(p)
    _strarr(obs, "_index", CELLS)
    _categorical(obs, "celltype", CODES,
                 lambda g: _nullable_str(g, "categories", LABELS, [False] * len(LABELS)))
    obs.attrs["column-order"] = ["celltype"]

    result = _reader().get_obs_var("cells", dataset_path=str(p))

    assert result["data"]["celltype"] == EXPANDED
    assert result["categories"]["celltype"] == LABELS


# --------------------------------------------------------------------------
# B. masked entries in a direct nullable column
# --------------------------------------------------------------------------

@pytest.mark.parametrize("writer,raw,expected", [
    (_nullable_str, ["A", "B", "SENTINEL", "A", "B", "C"],
     ["A", "B", None, "A", "B", "C"]),
    (_nullable_int, [10, 20, 999, 40, 50, 60],
     [10, 20, None, 40, 50, 60]),
])
def test_masked_entries_become_none(tmp_path, writer, raw, expected):
    """`mask=True` marks a MISSING value and must not surface as data.

    Reading `values` while ignoring `mask` yields a plausible-looking but wrong
    answer -- strictly worse than the empty list it replaces, because nothing
    downstream can tell it from real data.
    """
    p = tmp_path / f"masked_{writer.__name__}.zarr"
    _, obs, _ = _skeleton(p)
    _strarr(obs, "_index", CELLS)
    mask = [False, False, True, False, False, False]
    writer(obs, "col", raw, mask)
    obs.attrs["column-order"] = ["col"]

    values = _reader().get_obs_var("cells", dataset_path=str(p))["data"]["col"]

    assert values == expected
    assert raw[2] not in values, "masked sentinel leaked into the returned data"


# --------------------------------------------------------------------------
# C. index member stored as a group
# --------------------------------------------------------------------------

def _index_store(tmp_path, name, kind, with_x):
    p = tmp_path / name
    _, obs, var = _skeleton(p, obs_index="cell_id", with_x=with_x)
    if kind == "nullable":
        _nullable_str(obs, "cell_id", CELLS, [False] * len(CELLS))
        expected_names = CELLS
    else:
        _categorical(obs, "cell_id", CODES, lambda g: _strarr(g, "categories", LABELS))
        expected_names = EXPANDED
    return p, expected_names


@pytest.mark.xfail(strict=True, reason="index members stored as a group are not yet read: fixed by PR #11. strict=True so this turns RED the moment #11 lands, forcing the marker off rather than letting the coverage quietly lapse.")
@pytest.mark.parametrize("kind", ["nullable", "categorical"])
def test_group_encoded_index_yields_names(tmp_path, kind):
    p, expected = _index_store(tmp_path, f"index_{kind}.zarr", kind, with_x=True)

    assert _reader().get_cell_gene_names(str(p), "cells") == expected
    assert _reader().get_obs_var("cells", dataset_path=str(p))["data"]["_index"] == expected


@pytest.mark.xfail(strict=True, reason="index members stored as a group are not yet read: fixed by PR #11. strict=True so this turns RED the moment #11 lands, forcing the marker off rather than letting the coverage quietly lapse.")
@pytest.mark.parametrize("kind", ["nullable", "categorical"])
def test_group_encoded_index_yields_counts_without_x(tmp_path, kind):
    """With no `X` to fall back on, the counts must come from the index itself.

    An `X`-bearing store hides this: `get_basic_counts` reads `X.shape` and the
    index is never consulted, so a store WITHOUT `X` is the only one that
    exercises the encoded-length path.
    """
    p, _ = _index_store(tmp_path, f"index_{kind}_nox.zarr", kind, with_x=False)
    var = _open_root(p, mode="a")["var"]
    del var["_index"]
    var.attrs["_index"] = "gene_id"
    if kind == "nullable":
        _nullable_str(var, "gene_id", GENES, [False] * len(GENES))
    else:
        _categorical(var, "gene_id", np.array([0, 1, 2, 0], dtype=np.int8),
                     lambda g: _strarr(g, "categories", LABELS))

    counts = _reader().get_basic_counts(str(p))

    assert counts["cell_count"] == len(CELLS)
    assert counts["gene_count"] == len(GENES)


# --------------------------------------------------------------------------
# discriminator: everything plain
# --------------------------------------------------------------------------

def test_plain_encodings_control(tmp_path):
    """Negative control. This must pass on EVERY tree, fixed or not.

    If it fails, the fixtures above are broken and their verdicts say nothing
    about the reader.
    """
    p = tmp_path / "plain.zarr"
    _, obs, _ = _skeleton(p)
    _strarr(obs, "_index", CELLS)
    _categorical(obs, "celltype", CODES, lambda g: _strarr(g, "categories", LABELS))
    obs.attrs["column-order"] = ["celltype"]

    reader = _reader()
    assert reader.get_basic_counts(str(p)) == {"cell_count": len(CELLS),
                                               "gene_count": len(GENES)}
    result = _reader().get_obs_var("cells", dataset_path=str(p))
    assert result["data"]["_index"] == CELLS
    assert result["data"]["celltype"] == EXPANDED
    assert _reader().get_cell_gene_names(str(p), "cells") == CELLS


# --------------------------------------------------------------------------
# D. plain columns must not be probed element-by-element
# --------------------------------------------------------------------------

def test_plain_columns_are_not_scanned_elementwise(tmp_path):
    """A plain array must never be fed to the `in` operator.

    A zarr Array defines ``__getitem__`` but neither ``__contains__`` nor
    ``__iter__``, so ``'values' in arr`` silently falls back to the legacy
    sequence protocol and decodes EVERY element to answer a question about
    structure.  Measured here at 0.9 ms/element under zarr 3.1.6, i.e. ~68 s
    for one 75000-row obs column -- and `get_obs_var` routes every column
    through this check, so the cost lands on datasets that have no nullable
    member at all.

    The budget is calibrated against this machine rather than hard-coded: a
    correct implementation costs a handful of whole-array reads, a regressed
    one costs a per-element read for every row.  The two differ by three
    orders of magnitude, so the factor below is loose on purpose and the test
    is a defect detector, not a benchmark.
    """
    import time

    n = 20000
    p = tmp_path / "wide.zarr"
    root, obs, _ = _skeleton(p, with_x=False)
    _strarr(obs, "_index", [f"c{i}" for i in range(n)])
    _numarr(obs, "x_centroid", np.arange(n, dtype=np.float32))
    _numarr(obs, "y_centroid", np.arange(n, dtype=np.float32))
    obs.attrs["column-order"] = ["x_centroid", "y_centroid"]

    column = zarr.open_group(str(p), mode="r")["obs"]["x_centroid"]

    start = time.perf_counter()
    for _ in range(5):
        np.asarray(column[:])
    bulk = (time.perf_counter() - start) / 5

    start = time.perf_counter()
    result = _reader().get_obs_var("cells", dataset_path=str(p))
    elapsed = time.perf_counter() - start

    assert len(result["data"]["x_centroid"]) == n, "column did not read back"

    budget = max(2.0, 200 * bulk)
    assert elapsed < budget, (
        f"reading {n} rows took {elapsed:.2f}s against a budget of {budget:.2f}s "
        f"({bulk * 1e3:.2f} ms per bulk read of the same column) -- a plain array "
        f"is being probed element-by-element"
    )
