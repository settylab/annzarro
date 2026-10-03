#!/bin/bash
#
# Run Annzarro with Gunicorn for production
#

# Configuration: the same merged config as `annzarro start` (built-in defaults,
# then this file, then ANNZARRO_* variables). Login is ON and dataset paths are
# confined to the data directory unless the configuration says otherwise.
# Start from annzarro/server/site.example.yaml.
export ANNZARRO_CONFIG=${ANNZARRO_CONFIG:-"/etc/annzarro/site.yaml"}
if [ ! -f "$ANNZARRO_CONFIG" ]; then
    echo "Error: configuration file $ANNZARRO_CONFIG not found."
    echo "Copy annzarro/server/site.example.yaml there and edit it."
    exit 1
fi
CONFIG_FILE=$ANNZARRO_CONFIG

# Set Python path to include project directory
export PYTHONPATH=$(pwd):$PYTHONPATH

# Check if Gunicorn is installed
if ! command -v gunicorn &> /dev/null; then
    echo "Error: gunicorn is not installed. Please install it with: pip install gunicorn"
    exit 1
fi

echo "Starting Annzarro with Gunicorn..."
echo "Using config file: $CONFIG_FILE"

# Run Gunicorn with config
# (The old target "annzarro.server:create_app()" did not exist, and create_app()
# without a config ran with login off; use the hosted WSGI factory.)
gunicorn -c python:annzarro.server.gunicorn_config "annzarro.server.wsgi:create_wsgi_app()"