"""The legacy dataset listing and /status do not walk a data directory without bound.

Both used to visit every file under the data directory, chunk files of the
stores included (a 95-million-cell store has hundreds of thousands), on each
call, from any client, and /status slept 0.2 s per call to sample the CPU.
"""
import os
import shutil
from unittest.mock import patch

import psutil
import pytest

from annzarro.server.core import create_app

FIXTURE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "fixture_small.zarr")


def _layout(tmp_path, chunks=2000, stores=2, plain_dirs=0):
    root = tmp_path / "data"
    root.mkdir(parents=True)
    for i in range(stores):
        store = root / f"s{i}.zarr"
        shutil.copytree(FIXTURE, store)
        for k in range(chunks):
            (store / "X" / f"extra.{k}").write_text("")
    for i in range(plain_dirs):
        (root / f"plain{i:03d}").mkdir()
    return root


def _app(root, **extra):
    return create_app({"TESTING": True, "DEBUG": False, "auth_enabled": False, "data_dir": str(root),
                       "cache_enabled": False, **extra})


def test_a_scan_does_not_visit_the_chunks_of_a_store(tmp_path):
    from annzarro.data.scan import count_stores, scan_stores
    root = _layout(tmp_path)
    found, truncated = scan_stores(str(root), max_entries=50)
    assert sorted(os.path.basename(p) for p in found) == ["s0.zarr", "s1.zarr"] and not truncated
    assert count_stores(str(root), max_entries=50) == (2, False)


def test_a_scan_stops_at_its_limit_and_says_so(tmp_path):
    from annzarro.data.scan import count_stores, scan_stores
    root = _layout(tmp_path, chunks=0, stores=1, plain_dirs=40)
    found, truncated = scan_stores(str(root), max_entries=10)
    assert truncated and len(found) <= 1
    count, truncated = count_stores(str(root), max_entries=10)
    assert truncated


def test_scan_follows_the_recursion_and_link_options(tmp_path):
    from annzarro.data.scan import count_stores, scan_stores
    root = _layout(tmp_path, chunks=0, stores=1)
    (root / "deep" / "deeper").mkdir(parents=True)
    shutil.copytree(FIXTURE, root / "deep" / "deeper" / "d.zarr")
    shutil.copytree(FIXTURE, root / "deep" / "m.zarr")
    os.symlink(root / "s0.zarr", root / "link.zarr")
    names = lambda **kw: sorted(os.path.relpath(p, root) for p in scan_stores(str(root), **kw)[0])
    assert names() == ["deep/deeper/d.zarr", "deep/m.zarr", "link.zarr", "s0.zarr"]
    assert names(follow_symlinks=False) == ["deep/deeper/d.zarr", "deep/m.zarr", "s0.zarr"]
    assert names(recursive=False) == ["deep/m.zarr", "link.zarr", "s0.zarr"]


def test_the_legacy_listing_reports_a_truncated_scan(tmp_path):
    root = _layout(tmp_path, chunks=0, stores=1, plain_dirs=40)
    client = _app(root, dataset_scan_max_entries=10).test_client()
    reply = client.get("/api/v1/core/datasets").get_json()
    assert reply["truncated"] is True and reply["reason"] == "scan_limit" and "note" in reply
    whole = _app(root).test_client().get("/api/v1/core/datasets").get_json()
    assert "truncated" not in whole and len(whole["datasets"]) == 1


def test_status_counts_stores_within_the_limit_and_does_not_sleep(tmp_path):
    root = _layout(tmp_path, plain_dirs=40)
    client = _app(root, dataset_scan_max_entries=30).test_client()
    with patch.object(psutil.Process, "cpu_percent", return_value=0.0) as cpu, \
            patch.object(psutil, "cpu_percent", return_value=0.0) as system:
        reply = client.get("/api/v1/status").get_json()
    assert reply["data"]["zarr_file_count_truncated"] is True
    for call in cpu.call_args_list + system.call_args_list:
        assert not call.kwargs.get("interval"), "a blocking CPU sample holds a thread per /status call"
    full = _app(root).test_client().get("/api/v1/status").get_json()["data"]
    assert full["zarr_file_count"] == 2 and full["zarr_file_count_truncated"] is False


def test_status_reuses_its_count(tmp_path):
    root = _layout(tmp_path, chunks=0, stores=1)
    client = _app(root).test_client()
    assert client.get("/api/v1/status").get_json()["data"]["zarr_file_count"] == 1
    shutil.copytree(FIXTURE, root / "late.zarr")
    assert client.get("/api/v1/status").get_json()["data"]["zarr_file_count"] == 1


def test_a_directory_listing_stops_at_the_limit_and_opens_each_store_once(tmp_path):
    from annzarro.core import zarr_reader
    root = _layout(tmp_path, chunks=0, stores=2, plain_dirs=40)
    client = _app(root, dataset_scan_max_entries=10).test_client()
    reply = client.get("/api/v1/directories/list", query_string={"path": str(root)}).get_json()
    assert reply["truncated"] is True and reply["reason"] == "scan_limit"
    assert len(reply["directories"]) + len(reply["zarr_stores"]) <= 10

    root = _layout(tmp_path / "second", chunks=0, stores=2)
    client = _app(root).test_client()
    real = zarr_reader.get_basic_counts
    with patch.object(zarr_reader, "get_basic_counts", side_effect=real) as opened:
        first = client.get("/api/v1/directories/list", query_string={"path": str(root)}).get_json()
        again = client.get("/api/v1/directories/list", query_string={"path": str(root)}).get_json()
    assert "truncated" not in first and first == again and len(first["zarr_stores"]) == 2
    assert opened.call_count == 2, "each store is opened once, not once per listing"
