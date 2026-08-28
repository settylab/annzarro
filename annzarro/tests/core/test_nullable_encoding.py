"""AnnData nullable encodings: values must be read, and plain arrays must not be scanned.

AnnData may write a nullable dtype -- and, in this corpus, a *categorical's*
``categories`` member -- as a zarr **group** holding ``values`` + ``mask``
(``encoding-type`` ``nullable-string-array`` / ``nullable-integer`` /
``nullable-boolean``) rather than as a plain array. Slicing a group raises, and
``_get_categorical_values``'s bare ``except`` turned that into an empty column
served at HTTP 200: the column was still listed by the metadata path (which
reads only attrs/keys and never descends), so the UI offered ``celltype`` and
``sample`` with nothing behind them.

The store is built here rather than committed because these cases need only
``zarr``/``numpy``, both of which the server env has -- so this module is
self-contained and runs where the (gitignored) served data is absent.

Two independent properties are under test, and the second is the one no
value-equality assertion can protect:

1. **Correctness** -- nullable-encoded members read back as their real values,
   with ``mask=True`` positions as ``None``.
2. **Cost** -- ``_is_nullable_group`` must reject a plain array *without*
   touching its elements. zarr's ``Array`` defines no ``__contains__``, so
   ``'values' in array`` falls back to Python's legacy sequence protocol and
   decodes one chunk per element: measured at 108.88 s for a single call on a
   75000-row column, against 0.0008 s on a group. Because ``get_obs_var``
   routes every obs/var column through this predicate, that regression reached
   every dataset, including those that were never broken. The values stayed
   correct throughout, so only a cost assertion can catch a recurrence.
"""
import numpy as np
import pytest
import zarr

from annzarro.core.zarr_reader import ZarrReader


def _nullable(parent, name, values, mask, encoding, dtype):
    """Write an AnnData nullable group: a `values` array beside a `mask` array."""
    group = parent.create_group(name)
    group.attrs['encoding-type'] = encoding
    group.attrs['encoding-version'] = '0.1.0'
    arr = group.create_array('values', shape=(len(values),), dtype=dtype)
    arr[:] = np.array(values, dtype=dtype)
    msk = group.create_array('mask', shape=(len(mask),), dtype='bool')
    msk[:] = np.array(mask, dtype=bool)
    return group


def _categorical(parent, name, codes, build_categories):
    group = parent.create_group(name)
    group.attrs['encoding-type'] = 'categorical'
    group.attrs['encoding-version'] = '0.2.0'
    group.attrs['ordered'] = False
    arr = group.create_array('codes', shape=(len(codes),), dtype='int8')
    arr[:] = np.array(codes, dtype='int8')
    build_categories(group)
    return group


@pytest.fixture(scope='module')
def obs():
    """An obs group covering every nullable shape, plus a plain-array control."""
    root = zarr.open_group(zarr.storage.MemoryStore(), mode='w', zarr_format=2)
    grp = root.create_group('obs')

    # categories as a nullable-string-array, with a MASKED (missing) category.
    # No real dataset in the corpus has a set mask bit, so this is the only
    # place the None-substitution branch is exercised at all.
    _categorical(grp, 'cat_str_masked', [0, 1, 2, -1], lambda g: _nullable(
        g, 'categories', ['alpha', 'MISSINGSLOT', 'gamma'], [False, True, False],
        'nullable-string-array', '<U16'))

    # the other two nullable encodings; neither occurs in the served corpus.
    _categorical(grp, 'cat_int', [0, 1, 0, 1], lambda g: _nullable(
        g, 'categories', [10, 20], [False, False], 'nullable-integer', '<i8'))
    _categorical(grp, 'cat_bool', [0, 1, 1, 0], lambda g: _nullable(
        g, 'categories', [False, True], [False, False], 'nullable-boolean', 'bool'))

    # a column that is ITSELF nullable rather than a categorical.
    _nullable(grp, 'plain_nullable', [1.5, 2.5, 3.5, 4.5],
              [False, False, True, False], 'nullable-integer', '<f8')

    # control: plain-array categories, the form that always worked.
    def _plain(g):
        arr = g.create_array('categories', shape=(2,), dtype='<U8')
        arr[:] = np.array(['x', 'y'], dtype='<U8')
    _categorical(grp, 'cat_plain', [0, 1, 0, 1], _plain)

    # a nullable group with NO encoding-type attribute, for the structural
    # fallback -- the reason the fallback exists rather than being deleted.
    def _noattr(g):
        sub = g.create_group('categories')
        arr = sub.create_array('values', shape=(2,), dtype='<U8')
        arr[:] = np.array(['p', 'q'], dtype='<U8')
        msk = sub.create_array('mask', shape=(2,), dtype='bool')
        msk[:] = np.array([False, False])
    _categorical(grp, 'cat_noattr', [0, 1, 0, 1], _noattr)

    return grp


