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
from annzarro.server.jsonlog import log_dict_config, normalise_format
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

# Memory creep and slow leaks are bounded by recycling each worker after this
# many requests (server.max_requests; 0 = never), staggered by up to
# max_requests_jitter so they do not all restart together. A recycled worker
# starts with empty caches, so the default is high.
max_requests = int(_annzarro.get('max_requests', 20000) or 0)
max_requests_jitter = int(_annzarro.get('max_requests_jitter', 2000) or 0)
# A request line and each header have size limits, so one request cannot be
# made of megabytes of header. The request line is not limited (0): the web
# client sends the cells or genes it asks for in the URL, 12 KB for 2,000
# genes, and old deep links carry whole views; gunicorn would cap any other
# value at 8190. The reverse proxy in front bounds the line.
limit_request_line = int(_annzarro.get('limit_request_line', 0))
limit_request_fields = int(_annzarro.get('limit_request_fields', 100))
limit_request_field_size = int(_annzarro.get('limit_request_field_size', 8190))

# gunicorn 26 opens a control socket (for `gunicornc`) at ./.gunicorn/gunicorn.ctl
# or the like. It is not used here, and a long working directory (AF_UNIX paths
# hold about 100 bytes) or a bind mount made every start log an ERROR. Gunicorn
# before 26 has no such setting and ignores this name: only names that match a
# setting are read from this file.
control_socket_disable = True

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
# server.log_format: json: gunicorn's own messages as JSON lines too, and no
# gunicorn access log; the app writes the access line itself, with the request
# id and the route group instead of the client address and the URL.
if normalise_format(_annzarro.get('log_format')) == 'json':
    accesslog = None
    logconfig_dict = log_dict_config(loglevel.upper())


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
