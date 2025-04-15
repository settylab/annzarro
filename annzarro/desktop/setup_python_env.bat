@echo off
REM Script to set up a Python environment for the AnnZarro desktop app
REM Uses the improved annzarro-install.py script to manage dependencies

echo Setting up Python environment for AnnZarro desktop app

REM Get the script directory
set SCRIPT_DIR=%~dp0
set REPO_ROOT=%SCRIPT_DIR%..\..
set TARGET_DIR=%SCRIPT_DIR%electron\python
set INSTALLER_SCRIPT=%REPO_ROOT%\annzarro-install.py

echo Target directory: %TARGET_DIR%

REM Create target directory if it doesn't exist
if not exist "%TARGET_DIR%" (
    mkdir "%TARGET_DIR%"
    echo Created target directory
)

REM Check if the installer script exists
if not exist "%INSTALLER_SCRIPT%" (
    echo Error: Installer script not found at %INSTALLER_SCRIPT%
    exit /b 1
)

REM Run the installer with our target directory as the venv path
REM The improved CLI will automatically check for UV and fall back to pip if needed
echo Installing AnnZarro with dependencies...
python "%INSTALLER_SCRIPT%" --venv-path "%TARGET_DIR%" --clean

REM Validate the installation by checking for key files
if exist "%TARGET_DIR%\Scripts\python.exe" (
    echo Python environment was set up successfully
) else (
    echo Warning: Python environment may not have been set up correctly
    echo Check for errors in the installation output
)

echo Python environment setup complete
echo To activate this environment: call "%TARGET_DIR%\Scripts\activate.bat"
echo To build the desktop app with this environment: annzarro-cli desktop build --platform windows