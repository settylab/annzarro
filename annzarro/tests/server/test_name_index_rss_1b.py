"""A dataset-wide cell-name search of a billion-cell store keeps the server's
memory under the name-index budget.

Before: the first such search built an index of every name, ~30 GB for 1e9
names, in the request. Now an index over server.name_index_max_mb is not
built; the search scans the names a chunk at a time.

Needs a store with a very large obs/_index (zarr v2, local): set
ANNZARRO_NAME_INDEX_STORE to its path (e.g. the 1e9-cell synthetic store);
skipped otherwise. Run through the bench wrapper (it samples RSS).
"""
import json
import os
import socket
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request

import pytest

psutil = pytest.importorskip("psutil")

STORE = os.environ.get("ANNZARRO_NAME_INDEX_STORE")
pytestmark = pytest.mark.skipif(not STORE or not os.path.isdir(STORE or ""),
                                reason="ANNZARRO_NAME_INDEX_STORE not set to a store")

BUDGET_MB = 2048
SCAN_NAMES = 30_000_000        # keeps the test short; the default is 100M


def _tree_rss(p):
    total = 0
    for q in [p] + p.children(recursive=True):
        try:
            total += q.memory_info().rss
        except psutil.Error:
            pass
    return total


def test_dataset_wide_name_search_stays_under_the_budget(tmp_path):
    data = tmp_path / "data"
    home = tmp_path / "home"
    data.mkdir()
    home.mkdir()
    os.symlink(STORE, data / "big.zarr")
    (home / "c.yaml").write_text(
        f"server:\n  name_index_max_mb: {BUDGET_MB}\n  name_search_scan_names: {SCAN_NAMES}\n")
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    env = dict(os.environ, ANNZARRO_HOME=str(home), ANNZARRO_HEADLESS="1")
    proc = subprocess.Popen([sys.executable, "-m", "annzarro.cli", "start", "--config", str(home / "c.yaml"),
                             "--host", "127.0.0.1", "--port", str(port), "--data-dir", str(data),
                             "--no-browser", "--auth-disabled"],
                            env=env, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    root = f"http://127.0.0.1:{port}"
    samples, stop = [], threading.Event()
    try:
        for _ in range(240):
            try:
                urllib.request.urlopen(root + "/api/v1/config", timeout=1)
                break
            except OSError:
                time.sleep(0.25)
        else:
            pytest.fail("server did not start")
        ps = psutil.Process(proc.pid)

        def watch():
            while not stop.is_set():
                samples.append(_tree_rss(ps))
                time.sleep(0.25)
        threading.Thread(target=watch, daemon=True).start()
        time.sleep(2)
        baseline = samples[-1]

        def get(path, **q):
            with urllib.request.urlopen(f"{root}/api/v1/data/{path}?{urllib.parse.urlencode(q)}", timeout=900) as r:
                return json.load(r)
        dataset = str(data / "big.zarr")
        state = get("names/status", dataset_path=dataset, entity="cells")["state"]
        assert state == "streaming", state                     # sized from one chunk, nothing built
        miss = get("names", dataset_path=dataset, entity="cells", q="zzzz", scope="dataset", limit=20)
        assert miss["matches"] == [] and miss["partial"] is True and miss["scanned"] >= SCAN_NAMES
        assert miss["total"] > SCAN_NAMES
        first = get("names", dataset_path=dataset, entity="cells", q="", limit=3)
        assert len(first["matches"]) == 3
        hit = get("names", dataset_path=dataset, entity="cells", q=first["matches"][1]["name"], mode="exact")
        assert hit["matches"][0]["index"] == 1
        time.sleep(2)
    finally:
        stop.set()
        proc.terminate()
        try:
            proc.wait(15)
        except Exception:
            proc.kill()
    peak = max(samples)
    final = samples[-1]
    budget = BUDGET_MB * 2 ** 20
    print(f"baseline {baseline / 2**30:.2f} GiB, peak {peak / 2**30:.2f} GiB, final {final / 2**30:.2f} GiB, "
          f"budget {budget / 2**30:.2f} GiB")
    assert peak < baseline + budget, (peak, baseline, budget)
    assert final < baseline + budget / 2, (final, baseline, budget)
