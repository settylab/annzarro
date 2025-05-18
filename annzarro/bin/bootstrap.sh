#!/bin/bash
# Bootstrap script for AnnZarro that eliminates Python dependency
# This script will download UV, use it to create a Python venv, then run the installer

set -e

# Find the directory containing this script and the project root
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/../.." && pwd )"

# Check if we have required tools
if ! command -v curl &> /dev/null; then
    echo "Error: curl is required but not found"
    exit 1
fi

if ! command -v tar &> /dev/null && ! command -v unzip &> /dev/null; then
    echo "Error: tar or unzip is required but not found"
    exit 1
fi

# Default virtual environment path (adjusting to use the path expected by annzarro-cli)
VENV_PATH="$PROJECT_ROOT/venv"

# Process arguments
ARGS=()
SKIP_NEXT=false
ALL_ARGS=("$@")

for ((i=0; i<${#ALL_ARGS[@]}; i++)); do
    if $SKIP_NEXT; then
        SKIP_NEXT=false
        continue
    fi
    
    if [[ "${ALL_ARGS[$i]}" == "--venv-path" ]]; then
        SKIP_NEXT=true
        VENV_PATH="${ALL_ARGS[$i+1]}"
        echo "Using custom virtual environment path: $VENV_PATH"
        continue
    fi
    
    ARGS+=("${ALL_ARGS[$i]}")
done

echo "=== AnnZarro Bootstrap Installer ==="
echo "This script will set up AnnZarro with minimal dependencies"

# Determine platform
if [[ "$OSTYPE" == "darwin"* ]]; then
    # MacOS
    if [[ $(uname -m) == "arm64" ]]; then
        PLATFORM_DIR="darwin-arm64"
    else
        PLATFORM_DIR="darwin-x64"
    fi
elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
    # Windows
    PLATFORM_DIR="win32-x64"
    UV_EXT=".exe"
elif [[ "$OSTYPE" == "linux"* ]]; then
    # Linux
    PLATFORM_DIR="linux-x64"
else
    echo "Error: Unsupported platform: $OSTYPE"
    exit 1
fi

# Step 1: Download UV if needed
UV_CMD=""
UV_EXT=""

# Check for existing UV in the repository
BUNDLED_UV="$PROJECT_ROOT/annzarro/desktop/electron/bin/$PLATFORM_DIR/uv$UV_EXT"
echo "Checking for UV at: $BUNDLED_UV"

if [ -f "$BUNDLED_UV" ]; then
    # Make executable on Unix platforms
    if [[ "$OSTYPE" != "msys" && "$OSTYPE" != "win32" ]]; then
        chmod +x "$BUNDLED_UV"
    fi
    UV_CMD="$BUNDLED_UV"
    echo "Found bundled UV at $BUNDLED_UV"
else
    # Try other locations
    ALTERNATIVE_UV="$PROJECT_ROOT/annzarro/desktop/bin/$PLATFORM_DIR/uv$UV_EXT"
    echo "Checking for UV at alternative location: $ALTERNATIVE_UV"
    
    if [ -f "$ALTERNATIVE_UV" ]; then
        # Make executable on Unix platforms
        if [[ "$OSTYPE" != "msys" && "$OSTYPE" != "win32" ]]; then
            chmod +x "$ALTERNATIVE_UV"
        fi
        UV_CMD="$ALTERNATIVE_UV"
        echo "Found bundled UV at $ALTERNATIVE_UV"
    fi
fi

# If UV not found, download it
if [ -z "$UV_CMD" ]; then
    echo "UV not found, downloading it..."
    UV_DOWNLOAD_SCRIPT="$PROJECT_ROOT/annzarro/desktop/scripts/download_uv.sh"
    
    if [ -f "$UV_DOWNLOAD_SCRIPT" ]; then
        echo "Running UV download script: $UV_DOWNLOAD_SCRIPT"
        chmod +x "$UV_DOWNLOAD_SCRIPT"
        "$UV_DOWNLOAD_SCRIPT"
        
        # Check if download succeeded
        if [ -f "$BUNDLED_UV" ]; then
            chmod +x "$BUNDLED_UV"
            UV_CMD="$BUNDLED_UV"
            echo "Successfully downloaded UV to $BUNDLED_UV"
        else
            echo "Error: Failed to download UV"
            exit 1
        fi
    else
        echo "Error: UV download script not found at $UV_DOWNLOAD_SCRIPT"
        exit 1
    fi
fi

# Handle clean option
CLEAN_VENV=false
for arg in "${ARGS[@]}"; do
    if [[ "$arg" == "--clean" ]]; then
        CLEAN_VENV=true
        break
    fi
done

# Clean up virtual environment if requested
if $CLEAN_VENV && [ -d "$VENV_PATH" ]; then
    echo "Cleaning up existing virtual environment..."
    rm -rf "$VENV_PATH"
    echo "Virtual environment removed."
fi

# Step 2: Use UV to create a virtual environment with Python
echo "Creating Python virtual environment with UV"
# Don't specify Python version - let UV find the best available version
"$UV_CMD" venv "$VENV_PATH"

# Step 3: Set up environment for the next steps
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
    # Windows
    PYTHON_BIN="$VENV_PATH/Scripts/python.exe"
else
    # Unix-like
    PYTHON_BIN="$VENV_PATH/bin/python"
fi

if [ ! -f "$PYTHON_BIN" ]; then
    echo "Error: Python executable not found at $PYTHON_BIN after creating environment"
    exit 1
fi

echo "Python environment created successfully at $VENV_PATH"
echo "Using Python at $PYTHON_BIN"

# Step 4: Run the installer script using the downloaded Python
echo "Running installer script with newly created Python environment"
INSTALLER_SCRIPT="$PROJECT_ROOT/annzarro-install.py"

if [ ! -f "$INSTALLER_SCRIPT" ]; then
    echo "Error: Installer script not found at $INSTALLER_SCRIPT"
    exit 1
fi

# Pass through any CLI arguments
"$PYTHON_BIN" "$INSTALLER_SCRIPT" --venv-path "$VENV_PATH" --use-uv --uv-path "$UV_CMD" "${ARGS[@]}"
RESULT=$?

if [ $RESULT -eq 0 ]; then
    echo "============================="
    echo "Installation completed successfully!"
    echo "You can now use ./annzarro-cli to start the application"
    echo "============================="
else
    echo "============================="
    echo "Installation failed with error code: $RESULT"
    echo "Please check the logs above for more information"
    echo "============================="
fi

exit $RESULT