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

import contextlib

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
    # encoding=None writes the values/mask PAIR with no `encoding-type`, which
    # is the shape only the STRUCTURAL fallback in `_is_nullable_group` can
    # recognise. Some writers omit the attribute; the attributed path must not
    # be the only one that works.
    grp = parent.create_group(name)
    if encoding is not None:
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


@pytest.mark.parametrize("kind", ["nullable", "categorical"])
def test_group_encoded_index_yields_names(tmp_path, kind):
    p, expected = _index_store(tmp_path, f"index_{kind}.zarr", kind, with_x=True)

    assert _reader().get_cell_gene_names(str(p), "cells") == expected
    assert _reader().get_obs_var("cells", dataset_path=str(p))["data"]["_index"] == expected


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

@contextlib.contextmanager
def count_array_traversals():
    """Count element-wise reads of a zarr Array, on either zarr major.

    Both routes are counted because the two majors take different ones to the
    same defect: zarr 3's ``Array`` has neither ``__contains__`` nor
    ``__iter__``, so ``in`` degrades to an integer ``__getitem__`` per element;
    zarr 2's ``Array`` defines ``__iter__``, so ``in`` iterates.  A structural
    check on a member must do neither.

    ``__iter__`` is read from ``__dict__`` rather than via ``getattr`` so an
    INHERITED ``__iter__`` is not picked up and then "restored" onto the class,
    which would leave the patch permanently installed.
    """
    arr = zarr.Array
    counts = {"n": 0}
    orig_get = arr.__getitem__
    orig_iter = arr.__dict__.get("__iter__")

    def counting_get(self, key):
        if isinstance(key, (int, np.integer)):
            counts["n"] += 1
        return orig_get(self, key)

    arr.__getitem__ = counting_get
    if orig_iter is not None:
        def counting_iter(self):
            counts["n"] += 1
            return orig_iter(self)
        arr.__iter__ = counting_iter
    try:
        yield counts
    finally:
        arr.__getitem__ = orig_get
        if orig_iter is not None:
            arr.__iter__ = orig_iter


def test_plain_columns_are_not_scanned_elementwise(tmp_path):
    """A plain array must never be fed to the ``in`` operator, on the served path.

    Answering a question about a member's STRUCTURE must not read its DATA, so
    ZERO is the only correct answer and it is the same answer on both zarr
    majors.  This replaces a calibrated wall-clock budget which was VACUOUS
    under zarr 2: ``in`` iterates there rather than degrading to the
    per-element legacy sequence protocol, so an UNGUARDED tree finished fast
    enough to pass.  A clock also cannot work across both majors even in
    principle -- the regressed reader sits 30x INSIDE that budget on zarr 2
    while costing 40s on zarr 3.

    Complements the predicate-level access count below rather than repeating
    it: that one pins ``_is_nullable_group`` at zero reads against a stand-in
    and is instant; this one bounds the whole ``get_obs_var`` call against REAL
    zarr objects, so it still fires where the stand-in cannot reach and cannot
    inherit a wrong belief about the real class.
    """
    n = 20000
    p = tmp_path / "wide.zarr"
    _, obs_grp, _ = _skeleton(p, with_x=False)
    _strarr(obs_grp, "_index", [f"c{i}" for i in range(n)])
    _numarr(obs_grp, "x_centroid", np.arange(n, dtype=np.float32))
    _numarr(obs_grp, "y_centroid", np.arange(n, dtype=np.float32))
    obs_grp.attrs["column-order"] = ["x_centroid", "y_centroid"]

    with count_array_traversals() as counts:
        result = _reader().get_obs_var("cells", dataset_path=str(p))

    assert len(result["data"]["x_centroid"]) == n, "column did not read back"
    assert counts["n"] == 0, (
        f"{counts['n']} element-wise reads of a zarr Array while answering a "
        "STRUCTURAL question -- a plain array is being probed element by element"
    )


# --------------------------------------------------------------------------
# D2. the same cost guard, stated as a COUNT rather than a duration
# --------------------------------------------------------------------------

