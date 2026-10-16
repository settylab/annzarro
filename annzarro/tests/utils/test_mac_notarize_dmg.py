"""mac_notarize_dmg.sh retries stapling: right after notarization Apple's ticket service has
dropped the connection (stapler error 68) on two releases in a row, which failed the build.

A fake ``xcrun`` on PATH answers notarytool with "Accepted" and fails ``stapler staple`` a given
number of times; no Apple service or credential is involved.
"""
import os
import stat
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "desktop" / "scripts" / "mac_notarize_dmg.sh"

pytestmark = pytest.mark.skipif(sys.platform == "win32", reason="a bash script")


def _run(tmp_path, failures):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    count = tmp_path / "staple-count"
    count.write_text("0")
    xcrun = bin_dir / "xcrun"
    xcrun.write_text(f"""#!/bin/bash
if [[ "$1" == notarytool ]]; then echo "  id: 123"; echo "  status: Accepted"; exit 0; fi
if [[ "$1 $2" == "stapler staple" ]]; then
  n=$(( $(cat {count}) + 1 )); echo $n > {count}
  if (( n <= {failures} )); then echo "The staple and validate action failed! Error 68." >&2; exit 68; fi
  echo "The staple and validate action worked!"; exit 0
fi
exit 1
""")
    xcrun.chmod(xcrun.stat().st_mode | stat.S_IEXEC)
    dmg = tmp_path / "AnnZarro.dmg"
    dmg.write_bytes(b"dmg")
    env = {**os.environ, "PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}",
           "APPLE_API_KEY": "unused.p8", "APPLE_API_KEY_ID": "unused", "APPLE_API_ISSUER": "unused",
           "ANNZARRO_STAPLE_PAUSE_S": "0"}
    done = subprocess.run(["bash", str(SCRIPT), str(dmg)], env=env, capture_output=True, text=True)
    return done, int(count.read_text())


def test_a_dropped_connection_is_retried_until_the_ticket_is_stapled(tmp_path):
    done, attempts = _run(tmp_path, failures=2)
    assert done.returncode == 0, done.stderr
    assert attempts == 3 and "attempt 2 of 5" in done.stderr


def test_it_gives_up_after_five_attempts(tmp_path):
    done, attempts = _run(tmp_path, failures=99)
    assert done.returncode == 1 and attempts == 5 and "could not staple" in done.stderr
