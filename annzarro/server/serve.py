"""
``annzarro serve``: the production server, one command
------------------------------------------------------

Runs gunicorn with the bundled configuration, i.e. exactly

    gunicorn -c python:annzarro.server.gunicorn_config "annzarro.server.wsgi:create_wsgi_app()"

so the app is hosted (paths confined, remote-store policy for shared servers)
and login is ON unless the configuration says ``auth.enabled: false``.

The command REPLACES itself with gunicorn (``exec``) instead of embedding it:
gunicorn's master then is the process the service manager started, with the
same PID, and receives SIGTERM/SIGHUP/SIGTTIN itself, so ``systemctl stop``,
``systemctl reload`` and a pid file behave as for a bare gunicorn command. A
Python wrapper in between would have to forward every signal.

Flags reach gunicorn through the same configuration it already reads: they are
exported as ``ANNZARRO_SERVER_HOST`` and friends (which win over every
configuration file), and ``--config`` as ``ANNZARRO_CONFIG``.
"""

import importlib
import importlib.util
import os
import sys

__all__ = ["add_parser", "prepare_serve", "serve_command"]

WSGI_TARGET = "annzarro.server.wsgi:create_wsgi_app()"
GUNICORN_CONFIG = "python:annzarro.server.gunicorn_config"

# flag name -> environment variable the configuration manager maps to a key
_FLAG_ENV = {
    "host": "ANNZARRO_SERVER_HOST",
    "port": "ANNZARRO_SERVER_PORT",
    "workers": "ANNZARRO_SERVER_WORKERS",
    "threads": "ANNZARRO_SERVER_THREADS",
}


class ServeError(Exception):
    """A reason `annzarro serve` cannot start, worded for the person running it."""


def add_parser(subparsers):
    """Register ``serve`` on the CLI's subparsers."""
    import argparse

    parser = subparsers.add_parser(
        "serve",
        help="Start the production server (gunicorn; pip install 'annzarro[server]')",
        description="Start the production server: gunicorn with the bundled AnnZarro "
                    "configuration. Hosted mode: login is on unless the configuration "
                    "turns it off. Options after -- go to gunicorn.",
    )
    parser.add_argument("--config", default=argparse.SUPPRESS,
                        help="Path to configuration file (default: $ANNZARRO_CONFIG)")
    parser.add_argument("--host", help="Address to bind (server.host)")
    parser.add_argument("--port", type=int, help="Port to bind (server.port)")
    parser.add_argument("--workers", type=int, help="Worker processes (server.workers)")
    parser.add_argument("--threads", type=int, help="Threads per worker (server.threads)")
    parser.add_argument("gunicorn_args", nargs=argparse.REMAINDER, metavar="-- GUNICORN_ARGS",
                        help="Extra gunicorn options, e.g. -- --timeout 120")
    parser.set_defaults(func=serve_command)
    return parser


def gunicorn_argv(extra=()):
    """The command line that starts gunicorn on the AnnZarro WSGI factory.

    Uses ``python -m gunicorn`` of this interpreter, so it is the gunicorn of
    the environment AnnZarro is installed in whatever ``PATH`` says.
    """
    extra = list(extra)
    if extra and extra[0] == "--":
        extra = extra[1:]
    return [sys.executable, "-m", "gunicorn", "-c", GUNICORN_CONFIG, *extra, WSGI_TARGET]


def _check_runnable():
    if sys.platform == "win32":
        raise ServeError("gunicorn does not run on Windows. Use `annzarro start` "
                         "(waitress) to serve from this machine.")
    if importlib.util.find_spec("gunicorn") is None:
        raise ServeError("gunicorn is not installed. Install it with:\n"
                         "    pip install 'annzarro[server]'")


def prepare_serve(args):
    """Export the flags, validate the configuration and describe the start.

    Returns:
        (argv, summary): the gunicorn command line and the startup summary text.

    Raises:
        ServeError: gunicorn is missing, the platform lacks it, or the
            configuration is invalid.
    """
    _check_runnable()

    config = getattr(args, "config", None) or os.environ.get("ANNZARRO_CONFIG")
    if config:
        config = os.path.abspath(os.path.expanduser(config))
        if not os.path.isfile(config):
            raise ServeError(f"configuration file not found: {config}")
        os.environ["ANNZARRO_CONFIG"] = config
    for flag, variable in _FLAG_ENV.items():
        value = getattr(args, flag, None)
        if value is not None:
            os.environ[variable] = str(value)

    from annzarro.server.wsgi import load_hosted_config
    try:
        flat = load_hosted_config()
        # gunicorn_config derives bind/workers/threads from the same
        # configuration, so the summary cannot differ from what gunicorn runs.
        sys.modules.pop("annzarro.server.gunicorn_config", None)
        settings = importlib.import_module("annzarro.server.gunicorn_config")
    except (RuntimeError, ValueError, OSError) as e:
        raise ServeError(str(e))

    bind = settings.bind
    auth = "on" if flat.get("auth_enabled", True) else "OFF (anyone who can reach the port has access)"
    summary = "\n".join([
        "AnnZarro production server (gunicorn)",
        f"  URL:      http://{bind}",
        f"  workers:  {settings.workers} x {settings.threads} threads",
        f"  login:    {auth}",
        f"  config:   {config or 'built-in configs only (no ANNZARRO_CONFIG, no --config)'}",
    ])
    return gunicorn_argv(getattr(args, "gunicorn_args", None) or []), summary


def serve_command(args, _exec=None):
    """``annzarro serve``: print the summary, then become gunicorn."""
    try:
        argv, summary = prepare_serve(args)
    except ServeError as e:
        print(f"annzarro serve: {e}", file=sys.stderr)
        return 1
    print(summary, file=sys.stderr, flush=True)
    (_exec or os.execv)(argv[0], argv)
    return 0  # only reached when _exec is replaced in tests