class _CountingArray:
    """A zarr-Array-shaped stand-in that records element access.

    Mimics the two properties that matter: it carries ``attrs`` and it has no
    ``members``.  Like a real zarr Array it defines no ``__contains__``, so a
    membership test against it falls back to the sequence protocol and shows up
    here as ``accesses``.

    Measured, because the sentence above is true of both majors while its
    CONSEQUENCE is not: ``Array.__contains__`` is absent on zarr 2.18.7 and
    3.1.6 alike, but ``Array.__iter__`` is present on 2.18.7 and absent on
    3.1.6.  So a real zarr 2 Array intercepts ``in`` with the ITERATOR
    protocol (20 chunk-slice reads at n=20000) and only zarr 3 falls all the
    way to the legacy SEQUENCE protocol (20,001 integer-index reads).  This
    stand-in models the zarr 3 path, which is the expensive one; on zarr 2 it
    is stricter than reality rather than laxer, so a pass here is still
    meaningful and a failure is still a real defect.

    Stated explicitly because the same true-premise/false-consequence shape,
    written as an unqualified comment one layer down in ``zarr_reader.py``,
    is what made the zarr-2 guard defect invisible to three readers: the
    comment told each of them what they would find.
    """

    def __init__(self):
        self.attrs = {"encoding-type": "array"}
        self.accesses = 0

    def __getitem__(self, index):
        self.accesses += 1
        raise IndexError(index)


def test_plain_array_is_rejected_without_touching_elements():
    """Second, independent witness for the O(n) regression above.

    `test_plain_columns_are_not_scanned_elementwise` is the end-to-end arm: it
    counts traversals of REAL zarr Arrays across a whole `get_obs_var` call, so
    it catches a per-element read introduced at any call site.  This one pins
    the PREDICATE alone, uses no zarr at all, and fails in milliseconds.

    The two are complementary rather than redundant, and each covers the
    other's weakness.  Removing the Group guard from `_is_nullable_group` was
    measured to kill BOTH, on both zarr majors.  But a stand-in encodes the
    author's BELIEF about the real class -- and that belief has been wrong here
    before, which is why the end-to-end arm must not also be a stand-in.
    Conversely the end-to-end arm needs a real store and a real reader, so it
    cannot isolate the predicate the way this one does.

    Carried over from commit b3cd304, which was otherwise superseded by this
    module; it is the one assertion there that had no counterpart here.
    """
    array = _CountingArray()

    assert ZarrReader()._is_nullable_group(array) is False
    assert array.accesses == 0, (
        f"predicate read {array.accesses} element(s) from a plain array; zarr's "
        "Array has no __contains__, so a membership test here is one chunk "
        "decode per element -- 108.88s on a 75000-row column")


class _CountingArrayWithShape(_CountingArray):
    """As above, but carrying ``shape`` -- i.e. shaped like a REAL zarr Array.

    ``_CountingArray`` deliberately omits ``shape``, which is right for
    ``_is_nullable_group`` but hides the fast path in ``_get_encoded_length``:
    that function answers from ``shape`` before it can reach any structural
    test, and a stand-in without ``shape`` never exercises it.
    """

    def __init__(self, n=75000):
        super().__init__()
        self.shape = (n,)


def test_encoded_length_of_plain_array_touches_no_elements():
    """`_get_encoded_length` must answer from metadata, never from content.

    It is reached once per obs/var index read, so a membership test here costs
    the same chunk-decode-per-element as the one `_is_nullable_group` was
    guarded against -- and nothing else covers this function.
    """
    array = _CountingArrayWithShape(n=75000)

    assert ZarrReader()._get_encoded_length(array) == 75000
    assert array.accesses == 0, (
        f"read {array.accesses} element(s) to answer a question about length")


def test_group_predicate_holds_on_the_installed_zarr(tmp_path):
    """`_is_group` must recognise a Group under whichever zarr is installed.

    This is a cross-VERSION regression, and it is invisible to any test that
    exercises only one major. ``hasattr(member, 'members')`` is O(1) and
    correct on zarr 3, and answers False for EVERY zarr 2 Group, because
    ``members`` arrived in zarr 3. Under that predicate the structural
    fallback in `_is_nullable_group` and the whole of `_get_encoded_length`
    silently took the not-a-group arm on zarr 2: `get_basic_counts` answered
    ``{cell_count: 0, gene_count: 0}`` with no error and no log line.

    Measured on the same tree with zarr as the only variable: 4 of 4
    group-encoded-index arms passed under 3.1.6, 2 of 4 under 2.18.7.

    The predicate must therefore be checked against real zarr objects rather
    than against a stand-in, since a stand-in encodes the author's belief
    about the class rather than the class.
    """
    root = _open_root(tmp_path / "predicate.zarr")
    group = root.create_group("a_group")
    array = _numarr(root, "an_array", np.arange(4, dtype=np.int32))

    assert ZarrReader._is_group(group) is True, (
        f"zarr {zarr.__version__}: Group not recognised; "
        "every structural encoding check silently degrades")
    assert ZarrReader._is_group(array) is False, (
        f"zarr {zarr.__version__}: Array misread as a Group; membership tests "
        "against it decode one chunk per element")


