"""group_features.compute's ``("grouping", GroupingResult)`` event (for E6b's code cache): once the groups are
known and before any feature is read; off unless asked, so every existing caller sees the events it saw."""
import numpy as np
import pytest

from annzarro.core import cell_groups as cg
from annzarro.core import get_reader
from annzarro.core import group_features as gf
from annzarro.tests.core import grouping_store as gs


@pytest.fixture(scope="module")
def store(tmp_path_factory):
    return gs.make_store(tmp_path_factory.mktemp("ge") / "s.zarr", "csc", "zarr")


def _plan(store, parts):
    body = {"shape": "grouping", "partitionings": parts,
            "features": [{"id": "a", "kind": "gene", "name": gs.gene(1)}, {"id": "b", "kind": "gene", "name": gs.gene(2)}]}
    return gf.plan(get_reader(store), store, cg.parse_request(body))


CELL_TYPE = [{"source": {"type": "obs", "key": "cell_type"}}]


def test_the_grouping_comes_before_any_feature_is_read(store, monkeypatch):
    seen = []
    real = gf._gene_moments
    monkeypatch.setattr(gf, "_gene_moments", lambda *a, **k: (seen.append("read"), real(*a, **k))[1])
    events = []
    for event, payload in gf.compute(_plan(store, CELL_TYPE), None, grouping_event=True):
        events.append(event if event != "progress" else f"progress:{payload['stage']}")
        if event == "grouping":
            assert seen == [] and isinstance(payload, cg.GroupingResult) and len(payload.groups) == 6
            grouping = payload
    assert events.count("grouping") == 1
    at = events.index("grouping")
    assert all(e == "progress:groups" for e in events[:at])
    assert all(e != "progress:groups" for e in events[at + 1:])
    assert at < events.index("progress:features") and events[-1] == "result"
    result = [p for e, p in gf.compute(_plan(store, CELL_TYPE), None) if e == "result"][0]
    np.testing.assert_array_equal(grouping.codes, result.grouping.codes)


def test_the_event_is_off_unless_asked_and_comes_on_a_cache_hit_and_a_refusal(store):
    p = _plan(store, CELL_TYPE)
    plain = [e for e, _ in gf.compute(p, None)]
    assert "grouping" not in plain and plain[-1] == "result"
    first = [r for e, r in gf.compute(p, None) if e == "result"][0]
    hit = list(gf.compute(p, None, codes=first.grouping, grouping_event=True))
    assert [e for e, _ in hit][0] == "grouping" and hit[0][1] is first.grouping
    every = [f"c:m{i:04d}" for i in range(gs.N_MANY)]
    refused = list(gf.compute(_plan(store, [{"source": {"type": "obs", "key": "many"}, "levels": every}]), None,
                              grouping_event=True))
    kinds = [e for e, _ in refused]
    assert kinds[-2:] == ["grouping", "result"] and refused[-1][1].refused["reason"] == "too_many_levels"
