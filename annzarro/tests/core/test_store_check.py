"""``annzarro store check``: one fixture per finding, the JSON report, the exit codes, a remote store.

The check reads metadata only, so the fixtures are metadata only: arrays of the
size of a 1-million-cell atlas are created and never written, which costs no
disk. A test that read a chunk would get zeros, and ``test_reads_no_chunks``
makes it an error instead.
"""
import functools
import http.server
import json
import threading

import numpy as np
import pytest
import zarr

from annzarro import cli
from annzarro.core import layout_thresholds as T
from annzarro.core import read_guard, store_check

ZARR3 = int(zarr.__version__.split(".")[0]) >= 3
FORMATS = [2, pytest.param(3, marks=pytest.mark.skipif(not ZARR3, reason="format 3 needs zarr >= 3"))]

N_OBS, N_VARS = 1_000_000, 5_000


# --- fixtures: stores of the size of an atlas, without data -----------------

def _array(group, name, shape, dtype="float32", chunks=None, shards=None):
    chunks = tuple(chunks) if chunks else tuple(min(s, 1024) or 1 for s in shape)
    if not ZARR3:
        return group.create_dataset(name, shape=shape, dtype=dtype, chunks=chunks)
    kw = {"shards": tuple(shards)} if shards else {}
    return group.create_array(name, shape=shape, dtype=dtype, chunks=chunks, **kw)


def _encode(node, encoding):
    node.attrs["encoding-type"] = encoding
    node.attrs["encoding-version"] = "0.1.0"


def _sparse(parent, name, shape, nnz, fmt="csc", dtype="float32", chunks=(1 << 20,)):
    group = parent.create_group(name)
    _encode(group, f"{fmt}_matrix")
    group.attrs["shape"] = list(shape)
    major = shape[1] if fmt == "csc" else shape[0]
    _array(group, "data", (nnz,), dtype, chunks)
    _array(group, "indices", (nnz,), "int32", chunks)
    _array(group, "indptr", (major + 1,), "int64", (min(major + 1, 1 << 20),))
    return group


def _dataframe(parent, name, n, columns=()):
    group = parent.create_group(name)
    _encode(group, "dataframe")
    group.attrs["_index"] = "_index"
    group.attrs["column-order"] = list(columns)
    _array(group, "_index", (n,), "int64", (min(n, 1 << 20),))
    return group


def new_store(path, fmt=2, n_obs=N_OBS, n_vars=N_VARS, x="csc", nnz=101_000_000, consolidate=False):
    """An AnnData-shaped store; ``x``: "csc", "csr" or "dense" (chunks following the matrix)."""
    kw = {"zarr_format": fmt} if ZARR3 else {}
    root = zarr.open_group(str(path), mode="w", **kw)
    _encode(root, "anndata")
    if x == "dense":
        _array(root, "X", (n_obs, n_vars), "float32", T.layer_chunks(n_obs, n_vars))
    else:
        _sparse(root, "X", (n_obs, n_vars), nnz, x)
    _dataframe(root, "obs", n_obs)
    _dataframe(root, "var", n_vars)
    for group in ("obsm", "layers", "obsp", "varp"):
        _encode(root.create_group(group), "dict")
    _array(root["obsm"], "X_umap", (n_obs, 2), "float32", (n_obs, 2))
    if consolidate:
        zarr.consolidate_metadata(str(path), **({"zarr_format": fmt} if ZARR3 else {}))
    return root


def reopen(path, fmt):
    kw = {"zarr_format": fmt} if ZARR3 else {}
    return zarr.open_group(str(path), mode="r+", use_consolidated=False, **kw) if ZARR3 \
        else zarr.open_group(str(path), mode="r+")


def consolidate(path, fmt):
    zarr.consolidate_metadata(str(path), **({"zarr_format": fmt} if ZARR3 else {}))


def codes(report, element=None):
    return {f["code"] for f in report["findings"] if element is None or f["element"] == element}


def finding(report, code, element=None):
    found = [f for f in report["findings"] if f["code"] == code and (element is None or f["element"] == element)]
    assert found, f"no {code} finding for {element}; got {[(f['code'], f['element']) for f in report['findings']]}"
    return found[0]


