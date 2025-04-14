const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const log = require('electron-log');
const { autoUpdater } = require('electron-updater');
const findProcess = require('find-process');
const fs = require('fs');

// Configure logging
log.transports.file.level = 'info';
log.info('Application starting...');

// Global references
let mainWindow = null;
let serverProcess = null;
let appPath = null;
let serverPort = 8000;
let serverUrl = `http://localhost:${serverPort}`;
let isServerReady = false;
let pythonExecutable = null;
let serverStartAttempts = 0;
const MAX_SERVER_START_ATTEMPTS = 3;

// Set app name to match the Python package
app.setName('AnnZarro');

// Initialize auto-updater
autoUpdater.logger = log;
autoUpdater.checkForUpdatesAndNotify();

// Find Python executable based on platform
function findPythonExecutable() {
  if (app.isPackaged) {
    // In packaged mode, use bundled Python
    if (process.platform === 'win32') {
      return path.join(process.resourcesPath, 'app', 'python', 'python.exe');
    } else {
      return path.join(process.resourcesPath, 'app', 'python', 'bin', 'python3');
    }
  } else {
    // In development mode, use system Python
    return process.platform === 'win32' ? 'python' : 'python3';
  }
}

// Get app root path
function getAppRootPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app');
  } else {
    // In development, go up from desktop/electron directory to project root
    return path.resolve(__dirname, '..', '..', '..');
  }
}

// Start the Python server
function startServer() {
  if (serverProcess) {
    log.info('Server is already running');
    return;
  }

  // Add 1 more attempt
  serverStartAttempts++;
  log.info(`Starting server (attempt ${serverStartAttempts} of ${MAX_SERVER_START_ATTEMPTS})...`);

  // Check if port is already in use
  findProcess('port', serverPort)
    .then(list => {
      if (list.length > 0) {
        log.warn(`Port ${serverPort} is already in use by process ${list[0].name} (${list[0].pid})`);
        
        // Try to stop the existing process
        try {
          if (process.platform === 'win32') {
            spawn('taskkill', ['/PID', list[0].pid, '/F']);
          } else {
            process.kill(list[0].pid, 'SIGTERM');
          }
          log.info(`Killed existing process on port ${serverPort}`);
        } catch (err) {
          log.error(`Failed to kill existing process: ${err.message}`);
          dialog.showErrorBox(
            'Port in use',
            `The port ${serverPort} is already in use by another process. Please close that process and try again.`
          );
          if (!mainWindow) {
            app.quit();
          }
          return;
        }
      }

      // Start the server process
      const args = ['-m', 'annzarro.cli', 'start', '--host', 'localhost', '--port', String(serverPort)];
      
      // Add data directory if configured
      const dataDir = app.getPath('userData');
      if (dataDir) {
        args.push('--data-dir', path.join(dataDir, 'annzarro_data'));
      }

      // For development, allow running in debug mode
      if (!app.isPackaged) {
        args.push('--development');
      }

      log.info(`Spawning Python server: ${pythonExecutable} ${args.join(' ')}`);
      
      // Set server process env to include app root path in PYTHONPATH
      const env = {...process.env};
      if (app.isPackaged) {
        env.PYTHONPATH = appPath;
      }

      // Create data directory if it doesn't exist
      const dataDirectory = path.join(dataDir, 'annzarro_data');
      if (!fs.existsSync(dataDirectory)) {
        fs.mkdirSync(dataDirectory, { recursive: true });
      }
      
      // Spawn the server process
      serverProcess = spawn(pythonExecutable, args, {
        cwd: appPath,
        env,
        // Ensure stdout and stderr are treated as text
        stdio: ['ignore', 'pipe', 'pipe']
      });

      // Handle server process events
      serverProcess.stdout.on('data', (data) => {
        const output = data.toString().trim();
        log.info(`Server stdout: ${output}`);
        
        // Check if server is ready
        if (output.includes('Running on http://')) {
          log.info('Server is ready');
          isServerReady = true;
          
          // If window exists but hasn't loaded the URL yet, load it
          if (mainWindow && !mainWindow.webContents.getURL().includes('localhost')) {
            log.info(`Loading ${serverUrl} in main window`);
            mainWindow.loadURL(serverUrl);
          }
        }
      });

      serverProcess.stderr.on('data', (data) => {
        const output = data.toString().trim();
        log.error(`Server stderr: ${output}`);
      });

      serverProcess.on('error', (err) => {
        log.error(`Failed to start server: ${err.message}`);
        if (serverStartAttempts < MAX_SERVER_START_ATTEMPTS) {
          setTimeout(startServer, 1000);
        } else {
          dialog.showErrorBox(
            'Server Error',
            `Failed to start the server: ${err.message}\nPlease check the logs for more details.`
          );
        }
      });

      serverProcess.on('close', (code) => {
        log.info(`Server process exited with code ${code}`);
        serverProcess = null;
        isServerReady = false;
        
        // Don't attempt to restart if app is quitting or if we've reached max attempts
        if (!app.isQuitting && serverStartAttempts < MAX_SERVER_START_ATTEMPTS) {
          log.info('Restarting server...');
          setTimeout(startServer, 1000);
        }
      });
    })
    .catch(err => {
      log.error(`Error checking port: ${err.message}`);
      // Proceed anyway
      startServer();
    });
}

