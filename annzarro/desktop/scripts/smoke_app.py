#!/usr/bin/env python3
"""Launch a built AnnZarro desktop app in its self-test mode and check it.

With ANNZARRO_DESKTOP_SMOKE=1 the app starts its bundled server, loads the UI
in its window, waits for Plotly, fetches /api/v1/datasets and quits, printing
``ANNZARRO_DESKTOP_SMOKE ok ...`` (see annzarro/desktop/electron/main.js).

    python annzarro/desktop/scripts/smoke_app.py PATH/TO/AnnZarro[.exe] [electron flags]

On Linux CI, run it under ``xvfb-run``.
"""

import os
import subprocess
import sys
import tempfile
import time

TIMEOUT = 300


def main(argv):
    if not argv:
        sys.exit(__doc__)
    data_dir = tempfile.mkdtemp(prefix="annzarro-app-smoke-")
    env = dict(os.environ, ANNZARRO_DESKTOP_SMOKE="1", ANNZARRO_DESKTOP_DATA_DIR=data_dir)
    cmd = [os.path.abspath(argv[0])] + argv[1:]
    print("+", " ".join(cmd), flush=True)
    started = time.time()
    proc = subprocess.Popen(cmd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            text=True, errors="replace")
    verdict = None
    try:
        for line in proc.stdout:
            print(line, end="", flush=True)
            if "ANNZARRO_DESKTOP_SMOKE " in line:
                verdict = line.split("ANNZARRO_DESKTOP_SMOKE ", 1)[1].strip()
            if time.time() - started > TIMEOUT:
                break
        proc.wait(timeout=60)
    except subprocess.TimeoutExpired:
        pass
    finally:
        if proc.poll() is None:
            proc.kill()
    print(f"app exited with {proc.returncode} after {time.time() - started:.1f}s")
    if not (verdict and verdict.startswith("ok") and proc.returncode == 0):
        sys.exit(f"desktop app smoke test failed: {verdict or 'no verdict'}")
    print("desktop app smoke test passed")


if __name__ == "__main__":
    main(sys.argv[1:])