@pytest.fixture
def store(tmp_path):
    return tmp_path / "atlas.zarr"


# --- sparse direction -------------------------------------------------------

@pytest.mark.parametrize("fmt", FORMATS)
def test_csr_x_is_slow_for_a_gene_click(store, fmt):
    new_store(store, fmt, x="csr")
    report = store_check.check_store(str(store))
    f = finding(report, "sparse_wrong_direction", "X")
    assert f["severity"] == "slow"
    assert f["details"]["read_bytes"] == 101_000_000 * 8        # float32 values + int32 indices
    assert f["details"]["estimated_seconds"] == pytest.approx(0.101, abs=0.001)
    assert "every non-zero value of X" in f["cost"] and "Each gene click" in f["cost"]
    assert "sp.csc_matrix(adata.X)" in f["fix"] and "write_zarr" in f["fix"]
    assert report["zarr_format"] == fmt
    row = next(a for a in report["arrays"] if a["element"] == "X")
    assert row["encoding"] == "csr" and row["severity"] == "slow"
    assert row["gene_column_bytes"] == 101_000_000 * 8
    assert row["cell_row_bytes"] <= 8 * 2 ** 20           # one chunk of values and of indices


@pytest.mark.parametrize("fmt", FORMATS)
def test_csc_x_is_fine_for_genes_and_only_noted_for_cells(store, fmt):
    new_store(store, fmt, x="csc")
    report = store_check.check_store(str(store))
    assert "sparse_wrong_direction" not in codes(report)
    f = finding(report, "sparse_cell_direction", "X")
    assert f["severity"] == "info"
    row = next(a for a in report["arrays"] if a["element"] == "X")
    assert row["gene_column_bytes"] < 20 * 2 ** 20 < row["cell_row_bytes"]
    assert report["worst"] == "info"


def test_cell_direction_of_csc_is_a_warning_from_a_gigabyte(store):
    root = new_store(store, nnz=101_000_000)                         # 808 MB: info
    _sparse(root["layers"], "big", (N_OBS, N_VARS), 200_000_000, "csc")     # 1.6 GB
    report = store_check.check_store(str(store))
    assert finding(report, "sparse_cell_direction", "X")["severity"] == "info"
    big = finding(report, "sparse_cell_direction", "layers/big")
    assert big["severity"] == "warning"
    assert "Gene Plot" in big["cost"] and "table column" in big["cost"]


def test_csr_layer_severity_follows_its_size(store):
    root = new_store(store)
    _sparse(root["layers"], "small", (N_OBS, N_VARS), 6_000_000, "csr")      # ~6 ms
    _sparse(root["layers"], "medium", (N_OBS, N_VARS), 30_000_000, "csr")    # ~30 ms
    _sparse(root["layers"], "big", (N_OBS, N_VARS), 300_000_000, "csr")      # ~300 ms
    _sparse(root["layers"], "huge", (N_OBS, N_VARS), 900_000_000, "csr")
    _sparse(root["layers"], "tiny", (100, 50), 500, "csr")                   # nothing to report
    report = store_check.check_store(str(store))
    sev = {f["element"]: f["severity"] for f in report["findings"] if f["code"] == "sparse_wrong_direction"}
    assert sev == {"layers/small": "info", "layers/medium": "warning", "layers/big": "slow",
                   "layers/huge": "slow"}


def test_csc_pairwise_matrix_is_read_by_row(store):
    root = new_store(store)
    _sparse(root["obsp"], "connectivities", (N_OBS, N_OBS), 600_000_000, "csc")
    _sparse(root["obsp"], "good", (N_OBS, N_OBS), 600_000_000, "csr")
    report = store_check.check_store(str(store))
    f = finding(report, "sparse_wrong_direction", "obsp/connectivities")
    assert f["severity"] == "slow" and "Each cell click" in f["cost"]
    assert "sp.csr_matrix" in f["fix"]
    assert "obsp/good" not in {x["element"] for x in report["findings"]}


# --- dense chunk shape ------------------------------------------------------

