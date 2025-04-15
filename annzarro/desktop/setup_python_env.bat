@echo off
REM Script to set up a Python environment for the AnnZarro desktop app

echo Setting up Python environment for AnnZarro desktop app

REM Get the script directory
set SCRIPT_DIR=%~dp0
set TARGET_DIR=%SCRIPT_DIR%electron\python
set REQUIREMENTS_FILE=%SCRIPT_DIR%electron\requirements.txt

echo Target directory: %TARGET_DIR%

REM Create target directory if it doesn't exist
if not exist "%TARGET_DIR%" (
    mkdir "%TARGET_DIR%"
    echo Created target directory
)

REM Check if requirements file exists
if not exist "%REQUIREMENTS_FILE%" (
    echo Error: Requirements file not found at %REQUIREMENTS_FILE%
    exit /b 1
)

REM Create virtual environment
echo Creating Python virtual environment...
python -m venv "%TARGET_DIR%"
echo Virtual environment created at %TARGET_DIR%

REM Activate virtual environment
echo Activating virtual environment...
call "%TARGET_DIR%\Scripts\activate.bat"

REM Upgrade pip
echo Upgrading pip...
python -m pip install --upgrade pip

REM Install dependencies
echo Installing dependencies from %REQUIREMENTS_FILE%...
pip install -r "%REQUIREMENTS_FILE%"

REM Install AnnZarro package in development mode
echo Installing AnnZarro package...
pip install -e "%SCRIPT_DIR%\..\.."

echo Python environment setup complete
echo To activate this environment: call "%TARGET_DIR%\Scripts\activate.bat"
echo To build the desktop app with this environment: annzarro-cli desktop build --platform windows