def test_structural_fallback_detects_unattributed_group(tmp_path):
    """The structural fallback must ACCEPT what it is meant to accept.

    Every other direct assertion on `_is_nullable_group` in this module is
    NEGATIVE -- "reject a plain array", "read no elements". A suite whose
    predicate assertions are all rejections is satisfied in full by a
    predicate that rejects EVERYTHING, so an over-broad guard is structurally
    invisible to it. That is precisely how the zarr-2 `members` defect
    survived a five-mutant pass and a two-major run.

    `test_group_predicate_holds_on_the_installed_zarr` closes it at the
    PREDICATE level. This closes it at the COMPOSITION level: nothing else
    asserts that `_is_nullable_group` reaches True by the structural route,
    so a future change to how it consumes `_is_group` would be uncovered
    again.

    Fails at `dedebe9` under zarr 2.18.7; passes here under both majors.

    Credit: @annzpr13, who found the all-negative-assertions gap.
    """
    root = _open_root(tmp_path / "noattr.zarr")
    categorical = _categorical(
        root, "c", np.array([0, 1, 0, 1], dtype=np.int8),
        lambda g: _nullable(g, "categories", ["p", "q"], [False, False],
                            None, _strarr))

    member = categorical["categories"]
    assert "encoding-type" not in dict(member.attrs), (
        "fixture is wrong: the attribute is present, so this exercises the "
        "attributed path and says nothing about the structural fallback")
    assert ZarrReader()._is_nullable_group(member) is True, (
        f"zarr {zarr.__version__}: a values/mask group with no encoding-type "
        "was not recognised; the structural fallback is unreachable")


def test_unattributed_group_reads_back_with_mask_applied(tmp_path):
    """The structural route must deliver DATA, not merely be recognised.

    The arm above pins the predicate; this pins the composition of
    `_is_nullable_group` with `_read_member`. They can fail independently:
    a predicate that fires correctly still returns wrong data if the mask is
    dropped, and that is the exact defect removed from #11's inline branch.

    At `dedebe9` under zarr 2.18.7 this yields `[]` -- the guard rejects the
    group, `_read_member` falls through to `member[:]`, zarr 2's
    `Group.__getitem__` raises KeyError, and the enclosing `except Exception`
    converts it to an empty column at HTTP 200.

    Authored by annzpr13-sk, which derived the defect independently; taken
    rather than rewritten, because a witness written by a party with no stake
    in this PR is worth more than one written for it.
    """
    root = _open_root(tmp_path / "structural_read.zarr")
    _nullable(root, "flag", [10, 20, 30], [False, True, False], None,
              lambda g, n, v: _numarr(g, n, v, dtype=np.int64))

    member = _open_root(tmp_path / "structural_read.zarr", mode="r")["flag"]
    out = list(np.asarray(ZarrReader()._read_member(member), dtype=object))

    assert out == [10, None, 30], (
        f"got {out!r} under zarr {zarr.__version__}; the structural fallback "
        "either did not fire or dropped the mask")


def test_unattributed_column_survives_the_public_api(tmp_path):
    """End-to-end, at the level a user actually experiences the defect.

    Every other arm for this shape stops at a private method. This one goes
    through `get_obs_var`, which is what the HTTP layer calls -- and it is the
    only one that would have caught the bug as a REPORT rather than as a
    diagnosis, because the failure mode is a well-formed 200 response with an
    empty column rather than an error.
    """
    p = tmp_path / "structural_api.zarr"
    _, obs, _ = _skeleton(p)
    _strarr(obs, "_index", CELLS)
    _nullable(obs, "flag", [10, 20, 30, 40, 50, 60],
              [False, True, False, False, False, False], None,
              lambda g, n, v: _numarr(g, n, v, dtype=np.int64))
    obs.attrs["column-order"] = ["flag"]

    column = _reader().get_obs_var("cells", dataset_path=str(p))["data"]["flag"]

    assert column != [], (
        f"empty column under zarr {zarr.__version__} -- the silent-empty class "
        "#26 exists to eliminate, reached through the structural fallback")
    assert column == [10, None, 30, 40, 50, 60]
