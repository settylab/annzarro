"""No editor or notebook artefacts are committed inside the package.

annzarro/data/.ipynb_checkpoints/manager-checkpoint.py (a stale copy of
DataManager) was committed although .gitignore lists .ipynb_checkpoints/;
it was added before the ignore rule."""
import os
import subprocess

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))


def test_no_notebook_checkpoints_are_tracked():
    out = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True)
    if out.returncode != 0:
        pytest.skip("not a git checkout")
    tracked = [p for p in out.stdout.splitlines() if ".ipynb_checkpoints/" in p]
    assert tracked == []
