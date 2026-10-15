"""A process the tests spawn runs the checkout under test, not an installed copy of annzarro."""
import os
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))


def _where(cwd, code):
    out = subprocess.run([sys.executable, "-c", code], cwd=cwd, capture_output=True, text=True, timeout=120)
    assert out.returncode == 0, out.stderr
    return os.path.realpath(out.stdout.strip())


def test_a_spawned_process_imports_this_checkouts_annzarro(tmp_path):
    # from a temporary directory, as the servers the browser tests start run
    package = _where(tmp_path, "import annzarro, os; print(os.path.dirname(annzarro.__file__))")
    assert package == os.path.realpath(os.path.join(REPO, "annzarro")), (
        f"a spawned process imports {package}, not this checkout ({REPO}): the tests would pass or fail "
        "on another tree's code")


def test_the_cli_a_server_is_started_with_is_this_checkouts(tmp_path):
    cli = _where(tmp_path, "import annzarro.cli as c; print(c.__file__)")
    assert cli.startswith(os.path.realpath(REPO) + os.sep), cli
