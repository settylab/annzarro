# AnnZarro Desktop Application

This directory contains the code for the desktop application version of AnnZarro, which packages the web application into a standalone desktop application using Electron.

## Overview

The desktop application provides a convenient way to use AnnZarro without needing to manually start a server and open a browser. It bundles the Python server and a browser window into a single application.

## Development

First, download the required uv binaries for all platforms:

```bash
# Make the script executable
chmod +x annzarro/desktop/scripts/download_uv.sh

# Run the script to download uv binaries
./annzarro/desktop/scripts/download_uv.sh
```

To run the desktop application in development mode:

```bash
python -m annzarro.cli desktop run
```

This will start the application using your system's Python interpreter and the project files from your local directory.

## Building

Before building, make sure you've downloaded the uv binaries:

```bash
./annzarro/desktop/scripts/download_uv.sh
```

To build the desktop application:

```bash
python -m annzarro.cli desktop build
```

By default, this will build for your current platform. You can specify a target platform with the `--platform` option:

```bash
python -m annzarro.cli desktop build --platform windows
python -m annzarro.cli desktop build --platform mac
python -m annzarro.cli desktop build --platform linux
```

The built application will be available in the `annzarro/desktop/electron/dist` directory.

## Prerequisites

To build the desktop application, you need:

- Node.js and npm installed on your system
- Python and required dependencies
- For Windows builds: Windows or Windows Subsystem for Linux
- For macOS builds: macOS (signing requires an Apple Developer account)
- For Linux builds: A Linux distribution

### Setting Up a Python Environment

For optimal results, you should create a dedicated Python environment for the desktop app:

#### Using UV (Recommended - Faster)

```bash
# First, get the bundled UV package installer
chmod +x annzarro/desktop/scripts/download_uv.sh
./annzarro/desktop/scripts/download_uv.sh

# Create a virtual environment and install dependencies with UV
python -m annzarro.cli install --venv --venv-path annzarro/desktop/electron/python
```

#### Using Standard Pip

```bash
python -m annzarro.cli install --venv --venv-path annzarro/desktop/electron/python --no-uv
```

Or use the legacy scripts:

**On macOS/Linux:**
```bash
# Make the script executable
chmod +x annzarro/desktop/setup_python_env.sh

# Run the setup script
./annzarro/desktop/setup_python_env.sh
```

**On Windows:**
```cmd
annzarro\desktop\setup_python_env.bat
```

These methods will:
1. Create a Python virtual environment at `annzarro/desktop/electron/python/`
2. Install all required dependencies
3. Install the AnnZarro package in development mode

The desktop app will automatically use this Python environment when building and running.

## Structure

- `electron/` - Contains the Electron application code
  - `main.js` - Main process script that handles the application lifecycle
  - `preload.js` - Bridge between the renderer process and Node.js
  - `package.json` - Electron project configuration
  - `loading.html` - Loading screen shown while the server starts
  - `error.html` - Error screen shown if the server fails to start
  - `icons/` - Application icons for different platforms
  - `bin/` - Platform-specific uv binaries
    - `darwin-x64/` - macOS Intel binaries
    - `darwin-arm64/` - macOS ARM (Apple Silicon) binaries
    - `linux-x64/` - Linux x64 binaries
    - `win32-x64/` - Windows x64 binaries
- `scripts/` - Utility scripts for development
  - `download_uv.sh` - Script to download uv binaries for all platforms
- `builder.py` - Python module for building the desktop application

## How It Works

The desktop application:

1. Starts a Python server process running AnnZarro
2. Opens an Electron window that connects to the server
3. Manages the server lifecycle, ensuring it starts and stops with the application
4. Provides native OS integration (dock/taskbar, notifications, etc.)
5. Uses uv for faster Python package management and environment setup
6. Creates a dedicated virtual environment for Python dependencies

## Customization

To customize the application:

- Update the icons in the `icons/` directory
- Modify `package.json` to change the application name, description, etc.
- Edit `main.js` to change default window size, menu options, etc.

## Troubleshooting

If you encounter issues:

- Check the application logs in the usual Electron log locations
  - Windows: `%USERPROFILE%\AppData\Roaming\annzarro-desktop\logs`
  - macOS: `~/Library/Logs/annzarro-desktop`
  - Linux: `~/.config/annzarro-desktop/logs`
- Ensure you have all required dependencies installed
- Try running in development mode for more detailed logs