@pytest.mark.parametrize("fmt", FORMATS)
def test_whole_gene_chunks_make_a_cell_click_slow(store, fmt):
    root = new_store(store, fmt)
    _array(root["layers"], "whole_gene", (N_OBS, N_VARS), "float32", (N_OBS, 64))
    _array(root["layers"], "rule", (N_OBS, N_VARS), "float32", T.layer_chunks(N_OBS, N_VARS))
    _array(root["layers"], "anndata_default", (N_OBS, N_VARS), "float32", (15625, 79))
    consolidate(store, fmt)
    report = store_check.check_store(str(store))
    f = finding(report, "dense_chunk_shape", "layers/whole_gene")
    assert f["severity"] == "slow" and f["details"]["read"] == "cell row"
    assert f["details"]["suggested_chunks"] == [8192, 64]
    assert "(8192, 64)" in f["fix"] and "consolidate_metadata" in f["fix"]
    assert "layers/rule" not in {x["element"] for x in report["findings"]}
    assert "layers/anndata_default" not in {x["element"] for x in report["findings"]}


def test_whole_cell_chunks_make_a_gene_click_slow(store):
    root = new_store(store)
    _array(root["layers"], "whole_cell", (N_OBS, N_VARS), "float32", (256, N_VARS))
    f = finding(store_check.check_store(str(store)), "dense_chunk_shape", "layers/whole_cell")
    assert f["severity"] == "slow" and f["details"]["read"] == "gene column"


def test_a_small_matrix_is_not_flagged_for_its_chunks(store):
    root = new_store(store, n_obs=8090, n_vars=16285)
    _array(root["layers"], "square", (8090, 16285), "float32", (1024, 1024))
    assert "layers/square" not in {f["element"] for f in store_check.check_store(str(store))["findings"]}


def test_dense_x_is_judged_like_a_layer(store):
    root = new_store(store, x="dense")
    del root["X"]
    _array(root, "X", (N_OBS, N_VARS), "float32", (N_OBS, 64))
    finding(store_check.check_store(str(store)), "dense_chunk_shape", "X")


# --- float64, chunk sizes ---------------------------------------------------

def test_float64_warns_when_big_and_stays_quiet_when_small(store):
    root = new_store(store)
    _array(root["layers"], "wide", (N_OBS, 100), "float64", (8192, 100))        # 800 MB
    _array(root["layers"], "mid", (100_000, 100), "float64", (8192, 100))       # 80 MB
    _array(root["obsm"], "tiny", (1000, 2), "float64", (1000, 2))
    _array(root["layers"], "narrow", (N_OBS, 100), "float32", (8192, 100))
    report = store_check.check_store(str(store))
    assert finding(report, "float64", "layers/wide")["severity"] == "warning"
    assert finding(report, "float64", "layers/mid")["severity"] == "info"
    assert "float64" not in codes(report, "obsm/tiny") | codes(report, "layers/narrow")
    assert 'astype("float32")' in finding(report, "float64", "layers/wide")["fix"]


def test_float64_sparse_values_are_found(store):
    root = new_store(store)
    _sparse(root["obsp"], "distances", (N_OBS, N_OBS), 300_000_000, "csr", dtype="float64")
    assert finding(store_check.check_store(str(store)), "float64", "obsp/distances")["severity"] == "warning"


def test_chunks_far_from_two_megabytes(store):
    root = new_store(store)
    _array(root["obsm"], "tiny_chunks", (N_OBS, 2), "float32", (100, 2))          # 800 B x 10,000
    _array(root["obsm"], "one_chunk", (N_OBS, 40), "float32", (N_OBS, 40))        # 160 MB
    _array(root["obsm"], "fine", (N_OBS, 40), "float32", (16384, 40))             # 2.5 MB
    report = store_check.check_store(str(store))
    assert finding(report, "chunk_too_small", "obsm/tiny_chunks")["details"]["chunks"] == 10_000
    assert finding(report, "chunk_too_large", "obsm/one_chunk")["severity"] == "warning"
    assert not codes(report, "obsm/fine")
    assert not codes(report, "obsm/X_umap") - {"chunk_too_large"}


# --- pairwise: the server's notice and the check agree ------------------------

