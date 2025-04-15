#!/bin/bash
# Script to download uv binaries for all platforms

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

# Create directories
mkdir -p "${BIN_DIR}/darwin-x64"
mkdir -p "${BIN_DIR}/darwin-arm64"
mkdir -p "${BIN_DIR}/linux-x64"
mkdir -p "${BIN_DIR}/win32-x64"

echo "Downloading uv binaries for all platforms..."

# Create a temporary download directory
DOWNLOAD_DIR="${ROOT_DIR}/downloads"
mkdir -p "${DOWNLOAD_DIR}"

# Download and extract macOS Intel binary
echo "Downloading macOS Intel binary..."
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

# Download and extract macOS ARM binary
echo "Downloading macOS ARM binary..."
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

# Download and extract Linux binary
echo "Downloading Linux binary..."
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

# Download and extract Windows binary
echo "Downloading Windows binary..."
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

# Add a .gitignore file to the downloads directory
echo "*.tar.gz" > "${DOWNLOAD_DIR}/.gitignore"
echo "*.zip" >> "${DOWNLOAD_DIR}/.gitignore"
echo "tmp-*/" >> "${DOWNLOAD_DIR}/.gitignore"

echo "All uv binaries downloaded successfully!"
echo "Binaries are in ${BIN_DIR}"