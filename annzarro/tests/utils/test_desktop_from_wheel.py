"""`annzarro desktop` from a pip install says it needs a checkout, instead of
failing inside npm on a missing package.json."""
import logging

from annzarro import cli
from annzarro.desktop import builder


def test_checkout_has_the_electron_project():
    assert builder.electron_project_problem() is None


def test_problem_text_for_a_tree_without_electron(tmp_path):
    text = builder.electron_project_problem(tmp_path)
    assert "source checkout" in text and builder.RELEASES_URL in text


def test_cli_refuses_before_touching_npm(tmp_path, monkeypatch, caplog):
    real = builder.electron_project_problem
    monkeypatch.setattr(builder, "electron_project_problem", lambda app_root=None: real(tmp_path))
    called = []
    monkeypatch.setattr(builder, "run_desktop_app", lambda **kw: called.append(kw) or True)
    with caplog.at_level(logging.ERROR):
        assert cli.main(["desktop", "run"]) == 1
    assert not called
    assert builder.RELEASES_URL in caplog.text