def test_pairwise_rows_over_the_limit_are_the_servers_notice(store):
    root = new_store(store, n_obs=100_000, n_vars=2_000, x="csc", nnz=1_000_000)
    _array(root["obsp"], "bad", (100_000, 100_000), "float32", (1000, 100_000))      # 400 MB per row
    _array(root["obsp"], "good", (100_000, 100_000), "float32", (1, 8192))
    _array(root["varp"], "bad_varp", (2_000, 2_000), "float32", (2_000, 2_000))
    report = store_check.check_store(str(store), max_read_mb=64)
    f = finding(report, "pairwise_row_read", "obsp/bad")
    assert f["severity"] == "slow" and "focusing a cell is refused" in f["cost"]
    assert "(1, 8192)" in f["fix"]
    assert "obsp/good" not in {x["element"] for x in report["findings"]}
    assert "varp/bad_varp" not in {x["element"] for x in report["findings"]}      # 16 MB, under 64
    # the server's open-time notice names the same elements with the same sizes
    read_guard.configure(max_mb=64)
    try:
        notice = read_guard.chunking_notice(zarr.open_group(str(store), mode="r"), "agree")
    finally:
        read_guard.configure()
    assert [e["element"] for e in notice["elements"]] == ["obsp/bad"]
    assert notice["elements"][0]["row_read_mb"] == f["details"]["row_read_mb"]


def test_the_limit_comes_from_the_shared_module(store, monkeypatch):
    """Changing a threshold in layout_thresholds changes the check: the server reads the same numbers."""
    new_store(store, x="csr", nnz=101_000_000)
    assert finding(store_check.check_store(str(store)), "sparse_wrong_direction")["severity"] == "slow"
    monkeypatch.setattr(T, "SPARSE_SLOW_S", 5.0)
    assert finding(store_check.check_store(str(store)), "sparse_wrong_direction")["severity"] == "warning"


# --- obs / var --------------------------------------------------------------

def test_obs_and_var_columns_that_force_full_reads(store):
    root = new_store(store, n_obs=2_000_000, n_vars=5_000, nnz=1_000_000)
    obs = root["obs"]
    obs.attrs["column-order"] = ["label", "cell_type", "tiny", "unique_cat", "plain_str"]
    label = _array(obs, "label", (2_000_000,), "float64", (1 << 20,))              # 16 MB float64
    label.attrs["encoding-type"] = "array"
    plain = obs.create_group("cell_type")                                          # int64 codes, 3 categories
    _encode(plain, "categorical")
    _array(plain, "codes", (10_000_000,), "int64", (1 << 20,))
    _array(plain, "categories", (3,), "int64", (3,))
    uniq = obs.create_group("unique_cat")
    _encode(uniq, "categorical")
    _array(uniq, "codes", (2_000_000,), "int32", (1 << 20,))
    _array(uniq, "categories", (1_500_000,), "int64", (1 << 20,))
    small = obs.create_group("tiny")
    _encode(small, "categorical")
    _array(small, "codes", (2_000_000,), "int8", (1 << 20,))
    _array(small, "categories", (5,), "int64", (5,))
    strings = _array(obs, "plain_str", (2_000_000,), "int64", (1 << 20,))
    strings.attrs["encoding-type"] = "string-array"
    report = store_check.check_store(str(store))
    assert finding(report, "obs_string_column", "obs/plain_str")["severity"] == "warning"
    wide = finding(report, "categorical_wide_codes", "obs/cell_type")
    assert wide["details"]["code_bytes"] == 80_000_000
    assert finding(report, "categorical_unique", "obs/unique_cat")
    assert not codes(report, "obs/tiny")
    assert not any(f["code"] == "obs_string_column" and f["element"] != "obs/plain_str" for f in report["findings"])


def test_a_huge_index_is_noted_and_a_one_chunk_index_warned(store):
    new_store(store, n_obs=60_000_000, n_vars=5_000, nnz=1_000_000)
    f = finding(store_check.check_store(str(store)), "index_full_read", "obs/_index")
    assert f["severity"] == "warning" and f["details"]["rows"] == 60_000_000
    root = reopen(store, 2)
    del root["obs"]["_index"]
    _array(root["obs"], "_index", (12_000_000,), "int64", (12_000_000,))
    consolidate(store, 2)
    g = finding(store_check.check_store(str(store)), "index_full_read")
    assert g["severity"] == "warning" and "decoded whole in memory" in g["cost"]