// Stop the server gracefully
function stopServer() {
  if (!serverProcess) {
    log.info('No server process to stop');
    return Promise.resolve();
  }
  
  log.info('Stopping server...');
  
  return new Promise((resolve) => {
    // Try to stop the server gracefully first
    const stopArgs = ['-m', 'annzarro.cli', 'stop'];
    const stopProcess = spawn(pythonExecutable, stopArgs, {
      cwd: appPath,
      env: process.env
    });
    
    // Set timeout for force kill if graceful stop fails
    const forceKillTimeout = setTimeout(() => {
      log.warn('Force killing server process...');
      if (serverProcess) {
        serverProcess.kill('SIGKILL');
      }
      resolve();
    }, 5000);
    
    stopProcess.on('close', () => {
      clearTimeout(forceKillTimeout);
      log.info('Server stopped gracefully');
      serverProcess = null;
      resolve();
    });
    
    stopProcess.on('error', () => {
      // If the stop command fails, fall back to kill
      log.warn('Error stopping server gracefully, attempting force kill');
      clearTimeout(forceKillTimeout);
      if (serverProcess) {
        serverProcess.kill('SIGKILL');
      }
      serverProcess = null;
      resolve();
    });
  });
}

// Wait for server to be ready
function waitForServerReady(attempts = 0, maxAttempts = 30, interval = 500) {
  return new Promise((resolve, reject) => {
    if (isServerReady) {
      resolve();
      return;
    }
    
    if (attempts >= maxAttempts) {
      reject(new Error('Server failed to start within the timeout period'));
      return;
    }
    
    setTimeout(() => {
      if (isServerReady) {
        resolve();
      } else {
        waitForServerReady(attempts + 1, maxAttempts, interval)
          .then(resolve)
          .catch(reject);
      }
    }, interval);
  });
}

// Create the browser window
function createWindow() {
  log.info('Creating main window...');
  
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'AnnZarro',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    show: false // Don't show until ready-to-show
  });
  
  // Event listeners for the window
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  
  mainWindow.on('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });
  
  // Open external links in browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  
  // If server is ready, load the URL immediately, otherwise wait
  if (isServerReady) {
    log.info(`Loading ${serverUrl} in main window`);
    mainWindow.loadURL(serverUrl);
  } else {
    // Load a loading screen while waiting for server
    mainWindow.loadFile(path.join(__dirname, 'loading.html'));
    
    // Wait for server to start and then load the main URL
    waitForServerReady()
      .then(() => {
        log.info(`Loading ${serverUrl} in main window`);
        mainWindow.loadURL(serverUrl);
      })
      .catch(err => {
        log.error(`Error waiting for server: ${err.message}`);
        mainWindow.loadFile(path.join(__dirname, 'error.html'));
      });
  }
  
  // Create main menu
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Exit',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Alt+F4',
          click: () => app.quit()
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Developer',
      submenu: [
        { role: 'toggleDevTools' },
        {
          label: 'Restart Server',
          click: async () => {
            await stopServer();
            serverStartAttempts = 0;
            startServer();
          }
        }
      ]
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'About AnnZarro',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              title: 'About AnnZarro',
              message: 'AnnZarro Desktop',
              detail: `Version: ${app.getVersion()}\nA desktop application for Zarr-based AnnData visualization.`,
              buttons: ['OK'],
              type: 'info'
            });
          }
        }
      ]
    }
  ];
  
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// App ready event handler
app.whenReady().then(() => {
  // Initialize app paths
  appPath = getAppRootPath();
  pythonExecutable = findPythonExecutable();
  
  log.info(`App root path: ${appPath}`);
  log.info(`Python executable: ${pythonExecutable}`);
  
  // Start server and create window
  startServer();
  createWindow();
  
  // MacOS: recreate window when dock icon is clicked
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Handle app before-quit
app.on('before-quit', async (event) => {
  // Mark that we're quitting, so we don't restart processes
  app.isQuitting = true;
  
  // If server is running, prevent quit and stop server first
  if (serverProcess) {
    event.preventDefault();
    
    try {
      await stopServer();
      // Actually quit after server is stopped
      app.quit();
    } catch (err) {
      log.error(`Error stopping server: ${err.message}`);
      app.exit(1); // Force exit if there was an error
    }
  }
});

// IPC Handlers
ipcMain.handle('app:getVersion', () => app.getVersion());
ipcMain.handle('app:checkForUpdates', () => autoUpdater.checkForUpdatesAndNotify());
ipcMain.handle('app:restartServer', async () => {
  await stopServer();
  serverStartAttempts = 0;
  startServer();
  return true;
});