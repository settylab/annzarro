"""The container entrypoint's choice between the old /state/data layout and the new one."""
import os
import subprocess

import pytest

ENTRYPOINT = os.path.join(os.path.dirname(__file__), "..", "..", "..", "packaging", "container", "entrypoint.sh")


def fake_annzarro(tmp_path, data_dir):
    """A stand-in for `annzarro` whose `paths --format json` reports `data_dir`."""
    script = tmp_path.parent / f"{tmp_path.name}-bin"
    script.write_text('#!/bin/sh\ncat <<\'EOF\'\n{"locations": [\n  {\n    "label": "data directory",\n'
                      f'    "path": "{data_dir}",\n    "why": "x"\n  }},\n  {{\n    "label": "state directory",\n'
                      '    "path": "/state",\n    "why": "y"\n  }\n]}\nEOF\n')
    script.chmod(0o755)
    return str(script)


def decide(state, **env):
    full = {"PATH": os.environ["PATH"], "ANNZARRO_HOME": str(state), **env}
    out = subprocess.run(["sh", ENTRYPOINT, "--layout"], env=full, capture_output=True, text=True, check=True)
    return dict(line.split("=", 1) for line in out.stdout.splitlines())


def test_empty_volume_gets_the_new_layout(tmp_path):
    assert decide(tmp_path) == {"layout": "new"}


@pytest.mark.parametrize("make", [
    lambda s: (s / "data" / "sessions").mkdir(parents=True),
    lambda s: (s / "data").mkdir() or (s / "data" / "data").symlink_to("/data"),
])
def test_old_volume_keeps_serving_state_data(tmp_path, make):
    make(tmp_path)
    assert decide(tmp_path, ANNZARRO_BIN=fake_annzarro(tmp_path, "/data")) == {"layout": "old", "ANNZARRO_SERVER_DATA_DIR": f"{tmp_path}/data",
                                "ANNZARRO_SERVER_ALLOWED_DIRS": "/data"}


def test_new_volume_with_panel_sets_is_not_old(tmp_path):
    (tmp_path / "panel-sets").mkdir()
    (tmp_path / "panel-sets" / "a.json").write_text("{}")
    assert decide(tmp_path) == {"layout": "new"}


def test_operator_chosen_data_dir_is_left_alone(tmp_path):
    (tmp_path / "data" / "sessions").mkdir(parents=True)
    assert decide(tmp_path, ANNZARRO_SERVER_DATA_DIR="/srv/x") == {"layout": "new"}


def test_mounted_config_with_its_own_data_dir_is_left_alone(tmp_path):
    (tmp_path / "data" / "sessions").mkdir(parents=True)
    assert decide(tmp_path, ANNZARRO_BIN=fake_annzarro(tmp_path, "/srv/atlases")) == {"layout": "new"}


def test_mounted_config_naming_state_data_needs_no_export(tmp_path):
    (tmp_path / "data" / "sessions").mkdir(parents=True)
    assert decide(tmp_path, ANNZARRO_BIN=fake_annzarro(tmp_path, f"{tmp_path}/data")) == {"layout": "new"}


def test_old_layout_run_exports_and_hints(tmp_path):
    (tmp_path / "data" / "sessions").mkdir(parents=True)
    (tmp_path / "data" / "sessions" / "a.json").write_text("{}")
    out = subprocess.run(["sh", ENTRYPOINT, "sh", "-c", "echo $ANNZARRO_SERVER_DATA_DIR"],
                         env={"PATH": os.environ["PATH"], "ANNZARRO_HOME": str(tmp_path),
                              "ANNZARRO_BIN": fake_annzarro(tmp_path, "/data")},
                         capture_output=True, text=True, check=True)
    assert out.stdout.strip() == f"{tmp_path}/data"
    assert "panel-sets migrate" in out.stderr and "legacy" in out.stderr
