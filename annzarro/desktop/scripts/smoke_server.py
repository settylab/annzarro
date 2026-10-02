#!/usr/bin/env python3
"""Start a frozen ``annzarro-server`` the way the desktop app does and check it serves.

Uses only the standard library, so it runs on a bare CI runner. Checks:

* ``GET /api/v1/datasets`` answers with JSON;
* ``GET /`` serves the UI page, and its vendored Plotly bundle is served;
* with ``--dataset``, the store is opened by path (as the app's dataset
  browser does) and one gene's expression column is read.

    python annzarro/desktop/scripts/smoke_server.py PATH/TO/annzarro-server \
        [--dataset bm_aging.zarr] [--port 8865]
"""

import argparse
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request


def free_port(start):
    for port in range(start, start + 50):
        with socket.socket() as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    raise SystemExit(f"no free port in {start}..{start + 49}")


def get(url, timeout=30):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return r.status, r.headers.get("Content-Type", ""), r.read()


def check(cond, msg):
    print(("ok   " if cond else "FAIL ") + msg, flush=True)
    if not cond:
        raise SystemExit(1)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("server", help="path to the frozen annzarro-server executable")
    p.add_argument("--dataset", help="an AnnData .zarr store to open and read a gene from")
    p.add_argument("--port", type=int, default=8865, help="first port to try (default 8865)")
    p.add_argument("--timeout", type=float, default=180, help="seconds to wait for startup")
    args = p.parse_args(argv)

    port = free_port(args.port)
    base = f"http://127.0.0.1:{port}"
    tmp = tempfile.mkdtemp(prefix="annzarro-smoke-")
    data_dir = os.path.join(tmp, "data")
    os.makedirs(os.path.join(data_dir, "datasets"))
    env = dict(os.environ, ANNZARRO_HOME=os.path.join(tmp, "state"),
               ANNZARRO_ELECTRON_APP="true", ANNZARRO_HEADLESS="1")
    # Same arguments as annzarro/desktop/electron/main.js.
    cmd = [os.path.abspath(args.server), "start", "--host", "127.0.0.1", "--port", str(port),
           "--data-dir", data_dir, "--auth-disabled", "--no-browser"]
    print("+", " ".join(cmd), flush=True)
    log_path = os.path.join(tmp, "server.log")
    log = open(log_path, "w")
    started = time.time()
    proc = subprocess.Popen(cmd, stdout=log, stderr=subprocess.STDOUT, cwd=tmp, env=env)
    ok = False
    try:
        while True:
            if proc.poll() is not None:
                raise SystemExit(f"server exited with code {proc.returncode} before answering")
            if time.time() - started > args.timeout:
                raise SystemExit(f"server did not answer within {args.timeout:.0f}s")
            try:
                status, ctype, body = get(base + "/api/v1/datasets", timeout=5)
                break
            except OSError:
                time.sleep(0.5)
        check(status == 200 and "json" in ctype,
              f"/api/v1/datasets answered after {time.time() - started:.1f}s: {body[:200]!r}")
        json.loads(body)

        status, ctype, body = get(base + "/")
        check(status == 200 and b"<html" in body.lower(), f"/ serves the UI ({len(body)} bytes)")
        html = body.decode("utf-8", "replace")
        plotly = re.search(r'["\']([^"\']*vendor/[^"\']*plotly[^"\']*\.js)', html)
        check(plotly is not None, "UI page references the vendored Plotly bundle")
        status, _, body = get(urllib.parse.urljoin(base + "/", plotly.group(1)))
        check(status == 200 and len(body) > 1_000_000,
              f"{plotly.group(1)} served ({len(body)} bytes)")

        if args.dataset:
            ds = os.path.abspath(args.dataset)
            q = urllib.parse.quote(ds, safe="")
            status, _, body = get(f"{base}/api/v1/data/genes?dataset_path={q}", timeout=120)
            genes = json.loads(body)
            names = genes.get("genes") if isinstance(genes, dict) else genes
            check(status == 200 and bool(names),
                  f"gene list read from {os.path.basename(ds)}: {len(names)} genes")
            status, ctype, body = get(f"{base}/api/v1/data/X?dataset_path={q}&cols=0",
                                      timeout=120)
            column = json.loads(body).get("data") if status == 200 else None
            check(bool(column), f"expression of {names[0]} (column 0 of X) read: "
                  f"{len(column or [])} cells, {len(body)} bytes, {ctype}")
        ok = True
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=15)
        except subprocess.TimeoutExpired:
            proc.kill()
        log.close()
        if not ok:
            print("---- server log ----")
            with open(log_path, errors="replace") as f:
                print(f.read()[-20000:])
        shutil.rmtree(tmp, ignore_errors=True)
    print("smoke test passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
