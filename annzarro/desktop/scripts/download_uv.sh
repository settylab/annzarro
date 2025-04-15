#!/bin/bash
# Script to download uv binaries

set -e

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
BIN_DIR="${ROOT_DIR}/desktop/electron/bin"

# Versions and URLs
UV_VERSION="0.1.41"
UV_MACOS_URL="https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-x86_64-apple-darwin.tar.gz"
UV_MACOS_ARM_URL="https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-aarch64-apple-darwin.tar.gz"
UV_LINUX_URL="https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-x86_64-unknown-linux-gnu.tar.gz"
UV_WINDOWS_URL="https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-x86_64-pc-windows-msvc.zip"

# Create a temporary download directory
DOWNLOAD_DIR="${ROOT_DIR}/downloads"
mkdir -p "${DOWNLOAD_DIR}"

# Parse command-line arguments
ALL_PLATFORMS=false
SELECTED_PLATFORM=""

for arg in "$@"; do
    case $arg in
        --all-platforms)
            ALL_PLATFORMS=true
            shift
            ;;
        --platform=*)
            SELECTED_PLATFORM="${arg#*=}"
            shift
            ;;
        --platform)
            if [ -n "$2" ]; then
                SELECTED_PLATFORM="$2"
                shift 2
            else
                echo "Error: --platform requires an argument"
                exit 1
            fi
            ;;
    esac
done

# Determine current platform if no platform is specified
if [ "$ALL_PLATFORMS" = false ] && [ -z "$SELECTED_PLATFORM" ]; then
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # MacOS
        if [[ $(uname -m) == "arm64" ]]; then
            SELECTED_PLATFORM="darwin-arm64"
        else
            SELECTED_PLATFORM="darwin-x64"
        fi
    elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
        # Windows
        SELECTED_PLATFORM="win32-x64"
    elif [[ "$OSTYPE" == "linux"* ]]; then
        # Linux
        SELECTED_PLATFORM="linux-x64"
    else
        echo "Unknown platform: $OSTYPE"
        exit 1
    fi
    echo "Auto-detected platform: $SELECTED_PLATFORM"
fi

download_darwin_x64() {
    echo "Downloading macOS Intel binary..."
    mkdir -p "${BIN_DIR}/darwin-x64"
    curl -sL "${UV_MACOS_URL}" -o "${DOWNLOAD_DIR}/uv-mac.tar.gz"
    mkdir -p "${DOWNLOAD_DIR}/tmp-darwin-x64"
    tar -xzf "${DOWNLOAD_DIR}/uv-mac.tar.gz" -C "${DOWNLOAD_DIR}/tmp-darwin-x64" || echo "Warning: Failed to extract uv for darwin-x64"
    if [ -f "${DOWNLOAD_DIR}/tmp-darwin-x64/uv-x86_64-apple-darwin/uv" ]; then
        cp "${DOWNLOAD_DIR}/tmp-darwin-x64/uv-x86_64-apple-darwin/uv" "${BIN_DIR}/darwin-x64/uv"
        chmod +x "${BIN_DIR}/darwin-x64/uv"
        echo "Successfully extracted uv for darwin-x64"
    elif [ -f "${DOWNLOAD_DIR}/tmp-darwin-x64/uv" ]; then
        cp "${DOWNLOAD_DIR}/tmp-darwin-x64/uv" "${BIN_DIR}/darwin-x64/uv"
        chmod +x "${BIN_DIR}/darwin-x64/uv"
        echo "Successfully extracted uv for darwin-x64"
    else
        echo "Warning: uv binary not found after extraction for darwin-x64"
    fi
}

download_darwin_arm64() {
    echo "Downloading macOS ARM binary..."
    mkdir -p "${BIN_DIR}/darwin-arm64"
    # Check if we have a local copy in the root directory
    if [ -f "${ROOT_DIR}/../uv-aarch64-apple-darwin.tar.gz" ]; then
        echo "Using local copy of uv-aarch64-apple-darwin.tar.gz"
        cp "${ROOT_DIR}/../uv-aarch64-apple-darwin.tar.gz" "${DOWNLOAD_DIR}/uv-mac-arm.tar.gz"
    else
        curl -sL "${UV_MACOS_ARM_URL}" -o "${DOWNLOAD_DIR}/uv-mac-arm.tar.gz"
    fi
    mkdir -p "${DOWNLOAD_DIR}/tmp-darwin-arm64"
    tar -xzf "${DOWNLOAD_DIR}/uv-mac-arm.tar.gz" -C "${DOWNLOAD_DIR}/tmp-darwin-arm64" || echo "Warning: Failed to extract uv for darwin-arm64"
    if [ -f "${DOWNLOAD_DIR}/tmp-darwin-arm64/uv-aarch64-apple-darwin/uv" ]; then
        cp "${DOWNLOAD_DIR}/tmp-darwin-arm64/uv-aarch64-apple-darwin/uv" "${BIN_DIR}/darwin-arm64/uv"
        chmod +x "${BIN_DIR}/darwin-arm64/uv"
        echo "Successfully extracted uv for darwin-arm64"
    elif [ -f "${DOWNLOAD_DIR}/tmp-darwin-arm64/uv" ]; then
        cp "${DOWNLOAD_DIR}/tmp-darwin-arm64/uv" "${BIN_DIR}/darwin-arm64/uv"
        chmod +x "${BIN_DIR}/darwin-arm64/uv"
        echo "Successfully extracted uv for darwin-arm64"
    else
        echo "Warning: uv binary not found after extraction for darwin-arm64"
    fi
}

