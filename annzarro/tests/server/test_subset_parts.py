"""The routes take a subset's ``part`` and report the partition."""
import json

import pytest

from annzarro.core import subset as cell_subset
from annzarro.core import zarr_reader
from annzarro.server.core import create_app
from annzarro.tests.server.rich_store import N_OBS, make_rich_store


@pytest.fixture
def get(tmp_path):
    path = make_rich_store(tmp_path / "rich.zarr")
    zarr_reader.clear_cache()
    cell_subset.clear()
    client = create_app({"TESTING": True, "data_dir": str(tmp_path),
                         "log_file": str(tmp_path / "l.log")}).test_client()

    def _get(url, **query):
        query.setdefault("dataset_path", path)
        if "subset" in query and not isinstance(query["subset"], str):
            query["subset"] = json.dumps(query["subset"])
        return client.get(url, query_string=query)
    yield _get
    zarr_reader.clear_cache()
    cell_subset.clear()


def test_parts_partition_the_cells_and_are_reported(get):
    n = 60
    k = -(-N_OBS // n)
    seen = []
    for part in range(k):
        spec = {"n": n, "seed": 2, "part": part}
        info = get("/api/v1/data/subset", subset=spec).get_json()
        assert (info["part"], info["parts"]) == (part, k)
        assert info["n"] == min(n, N_OBS - part * n)
        cells = get("/api/v1/data/cells", subset=spec).get_json()["cells"]
        assert len(cells) == info["n"]
        assert get("/api/v1/data/cells", subset=spec).get_json()["cells"] == cells, "deterministic"
        obs = get("/api/v1/data/obs", subset=spec, columns="total_counts").get_json()["data"]
        assert len(obs["total_counts"]) == len(cells), "every cell-axis route follows the part"
        seen += cells
    assert len(seen) == len(set(seen)) == N_OBS
    part0 = get("/api/v1/data/cells", subset={"n": n, "seed": 2}).get_json()["cells"]
    assert part0 == get("/api/v1/data/cells", subset={"n": n, "seed": 2, "part": 0}).get_json()["cells"]
    assert get("/api/v1/data/subset", subset={"n": n, "seed": 2}).get_json()["key"] == '{"n":60,"seed":2}'


def test_a_part_past_the_last_is_refused(get):
    resp = get("/api/v1/data/subset", subset={"n": 60, "seed": 0, "part": 99})
    assert resp.status_code == 400 and resp.get_json()["reason"] == "part_out_of_range"
    resp = get("/api/v1/data/cells", subset={"n": 10 ** 6, "seed": 0, "part": 1})
    assert resp.status_code == 400 and resp.get_json()["reason"] == "part_out_of_range"


def test_balanced_parts_report_their_groups(get):
    spec = {"n": 50, "seed": 1, "balance": "leiden", "part": 1}
    info = get("/api/v1/data/subset", subset=spec).get_json()
    assert sum(c["shown"] for c in info["groups"].values()) == info["n"]
    assert all({"total", "shown", "before"} <= set(c) for c in info["groups"].values())


@pytest.mark.parametrize("spec", [
    {"n": 60, "seed": 2},
    {"n": 50, "seed": 1, "balance": "leiden"},
    {"n": 40, "seed": 3, "where": [{"col": "total_counts", "op": ">", "value": 1000}]},
], ids=["uniform", "balanced", "filtered"])
def test_locate_says_which_part_shows_a_row(get, spec):
    """/subset/locate?parts=1: the part that shows each dataset row, so a
    focused cell outside the part shown can be gone to (the status strip's
    "Go to its part"), without resolving every part."""
    parts = get("/api/v1/data/subset", subset=spec).get_json()["parts"]
    where = {}
    for part in range(parts):
        rows = get("/api/v1/data/subset/locate", subset=dict(spec, part=part),
                   rows=",".join(map(str, range(get("/api/v1/data/subset", subset=dict(spec, part=part))
                                                .get_json()["n"])))).get_json()["dataset_rows"]
        where.update({r: part for r in rows})
    rows = list(range(0, N_OBS, 7))
    reply = get("/api/v1/data/subset/locate", subset=spec, dataset_rows=",".join(map(str, rows)), parts="1")
    assert reply.status_code == 200, reply.get_json()
    assert reply.get_json()["parts"] == [where.get(r) for r in rows]
    assert "locate_parts" in get("/api/v1/data/subset", subset=spec).get_json()["features"]
