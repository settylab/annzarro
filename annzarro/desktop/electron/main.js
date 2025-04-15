const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const { spawn, execSync } = require('child_process');
const log = require('electron-log');
const { autoUpdater } = require('electron-updater');
const findProcess = require('find-process');

// Configure logging
log.transports.file.level = 'info';
log.info('App starting...');

// Global references
let mainWindow = null;
let serverProcess = null;
let serverPort = 8000; // Default port
let serverHost = '127.0.0.1';
let serverUrl = `http://${serverHost}:${serverPort}`;
let isServerRunning = false;
let isDevMode = process.env.NODE_ENV === 'development';
let appDataPath = null;
let venvPath = null;
let cliPath = null;

// Constants
const MAX_SERVER_START_ATTEMPTS = 3;
const DEFAULT_PORT = 8000;
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
    
    // Set up data path
    appDataPath = path.join(app.getPath('userData'), 'data');
    if (!fs.existsSync(appDataPath)) {
        fs.mkdirSync(appDataPath, { recursive: true });
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
 * Find the annzarro-cli script path
 */
function findCliPath(resourcePath) {
    // Search for the CLI script in order of preference
    const possiblePaths = [
        path.join(resourcePath, 'annzarro-cli'),
        path.join(resourcePath, 'annzarro', 'bin', 'annzarro-cli'),
        path.join(resourcePath, 'bin', 'annzarro-cli')
    ];
    
    for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
            log.info(`Found CLI at: ${p}`);
            return p;
        }
    }
    
    log.error('Could not find annzarro-cli script');
    return null;
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
                try {
                    execSync(`chmod +x "${cliPath}"`);
                } catch (error) {
                    log.warn(`Failed to make CLI executable: ${error.message}`);
                }
            }
            
            // On Windows, use a shell command with proper quoting
            if (process.platform === 'win32') {
                const command = `"${cliPath}" start --port ${serverPort} --host ${serverHost} --config "${configPath}" --venv-path "${venvPath}" --auth-disabled --detach`;
                log.info(`Running Windows command: ${command}`);
                
                // Start the server process
                serverProcess = spawn(command, {
                    stdio: 'pipe',
                    shell: true
                });
            } else {
                // On Unix, use a proper args array to avoid shell escaping issues
                const args = [
                    'start',
                    '--port', serverPort.toString(),
                    '--host', serverHost,
                    '--config', configPath,
                    '--venv-path', venvPath,
                    '--auth-disabled',
                    '--detach'
                ];
                
                log.info(`Running with args: ${JSON.stringify(args)}`);
                
                // Start the server process with shell: false
                serverProcess = spawn(cliPath, args, {
                    stdio: 'pipe',
                    shell: false
                });
            }
            
            // Handle server process events
            serverProcess.stdout.on('data', (data) => {
                log.info(`Server stdout: ${data.toString().trim()}`);
            });
            
            serverProcess.stderr.on('data', (data) => {
                log.error(`Server stderr: ${data.toString().trim()}`);
            });
            
            serverProcess.on('close', (code) => {
                log.info(`Server process exited with code ${code}`);
                isServerRunning = false;
                serverProcess = null;
                
                // Auto-restart if server crashes and mainWindow still exists
                if (code !== 0 && mainWindow) {
                    log.warn('Server process crashed, attempting to restart');
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
                    execSync(`rmdir /s /q "${destPath}"`, { shell: true });
                    fs.mkdirSync(destPath, { recursive: true });
                } else {
                    execSync(`rm -rf "${destPath}" && mkdir -p "${destPath}"`, { shell: true });
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
            log.info(`Copy command: ${command}`);
            execSync(command, { shell: true });
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
            
            log.info(`Copy command: ${command}`);
            execSync(command, { shell: true });
        }
        
        // Make bin files executable on Unix
        if (process.platform !== 'win32') {
            try {
                const binDir = path.join(destPath, 'bin');
                if (fs.existsSync(binDir)) {
                    log.info('Making bin files executable');
                    execSync(`chmod +x ${binDir}/*`, { shell: true });
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
                try {
                    execSync(`chmod +x "${cliPath}"`);
                } catch (error) {
                    log.warn(`Failed to make CLI executable: ${error.message}`);
                }
            }
            
            log.info(`Creating venv at: ${venvPath}`);
            
            // On Windows, use execSync with a properly quoted command
            if (process.platform === 'win32') {
                const command = `"${cliPath}" install --clean --venv-path "${venvPath}"`;
                log.info(`Executing Windows command: ${command}`);
                const output = execSync(command, { 
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
                                
                                const pythonOutput = execSync(`${pythonCmd} "${installScript}" --clean --venv-path "${venvPath}"`, {
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
    
    if (!isServerRunning) {
        log.info('Server is not running');
        return;
    }
    
    try {
        log.info('Using CLI to stop server');
        
        // Handle Windows and Unix differently
        if (process.platform === 'win32') {
            // Build the stop command with proper quoting for Windows
            const command = `"${cliPath}" stop`;
            
            // Run stop command but don't wait for it to complete
            spawn(command, {
                stdio: 'ignore',
                shell: true,
                detached: true
            }).unref();
        } else {
            // Use args array for Unix
            const args = ['stop'];
            
            // Run stop command but don't wait for it to complete
            spawn(cliPath, args, {
                stdio: 'ignore',
                shell: false,
                detached: true
            }).unref();
        }
        
        isServerRunning = false;
        log.info('Server stop command issued');
        
        // Give some time for the server to stop
        await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
        log.error('Failed to stop server gracefully:', error);
        
        // Force kill if necessary
        try {
            if (serverProcess) {
                log.warn('Force killing server process');
                serverProcess.kill('SIGKILL');
                serverProcess = null;
            }
            
            // Find and kill any remaining Python processes
            const processes = await findProcess('name', 'python');
            for (const proc of processes) {
                if (proc.cmd.includes('annzarro')) {
                    log.warn(`Force killing orphaned Python process: ${proc.pid}`);
                    try {
                        process.kill(proc.pid, 'SIGKILL');
                    } catch (err) {
                        log.error(`Failed to kill process ${proc.pid}:`, err);
                    }
                }
            }
        } catch (killError) {
            log.error('Failed to force kill server processes:', killError);
        }
    }
    
    isServerRunning = false;
    serverProcess = null;
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
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// Force app quit and server termination
app.on('before-quit', async (event) => {
    if (isServerRunning) {
        event.preventDefault();
        await stopServer();
        app.quit();
    }
});