#!/bin/bash
#
# Annzarro Server Startup Script
# Simple wrapper for starting the server with common options
#

# Default values
HOST="0.0.0.0"
PORT=8000
DEBUG=0
DATA_DIR="data"

# Parse command line options
function show_help {
    echo "Annzarro Server Startup Script"
    echo "Usage: $0 [options]"
    echo ""
    echo "Options:"
    echo "  -p, --port PORT        Port to use (default: $PORT)"
    echo "  -h, --host HOST        Host to bind to (default: $HOST)"
    echo "  -d, --data-dir DIR     Data directory (default: $DATA_DIR)"
    echo "  --debug                Enable debug mode"
    echo "  --help                 Show this help message"
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    key="$1"
    case $key in
        -p|--port)
            PORT="$2"
            shift
            shift
            ;;
        -h|--host)
            HOST="$2"
            shift
            shift
            ;;
        -d|--data-dir)
            DATA_DIR="$2"
            shift
            shift
            ;;
        --debug)
            DEBUG=1
            shift
            ;;
        --help)
            show_help
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

# Set up Python command
if command -v python3 &> /dev/null; then
    PYTHON_CMD="python3"
elif command -v python &> /dev/null; then
    PYTHON_CMD="python"
else
    echo "Error: Python not found. Please install Python 3."
    exit 1
fi

# Start the server
echo "Starting Annzarro Server..."
echo "Host: $HOST"
echo "Port: $PORT"
echo "Data directory: $DATA_DIR"
echo "Debug mode: $([ $DEBUG -eq 1 ] && echo "enabled" || echo "disabled")"
echo ""

CMD="$PYTHON_CMD -m annzarro.server --host $HOST --port $PORT --data-dir $DATA_DIR"

if [ $DEBUG -eq 1 ]; then
    CMD="$CMD --debug"
fi

echo "Running: $CMD"
echo "Press Ctrl+C to stop the server"
echo ""

# Run the server
$CMD