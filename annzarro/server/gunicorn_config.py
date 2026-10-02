"""
Gunicorn configuration for Annzarro production server.
"""

import multiprocessing
import os

# Read the SAME merged configuration the app will run with (base/env YAML,
# then $ANNZARRO_CONFIG, then ANNZARRO_* variables), so the bind address and
# the app's own settings cannot disagree.
from annzarro.server.wsgi import load_hosted_config

config_file = os.environ.get('ANNZARRO_CONFIG', '(none: built-in configs only)')
config = load_hosted_config()

# Server socket. Default to loopback: put a TLS-terminating reverse proxy in
# front (see README, "Deploying on a Lab Server") rather than exposing gunicorn.
bind = f"{config.get('host', '127.0.0.1')}:{config.get('port', 8000)}"

# Worker processes
workers = config.get('workers', multiprocessing.cpu_count() * 2 + 1)
worker_class = 'sync'
worker_connections = 1000
timeout = 60
keepalive = 5

# Process naming
proc_name = 'annzarro'

# Server mechanics
user = 'www-data'
group = 'www-data'
umask = 0o027  # 0o027 is equivalent to octal 027 (rwxr-x---)
daemon = False

# Logging
accesslog = config.get('access_log', '/var/log/annzarro/access.log')
errorlog = config.get('log_file', '/var/log/annzarro/error.log')
loglevel = config.get('log_level', 'info').lower()

# Server hooks
def on_starting(server):
    print(f"Starting Annzarro server on {bind}")
    print(f"Workers: {workers}")
    print(f"Config file: {config_file}")
    print(f"Log file: {errorlog}")

def worker_int(worker):
    worker.log.info("Worker received INT signal")

def worker_abort(worker):
    worker.log.info("Worker received ABORT signal")

def post_fork(server, worker):
    server.log.info(f"Worker spawned (pid: {worker.pid})")

def pre_fork(server, worker):
    pass

def pre_exec(server):
    server.log.info("Forked child, re-executing.")

# SSL configuration if enabled
if config.get('https_enabled', False):
    certfile = config.get('cert_file')
    keyfile = config.get('key_file')
    
    if certfile and keyfile and os.path.exists(certfile) and os.path.exists(keyfile):
        # Enable SSL
        ssl_version = 'TLS'
        cert_reqs = 0  # ssl.CERT_NONE
        ca_certs = None
        suppress_ragged_eofs = True
        do_handshake_on_connect = False
    else:
        print("WARNING: HTTPS is enabled in config but certificate or key file is missing.")
        print(f"Certificate file: {certfile}")
        print(f"Key file: {keyfile}")
        print("Falling back to HTTP.")

# For debugging
if config.get('debug', False):
    reload = True
    timeout = 120
    loglevel = 'debug'
    workers = 1
else:
    reload = False