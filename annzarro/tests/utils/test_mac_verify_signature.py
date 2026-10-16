"""mac_verify_signature.sh retries ``stapler validate`` when Apple's ticket service drops the
connection (error 68, CloudKit -1005 "The network connection was lost": the v0.5.4 release failed
there after a good notarization), and never retries a real "no ticket stapled" answer.

Fake ``codesign``, ``spctl`` and ``xcrun`` on PATH; no Apple service or credential is involved.
"""
import os
import stat
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "desktop" / "scripts" / "mac_verify_signature.sh"

pytestmark = pytest.mark.skipif(sys.platform == "win32", reason="a bash script")

NETWORK = 'echo "CloudKit query failed due to \\"Error Domain=NSURLErrorDomain Code=-1005 The network connection was lost.\\"" >&2; echo "Could not validate ticket for $3. Error 68." >&2; exit 68'
NO_TICKET = 'echo "$3 does not have a ticket stapled to it. Error 65." >&2; exit 65'


def _run(tmp_path, validate_failure, failures, dmgs=0):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    count = tmp_path / "validate-count"
    count.write_text("0")

    def tool(name, body):
        p = bin_dir / name
        p.write_text("#!/bin/bash\n" + body + "\n")
        p.chmod(p.stat().st_mode | stat.S_IEXEC)

    tool("codesign", "exit 0")
    tool("spctl", 'echo "$3: accepted"; echo "source=Notarized Developer ID"; exit 0')
    tool("xcrun", f"""if [[ "$1 $2" == "stapler validate" ]]; then
  n=$(( $(cat {count}) + 1 )); echo $n > {count}
  if (( n <= {failures} )); then {validate_failure}; fi
  echo "The validate action worked!"; exit 0
fi
exit 1""")
    app = tmp_path / "AnnZarro.app"
    app.mkdir()
    args = [str(app)]
    for i in range(dmgs):
        d = tmp_path / f"AnnZarro-{i}.dmg"
        d.write_bytes(b"dmg")
        args.append(str(d))
    env = {**os.environ, "PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}", "ANNZARRO_STAPLE_PAUSE_S": "0"}
    done = subprocess.run(["bash", str(SCRIPT), *args], env=env, capture_output=True, text=True)
    return done, int(count.read_text())


def test_a_dropped_connection_is_retried_until_the_ticket_validates(tmp_path):
    done, attempts = _run(tmp_path, NETWORK, failures=2, dmgs=1)
    assert done.returncode == 0, done.stderr
    assert attempts == 4  # the app: 3 tries, the dmg: 1
    assert "attempt 2 of 5" in done.stderr and "signature checks passed" in done.stdout


def test_a_persistent_network_error_gives_up_after_five_attempts(tmp_path):
    done, attempts = _run(tmp_path, NETWORK, failures=99)
    assert done.returncode != 0 and attempts == 5
    assert "gave up" in done.stderr and "signature checks passed" not in done.stdout


def test_a_missing_ticket_fails_at_once_and_is_never_retried(tmp_path):
    done, attempts = _run(tmp_path, NO_TICKET, failures=99)
    assert done.returncode == 65 and attempts == 1
    assert "not a network error" in done.stderr and "signature checks passed" not in done.stdout

