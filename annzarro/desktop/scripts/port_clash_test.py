#!/usr/bin/env python3
"""Launch the built app while its default port is taken, and check it still starts.

    python annzarro/desktop/scripts/port_clash_test.py PATH/TO/AnnZarro[.exe] [electron flags]

Two cases, each with a fresh profile and data directory (never the user's):

occupied
    Another program listens on 127.0.0.1:39487 and accepts connections but
    never answers. The app must notice, start its server on another port and
    load its interface there.

race (macOS and Linux)
    The port is free when the app checks it, but another program takes it
    while the app's server is still starting: this script watches for the
    server process (``annzarro-server start ... --port 39487``) and binds the
    port before the server gets to it. The server then fails with "Port 39487
    is in use"; the app must try the next port. This is how two AnnZarro
    windows started at the same moment used to fail.

Each case runs the app's self-test mode (ANNZARRO_DESKTOP_SMOKE=1) and passes
when it reports ``ANNZARRO_DESKTOP_SMOKE ok http://127.0.0.1:<port>`` with a
port other than 39487.
"""

import os
import re
import socket
import subprocess
import sys
import tempfile
import threading
import time

PORT = 39487
TIMEOUT = int(os.environ.get("PORT_CLASH_TIMEOUT", "300"))


def occupy(port):
    """Listen on 127.0.0.1:port; accept connections and never answer."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    if os.name != "nt":
        # A server that just stopped leaves TIME_WAIT connections on the
        # port; without this the bind fails right after another test.
        # (Two listeners still cannot share the port.)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("127.0.0.1", port))
    sock.listen(16)
    held = []

    def accept():
        while True:
            try:
                conn, _ = sock.accept()
            except OSError:
                return
            held.append(conn)  # keep it open, say nothing

    threading.Thread(target=accept, daemon=True).start()

    class Occupier:
        def close(self):
            # The accepted connections too: left open, they keep the port
            # looking busy to the next case on Linux.
            for conn in held:
                conn.close()
            # shutdown first: on Linux, close() alone leaves the socket
            # listening while another thread is blocked in accept().
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            sock.close()

    return Occupier()


def wait_until_free(port, timeout=60):
    """Wait until the app would see ``port`` as free (as its probe does)."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        probe = socket.socket()
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            probe.bind(("127.0.0.1", port))
            probe.listen(1)
            return
        except OSError:
            time.sleep(0.5)
        finally:
            probe.close()
    print(f"warning: 127.0.0.1:{port} still busy after {timeout}s; holders:", flush=True)
    for cmd in (["ss", "-tanp"], ["lsof", "-nP", f"-iTCP:{port}"]):
        try:
            out = subprocess.run(cmd, capture_output=True, text=True).stdout
            print("\n".join(l for l in out.splitlines() if str(port) in l or "State" in l), flush=True)
        except OSError:
            pass
    out = subprocess.run(["ps", "-eo", "pid,ppid,args"], capture_output=True, text=True).stdout
    print("\n".join(l for l in out.splitlines() if "annzarro" in l.lower()), flush=True)


def take_port_when_server_starts(port, stop):
    """Bind ``port`` as soon as a server process for it appears."""
    pattern = f"--port {port}"
    while not stop.is_set():
        out = subprocess.run(["ps", "-eo", "args"], capture_output=True, text=True).stdout
        if any("annzarro-server" in line and " start " in line and pattern in line
               for line in out.splitlines()):
            try:
                sock = occupy(port)
                print(f"race: took 127.0.0.1:{port} while the app's server was starting", flush=True)
                return sock
            except OSError as e:
                print(f"race: too late to take the port ({e})", flush=True)
                return None
        time.sleep(0.01)
    return None


def run_app(app_args, name):
    root = tempfile.mkdtemp(prefix=f"annzarro-{name}-")
    profile = os.path.join(root, "profile")
    env = dict(os.environ, ANNZARRO_DESKTOP_SMOKE="1",
               ANNZARRO_DESKTOP_DATA_DIR=os.path.join(root, "data"),
               ANNZARRO_DESKTOP_USER_DATA=profile)
    started = time.time()
    proc = subprocess.Popen(app_args, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            text=True, errors="replace")
    try:
        proc.stdout_text, _ = proc.communicate(timeout=TIMEOUT)
    except subprocess.TimeoutExpired:
        # Neither the interface nor an error page: the endless spinner.
        proc.kill()
        proc.stdout_text, _ = proc.communicate()
        print(f"[{name}] app still starting after {TIMEOUT}s (endless spinner); killed it")
    proc.stdout = proc.stdout_text
    log_path = os.path.join(profile, "logs", "main.log")
    log = open(log_path, errors="replace").read() if os.path.exists(log_path) else ""
    m = re.search(r"ANNZARRO_DESKTOP_SMOKE ok (http://127\.0\.0\.1:(\d+))", proc.stdout)
    port = int(m.group(2)) if m else None
    print(f"[{name}] app exited {proc.returncode} after {time.time() - started:.1f}s, "
          f"served on {m.group(1) if m else 'nothing'}")
    for line in log.splitlines():
        if re.search(r"Starting server:|in use|trying the next|Server ready|Interface loaded|"
                     r"Failed|could not start", line):
            print(f"[{name}]   log: {line[:200]}")
    ok = proc.returncode == 0 and port is not None and port != PORT
    if not ok:
        print(f"[{name}] FAILED. App output:\n{proc.stdout[-4000:]}")
    return ok


def main(argv):
    if not argv:
        sys.exit(__doc__)
    app_args = [os.path.abspath(argv[0])] + argv[1:]
    results = {}

    sock = occupy(PORT)
    print(f"occupied: 127.0.0.1:{PORT} is held by a program that never answers")
    try:
        results["occupied"] = run_app(app_args, "occupied")
    finally:
        sock.close()

    if os.name != "nt":
        wait_until_free(PORT)
        stop = threading.Event()
        box = {}
        watcher = threading.Thread(
            target=lambda: box.setdefault("sock", take_port_when_server_starts(PORT, stop)))
        watcher.start()
        try:
            results["race"] = run_app(app_args, "race")
        finally:
            stop.set()
            watcher.join()
            if box.get("sock"):
                box["sock"].close()
        if not box.get("sock"):
            print("race: the port could not be taken in time; this case proved nothing")
            results["race"] = False

    for name, ok in results.items():
        print(f"{name}: {'passed' if ok else 'FAILED'}")
    if not all(results.values()):
        sys.exit("port clash test failed")
    print("port clash test passed")


if __name__ == "__main__":
    main(sys.argv[1:])