# --- the store as a whole ---------------------------------------------------

def test_unconsolidated_metadata(store):
    root = new_store(store, consolidate=False)
    for i in range(60):
        _array(root["obsm"], f"e{i}", (10, 2), "float32", (10, 2))
    report = store_check.check_store(str(store))
    f = finding(report, "unconsolidated")
    assert f["severity"] == "warning" and "consolidate_metadata" in f["fix"]
    assert report["consolidated"] is False
    consolidate(store, 2)
    assert "unconsolidated" not in codes(store_check.check_store(str(store)))


def test_a_small_unconsolidated_store_is_not_worth_a_finding(store):
    new_store(store, n_obs=100, n_vars=10, nnz=50, consolidate=False)
    assert "unconsolidated" not in codes(store_check.check_store(str(store)))


def test_stale_consolidated_metadata(store):
    new_store(store, consolidate=True)
    root = reopen(store, 2)
    _array(root["layers"], "late", (N_OBS, 100), "float64", (8192, 100))     # added after consolidating
    report = store_check.check_store(str(store))
    f = finding(report, "stale_consolidated")
    assert f["severity"] == "slow" and "layers/late" in f["summary"]
    # AnnZarro reads the store without the stale listing, so the check judges what is on disk
    assert finding(report, "float64", "layers/late")


@pytest.mark.skipif(not ZARR3, reason="format 3 needs zarr >= 3")
def test_format_3_without_shards_and_with_them(store, tmp_path):
    root = new_store(store, 3)
    _array(root["layers"], "many", (N_OBS, N_VARS), "float32", (1000, 64))          # 12,640 x ... = 1000 x 79 chunks
    consolidate(store, 3)
    f = finding(store_check.check_store(str(store)), "unsharded_many_chunks")
    assert f["severity"] == "warning" and f["details"]["files"] >= T.MANY_CHUNKS_V3
    assert "shards" in f["fix"]
    sharded = tmp_path / "sharded.zarr"
    root = new_store(sharded, 3)
    _array(root["layers"], "many", (N_OBS, N_VARS), "float32", (1000, 64), shards=(8000, 640))
    consolidate(sharded, 3)
    report = store_check.check_store(str(sharded))
    assert "unsharded_many_chunks" not in codes(report) and "many_files" not in codes(report)
    row = next(a for a in report["arrays"] if a["element"] == "layers/many")
    assert row["chunks"] == [1000, 64] and row["shards"] == [8000, 640]


def test_too_many_small_files(store):
    root = new_store(store)
    _array(root["layers"], "many", (N_OBS, N_VARS), "float32", (500, 64))
    consolidate(store, 2)
    f = finding(store_check.check_store(str(store)), "many_files")
    assert f["severity"] == "warning" and f["details"]["files"] > T.MANY_FILES


def test_a_clean_store_has_no_findings(store):
    root = new_store(store, x="csc", nnz=1_000)
    report = store_check.check_store(str(store))
    assert report["findings"] == [] and report["worst"] == "ok"
    assert "No findings" in store_check.format_report(report)


def test_a_half_written_store_is_reported(tmp_path):
    path = tmp_path / "half.zarr"
    zarr.open_group(str(path), mode="w", **({"zarr_format": 2} if ZARR3 else {}))
    assert finding(store_check.check_store(str(path)), "not_anndata")


def test_reads_no_chunks(store, monkeypatch):
    new_store(store, x="csr")

    def refuse(*args, **kwargs):
        raise AssertionError("store check read array data")
    monkeypatch.setattr(zarr.Array, "__getitem__", refuse)
    monkeypatch.setattr(zarr.Array, "get_basic_selection", refuse, raising=False)
    assert store_check.check_store(str(store))["findings"]


# --- JSON and text ----------------------------------------------------------

FINDING_KEYS = {"code", "severity", "element", "summary", "cost", "fix", "details"}
ARRAY_KEYS = {"element", "encoding", "shape", "dtype", "chunks", "shards", "gene_column_bytes", "cell_row_bytes",
              "gene_column_seconds", "cell_row_seconds", "severity"}
