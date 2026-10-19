"""
`annzarro serve`: argument and configuration handling, without starting gunicorn.

The command exports its flags as ANNZARRO_SERVER_* variables and execs gunicorn
on the bundled configuration. These tests check the command line it would
exec, that gunicorn itself parses it into the expected settings, the startup
summary, and the refusals (no gunicorn, Windows, a bad configuration).
"""
import argparse
import os
import sys

import pytest

from annzarro.server import serve

gunicorn_app = pytest.importorskip("gunicorn.app.wsgiapp")


@pytest.fixture
def site(tmp_path, monkeypatch):
    for name in list(os.environ):
        if name.startswith("ANNZARRO_"):
            monkeypatch.delenv(name, raising=False)
    (tmp_path / "data").mkdir()
    path = tmp_path / "site.yaml"
    path.write_text(
        "server:\n"
        f"  data_dir: \"{tmp_path / 'data'}\"\n"
        f"  log_file: \"{tmp_path / 'test.log'}\"\n"
        "  port: 8841\n"
        "  workers: 3\n"
        "  threads: 5\n"
        "auth:\n"
        f"  user_file: \"{tmp_path / 'users.json'}\"\n"
    )
    monkeypatch.setenv("ANNZARRO_CONFIG", str(path))
    return path


def _parse(argv_list=(), **flags):
    parser = argparse.ArgumentParser()
    serve.add_parser(parser.add_subparsers(dest="command"))
    return parser.parse_args(["serve", *argv_list], namespace=argparse.Namespace(**flags))


def _gunicorn_app(argv, monkeypatch):
    """The settings gunicorn derives from a command line, without running it."""
    monkeypatch.setattr(sys, "argv", ["gunicorn", *argv[3:]])  # drop python -m gunicorn
    return gunicorn_app.WSGIApplication("%(prog)s [OPTIONS] [APP_MODULE]")


def test_defaults_come_from_the_site_file(site, monkeypatch):
    argv, summary = serve.prepare_serve(_parse())
    app = _gunicorn_app(argv, monkeypatch)
    cfg = app.cfg
    assert cfg.bind == ["127.0.0.1:8841"]
    assert cfg.workers == 3 and cfg.threads == 5
    assert cfg.worker_class_str == "gthread"
    assert app.app_uri == serve.WSGI_TARGET
    assert "http://127.0.0.1:8841" in summary
    assert "3 x 5 threads" in summary
    assert "login:    on" in summary
    assert str(site) in summary


def test_flags_override_the_file(site, monkeypatch):
    args = _parse(["--host", "127.0.0.1", "--port", "9123", "--workers", "2", "--threads", "7"])
    argv, summary = serve.prepare_serve(args)
    app = _gunicorn_app(argv, monkeypatch)
    cfg = app.cfg
    assert cfg.bind == ["127.0.0.1:9123"]
    assert cfg.workers == 2 and cfg.threads == 7
    assert "http://127.0.0.1:9123" in summary and "2 x 7 threads" in summary


def test_config_flag_sets_the_site_file(site, tmp_path, monkeypatch):
    other = tmp_path / "other.yaml"
    other.write_text(site.read_text().replace("8841", "8842"))
    argv, summary = serve.prepare_serve(_parse(["--config", str(other)]))
    assert os.environ["ANNZARRO_CONFIG"] == str(other)
    assert _gunicorn_app(argv, monkeypatch).cfg.bind == ["127.0.0.1:8842"]
    assert str(other) in summary


def test_missing_config_file_is_an_error(site, tmp_path):
    with pytest.raises(serve.ServeError, match="not found"):
        serve.prepare_serve(_parse(["--config", str(tmp_path / "nope.yaml")]))


def test_extra_arguments_reach_gunicorn(site, monkeypatch):
    argv, _ = serve.prepare_serve(_parse(["--port", "9124", "--", "--timeout", "120"]))
    assert "--" not in argv
    app = _gunicorn_app(argv, monkeypatch)
    cfg = app.cfg
    assert cfg.timeout == 120          # the command line overrides the bundled 60
    assert cfg.bind == ["127.0.0.1:9124"]


def test_login_is_on_unless_the_configuration_turns_it_off(site, monkeypatch):
    assert "login:    on" in serve.prepare_serve(_parse())[1]
    site.write_text(site.read_text() + "  enabled: false\n")  # appended to the auth section
    assert "login:    OFF" in serve.prepare_serve(_parse())[1]


def test_invalid_configuration_is_reported(site):
    site.write_text("server:\n  port: not-a-port\n")
    with pytest.raises(serve.ServeError):
        serve.prepare_serve(_parse())


def test_gunicorn_missing_says_how_to_install(site, monkeypatch):
    monkeypatch.setattr(serve.importlib.util, "find_spec", lambda name: None)
    with pytest.raises(serve.ServeError, match=r"pip install 'annzarro\[server\]'"):
        serve.prepare_serve(_parse())


def test_windows_points_to_start(site, monkeypatch):
    monkeypatch.setattr(serve.sys, "platform", "win32")
    with pytest.raises(serve.ServeError, match="annzarro start"):
        serve.prepare_serve(_parse())


def test_serve_command_execs_gunicorn_and_prints_the_summary(site, capsys):
    calls = []
    assert serve.serve_command(_parse(), _exec=lambda path, argv: calls.append((path, argv))) == 0
    (path, argv), = calls
    assert path == sys.executable
    assert argv[1:5] == ["-m", "gunicorn", "-c", serve.GUNICORN_CONFIG]
    assert argv[-1] == serve.WSGI_TARGET
    assert "AnnZarro production server" in capsys.readouterr().err


def test_serve_command_failure_exits_1_without_exec(site, tmp_path, capsys):
    calls = []
    args = _parse(["--config", str(tmp_path / "nope.yaml")])
    assert serve.serve_command(args, _exec=lambda *a: calls.append(a)) == 1
    assert not calls and "not found" in capsys.readouterr().err


def test_cli_dispatches_serve(site, monkeypatch):
    from annzarro import cli
    seen = []
    monkeypatch.setattr(serve.os, "execv", lambda path, argv: seen.append(argv))
    assert cli.main(["serve", "--port", "9125", "--", "--timeout", "90"]) == 0
    (argv,) = seen
    assert argv[-3:-1] == ["--timeout", "90"] and argv[-1] == serve.WSGI_TARGET
