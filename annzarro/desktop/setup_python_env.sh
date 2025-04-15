#!/bin/bash
# Script to set up a Python environment for the AnnZarro desktop app
# Uses the improved annzarro-install.py script to manage dependencies

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "${SCRIPT_DIR}/../.." && pwd )"
TARGET_DIR="${SCRIPT_DIR}/electron/python"
INSTALLER_SCRIPT="${REPO_ROOT}/annzarro-install.py"

echo "Setting up Python environment for AnnZarro desktop app"
echo "Target directory: ${TARGET_DIR}"

# Create target directory if it doesn't exist
if [ ! -d "${TARGET_DIR}" ]; then
    mkdir -p "${TARGET_DIR}"
    echo "Created target directory"
fi

# Check if the installer script exists
if [ ! -f "${INSTALLER_SCRIPT}" ]; then
    echo "Error: Installer script not found at ${INSTALLER_SCRIPT}"
    exit 1
fi

# Run the installer with our target directory as the venv path
# The improved CLI will automatically check for UV and fall back to pip if needed
echo "Installing AnnZarro with dependencies..."
python3 "${INSTALLER_SCRIPT}" --venv-path "${TARGET_DIR}" --clean

# Validate the installation by checking for key files
if [ -f "${TARGET_DIR}/bin/python" ] || [ -f "${TARGET_DIR}/bin/python3" ]; then
    echo "Python environment was set up successfully"
else
    echo "Warning: Python environment may not have been set up correctly"
    echo "Check for errors in the installation output"
fi

echo "Python environment setup complete"
echo "To activate this environment: source ${TARGET_DIR}/bin/activate"
echo "To build the desktop app with this environment: ./annzarro-cli desktop build --platform <platform>"