"""
Gunicorn configuration for the AnnZarro production server.

Gunicorn reads EVERY module-level name in this file that matches one of its
settings (``bind``, ``workers``, ``certfile``, ... and ``config``). So the
AnnZarro configuration is kept under a private name: a module variable called
``config`` was taken as gunicorn's own ``--config`` setting and it refused to
start ("Error: Not a string").
"""

import multiprocessing
import os

# Read the SAME merged configuration the app will run with (base/env YAML,
# then $ANNZARRO_CONFIG, then ANNZARRO_* variables), so the bind address and
# the app's own settings cannot disagree.
from annzarro.server.wsgi import load_hosted_config

_config_file = os.environ.get('ANNZARRO_CONFIG', '(none: built-in configs only)')
_annzarro = load_hosted_config()

# Server socket. Default to loopback: put a TLS-terminating reverse proxy in
# front (see README, "Deploying on a Lab Server") rather than exposing gunicorn.
bind = f"{_annzarro.get('host', '127.0.0.1')}:{_annzarro.get('port', 8000)}"

# Worker processes (server.workers). Every worker keeps its own dataset cache
# of up to cache_memory_mb, so the default is small rather than 2*CPUs+1,
# which on a 64-core node meant 129 caches.
workers = int(_annzarro.get('workers') or min(multiprocessing.cpu_count() * 2 + 1, 4))
# Threads per worker (server.threads). A sync worker serves one request at a
# time, so any slow request (a large read, a remote store) held a whole
# process; gthread lets the others through. The app is thread-safe: `annzarro
# start` serves it threaded too. (Refresh no longer sleeps in a request at
# all, issue #83.)
worker_class = 'gthread'
threads = int(_annzarro.get('threads') or 4)
timeout = 60
keepalive = 5

# Process naming
proc_name = 'annzarro'

# The account is the service manager's business (systemd ``User=``); naming a
# user here made gunicorn fail on any machine without ``www-data``.
umask = 0o027
daemon = False

# Gunicorn's own logs go to stderr (the journal under systemd); the app logs
# to server.log_file as it does under `annzarro start`.
accesslog = '-'
errorlog = '-'
loglevel = str(_annzarro.get('log_level', 'info')).lower()


# Server hooks
def on_starting(server):
    server.log.info(f"Starting AnnZarro on {bind} with {workers} workers "
                    f"(config file: {_config_file})")


# TLS directly in gunicorn (prefer a reverse proxy). Only set certfile/keyfile
# when both exist: gunicorn refuses to start on a missing one.
if _annzarro.get('https_enabled', False):
    _cert = _annzarro.get('cert_file')
    _key = _annzarro.get('key_file')
    if _cert and _key and os.path.exists(_cert) and os.path.exists(_key):
        certfile = _cert
        keyfile = _key
    else:
        print("WARNING: https_enabled is set but cert_file or key_file is missing "
              f"({_cert}, {_key}); serving plain HTTP.")

# Never reload in production; debug only makes the logs verbose.
reload = False
if _annzarro.get('debug', False):
    loglevel = 'debug'
