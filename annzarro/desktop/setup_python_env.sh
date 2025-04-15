#!/bin/bash
# Script to set up a Python environment for the AnnZarro desktop app

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
TARGET_DIR="${SCRIPT_DIR}/electron/python"
REQUIREMENTS_FILE="${SCRIPT_DIR}/electron/requirements.txt"

echo "Setting up Python environment for AnnZarro desktop app"
echo "Target directory: ${TARGET_DIR}"

# Create target directory if it doesn't exist
if [ ! -d "${TARGET_DIR}" ]; then
    mkdir -p "${TARGET_DIR}"
    echo "Created target directory"
fi

# Check if requirements file exists
if [ ! -f "${REQUIREMENTS_FILE}" ]; then
    echo "Error: Requirements file not found at ${REQUIREMENTS_FILE}"
    exit 1
fi

# Create virtual environment
echo "Creating Python virtual environment..."
python3 -m venv "${TARGET_DIR}"
echo "Virtual environment created at ${TARGET_DIR}"

# Activate virtual environment
echo "Activating virtual environment..."
source "${TARGET_DIR}/bin/activate"

# Upgrade pip
echo "Upgrading pip..."
pip install --upgrade pip

# Install dependencies
echo "Installing dependencies from ${REQUIREMENTS_FILE}..."
pip install -r "${REQUIREMENTS_FILE}"

# Install AnnZarro package in development mode
echo "Installing AnnZarro package..."
pip install -e "${SCRIPT_DIR}/../../"

echo "Python environment setup complete"
echo "To activate this environment: source ${TARGET_DIR}/bin/activate"
echo "To build the desktop app with this environment: ./annzarro-cli desktop build --platform <platform>"