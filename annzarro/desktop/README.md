# AnnZarro Desktop Application

This directory contains the code for the desktop application version of AnnZarro, which packages the web application into a standalone desktop application using Electron.

## Overview

The desktop application provides a convenient way to use AnnZarro without needing to manually start a server and open a browser. It bundles the Python server and a browser window into a single application.

## Development

To run the desktop application in development mode:

```bash
python -m annzarro.cli desktop run
```

This will start the application using your system's Python interpreter and the project files from your local directory.

## Building

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

## Structure

- `electron/` - Contains the Electron application code
  - `main.js` - Main process script that handles the application lifecycle
  - `preload.js` - Bridge between the renderer process and Node.js
  - `package.json` - Electron project configuration
  - `loading.html` - Loading screen shown while the server starts
  - `error.html` - Error screen shown if the server fails to start
  - `icons/` - Application icons for different platforms
- `builder.py` - Python module for building the desktop application

## How It Works

The desktop application:

1. Starts a Python server process running AnnZarro
2. Opens an Electron window that connects to the server
3. Manages the server lifecycle, ensuring it starts and stops with the application
4. Provides native OS integration (dock/taskbar, notifications, etc.)

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