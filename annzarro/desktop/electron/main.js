const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const { spawn, execSync } = require('child_process');
const util = require('util');
const log = require('electron-log');
const { autoUpdater } = require('electron-updater');
const findProcess = require('find-process');

/**
 * Safely executes a shell command synchronously with EPIPE error handling
 * 
 * @param {string} command - The command to execute
 * @param {object} options - Options for execSync
 * @returns {string|null} - Command output or null if an error occurred
 */
function safeExecSync(command, options = {}) {
    try {
        // Set default options to suppress stdio unless explicitly provided
        const safeOptions = {
            stdio: ['ignore', 'pipe', 'pipe'],
            maxBuffer: 10 * 1024 * 1024, // 10MB buffer
            ...options
        };
        
        // If caller didn't specify stdio, use our safe defaults
        if (!options.stdio) {
            safeOptions.stdio = ['ignore', 'pipe', 'pipe'];
        }
        
        const result = execSync(command, safeOptions);
        return result ? result.toString() : null;
    } catch (error) {
        // Safe error logging
        try {
            // Only log non-EPIPE errors in detail
            if (error.code === 'EPIPE') {
                log.warn(`EPIPE error executing command: ${command.slice(0, 100)}...`);
            } else {
                log.error(`Error executing command (${error.code}): ${command.slice(0, 100)}...`);
                if (error.stderr) log.error(`stderr: ${error.stderr.toString()}`);
            }
        } catch (logError) {
            // Silently handle EPIPE in logging
            if (logError.code !== 'EPIPE') {
                console.error(`Error logging execSync failure: ${logError.message}`);
            }
        }
        
        return null;
    }
}

/**
 * Safely logs a message with EPIPE error handling
 * 
 * @param {Function} logFn - The logging function to use (log.info, log.error, etc.)
 * @param {string} message - The message to log
 */
function safeLog(logFn, message) {
    try {
        logFn(message);
    } catch (error) {
        // Silently handle EPIPE errors
        if (error.code !== 'EPIPE') {
            console.error(`Error logging message: ${error.message}`);
        }
    }
}

// Configure logging with EPIPE error prevention
log.transports.file.level = 'info';

// Override the console transport to handle EPIPE errors gracefully
log.transports.console = {
    level: 'info',
    format: '{h}:{i}:{s} {level} {text}',
    writeFn: (message) => {
        try {
            // Only write if process.stdout exists and is writable
            if (process && process.stdout && process.stdout.writable) {
                process.stdout.write(message + '\n');
            }
        } catch (error) {
            // Silently handle EPIPE errors
            if (error.code !== 'EPIPE') {
                console.error(`Electron-log error: ${error.message}`);
            }
        }
    }
};

// Safe starting message
try {
    log.info('App starting...');
} catch (error) {
    console.error('Error during initial logging:', error.message);
}

// Global references
let mainWindow = null;
let serverProcess = null;
let serverPort = 39487; // Default port (non-standard to minimize collisions)
let serverHost = '127.0.0.1';
let serverUrl = `http://${serverHost}:${serverPort}`;
let isServerRunning = false;
let isDevMode = process.env.NODE_ENV === 'development';
let appDataPath = null;
let venvPath = null;
let cliPath = null;

// Constants
const MAX_SERVER_START_ATTEMPTS = 3;
const DEFAULT_PORT = 39487; // Using a less common port to reduce collision chances
const CONFIG_FILENAME = 'electron_config.yaml';

/**
 * Create the application window
 */
function createWindow() {
    log.info('Creating application window');
    
    // Create the browser window
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        show: false, // Don't show until loaded
        icon: path.join(__dirname, 'icons', 'icon.png')
    });

    // Show loading screen
    mainWindow.loadFile(path.join(__dirname, 'loading.html'));
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    // Start the server when the app is ready
    startServer()
        .then(() => {
            log.info(`Server started at ${serverUrl}`);
            mainWindow.loadURL(serverUrl);
        })
        .catch((error) => {
            log.error('Failed to start server:', error);
            showErrorScreen('Failed to start the server. See log for details.');
        });

    // Handle window close
    mainWindow.on('closed', () => {
        mainWindow = null;
        stopServer();
    });

    // Open external links in default browser
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('http')) {
            shell.openExternal(url);
            return { action: 'deny' };
        }
        return { action: 'allow' };
    });

    // Set up IPC handlers
    setupIpcHandlers();
}

/**
 * Initialize app paths
 */
function initializePaths() {
    log.info('Initializing application paths');

    // Determine resource path based on whether we're in development or production
    let resourcePath;
    if (isDevMode) {
        resourcePath = path.resolve(__dirname, '..', '..', '..');
    } else {
        resourcePath = path.join(app.getPath('userData'), 'resources');
        
        // Create resources directory if it doesn't exist
        if (!fs.existsSync(resourcePath)) {
            fs.mkdirSync(resourcePath, { recursive: true });
        }
        
        // In production, resources are in the 'app' directory inside extraResources
        const extraResourcesPath = path.join(process.resourcesPath, 'app');
        if (fs.existsSync(extraResourcesPath)) {
            resourcePath = extraResourcesPath;
        }
    }
    
    // Set up data path in user's home directory for better writability
    // This directory will be used for sessions storage and dataset access
    appDataPath = path.join(os.homedir(), 'annzarro-data');
    if (!fs.existsSync(appDataPath)) {
        fs.mkdirSync(appDataPath, { recursive: true });
        
        // Create sessions subdirectory
        const sessionsPath = path.join(appDataPath, 'sessions');
        fs.mkdirSync(sessionsPath, { recursive: true });
        
        // Create datasets example directory
        const datasetsPath = path.join(appDataPath, 'datasets');
        fs.mkdirSync(datasetsPath, { recursive: true });
    }
    
    // Set up venv path in user data directory
    const userVenvPath = path.join(app.getPath('userData'), 'venv');
    
    // Check for bundled venv
    const bundledVenvPath = path.join(process.resourcesPath, 'python');
    
    // We'll always use the user path for runtime, but we'll copy from bundled if available
    venvPath = userVenvPath;
    log.info(`Using Python environment: ${venvPath}`);
    
    // Note the bundled path for later use in ensureVenvExists
    log.info(`Checking for bundled venv at: ${bundledVenvPath}`);
    
    // Find CLI path
    cliPath = findCliPath(resourcePath);
    
    log.info(`Resource path: ${resourcePath}`);
    log.info(`App data path: ${appDataPath}`);
    log.info(`Venv path: ${venvPath}`);
    log.info(`CLI path: ${cliPath}`);
    
    return resourcePath;
}

