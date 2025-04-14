#!/bin/bash
#
# Run Annzarro with Gunicorn for production
#

# Set default configuration file
CONFIG_FILE=${ANNZARRO_CONFIG:-"/opt/annzarro/server/production_config.json"}

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
gunicorn -c server/gunicorn_config.py "annzarro.server:create_app()"