REPORT_KEYS = {"schema", "annzarro_version", "store", "remote", "zarr_format", "consolidated", "nodes", "files",
               "max_read_mb", "arrays", "findings", "counts", "worst"}


def test_json_schema(store, capsys):
    root = new_store(store, x="csr")
    _array(root["layers"], "whole_gene", (N_OBS, N_VARS), "float32", (N_OBS, 64))
    assert cli.main(["store", "check", str(store), "--json"]) == 1
    report = json.loads(capsys.readouterr().out)
    assert set(report) == REPORT_KEYS | {"fail_on", "failed"}
    assert report["schema"] == "annzarro-store-check/1" == store_check.SCHEMA
    assert report["fail_on"] == "slow" and report["failed"] is True
    assert report["remote"] is False and report["zarr_format"] == 2 and isinstance(report["consolidated"], bool)
    assert set(report["counts"]) == set(T.SEVERITIES) and report["worst"] == "slow"
    assert report["counts"]["slow"] == sum(f["severity"] == "slow" for f in report["findings"])
    for a in report["arrays"]:
        assert set(a) >= ARRAY_KEYS
        assert a["severity"] in ("ok", *T.SEVERITIES)
    for f in report["findings"]:
        assert set(f) == FINDING_KEYS
        assert f["severity"] in T.SEVERITIES and isinstance(f["details"], dict)
        assert f["cost"] and f["fix"] and f["summary"]
    severities = [T.SEVERITIES.index(f["severity"]) for f in report["findings"]]
    assert severities == sorted(severities, reverse=True)


def test_text_report_names_cost_and_fix(store, capsys):
    new_store(store, x="csr")
    cli.main(["store", "check", str(store)])
    out = capsys.readouterr().out
    assert "[SLOW] sparse_wrong_direction: X" in out
    assert "Each gene click reads every non-zero value of X" in out
    assert "Fix:" in out and "sp.csc_matrix" in out
    assert "1 slow" in out


# --- exit codes -------------------------------------------------------------

def test_exit_codes(store, tmp_path, capsys):
    new_store(store, x="csr")
    s = str(store)
    assert cli.main(["store", "check", s]) == 1                                  # slow, default --fail-on slow
    assert cli.main(["store", "check", s, "--fail-on", "never"]) == 0
    assert cli.main(["store", "check", s, "--fail-on", "info"]) == 1
    clean = tmp_path / "clean.zarr"
    new_store(clean, x="csc", nnz=1000)
    assert cli.main(["store", "check", str(clean), "--fail-on", "info"]) == 0
    info_only = tmp_path / "info.zarr"
    new_store(info_only, x="csc")                                                # CSC X: an info finding
    assert cli.main(["store", "check", str(info_only)]) == 0
    assert cli.main(["store", "check", str(info_only), "--fail-on", "warning"]) == 0
    assert cli.main(["store", "check", str(info_only), "--fail-on", "info"]) == 1
    capsys.readouterr()
    assert cli.main(["store", "check", str(tmp_path / "missing.zarr")]) == 2
    assert "does not exist" in capsys.readouterr().err
    (tmp_path / "plain.h5ad").write_text("x")
    assert cli.main(["store", "check", str(tmp_path / "plain.h5ad")]) == 2


def test_exceeds():
    report = {"findings": [{"severity": "warning"}]}
    assert store_check.exceeds(report, "warning") and store_check.exceeds(report, "info")
    assert not store_check.exceeds(report, "slow") and not store_check.exceeds(report, "never")


# --- a remote store through a real HTTP server ------------------------------

pytest.importorskip("fsspec")
pytest.importorskip("aiohttp")