/**
 * Find the annzarro-cli script path, or create it if needed
 */
function findCliPath(resourcePath) {
    // Search for the CLI script in order of preference
    const possiblePaths = [
        path.join(resourcePath, 'annzarro-cli'),
        path.join(resourcePath, 'annzarro', 'bin', 'annzarro-cli'),
        path.join(resourcePath, 'bin', 'annzarro-cli'),
        // Add development paths when running from source code
        path.join(process.cwd(), 'annzarro-cli'),
        path.join(process.cwd(), 'annzarro', 'bin', 'annzarro-cli'),
        path.join(process.cwd(), 'bin', 'annzarro-cli')
    ];
    
    for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
            log.info(`Found CLI at: ${p}`);
            return p;
        }
    }
    
    // Log the paths we looked for to help with debugging
    log.error('Could not find annzarro-cli script. Searched in:');
    possiblePaths.forEach(p => log.error(` - ${p}`));
    
    // Try to create the CLI script in the resource path
    const targetCliPath = path.join(resourcePath, 'annzarro-cli');
    log.info(`Attempting to create CLI script at: ${targetCliPath}`);
    
    // Ensure we have a valid venv path before trying to create a script
    if (!venvPath) {
        log.error('Cannot create CLI script without valid venvPath');
        // Return existing Python (if any) or a standard interpreter
        return process.platform === 'win32' ? 'python' : 'python3';
    }
    
    try {
        // Ensure directory exists
        const resourceDir = path.dirname(targetCliPath);
        if (!fs.existsSync(resourceDir)) {
            log.info(`Creating resource directory: ${resourceDir}`);
            fs.mkdirSync(resourceDir, { recursive: true });
        }
        
        // Create a simplified CLI script that invokes the Python module directly
        let scriptContent;
        
        if (process.platform === 'win32') {
            // Windows batch script
            scriptContent = `@echo off
REM Automatically generated CLI script for Electron app
setlocal enabledelayedexpansion

REM Get Python path from venv
set PYTHON_PATH=${venvPath}\\Scripts\\python.exe

REM Check if Python exists
if not exist "%PYTHON_PATH%" (
    echo Python not found at: %PYTHON_PATH%
    exit /b 1
)

REM Execute the annzarro CLI module
"%PYTHON_PATH%" -m annzarro.cli %*
`;
        } else {
            // Unix bash script - properly escape all paths
            scriptContent = `#!/bin/bash
# Automatically generated CLI script for Electron app

# Get Python path from venv - notice the quotes around the path
PYTHON_PATH="${venvPath.replace(/(\s+)/g, '\\$1')}/bin/python"

# Check if Python exists
if [ ! -f "$PYTHON_PATH" ]; then
    echo "Python not found at: $PYTHON_PATH"
    exit 1
fi

# Execute the annzarro CLI module
"$PYTHON_PATH" -m annzarro.cli "$@"
`;
        }
        
        // Write the script to the file
        fs.writeFileSync(targetCliPath, scriptContent);
        
        // Make it executable on Unix systems
        if (process.platform !== 'win32') {
            safeExecSync(`chmod +x "${targetCliPath}"`);
            safeLog(log.info, `Made CLI script executable: ${targetCliPath}`);
        }
        
        log.info(`Successfully created CLI script at: ${targetCliPath}`);
        return targetCliPath;
    } catch (error) {
        log.error(`Failed to create CLI script: ${error.message}`);
        
        // If we can't create the script, just return a fallback path to Python
        const pythonPath = process.platform === 'win32' 
            ? (fs.existsSync(path.join(venvPath, 'Scripts', 'python.exe')) 
                ? path.join(venvPath, 'Scripts', 'python.exe') 
                : 'python')
            : (fs.existsSync(path.join(venvPath, 'bin', 'python')) 
                ? path.join(venvPath, 'bin', 'python') 
                : 'python3');
        
        log.warn(`Falling back to Python directly: ${pythonPath}`);
        return pythonPath;
    }
}

/**
 * Set up configuration for the Electron app
 */