@pytest.mark.parametrize('column,expected_values,expected_categories', [
    ('cat_str_masked', ['alpha', None, 'gamma', None], ['alpha', None, 'gamma']),
    ('cat_int', [10, 20, 10, 20], [10, 20]),
    ('cat_bool', [False, True, True, False], [False, True]),
    ('plain_nullable', [1.5, 2.5, None, 4.5], []),
    ('cat_plain', ['x', 'y', 'x', 'y'], ['x', 'y']),
    ('cat_noattr', ['p', 'q', 'p', 'q'], ['p', 'q']),
])
def test_nullable_values_are_read(obs, column, expected_values, expected_categories):
    """Values come back real, not as the empty list a swallowed read produced."""
    values, categories = ZarrReader()._get_categorical_values(
        obs[column], return_categories=True)

    assert list(values) == expected_values
    assert list(categories) == expected_categories


def test_masked_entries_become_none(obs):
    """mask=True marks a MISSING entry -- inverting this would null real values."""
    _, categories = ZarrReader()._get_categorical_values(
        obs['cat_str_masked'], return_categories=True)

    assert categories[1] is None, "the masked slot must not surface its filler"
    assert categories[0] == 'alpha' and categories[2] == 'gamma'


class _CountingArray:
    """A zarr-Array-shaped stand-in that records element access.

    Mimics the two properties that matter: it carries ``attrs`` and it has no
    ``members``. Like a real zarr Array it defines no ``__contains__``, so a
    membership test against it falls back to the sequence protocol and shows up
    here as ``accesses``.
    """

    def __init__(self):
        self.attrs = {'encoding-type': 'array'}
        self.accesses = 0

    def __getitem__(self, index):
        self.accesses += 1
        raise IndexError(index)


def test_plain_array_is_rejected_without_touching_elements():
    """The cost guard. A value-equality test cannot catch this regressing."""
    array = _CountingArray()

    assert ZarrReader()._is_nullable_group(array) is False
    assert array.accesses == 0, (
        f"predicate read {array.accesses} element(s) from a plain array; zarr's "
        "Array has no __contains__, so a membership test here is one chunk "
        "decode per element -- 108.88s on a 75000-row column")


def test_multidimensional_array_is_rejected_cleanly():
    """A 2-D array must not reach the membership test.

    ``'values' in <2-D array>`` raises ``ValueError: truth value ... ambiguous``,
    which the caller's bare ``except`` would convert into an empty column at
    HTTP 200 -- the very defect this module exists to prevent.
    """
    root = zarr.open_group(zarr.storage.MemoryStore(), mode='w', zarr_format=2)
    arr = root.create_array('two_d', shape=(50, 3), dtype='<f4')
    arr[:] = np.zeros((50, 3), dtype='<f4')

    assert ZarrReader()._is_nullable_group(arr) is False


def test_string_array_containing_the_marker_names_is_not_nullable():
    """Element values must not be mistaken for member names."""
    root = zarr.open_group(zarr.storage.MemoryStore(), mode='w', zarr_format=2)
    arr = root.create_array('str_trap', shape=(2,), dtype='<U8')
    arr[:] = np.array(['values', 'mask'], dtype='<U8')

    assert ZarrReader()._is_nullable_group(arr) is False


def test_structural_fallback_still_detects_an_unattributed_group(obs):
    """The guard must not cost the fallback its purpose."""
    assert ZarrReader()._is_nullable_group(obs['cat_noattr']['categories']) is True