@pytest.fixture
def http_base(tmp_path):
    handler = type("Quiet", (http.server.SimpleHTTPRequestHandler,), {"log_message": lambda *a: None})
    server = http.server.ThreadingHTTPServer(
        ("127.0.0.1", 0), functools.partial(handler, directory=str(tmp_path)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_port}", tmp_path
    server.shutdown()
    server.server_close()


@pytest.mark.parametrize("fmt", FORMATS)
def test_remote_store_gives_the_local_findings(http_base, fmt):
    base, root_dir = http_base
    root = new_store(root_dir / "atlas.zarr", fmt, x="csr")
    _array(root["layers"], "whole_gene", (N_OBS, N_VARS), "float32", (N_OBS, 64))
    consolidate(root_dir / "atlas.zarr", fmt)
    remote = store_check.check_store(f"{base}/atlas.zarr")
    local = store_check.check_store(str(root_dir / "atlas.zarr"))
    assert remote["remote"] is True and remote["consolidated"] is True and remote["zarr_format"] == fmt
    key = lambda r: sorted((f["code"], f["element"], f["severity"]) for f in r["findings"])
    assert key(remote) == key(local)
    assert ("sparse_wrong_direction", "X", "slow") in key(remote)


def test_remote_store_without_consolidated_metadata(http_base, caplog):
    base, root_dir = http_base
    new_store(root_dir / "bare.zarr", 2, consolidate=False)
    report = store_check.check_store(f"{base}/bare.zarr")
    f = finding(report, "unconsolidated")
    assert f["severity"] == "slow" and report["consolidated"] is False


def test_unreachable_remote_store_is_an_error(http_base):
    base, _ = http_base
    with pytest.raises(store_check.StoreCheckError):
        store_check.check_store(f"{base}/nothing.zarr")


def test_max_read_mb_from_config_and_flag(store, tmp_path, capsys):
    root = new_store(store, n_obs=100_000, n_vars=2_000, nnz=1_000_000)
    _array(root["obsp"], "mid", (100_000, 100_000), "float32", (100, 100_000))      # 40 MB per row
    cfg = tmp_path / "site.yaml"
    cfg.write_text("server:\n  max_read_mb: 16\n")

    def slow_elements(*extra):
        cli.main(["store", "check", str(store), "--json", "--fail-on", "never", *extra])
        report = json.loads(capsys.readouterr().out)
        return report["max_read_mb"], {f["element"] for f in report["findings"] if f["code"] == "pairwise_row_read"}

    assert slow_elements("--max-read-mb", "64") == (64, set())
    assert slow_elements("--config", str(cfg)) == (16, {"obsp/mid"})
    assert slow_elements("--config", str(cfg), "--max-read-mb", "64") == (64, set())


# --- a deadline -------------------------------------------------------------

def test_an_expired_deadline_returns_what_was_found_and_says_partial(store):
    import time
    root = new_store(store, x="csr")
    _array(root["layers"], "whole_gene", (N_OBS, N_VARS), "float32", (N_OBS, 64))
    whole = store_check.check_store(str(store))
    assert "partial" not in whole, "the command's JSON keeps its keys"
    stopped = store_check.check_store(str(store), deadline=time.monotonic() - 1)
    assert stopped["partial"] is True and len(stopped["findings"]) < len(whole["findings"])


def test_a_deadline_that_is_not_reached_changes_nothing(store):
    import time
    root = new_store(store, x="csr")
    _array(root["layers"], "whole_gene", (N_OBS, N_VARS), "float32", (N_OBS, 64))
    whole = store_check.check_store(str(store))
    timed = store_check.check_store(str(store), deadline=time.monotonic() + 600)
    assert timed.pop("partial") is False and timed == whole


def test_a_deadline_midway_keeps_the_earlier_findings(store, monkeypatch):
    import time
    root = new_store(store, x="csr")
    for name in ("a_whole_gene", "b_whole_gene"):
        _array(root["layers"], name, (N_OBS, N_VARS), "float32", (N_OBS, 64))
    real = store_check._Checker.dense

    def slow(self, *a, **k):
        time.sleep(0.2)
        return real(self, *a, **k)
    monkeypatch.setattr(store_check._Checker, "dense", slow)
    report = store_check.check_store(str(store), deadline=time.monotonic() + 0.05)
    whole = store_check.check_store(str(store))
    assert report["partial"] is True and not whole.get("partial")
    assert codes(report, "X") == codes(whole, "X") != set(), "the finding made before the deadline stays"
    assert codes(report, "layers/a_whole_gene") and not codes(report, "layers/b_whole_gene")
    assert codes(whole, "layers/b_whole_gene")