function setupConfig(resourcePath) {
    log.info('Setting up application configuration');
    
    const configDir = path.join(app.getPath('userData'), 'config');
    if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
    }
    
    const configPath = path.join(configDir, CONFIG_FILENAME);
    
    // If config file doesn't exist, create it
    if (!fs.existsSync(configPath)) {
        log.info('Creating new electron configuration file');
        
        // Base config template
        const configContent = `# Annzarro Electron App Configuration
# Generated automatically by the desktop app

# Server configuration
server:
  host: ${serverHost}
  port: ${serverPort}
  unified_server: true
  
  # Network settings
  cors_enabled: false
  
  # HTTPS settings
  https_enabled: false
  
  # Data storage 
  # Using a dedicated directory in user home for datasets and session storage
  # This directory is writable and accessible from the dataset dropdown
  # Supports storing both datasets and user sessions
  data_dir: "${appDataPath.replace(/\\/g, '/')}"
  
  # Logging configuration
  log_file: "${path.join(app.getPath('userData'), 'logs', 'annzarro_server.log').replace(/\\/g, '/')}"
  log_level: "INFO"

# Authentication configuration
auth:
  enabled: false
  user_file: "${path.join(configDir, 'users.json').replace(/\\/g, '/')}"

# UI configuration
ui:
  # Panel type settings
  enabled_panel_types:
    - cell-plot
    - gene-plot
    - cell-table
    - gene-table
    - gene-set
`;

        fs.writeFileSync(configPath, configContent);
    }
    
    return configPath;
}

/**
 * Find a free port starting from the given port
 */
async function findFreePort(startPort) {
    log.info(`Finding free port starting from ${startPort}`);
    
    let port = startPort;
    
    for (let attempt = 0; attempt < 20; attempt++) {
        const inUse = await checkPortInUse(port);
        if (!inUse) {
            log.info(`Found free port: ${port}`);
            return port;
        }
        log.info(`Port ${port} is in use, trying next port`);
        port++;
    }
    
    throw new Error(`Could not find a free port starting from ${startPort}`);
}

/**
 * Check if a port is in use
 */
function checkPortInUse(port) {
    return new Promise((resolve) => {
        const server = net.createServer();
        
        server.once('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                resolve(true);
            } else {
                resolve(false);
            }
            server.close();
        });
        
        server.once('listening', () => {
            server.close();
            resolve(false);
        });
        
        server.listen(port, '127.0.0.1');
    });
}

/**
 * Wait for the server to be ready
 */
async function waitForServerReady(url, maxAttempts = 30, interval = 500) {
    log.info(`Waiting for server to be ready at ${url}`);
    
    const checkUrl = async (attempt) => {
        if (attempt >= maxAttempts) {
            throw new Error(`Server did not become ready after ${maxAttempts} attempts`);
        }
        
        try {
            // Try to fetch the home page
            const response = await fetch(url, { method: 'HEAD' });
            if (response.ok) {
                log.info('Server is ready');
                return true;
            }
        } catch (err) {
            // Server not ready yet
        }
        
        // Wait and try again
        await new Promise(resolve => setTimeout(resolve, interval));
        return checkUrl(attempt + 1);
    };
    
    return checkUrl(0);
}

/**
 * Start the Python server
 */