download_linux_x64() {
    echo "Downloading Linux binary..."
    mkdir -p "${BIN_DIR}/linux-x64"
    curl -sL "${UV_LINUX_URL}" -o "${DOWNLOAD_DIR}/uv-linux.tar.gz"
    mkdir -p "${DOWNLOAD_DIR}/tmp-linux-x64"
    tar -xzf "${DOWNLOAD_DIR}/uv-linux.tar.gz" -C "${DOWNLOAD_DIR}/tmp-linux-x64" || echo "Warning: Failed to extract uv for linux-x64"
    if [ -f "${DOWNLOAD_DIR}/tmp-linux-x64/uv-x86_64-unknown-linux-gnu/uv" ]; then
        cp "${DOWNLOAD_DIR}/tmp-linux-x64/uv-x86_64-unknown-linux-gnu/uv" "${BIN_DIR}/linux-x64/uv"
        chmod +x "${BIN_DIR}/linux-x64/uv"
        echo "Successfully extracted uv for linux-x64"
    elif [ -f "${DOWNLOAD_DIR}/tmp-linux-x64/uv" ]; then
        cp "${DOWNLOAD_DIR}/tmp-linux-x64/uv" "${BIN_DIR}/linux-x64/uv"
        chmod +x "${BIN_DIR}/linux-x64/uv"
        echo "Successfully extracted uv for linux-x64"
    else
        echo "Warning: uv binary not found after extraction for linux-x64"
    fi
}

download_win32_x64() {
    echo "Downloading Windows binary..."
    mkdir -p "${BIN_DIR}/win32-x64"
    # For Windows, we need to handle the zip file differently
    curl -sL "${UV_WINDOWS_URL}" -o "${DOWNLOAD_DIR}/uv-windows.zip"
    mkdir -p "${DOWNLOAD_DIR}/tmp-win32-x64"
    unzip -q "${DOWNLOAD_DIR}/uv-windows.zip" -d "${DOWNLOAD_DIR}/tmp-win32-x64" || echo "Warning: Failed to extract uv for win32-x64"
    
    # Check different possible locations
    if [ -f "${DOWNLOAD_DIR}/tmp-win32-x64/uv-x86_64-pc-windows-msvc/uv.exe" ]; then
        cp "${DOWNLOAD_DIR}/tmp-win32-x64/uv-x86_64-pc-windows-msvc/uv.exe" "${BIN_DIR}/win32-x64/uv.exe"
        echo "Successfully extracted uv.exe for win32-x64"
    elif [ -f "${DOWNLOAD_DIR}/tmp-win32-x64/uv.exe" ]; then
        cp "${DOWNLOAD_DIR}/tmp-win32-x64/uv.exe" "${BIN_DIR}/win32-x64/uv.exe"
        echo "Successfully extracted uv.exe for win32-x64"
    else
        echo "Warning: uv.exe binary not found after extraction for win32-x64"
    fi
}

# Download either all platforms or the specified platform
if [ "$ALL_PLATFORMS" = true ]; then
    echo "Downloading uv binaries for all platforms..."
    download_darwin_x64
    download_darwin_arm64
    download_linux_x64
    download_win32_x64
else
    echo "Downloading uv binary for $SELECTED_PLATFORM..."
    case $SELECTED_PLATFORM in
        darwin-x64)
            download_darwin_x64
            ;;
        darwin-arm64)
            download_darwin_arm64
            ;;
        linux-x64)
            download_linux_x64
            ;;
        win32-x64)
            download_win32_x64
            ;;
        *)
            echo "Error: Unknown platform $SELECTED_PLATFORM"
            echo "Supported platforms: darwin-x64, darwin-arm64, linux-x64, win32-x64"
            exit 1
            ;;
    esac
fi

# Add a .gitignore file to the downloads directory
echo "*.tar.gz" > "${DOWNLOAD_DIR}/.gitignore"
echo "*.zip" >> "${DOWNLOAD_DIR}/.gitignore"
echo "tmp-*/" >> "${DOWNLOAD_DIR}/.gitignore"

echo "UV binary download completed!"
echo "Binaries are in ${BIN_DIR}"