async function startServer() {
    log.info('Starting server...');
    
    // Don't start if already running
    if (isServerRunning) {
        log.info('Server is already running');
        return;
    }
    
    // Initialize paths
    const resourcePath = initializePaths();
    
    // Set up configuration
    const configPath = setupConfig(resourcePath);
    
    // Find a free port
    try {
        serverPort = await findFreePort(DEFAULT_PORT);
        serverUrl = `http://${serverHost}:${serverPort}`;
    } catch (error) {
        log.error('Failed to find a free port:', error);
        throw error;
    }
    
    // Ensure venv exists or create it
    try {
        await ensureVenvExists();
    } catch (error) {
        log.error('Failed to ensure venv exists:', error);
        throw error;
    }

    // Start server with retries
    let attempts = 0;
    while (attempts < MAX_SERVER_START_ATTEMPTS) {
        attempts++;
        log.info(`Starting server attempt ${attempts}/${MAX_SERVER_START_ATTEMPTS}`);
        
        try {
            // Make the CLI executable on Unix systems
            if (process.platform !== 'win32') {
                safeExecSync(`chmod +x "${cliPath}"`);
                safeLog(log.info, `Ensured CLI is executable: ${cliPath}`);
            }
            
            // On Windows, use a shell command with proper quoting
            if (process.platform === 'win32') {
                // Determine if we're using Python fallback based on the path
                const isPythonFallback = 
                    (typeof cliPath === 'string') && 
                    (cliPath.includes('python') || 
                     cliPath === 'python' || 
                     cliPath.endsWith('python.exe'));
                
                let command;
                
                if (isPythonFallback) {
                    // If using Python, use the module instead of CLI
                    log.info('Using Python module fallback for Windows');
                    // IMPORTANT: Make sure -m annzarro.cli is treated as a single argument
                    // and 'start' is treated as a subcommand to the module
                    command = `"${cliPath}" -m annzarro.cli start --port ${serverPort} --host ${serverHost} --config "${configPath}" --venv-path "${venvPath}" --auth-disabled`;
                } else {
                    // Using the CLI script directly
                    command = `"${cliPath}" start --port ${serverPort} --host ${serverHost} --config "${configPath}" --venv-path "${venvPath}" --auth-disabled`;
                }
                
                // Error handling for null/undefined executable
                if (!cliPath) {
                    throw new Error('No executable path available for Windows');
                }
                
                log.info(`Running Windows command: ${command}`);
                
                // Set environment variables for the server process
                const winEnv = { 
                    ...process.env, 
                    ANNZARRO_AUTH_DISABLED: 'true',
                    ANNZARRO_ELECTRON_APP: 'true'
                };
                
                // Start the server process
                try {
                    serverProcess = spawn(command, {
                        stdio: 'pipe',
                        shell: true,
                        env: winEnv
                    });
                    
                    if (serverProcess && serverProcess.pid) {
                        log.info(`Windows server process spawned with PID: ${serverProcess.pid}`);
                    } else {
                        log.warn('Windows server process spawned but no PID available');
                    }
                    
                    // Add specific error handling for stream errors
                    if (serverProcess.stdout) {
                        serverProcess.stdout.on('error', (err) => {
                            log.error(`Windows stdout stream error: ${err.message}`);
                        });
                    }
                    
                    if (serverProcess.stderr) {
                        serverProcess.stderr.on('error', (err) => {
                            log.error(`Windows stderr stream error: ${err.message}`);
                        });
                    }
                } catch (spawnError) {
                    throw new Error(`Failed to spawn Windows server process: ${spawnError.message}`);
                }
            } else {
                // Check if we're using the CLI script or Python fallback
                let args;
                let executable = cliPath;
                let useShell = false;
                
                // Determine if we're using Python fallback based on the path
                const isPythonFallback = 
                    (typeof cliPath === 'string') && 
                    (cliPath.includes('python') || 
                     cliPath === 'python' || 
                     cliPath === 'python3' ||
                     cliPath.endsWith('python.exe'));
                
                if (isPythonFallback) {
                    // If using Python, use the module instead of CLI
                    log.info('Using Python module fallback');
                    // Special handling for Python with spaces in paths
                    // CRITICAL: The arguments must be passed correctly to the Python module
                    
                    // Create command as shell command for Unix platforms to handle paths with spaces
                    if (process.platform !== 'win32') {
                        log.info('Using shell execution for Python to handle paths with spaces');
                        
                        // Use shell=true and a single command string for Unix platforms
                        executable = executable;
                        useShell = true;
                        args = [`-m annzarro.cli start --port ${serverPort} --host ${serverHost} --config "${configPath}" --venv-path "${venvPath}" --auth-disabled`];
                    } else {
                        // Standard args array for Windows
                        args = [
                            '-m', 
                            'annzarro.cli',  // Run as module
                            'start',         // This is a subcommand for the module, not a script name
                            '--port', serverPort.toString(),
                            '--host', serverHost,
                            '--config', configPath,
                            '--venv-path', venvPath,
                            '--auth-disabled'
                        ];
                    }
                } else {
                    // Using the CLI script directly
                    args = [
                        'start',
                        '--port', serverPort.toString(),
                        '--host', serverHost,
                        '--config', configPath,
                        '--venv-path', venvPath,
                        '--auth-disabled'
                    ];
                }
                
                log.info(`Running with executable: ${executable}`);
                log.info(`Running with args: ${JSON.stringify(args)}`);
                
                // Set environment variables for the server process
                const env = { 
                    ...process.env, 
                    ANNZARRO_AUTH_DISABLED: 'true',
                    ANNZARRO_ELECTRON_APP: 'true'
                };
                
                // Start the server process with shell: false for better argument handling
                try {
                    // Error handling for null/undefined executable
                    if (!executable) {
                        log.error('No executable path available, falling back to system Python');
                        executable = process.platform === 'win32' ? 'python' : 'python3';
                        isPythonFallback = true;
                        
                        // Update arguments for Python fallback
                        args = [
                            '-m', 
                            'annzarro.cli',
                            'start',
                            '--port', serverPort.toString(),
                            '--host', serverHost,
                            '--config', configPath,
                            '--venv-path', venvPath,
                            '--auth-disabled'
                        ];
                    }
                    
                    // Extra logging to debug the exact command we're running
                    log.info(`Final command: ${executable} ${args.join(' ')}`);
                    
                    // Verify the executable exists
                    if (!fs.existsSync(executable) && !['python', 'python3'].includes(executable)) {
                        throw new Error(`Executable not found: ${executable}`);
                    }
                    
                    // For scripts, make sure they're executable on Unix
                    if (process.platform !== 'win32' && !isPythonFallback) {
                        try {
                            // Use execSync with options to handle EPIPE errors
                            execSync(`chmod +x "${executable}"`, {
                                stdio: ['ignore', 'ignore', 'ignore'] // Suppress all stdio to avoid EPIPE
                            });
                        } catch (chmodError) {
                            // Safely log errors
                            try {
                                log.warn(`Failed to make executable: ${chmodError.message}`);
                            } catch (logError) {
                                // Silent handling for EPIPE errors in logging
                                if (logError.code !== 'EPIPE') {
                                    console.error(`Error logging chmod failure: ${logError.message}`);
                                }
                            }
                        }
                    }
                    
                    // Use shell mode for scripts on Unix to ensure proper interpreter handling
                    if (process.platform !== 'win32' && !isPythonFallback) {
                        useShell = true;
                        executable = `'${executable}'`; // Wraps the executable string with single quotes
                        args = args.map(arg => `'${arg}'`); // Creates a new array with quoted strings
                    }
                    
                    // Spawn the process with appropriate options
                    serverProcess = spawn(executable, args, {
                        stdio: 'pipe',
                        shell: useShell,
                        env: env
                    });
                    
                    if (serverProcess && serverProcess.pid) {
                        log.info(`Server process spawned with PID: ${serverProcess.pid}`);
                    } else {
                        log.warn('Server process spawned but no PID available');
                    }
                    
                    // Add specific error handling for stream errors
                    if (serverProcess.stdout) {
                        serverProcess.stdout.on('error', (err) => {
                            log.error(`stdout stream error: ${err.message}`);
                        });
                    }
                    
                    if (serverProcess.stderr) {
                        serverProcess.stderr.on('error', (err) => {
                            log.error(`stderr stream error: ${err.message}`);
                        });
                    }
                    
                } catch (spawnError) {
                    throw new Error(`Failed to spawn server process: ${spawnError.message}`);
                }
            }
            
            // Handle server process events with proper error handling
            if (serverProcess.stdout) {
                serverProcess.stdout.on('data', (data) => {
                    try {
                        log.info(`Server stdout: ${data.toString().trim()}`);
                    } catch (error) {
                        // Silent handling for EPIPE errors
                        if (error.code !== 'EPIPE') {
                            console.error(`Error logging stdout: ${error.message}`);
                        }
                    }
                });
                
                // Add specific error handler for stdout
                serverProcess.stdout.on('error', (error) => {
                    // Silent handling for EPIPE errors
                    if (error.code !== 'EPIPE') {
                        console.error(`Stdout stream error: ${error.message}`);
                    }
                });
            }
            
            if (serverProcess.stderr) {
                serverProcess.stderr.on('data', (data) => {
                    try {
                        log.error(`Server stderr: ${data.toString().trim()}`);
                    } catch (error) {
                        // Silent handling for EPIPE errors
                        if (error.code !== 'EPIPE') {
                            console.error(`Error logging stderr: ${error.message}`);
                        }
                    }
                });
                
                // Add specific error handler for stderr
                serverProcess.stderr.on('error', (error) => {
                    // Silent handling for EPIPE errors
                    if (error.code !== 'EPIPE') {
                        console.error(`Stderr stream error: ${error.message}`);
                    }
                });
            }
            
            // Handle process exit and errors properly
            serverProcess.on('error', (error) => {
                log.error(`Server process error: ${error.message}`);
                isServerRunning = false;
                
                // Only set to null if not already restarting
                if (serverProcess) {
                    serverProcess = null;
                }
                
                if (mainWindow) {
                    showErrorScreen('An error occurred with the server process. Please restart the application.');
                }
            });
            
            serverProcess.on('exit', (code, signal) => {
                log.info(`Server process exited with code ${code} and signal ${signal || 'none'}`);
                isServerRunning = false;
                
                // Auto-restart if server exits unexpectedly and mainWindow still exists
                if (code !== 0 && !signal && mainWindow) {
                    log.warn('Server process exited unexpectedly, attempting to restart');
                    
                    // Only attempt restart if we aren't explicitly shutting down
                    if (!isQuitting) {
                        // Clear serverProcess before restarting
                        serverProcess = null;
                        
                        setTimeout(() => {
                            startServer()
                                .then(() => {
                                    if (mainWindow) {
                                        mainWindow.loadURL(serverUrl);
                                    }
                                })
                                .catch((error) => {
                                    log.error('Failed to restart server:', error);
                                    showErrorScreen('The server crashed and could not be restarted. Please restart the application.');
                                });
                        }, 2000);
                    }
                } else {
                    // Normal exit or we're in shutdown process
                    serverProcess = null;
                }
            });
            
            // Wait for server to be ready
            try {
                await waitForServerReady(serverUrl);
                isServerRunning = true;
                return;
            } catch (error) {
                log.error('Server did not become ready:', error);
                
                // If the server didn't become ready, stop it and try again
                if (serverProcess) {
                    serverProcess.kill();
                    serverProcess = null;
                }
                
                // Try another port
                serverPort = await findFreePort(serverPort + 1);
                serverUrl = `http://${serverHost}:${serverPort}`;
                log.info(`Trying again with port ${serverPort}`);
            }
        } catch (error) {
            log.error(`Server start attempt ${attempts} failed:`, error);
            
            // Clean up if the start failed
            if (serverProcess) {
                serverProcess.kill();
                serverProcess = null;
            }
            
            // If we've exhausted all retries, throw the error
            if (attempts >= MAX_SERVER_START_ATTEMPTS) {
                throw new Error(`Failed to start server after ${MAX_SERVER_START_ATTEMPTS} attempts: ${error.message}`);
            }
            
            // Wait before trying again
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
}

/**
 * Copy the bundled venv to the user directory
 */
async function copyBundledVenv(sourcePath, destPath) {
    try {
        log.info(`Copying bundled venv from ${sourcePath} to ${destPath}`);
        
        // Ensure destination directory exists
        if (!fs.existsSync(destPath)) {
            fs.mkdirSync(destPath, { recursive: true });
        } else {
            // Clear any existing partial venv
            try {
                log.info('Clearing existing destination directory');
                if (process.platform === 'win32') {
                    safeExecSync(`rmdir /s /q "${destPath}"`, { shell: true });
                    fs.mkdirSync(destPath, { recursive: true });
                } else {
                    safeExecSync(`rm -rf "${destPath}" && mkdir -p "${destPath}"`, { shell: true });
                }
            } catch (error) {
                log.error(`Failed to clear destination directory: ${error.message}`);
                // Continue anyway
            }
        }
        
        // Copy directory using appropriate platform commands
        if (process.platform === 'win32') {
            // Windows xcopy
            const command = `xcopy "${sourcePath}\\*" "${destPath}\\" /E /I /H /Y`;
            safeLog(log.info, `Copy command: ${command}`);
            safeExecSync(command, { shell: true });
        } else {
            // Unix cp
            let command;
            
            if (process.platform === 'darwin') {
                // macOS uses cp -R
                command = `cp -R "${sourcePath}"/* "${destPath}"/`;
            } else {
                // Linux uses cp -a for archive mode
                command = `cp -a "${sourcePath}"/* "${destPath}"/`;
            }
            
            safeLog(log.info, `Copy command: ${command}`);
            safeExecSync(command, { shell: true });
        }
        
        // Make bin files executable on Unix
        if (process.platform !== 'win32') {
            try {
                const binDir = path.join(destPath, 'bin');
                if (fs.existsSync(binDir)) {
                    safeLog(log.info, 'Making bin files executable');
                    safeExecSync(`chmod +x ${binDir}/*`, { shell: true });
                }
            } catch (error) {
                log.warn(`Failed to make bin files executable: ${error.message}`);
            }
        }
        
        log.info('Successfully copied bundled venv');
    } catch (error) {
        log.error(`Failed to copy bundled venv: ${error.message}`);
        if (error.stdout) log.info(`stdout: ${error.stdout}`);
        if (error.stderr) log.error(`stderr: ${error.stderr}`);
        throw error;
    }
}

/**
 * Ensure a Python virtual environment exists
 */
async function ensureVenvExists() {
    log.info(`Ensuring Python venv exists at ${venvPath}`);
    
    // Check if venv already exists and is usable
    const venvIndicator = process.platform === 'win32' 
        ? path.join(venvPath, 'Scripts', 'python.exe') 
        : path.join(venvPath, 'bin', 'python');
    
    // If venv already exists, we can use it
    if (fs.existsSync(venvIndicator)) {
        log.info('Python venv already exists and is usable');
        return;
    }
    
    // Check for bundled venv
    const bundledVenvPath = path.join(process.resourcesPath, 'python');
    const bundledVenvIndicator = process.platform === 'win32'
        ? path.join(bundledVenvPath, 'Scripts', 'python.exe')
        : path.join(bundledVenvPath, 'bin', 'python');
    
    if (fs.existsSync(bundledVenvIndicator)) {
        log.info(`Found bundled venv at ${bundledVenvPath}, copying to ${venvPath}`);
        await copyBundledVenv(bundledVenvPath, venvPath);
        return;
    }
    
    log.info('No bundled venv found, creating new venv...');
    
    try {
        // Create venv directory if it doesn't exist
        if (!fs.existsSync(venvPath)) {
            fs.mkdirSync(venvPath, { recursive: true });
        }
        
        // Install using the CLI
        const installArgs = [
            'install',
            '--clean',
            '--venv-path', `"${venvPath}"` // Quote the path to handle spaces
        ];
        
        log.info(`Running: ${cliPath} ${installArgs.join(' ')}`);
        
        // Make the CLI executable on Unix systems
        if (process.platform !== 'win32') {
            try {
                execSync(`chmod +x "${cliPath}"`);
            } catch (error) {
                log.warn(`Failed to make CLI executable: ${error.message}`);
            }
        }
        
        // Use a proper array of arguments and spawn instead of execSync
        // This will handle spaces in paths correctly
        try {
            // Make sure CLI is executable on Unix
            if (process.platform !== 'win32') {
                safeExecSync(`chmod +x "${cliPath}"`);
                safeLog(log.info, `Made CLI script executable for installation`);
            }
            
            log.info(`Creating venv at: ${venvPath}`);
            
            // On Windows, use execSync with a properly quoted command
            if (process.platform === 'win32') {
                const command = `"${cliPath}" install --clean --venv-path "${venvPath}"`;
                log.info(`Executing Windows command: ${command}`);
                const output = safeExecSync(command, { 
                    encoding: 'utf8',
                    maxBuffer: 10 * 1024 * 1024 // 10MB buffer for long outputs
                });
                log.info('Python venv created successfully');
                log.info(output);
                return;
            }
            
            
            // On Unix systems, use spawn with properly separated arguments
            log.info('Using spawn with separated arguments for Unix');
            
            // Create an args array instead of a command string to avoid shell escaping issues
            const args = [
                'install',
                '--clean',
                '--venv-path', venvPath
            ];
            
            log.info(`Spawning process: ${cliPath} with args: ${JSON.stringify(args)}`);
            
            // Use spawn with shell: false for proper argument handling
            const installProcess = spawn(cliPath, args, {
                stdio: 'pipe',
                shell: false
            });
            
            return new Promise((resolve, reject) => {
                let stdoutData = '';
                let stderrData = '';
                
                installProcess.stdout.on('data', (data) => {
                    const message = data.toString().trim();
                    stdoutData += message + '\n';
                    log.info(`Install stdout: ${message}`);
                });
                
                installProcess.stderr.on('data', (data) => {
                    const message = data.toString().trim();
                    stderrData += message + '\n';
                    log.error(`Install stderr: ${message}`);
                });
                
                installProcess.on('close', (code) => {
                    if (code === 0) {
                        log.info('Python venv created successfully');
                        resolve();
                    } else {
                        log.error(`Venv creation failed with code ${code}:`);
                        log.error(stderrData);
                        
                        // If it failed, try direct Python execution as a fallback
                        log.info('Trying direct Python install as fallback');
                        try {
                            const pythonCmd = process.platform === 'win32' 
                                ? 'python' 
                                : 'python3';
                            
                            const installScript = path.join(path.dirname(cliPath), 'annzarro-install.py');
                            
                            if (fs.existsSync(installScript)) {
                                log.info(`Found install script at: ${installScript}`);
                                
                                // Use single argument format to avoid spaces breaking things
                                const pythonArgs = [
                                    installScript,
                                    '--clean',
                                    '--venv-path', venvPath
                                ];
                                
                                log.info(`Running Python directly: ${pythonCmd} ${JSON.stringify(pythonArgs)}`);
                                
                                const pythonOutput = safeExecSync(`${pythonCmd} "${installScript}" --clean --venv-path "${venvPath}"`, {
                                    encoding: 'utf8',
                                    maxBuffer: 10 * 1024 * 1024
                                });
                                
                                log.info('Fallback Python install succeeded:');
                                log.info(pythonOutput);
                                resolve();
                                return;
                            }
                        } catch (fallbackError) {
                            log.error(`Fallback install also failed: ${fallbackError.message}`);
                            if (fallbackError.stdout) log.info(`Fallback stdout: ${fallbackError.stdout}`);
                            if (fallbackError.stderr) log.error(`Fallback stderr: ${fallbackError.stderr}`);
                        }
                        
                        const error = new Error(`Failed to create Python venv (exit code ${code})`);
                        error.stdout = stdoutData;
                        error.stderr = stderrData;
                        reject(error);
                    }
                });
            });
        } catch (error) {
            log.error(`Failed to create Python venv: ${error.message}`);
            if (error.stdout) log.info(`Install stdout: ${error.stdout}`);
            if (error.stderr) log.error(`Install stderr: ${error.stderr}`);
            throw new Error(`Failed to create Python venv: ${error.message}`);
        }
    } catch (error) {
        log.error('Failed to create Python venv:', error);
        throw error;
    }
}

/**
 * Stop the Python server
 */
async function stopServer() {
    log.info('Stopping server...');
    
    if (!isServerRunning && !serverProcess) {
        log.info('Server is not running');
        return;
    }
    
    let isStopSuccessful = false;
    
    try {
        // First attempt: Terminate the server process directly
        if (serverProcess) {
            log.info('Terminating server process directly');
            try {
                // Try SIGTERM first for graceful shutdown
                serverProcess.kill('SIGTERM');
                
                // Wait a moment for process to terminate
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                // Check if process is still running
                if (serverProcess.killed) {
                    log.info('Server process terminated gracefully');
                    isStopSuccessful = true;
                } else {
                    // If still running, force kill with SIGKILL
                    log.warn('Server still running after SIGTERM, using SIGKILL');
                    serverProcess.kill('SIGKILL');
                    log.info('Killed server process with SIGKILL');
                    isStopSuccessful = true;
                }
            } catch (killError) {
                log.error(`Failed to kill server process: ${killError.message}`);
            }
        }
        
        // If direct termination failed, try CLI stop command
        if (!isStopSuccessful && cliPath) {
            log.info('Using CLI to stop server');
            try {
                // Handle Windows and Unix differently
                if (process.platform === 'win32') {
                    // Execute stop command synchronously with a timeout
                    safeLog(log.info, 'Executing stop command on Windows');
                    safeExecSync(`"${cliPath}" stop`, { timeout: 5000 });
                } else {
                    // Execute stop command synchronously with a timeout
                    safeLog(log.info, 'Executing stop command on Unix');
                    safeExecSync(`"${cliPath}" stop`, { timeout: 5000 });
                }
                
                safeLog(log.info, 'Server stop command completed successfully');
                isStopSuccessful = true;
            } catch (cliError) {
                log.warn(`CLI stop command failed: ${cliError.message}`);
            }
        }
        
        // Last attempt: Find and kill any remaining Python processes
        if (!isStopSuccessful) {
            log.info('Searching for orphaned Python processes...');
            const processes = await findProcess('name', 'python');
            let foundAnnzarroProcesses = false;
            
            for (const proc of processes) {
                if (proc.cmd && proc.cmd.includes('annzarro')) {
                    foundAnnzarroProcesses = true;
                    log.warn(`Force killing orphaned Python process: ${proc.pid} - ${proc.cmd}`);
                    try {
                        process.kill(proc.pid, 'SIGKILL');
                        log.info(`Successfully killed process ${proc.pid}`);
                    } catch (err) {
                        log.error(`Failed to kill process ${proc.pid}: ${err.message}`);
                    }
                }
            }
            
            if (foundAnnzarroProcesses) {
                // Verify all processes were killed
                const remainingProcesses = await findProcess('name', 'python');
                const stillRunning = remainingProcesses.filter(proc => 
                    proc.cmd && proc.cmd.includes('annzarro')
                );
                
                if (stillRunning.length > 0) {
                    log.error(`Failed to kill ${stillRunning.length} annzarro processes`);
                    stillRunning.forEach(proc => {
                        log.error(`  - PID ${proc.pid}: ${proc.cmd}`);
                    });
                } else {
                    log.info('All annzarro processes successfully terminated');
                    isStopSuccessful = true;
                }
            }
            
            // On macOS try the `pkill` command as last resort
            if (process.platform === 'darwin' && !isStopSuccessful) {
                log.warn('Attempting to use pkill as last resort');
                try {
                    safeExecSync('pkill -f "python.*annzarro"', { timeout: 3000 });
                    safeLog(log.info, 'pkill command executed successfully');
                    isStopSuccessful = true;
                } catch (pkillError) {
                    // pkill returns non-zero if no processes match
                    if (pkillError.status !== 1) {
                        log.error(`pkill failed: ${pkillError.message}`);
                    } else {
                        log.info('No matching processes found by pkill');
                    }
                }
            }
        }
    } catch (error) {
        log.error('Error during server shutdown sequence:', error);
    } finally {
        // Always mark the server as not running to prevent further issues
        isServerRunning = false;
        serverProcess = null;
        log.info('Server shutdown sequence completed');
    }
}

/**
 * Show error screen
 */
function showErrorScreen(errorMessage) {
    log.error(`Showing error screen: ${errorMessage}`);
    
    if (!mainWindow) return;
    
    const errorPath = path.join(__dirname, 'error.html');
    
    // Check if error.html exists, otherwise create a basic one
    if (!fs.existsSync(errorPath)) {
        const errorHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline';">
            <title>Error - Annzarro</title>
            <style>
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
                    margin: 0;
                    padding: 20px;
                    color: #333;
                    background-color: #f5f5f5;
                    text-align: center;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    height: 100vh;
                }
                .error-container {
                    background-color: white;
                    border-radius: 8px;
                    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
                    padding: 30px;
                    max-width: 500px;
                    width: 100%;
                }
                h1 {
                    color: #e53935;
                    margin-bottom: 20px;
                }
                p {
                    margin-bottom: 20px;
                    line-height: 1.5;
                }
                button {
                    background-color: #2196f3;
                    color: white;
                    border: none;
                    padding: 10px 20px;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 16px;
                    transition: background-color 0.2s;
                }
                button:hover {
                    background-color: #1976d2;
                }
            </style>
        </head>
        <body>
            <div class="error-container">
                <h1>Application Error</h1>
                <p id="error-message">An error occurred while starting the application.</p>
                <button onclick="window.location.reload()">Retry</button>
                <p><small>If the problem persists, please restart the application.</small></p>
            </div>
            <script>
                document.addEventListener('DOMContentLoaded', () => {
                    const urlParams = new URLSearchParams(window.location.search);
                    const error = urlParams.get('error');
                    if (error) {
                        document.getElementById('error-message').textContent = error;
                    }
                });
            </script>
        </body>
        </html>
        `;
        fs.writeFileSync(errorPath, errorHtml);
    }
    
    mainWindow.loadFile(errorPath, { query: { error: errorMessage } });
}

/**
 * Setup IPC handlers
 */
function setupIpcHandlers() {
    // App version
    ipcMain.handle('app:getVersion', () => {
        return app.getVersion();
    });
    
    // Update checking
    ipcMain.handle('app:checkForUpdates', async () => {
        try {
            const result = await autoUpdater.checkForUpdatesAndNotify();
            return { 
                updateAvailable: !!result,
                version: result ? result.updateInfo.version : null
            };
        } catch (error) {
            log.error('Error checking for updates:', error);
            return { error: error.message };
        }
    });
    
    // Server restart
    ipcMain.handle('app:restartServer', async () => {
        try {
            await stopServer();
            await startServer();
            if (mainWindow) {
                mainWindow.loadURL(serverUrl);
            }
            return { success: true };
        } catch (error) {
            log.error('Failed to restart server:', error);
            return { error: error.message };
        }
    });
    
    // Directory selection
    ipcMain.handle('app:selectDirectory', async () => {
        const result = await dialog.showOpenDialog(mainWindow, {
            properties: ['openDirectory']
        });
        return result.canceled ? null : result.filePaths[0];
    });
    
    // App info
    ipcMain.handle('app:getInfo', () => {
        return {
            version: app.getVersion(),
            isDevMode: isDevMode,
            serverUrl: serverUrl,
            appDataPath: appDataPath,
            venvPath: venvPath
        };
    });
    
    // System info
    ipcMain.handle('app:getSystemInfo', () => {
        return {
            platform: process.platform,
            arch: process.arch,
            osVersion: os.release(),
            hostname: os.hostname(),
            cpus: os.cpus().length,
            totalMemory: Math.round(os.totalmem() / (1024 * 1024 * 1024)), // GB
            freeMemory: Math.round(os.freemem() / (1024 * 1024 * 1024)) // GB
        };
    });
}

// App ready event
app.whenReady().then(() => {
    createWindow();
    
    app.on('activate', () => {
        if (!mainWindow) createWindow();
    });
    
    // Set up auto-updater events
    autoUpdater.on('checking-for-update', () => {
        log.info('Checking for update...');
    });
    
    autoUpdater.on('update-available', (info) => {
        log.info('Update available:', info);
    });
    
    autoUpdater.on('update-not-available', (info) => {
        log.info('Update not available:', info);
    });
    
    autoUpdater.on('error', (err) => {
        log.error('Error in auto-updater:', err);
    });
    
    autoUpdater.on('download-progress', (progressObj) => {
        log.info(`Download progress: ${progressObj.percent}%`);
    });
    
    autoUpdater.on('update-downloaded', (info) => {
        log.info('Update downloaded:', info);
        dialog.showMessageBox({
            type: 'info',
            title: 'Update Available',
            message: 'A new version has been downloaded. Restart the application to apply the updates.',
            buttons: ['Restart', 'Later']
        }).then((returnValue) => {
            if (returnValue.response === 0) autoUpdater.quitAndInstall();
        });
    });
    
    // Check for updates only if app-update.yml exists
    const updateConfigPath = path.join(process.resourcesPath, 'app-update.yml');
    if (fs.existsSync(updateConfigPath)) {
        log.info('Found update configuration, checking for updates');
        autoUpdater.checkForUpdatesAndNotify().catch((error) => {
            log.error('Failed to check for updates:', error);
        });
    } else {
        log.info('No update configuration found, skipping update check');
    }
});

// Quit when all windows are closed
app.on('window-all-closed', () => {
    app.quit();
});

// Track if quit process is already in progress
let isQuitting = false;

// Ensure server is stopped before quitting
app.on('before-quit', async (event) => {
    // If already quitting, don't prevent default and don't do anything else
    if (isQuitting) {
        return;
    }
    
    // Prevent the app from quitting immediately
    event.preventDefault();
    
    // Mark that we're in the quit process
    isQuitting = true;
    
    // Log the quit attempt
    log.info('Application quit requested, ensuring server shutdown...');
    
    // Stop the server with a timeout safety
    const serverStopPromise = stopServer();
    const timeoutPromise = new Promise(resolve => setTimeout(resolve, 5000)); // 5 second max wait
    
    try {
        // Race between normal shutdown and timeout
        await Promise.race([serverStopPromise, timeoutPromise]);
        log.info('Server shutdown completed or timed out, proceeding with app quit');
    } catch (error) {
        log.error('Error during final server shutdown:', error);
    }
    
    // Continue with app quit after a short delay
    setTimeout(() => app.exit(0), 100); // Use exit instead of quit to avoid triggering before-quit again
});

// Note: will-quit won't be triggered when using app.exit()
// but we keep this handler just in case the app is closed differently
app.on('will-quit', (event) => {
    log.info('Application will quit event triggered');
});