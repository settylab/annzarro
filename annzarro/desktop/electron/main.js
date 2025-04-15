const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const log = require('electron-log');
const { autoUpdater } = require('electron-updater');
const findProcess = require('find-process');
const fs = require('fs');

// Configure logging
log.transports.file.level = 'info';

// Fix for EPIPE errors in console transport
try {
  // Safely configure console transport with error handling
  log.transports.console = {
    level: 'info',
    format: '{h}:{i}:{s} {text}',
    useStyles: true
  };

  // Add error handling for console transport
  const originalConsoleLog = log.transports.console.log;
  log.transports.console.log = function safeConsoleLog(message) {
    try {
      if (originalConsoleLog) {
        originalConsoleLog(message);
      } else {
        console.log(message);
      }
    } catch (err) {
      // Silently catch EPIPE errors
      if (err.code !== 'EPIPE') {
        console.error('Error in electron-log console transport:', err);
      }
    }
  };
} catch (err) {
  // If anything fails in log setup, disable console transport
  log.transports.console.level = false;
  console.error('Error configuring electron-log, console transport disabled:', err);
}

log.info('Application starting...');

// Global references
let mainWindow = null;
let serverProcess = null;
let appPath = null;
let serverPort = 8000;
let serverUrl = `http://localhost:${serverPort}`;
let isServerExternallyManaged = false; // Flag to track if server is managed externally
let isServerReady = false;
let pythonExecutable = null;
let serverStartAttempts = 0;
const MAX_SERVER_START_ATTEMPTS = 3;

// Set app name to match the Python package
app.setName('AnnZarro');

// Initialize auto-updater only if we're in a packaged app
if (app.isPackaged) {
  try {
    autoUpdater.logger = log;
    // Only check for updates if the app-update.yml file exists
    const updateConfigPath = path.join(process.resourcesPath, 'app-update.yml');
    if (fs.existsSync(updateConfigPath)) {
      log.info('Auto-updater config found, enabling auto-updates');
      autoUpdater.checkForUpdatesAndNotify().catch(err => {
        log.warn(`Auto-update check failed: ${err.message}`);
      });
    } else {
      log.warn('Auto-updater config not found, disabling auto-updates');
    }
  } catch (err) {
    log.warn(`Error initializing auto-updater: ${err.message}`);
  }
} else {
  log.info('Running in development mode, auto-updater disabled');
}

// Find Python executable based on platform
function findPythonExecutable() {
  if (app.isPackaged) {
    // In packaged mode, first check if we have a venv Python available
    const venvPath = path.join(app.getPath('userData'), 'python_venv');
    const venvPythonPath = process.platform === 'win32'
      ? path.join(venvPath, 'Scripts', 'python.exe')
      : path.join(venvPath, 'bin', 'python3');
    
    // If venv exists and has a Python executable, use it
    if (fs.existsSync(venvPythonPath)) {
      log.info(`Found virtual environment Python at: ${venvPythonPath}`);
      return venvPythonPath;
    }
    
    // If venv Python doesn't exist yet, check other possible locations
    if (process.platform === 'win32') {
      // Windows - check typical locations
      const possiblePaths = [
        path.join(process.resourcesPath, 'app', 'python', 'python.exe'),
        path.join(process.resourcesPath, 'python', 'python.exe'),
        'python.exe'  // System Python as fallback
      ];
      
      for (const pythonPath of possiblePaths) {
        if (fs.existsSync(pythonPath)) {
          log.info(`Found Python executable at: ${pythonPath}`);
          return pythonPath;
        }
      }
      
      // Default to system Python if none found
      return 'python';
    } else if (process.platform === 'darwin') {
      // macOS - check typical locations
      const possiblePaths = [
        path.join(process.resourcesPath, 'app', 'python', 'bin', 'python3'),
        path.join(process.resourcesPath, 'python', 'bin', 'python3'),
        '/usr/bin/python3',
        '/usr/local/bin/python3',
        '/opt/homebrew/bin/python3'
      ];
      
      // Check for system Python first - no permission issues
      for (const pythonPath of ['/usr/bin/python3', '/usr/local/bin/python3', '/opt/homebrew/bin/python3']) {
        if (fs.existsSync(pythonPath)) {
          log.info(`Found Python executable at: ${pythonPath}`);
          return pythonPath;
        }
      }
      
      // Then check bundled Python options
      for (const pythonPath of possiblePaths) {
        if (fs.existsSync(pythonPath)) {
          log.info(`Found Python executable at: ${pythonPath}`);
          return pythonPath;
        }
      }
      
      // Default to system Python if none found
      return 'python3';
    } else {
      // Linux - check typical locations
      const possiblePaths = [
        path.join(process.resourcesPath, 'app', 'python', 'bin', 'python3'),
        path.join(process.resourcesPath, 'python', 'bin', 'python3'),
        '/usr/bin/python3',
        '/usr/local/bin/python3'
      ];
      
      for (const pythonPath of possiblePaths) {
        if (fs.existsSync(pythonPath)) {
          log.info(`Found Python executable at: ${pythonPath}`);
          return pythonPath;
        }
      }
      
      // Default to system Python if none found
      return 'python3';
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

// Find bundled Python environment
function findBundledPythonEnvironment() {
  if (app.isPackaged) {
    // Check for bundled Python in priority order
    const possiblePaths = [];
    
    if (process.platform === 'win32') {
      // Windows paths
      possiblePaths.push(
        path.join(process.resourcesPath, 'app', 'python', 'python.exe'),
        path.join(process.resourcesPath, 'python', 'python.exe'),
        path.join(process.resourcesPath, 'app.asar.unpacked', 'python', 'python.exe')
      );
    } else if (process.platform === 'darwin') {
      // macOS paths - include both system Python locations
      possiblePaths.push(
        path.join(process.resourcesPath, 'app', 'python', 'bin', 'python3'),
        path.join(process.resourcesPath, 'python', 'bin', 'python3'),
        path.join(process.resourcesPath, 'app.asar.unpacked', 'python', 'bin', 'python3'),
        '/usr/bin/python3',
        '/usr/local/bin/python3',
        '/opt/homebrew/bin/python3'
      );
    } else {
      // Linux paths
      possiblePaths.push(
        path.join(process.resourcesPath, 'app', 'python', 'bin', 'python3'),
        path.join(process.resourcesPath, 'python', 'bin', 'python3'),
        path.join(process.resourcesPath, 'app.asar.unpacked', 'python', 'bin', 'python3'),
        '/usr/bin/python3'
      );
    }
    
    // Check if any of the bundled Python paths exist
    for (const pythonPath of possiblePaths) {
      if (fs.existsSync(pythonPath)) {
        log.info(`Found bundled Python at: ${pythonPath}`);
        return pythonPath;
      }
    }
    
    log.warn('No bundled Python environment found');
  }
  
  return null;
}

// Install Python dependencies using the improved annzarro-install.py script
function installDependencies() {
  return new Promise((resolve, reject) => {
    log.info('Checking and installing Python dependencies...');
    
    // First check for a bundled Python environment
    const bundledPython = findBundledPythonEnvironment();
    if (bundledPython) {
      log.info(`Using bundled Python environment: ${bundledPython}`);
      pythonExecutable = bundledPython;
      resolve();
      return;
    }
    
    // If no bundled environment, use a user-specific venv as fallback
    log.info('No bundled Python found, creating virtual environment as fallback...');
    
    // Get paths for venv - use a consistent location in userData
    // This ensures we only have one Python environment and it's properly isolated 
    const venvPath = path.join(app.getPath('userData'), 'python_venv');
      
    log.info(`Using virtual environment at: ${venvPath}`);
    
    // Find the annzarro-install.py script
    const repoRoot = getAppRootPath();
    const installerScript = path.join(repoRoot, 'annzarro-install.py');
    
    // Check if the installer script exists
    if (!fs.existsSync(installerScript)) {
      log.error(`Installer script not found at ${installerScript}`);
      
      // Create a minimal installer function using Python's built-in venv
      log.info('Falling back to basic venv and pip installation');
      
      // Ensure the venv directory exists
      if (!fs.existsSync(venvPath)) {
        try {
          fs.mkdirSync(venvPath, { recursive: true });
        } catch (err) {
          log.error(`Failed to create virtual environment directory: ${err.message}`);
          return reject(new Error('Failed to create virtual environment directory'));
        }
      }
      
      // Create venv with Python's venv module
      const venvProcess = spawn(pythonExecutable, ['-m', 'venv', venvPath], {
        stdio: ['ignore', 'pipe', 'pipe']
      });
      
      venvProcess.on('close', (code) => {
        if (code === 0) {
          // Set Python path to venv Python
          const venvPythonPath = process.platform === 'win32' 
            ? path.join(venvPath, 'Scripts', 'python.exe')
            : path.join(venvPath, 'bin', 'python3');
            
          // Use pip to install from requirements.txt
          const requirementsPath = path.join(__dirname, 'requirements.txt');
          if (fs.existsSync(requirementsPath)) {
            log.info(`Installing dependencies from ${requirementsPath}`);
            
            const pipProcess = spawn(venvPythonPath, ['-m', 'pip', 'install', '-r', requirementsPath], {
              stdio: ['ignore', 'pipe', 'pipe']
            });
            
            pipProcess.stdout.on('data', (data) => {
              log.info(`Pip stdout: ${data.toString().trim()}`);
            });
            
            pipProcess.stderr.on('data', (data) => {
              log.error(`Pip stderr: ${data.toString().trim()}`);
            });
            
            pipProcess.on('close', (pipCode) => {
              if (pipCode === 0) {
                log.info('Python dependencies installed successfully');
                pythonExecutable = venvPythonPath; // Update the Python path
                resolve();
              } else {
                log.error(`Failed to install dependencies with pip, exit code: ${pipCode}`);
                resolve(); // Continue anyway
              }
            });
            
            pipProcess.on('error', (err) => {
              log.error(`Error installing dependencies with pip: ${err.message}`);
              resolve(); // Continue anyway
            });
          } else {
            log.error(`Requirements file not found at ${requirementsPath}`);
            resolve(); // Continue anyway
          }
        } else {
          log.error(`Failed to create venv, exit code: ${code}`);
          resolve(); // Continue anyway
        }
      });
      
      venvProcess.on('error', (err) => {
        log.error(`Error creating venv: ${err.message}`);
        resolve(); // Continue anyway
      });
      
      return;
    }
    
    // Use the installer script for dependency management
    log.info(`Found installer script at ${installerScript}`);
    
    // Build the installer command (don't use --clean flag as it's not supported)
    const args = [
      installerScript,
      '--venv-path', venvPath
    ];
    
    // Spawn the installer process
    log.info(`Running installer: ${pythonExecutable} ${args.join(' ')}`);
    const installerProcess = spawn(pythonExecutable, args, {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    
    installerProcess.stdout.on('data', (data) => {
      const output = data.toString().trim();
      if (output) {
        log.info(`Installer stdout: ${output}`);
      }
    });
    
    installerProcess.stderr.on('data', (data) => {
      const output = data.toString().trim();
      if (output) {
        log.error(`Installer stderr: ${output}`);
      }
    });
    
    installerProcess.on('close', (code) => {
      if (code === 0) {
        log.info('Python dependencies installed successfully');
        
        // Update pythonExecutable to use the venv Python
        const venvPythonPath = process.platform === 'win32'
          ? path.join(venvPath, 'Scripts', 'python.exe')
          : path.join(venvPath, 'bin', 'python3');
          
        if (fs.existsSync(venvPythonPath)) {
          log.info(`Using virtual environment Python: ${venvPythonPath}`);
          pythonExecutable = venvPythonPath;
        } else {
          log.warn(`Virtual environment Python executable not found at ${venvPythonPath}`);
          // Try alternate path for Python 
          const altPath = process.platform === 'win32'
            ? venvPythonPath
            : path.join(venvPath, 'bin', 'python');
            
          if (fs.existsSync(altPath)) {
            log.info(`Using alternate Python path: ${altPath}`);
            pythonExecutable = altPath;
          } else {
            log.warn(`No Python found in venv, using system Python: ${pythonExecutable}`);
          }
        }
        
        resolve();
      } else {
        log.error(`Installer failed with exit code: ${code}`);
        
        if (mainWindow) {
          dialog.showMessageBox(mainWindow, {
            type: 'warning',
            title: 'Dependency Installation Warning',
            message: 'Some dependencies could not be installed automatically.',
            detail: 'The application may not function correctly. Please check the logs for more information.'
          });
        }
        
        // Still resolve to continue with app startup
        resolve();
      }
    });
    
    installerProcess.on('error', (err) => {
      log.error(`Error running installer: ${err.message}`);
      reject(err);
    });
  });
}

// Check if module exists
function checkPythonModule(moduleName) {
  return new Promise((resolve) => {
    // Set PYTHONPATH to include all possible module locations
    const env = {...process.env};
    
    // Add important paths to PYTHONPATH to help find modules
    const pythonPaths = [
      appPath, // Base app path
      process.resourcesPath,
      path.join(process.resourcesPath, 'app')
    ];
    
    if (app.isPackaged) {
      // Add specific paths for packaged app
      pythonPaths.push(
        path.join(process.resourcesPath, 'app.asar.unpacked'),
        path.join(process.resourcesPath, 'app.asar.unpacked', 'annzarro'),
        path.join(process.resourcesPath, 'app', 'annzarro'),
        path.join(app.getPath('userData'), 'python_venv', 'lib', 
          process.platform === 'win32' ? 'site-packages' : 
          `python${pythonExecutable.includes('python3') ? '3' : ''}*/site-packages`)
      );
      
      // Add site-packages directories for all Python versions
      if (process.platform !== 'win32') {
        // On Unix systems, check various Python version directories
        for (let i = 7; i <= 12; i++) {
          pythonPaths.push(path.join(app.getPath('userData'), 'python_venv', 'lib', `python3.${i}`, 'site-packages'));
        }
      }
    } else {
      // Add development paths
      pythonPaths.push(
        path.resolve(__dirname, '..', '..', '..'), // Project root
        path.join(__dirname, 'python_venv', 'lib', 
          process.platform === 'win32' ? 'site-packages' : 
          `python${pythonExecutable.includes('python3') ? '3' : ''}*/site-packages`)
      );
    }
    
    // Add current env PYTHONPATH if it exists
    if (process.env.PYTHONPATH) {
      pythonPaths.push(process.env.PYTHONPATH);
    }
    
    env.PYTHONPATH = pythonPaths.join(process.platform === 'win32' ? ';' : ':');
    
    // If checking for a specific module that might be missing, try to create a .pth file
    if (moduleName.startsWith('annzarro') && app.isPackaged) {
      try {
        // Find site-packages directory in venv if it exists
        const venvPath = path.join(app.getPath('userData'), 'python_venv');
        if (fs.existsSync(venvPath)) {
          let sitePackagesDir = '';
          
          if (process.platform === 'win32') {
            sitePackagesDir = path.join(venvPath, 'Lib', 'site-packages');
          } else {
            // Try to find actual site-packages directory
            const libDir = path.join(venvPath, 'lib');
            if (fs.existsSync(libDir)) {
              const dirs = fs.readdirSync(libDir);
              const pythonDirs = dirs.filter(dir => dir.startsWith('python'));
              
              if (pythonDirs.length > 0) {
                sitePackagesDir = path.join(libDir, pythonDirs[0], 'site-packages');
              }
            }
          }
          
          // If site-packages directory found, create .pth file
          if (sitePackagesDir && fs.existsSync(sitePackagesDir)) {
            const pthFile = path.join(sitePackagesDir, 'annzarro.pth');
            fs.writeFileSync(pthFile, appPath);
            log.info(`Created Python path file at ${pthFile} pointing to ${appPath}`);
          }
        }
      } catch (err) {
        log.error(`Error setting up Python paths: ${err.message}`);
      }
    }
    
    // Check for a module with more diagnostic information
    const checkScript = `
try:
    import sys
    print(f"Python path: {sys.path}")
    print(f"Python executable: {sys.executable}")
    import ${moduleName}
    print(f"Module {moduleName} exists at {getattr(${moduleName}, '__file__', 'unknown')}")
    exit(0)
except ImportError as e:
    print(f"Module {moduleName} missing: {e}")
    exit(1)
except Exception as e:
    print(f"Error checking for {moduleName}: {e}")
    exit(2)
`;
    
    const checkProcess = spawn(pythonExecutable, ['-c', checkScript], { env });
    
    checkProcess.stdout.on('data', (data) => {
      const output = data.toString().trim();
      log.info(`Module check stdout: ${output}`);
    });
    
    checkProcess.stderr.on('data', (data) => {
      const output = data.toString().trim();
      log.error(`Module check stderr: ${output}`);
    });
    
    checkProcess.on('close', (code) => {
      resolve(code === 0);
    });
    
    checkProcess.on('error', (err) => {
      log.error(`Error checking module ${moduleName}: ${err.message}`);
      resolve(false);
    });
  });
}

// Ensure dependencies are installed
async function checkDependencies() {
  log.info('Checking Python environment...');
  
  // First check for a bundled Python environment
  const bundledPython = findBundledPythonEnvironment();
  if (bundledPython) {
    log.info(`Using bundled Python environment: ${bundledPython}`);
    pythonExecutable = bundledPython;
    return;
  }
  
  // If no bundled Python, check for existing venv or create one
  log.info('No bundled Python found, checking/creating virtual environment as fallback...');
  
  try {
    const venvPath = path.join(app.getPath('userData'), 'python_venv');
    const cliPath = path.join(appPath, 'annzarro-cli');
    const installerScript = path.join(appPath, 'annzarro-install.py');
    
    // Check if CLI and installer scripts exist
    const cliExists = fs.existsSync(cliPath);
    const installerExists = fs.existsSync(installerScript);
    
    if (!installerExists) {
      log.error(`Installer script not found at ${installerScript}`);
      return;  // Cannot proceed without installer
    }
    
    log.info(`Python venv path: ${venvPath}`);
    
    // Try to make CLI executable if it exists
    if (cliExists && process.platform !== 'win32') {
      try {
        fs.chmodSync(cliPath, 0o755);
      } catch (err) {
        log.error(`Failed to make CLI executable: ${err.message}`);
      }
    }
    
    // Check if venv already exists and has Python
    const venvPythonPath = process.platform === 'win32'
      ? path.join(venvPath, 'Scripts', 'python.exe')
      : path.join(venvPath, 'bin', 'python3');
      
    if (fs.existsSync(venvPythonPath)) {
      log.info(`Virtual environment already exists at ${venvPath}`);
      pythonExecutable = venvPythonPath;
      return;
    }
    
    // If venv doesn't exist, create it
    log.info('Virtual environment not found, setting up...');
    
    let installProcess;
    
    if (cliExists) {
      // Use the CLI when available
      log.info(`Installing dependencies using CLI with venv path: ${venvPath}`);
      
      // Spawn the install command (don't use --clean as it's not supported)
      const installCommand = ['--venv-path', venvPath, 'install'];
      
      // Execute the CLI directly or through Python depending on platform
      if (process.platform === 'win32') {
        // On Windows, use Python to run the CLI
        installProcess = await new Promise((resolve, reject) => {
          const proc = spawn(pythonExecutable, [cliPath, ...installCommand], {
            cwd: appPath,
            stdio: ['ignore', 'pipe', 'pipe']
          });
          
          proc.stdout.on('data', (data) => {
            log.info(`Install stdout: ${data.toString().trim()}`);
          });
          
          proc.stderr.on('data', (data) => {
            log.error(`Install stderr: ${data.toString().trim()}`);
          });
          
          proc.on('close', (code) => {
            if (code === 0) {
              log.info('Installation completed successfully');
              resolve(true);
            } else {
              log.error(`Installation failed with code ${code}`);
              resolve(false);
            }
          });
          
          proc.on('error', (err) => {
            log.error(`Installation error: ${err.message}`);
            reject(err);
          });
        });
      } else {
        // On Unix, execute the CLI script directly
        installProcess = await new Promise((resolve, reject) => {
          const proc = spawn(cliPath, installCommand, {
            cwd: appPath,
            stdio: ['ignore', 'pipe', 'pipe']
          });
          
          proc.stdout.on('data', (data) => {
            log.info(`Install stdout: ${data.toString().trim()}`);
          });
          
          proc.stderr.on('data', (data) => {
            log.error(`Install stderr: ${data.toString().trim()}`);
          });
          
          proc.on('close', (code) => {
            if (code === 0) {
              log.info('Installation completed successfully');
              resolve(true);
            } else {
              log.error(`Installation failed with code ${code}`);
              resolve(false);
            }
          });
          
          proc.on('error', (err) => {
            log.error(`Installation error: ${err.message}`);
            reject(err);
          });
        });
      }
    } else {
      // Fall back to using the installer script directly
      log.warn(`CLI script not found at ${cliPath}, falling back to direct installer execution`);
      
      // No --clean flag for installer
      const installArgs = ['--venv-path', venvPath];
      
      installProcess = await new Promise((resolve, reject) => {
        const proc = spawn(pythonExecutable, [installerScript, ...installArgs], {
          cwd: appPath,
          stdio: ['ignore', 'pipe', 'pipe']
        });
        
        proc.stdout.on('data', (data) => {
          log.info(`Installer stdout: ${data.toString().trim()}`);
        });
        
        proc.stderr.on('data', (data) => {
          log.error(`Installer stderr: ${data.toString().trim()}`);
        });
        
        proc.on('close', (code) => {
          if (code === 0) {
            log.info('Installation completed successfully');
            resolve(true);
          } else {
            log.error(`Installation failed with code ${code}`);
            resolve(false);
          }
        });
        
        proc.on('error', (err) => {
          log.error(`Installation error: ${err.message}`);
          reject(err);
        });
      });
    }
    
    log.info('Dependencies installation completed');
    
    // Update Python executable to use the venv Python if it exists now
    if (fs.existsSync(venvPythonPath)) {
      log.info(`Using virtual environment Python: ${venvPythonPath}`);
      pythonExecutable = venvPythonPath;
    }
  } catch (err) {
    log.error(`Failed to install dependencies: ${err.message}`);
  }
}

// Start the Python server
async function startServer() {
  if (serverProcess) {
    log.info('Server is already running');
    return;
  }

  // Add 1 more attempt
  serverStartAttempts++;
  log.info(`Starting server (attempt ${serverStartAttempts} of ${MAX_SERVER_START_ATTEMPTS})...`);

  // Check dependencies first
  try {
    await checkDependencies();
  } catch (err) {
    log.error(`Error checking dependencies: ${err.message}`);
    // Continue anyway - we'll show error if server fails to start
  }

  // Always use a new port for the app's server to avoid conflicts with existing servers
  try {
    // Try to find a free port starting from serverPort
    const newPort = await findFreePort(serverPort);
    if (newPort !== serverPort) {
      log.info(`Original port ${serverPort} is in use, found free port: ${newPort}`);
      serverPort = newPort;
      serverUrl = `http://localhost:${serverPort}`;
    } else {
      log.info(`Using original port: ${serverPort}`);
    }
    
    // We don't try to use an existing server - always start our own
    // This eliminates potential confusion with external servers
    isServerExternallyManaged = false;
    isServerReady = false;
  } catch (err) {
    log.error(`Error finding free port: ${err.message}`);
    // Continue with default port if port finding fails
  }

    // Define the venv path for consistency with installation
    const venvPath = path.join(app.getPath('userData'), 'python_venv');
    
    // Start the server process using annzarro-cli directly
    // This ensures the CLI handles venv activation properly as it was designed to do
    let cliPath = path.join(appPath, 'annzarro-cli');
    
    // Set up empty data directory for file picker-based operation
    const emptyDataDir = path.join(app.getPath('userData'), 'data');
    
    // Ensure the empty data directory exists
    if (!fs.existsSync(emptyDataDir)) {
      try {
        fs.mkdirSync(emptyDataDir, { recursive: true });
        log.info(`Created empty data directory: ${emptyDataDir}`);
      } catch (err) {
        log.error(`Failed to create empty data directory: ${err.message}`);
      }
    }
    
    // Prepare our arguments for the CLI wrapper (using current serverPort value)
    log.info(`Starting server on port: ${serverPort}`);
    const startCommand = ['start', '--host', 'localhost', '--port', String(serverPort), '--data-dir', emptyDataDir];
    
    // Add venv path to ensure the CLI uses the correct environment
    startCommand.unshift('--venv-path', venvPath);

    // For development, allow running in debug mode
    if (!app.isPackaged) {
      startCommand.push('--development');
    }

    // If on Windows, adjust the CLI path
    if (process.platform === 'win32') {
      // On Windows we need to run the Python script directly
      log.info(`Using CLI from: ${cliPath}`);
      args = [cliPath, ...startCommand];
      log.info(`Spawning Python server via CLI: ${pythonExecutable} ${args.join(' ')}`);
    } else {
      // On Unix systems we can execute the bash script directly
      log.info(`Using CLI from: ${cliPath}`);
      
      // Ensure the CLI script is executable
      try {
        fs.chmodSync(cliPath, 0o755);
      } catch (err) {
        log.error(`Failed to make CLI executable: ${err.message}`);
      }
      
      log.info(`Spawning server via CLI: ${cliPath} ${startCommand.join(' ')}`);
    }
    
    // Set basic environment variables
    const env = {...process.env};

    // Create data directory if it doesn't exist - we already did this above
    // No need for additional data directory creation
    
    try {
      // Log the complete command and environment for debugging
      log.info('Server environment variables:');
      Object.keys(env).forEach(key => {
        if (key.toLowerCase().includes('path')) {
          log.info(`${key}=${env[key]}`);
        }
      });
      
      // Data directory already created earlier
      
      // Check if CLI script exists
      const cliExists = fs.existsSync(cliPath);
      
      if (!cliExists) {
        log.warn(`CLI script not found at ${cliPath}, falling back to direct Python execution`);
        
        // Fall back to direct Python execution if CLI script not found
        const pythonArgs = ['-m', 'annzarro.cli', 'start', 
          '--host', 'localhost', 
          '--port', String(serverPort),
          '--data-dir', emptyDataDir
        ];
        
        if (!app.isPackaged) {
          pythonArgs.push('--development');
        }
        
        log.info(`Spawning Python server directly: ${pythonExecutable} ${pythonArgs.join(' ')}`);
        
        serverProcess = spawn(pythonExecutable, pythonArgs, {
          cwd: appPath,
          env,
          stdio: ['ignore', 'pipe', 'pipe']
        });
      } else {
        // Spawn the server process using the CLI when available
        if (process.platform === 'win32') {
          // On Windows, use pythonExecutable to run the CLI script
          serverProcess = spawn(pythonExecutable, args, {
            cwd: appPath,
            env,
            stdio: ['ignore', 'pipe', 'pipe']
          });
        } else {
          // On Unix, execute the CLI script directly
          serverProcess = spawn(cliPath, startCommand, {
            cwd: appPath,
            env,
            stdio: ['ignore', 'pipe', 'pipe']
          });
        }
      }

      // Set up a timeout for server readiness
      const serverReadyTimeout = setTimeout(() => {
        if (!isServerReady) {
          log.warn('Server failed to start within timeout period');
          
          // No need to check for existing server - just show error
          if (serverProcess) {
            // Kill the server process as it's not responding
            try {
              serverProcess.kill('SIGKILL');
              serverProcess = null;
              log.info('Killed non-responsive server process');
            } catch (e) {
              log.error(`Error killing server process: ${e.message}`);
            }
          }
          
          // Show error UI and keep it shown
          if (mainWindow && !mainWindow.isDestroyed()) {
            log.error('Loading error page due to server timeout');
            mainWindow.loadFile(path.join(__dirname, 'error.html'));
            
            // Prevent any further attempts to load other URLs
            mainWindow.webContents.on('will-navigate', (e) => {
              if (!isServerReady) {
                e.preventDefault();
                log.info('Prevented navigation while server is not ready');
              }
            });
          }
        }
      }, 15000); // 15 seconds timeout
      
      // Handle server process events
      serverProcess.stdout.on('data', (data) => {
        const output = data.toString().trim();
        log.info(`Server stdout: ${output}`);
        
        // Check for multiple potential messages indicating server is ready
        // Flask/Werkzeug output format: "* Running on http://..."
        // Gunicorn output format: "[INFO] Starting gunicorn..." followed by "Listening at: http://..."
        if (output.includes('Running on http://') || 
            output.includes('Listening at: http://') ||
            output.includes('server started') ||
            output.includes('Application startup complete')) {
          
          log.info('Server is ready');
          isServerReady = true;
          clearTimeout(serverReadyTimeout);
          
          // Extract port information if present to double-check
          const portMatch = output.match(/localhost:(\d+)/);
          if (portMatch && portMatch[1]) {
            const detectedPort = parseInt(portMatch[1]);
            if (detectedPort !== serverPort) {
              log.info(`Detected different port than expected: ${detectedPort} vs ${serverPort}`);
              serverPort = detectedPort;
              serverUrl = `http://localhost:${serverPort}`;
            }
          }
          
          // If window exists but hasn't loaded the URL yet, load it
          if (mainWindow && !mainWindow.webContents.getURL().includes('localhost')) {
            log.info(`Loading ${serverUrl} in main window`);
            mainWindow.loadURL(serverUrl).catch(err => {
              log.error(`Error loading URL in window: ${err.message}`);
            });
          }
        } else if (output.includes('Debug mode') || output.includes('Press CTRL+C to quit')) {
          // Alternative server ready patterns
          setTimeout(() => {
            if (!isServerReady) {
              log.info('Server appears to be ready based on debug output');
              isServerReady = true;
              clearTimeout(serverReadyTimeout);
              
              // If window exists but hasn't loaded the URL yet, load it
              if (mainWindow && !mainWindow.webContents.getURL().includes('localhost')) {
                log.info(`Loading ${serverUrl} in main window`);
                mainWindow.loadURL(serverUrl).catch(err => {
                  log.error(`Error loading URL in window: ${err.message}`);
                });
              }
            }
          }, 2000); // Short delay to check if more direct ready messages come
        }
      });

      serverProcess.stderr.on('data', (data) => {
        const output = data.toString().trim();
        log.error(`Server stderr: ${output}`);
        
        // Check for port in use error
        if (output.includes('Address already in use') || output.includes('Port 8000 is in use')) {
          log.warn('Detected server port conflict');
          
          // Kill current process
          if (serverProcess) {
            serverProcess.kill();
          }
          
          // Auto find a new port and try again
          if (serverStartAttempts < MAX_SERVER_START_ATTEMPTS) {
            findFreePort(serverPort + 1).then(newPort => {
              log.info(`Found new free port: ${newPort}`);
              serverPort = newPort;
              serverUrl = `http://localhost:${serverPort}`;
              
              // Restart server with new port
              setTimeout(startServer, 1000);
            }).catch(err => {
              log.error(`Failed to find free port: ${err.message}`);
            });
          }
          return;
        }
        
        // Look for common error patterns in stderr
        if (output.includes('ImportError') || output.includes('ModuleNotFoundError')) {
          // This is a Python module import error
          log.error('Detected Python import error. Missing dependencies may need to be installed.');
          
          // Try to extract the missing module name
          const importErrorMatch = output.match(/No module named '([^']+)'/);
          if (importErrorMatch && importErrorMatch[1]) {
            const missingModule = importErrorMatch[1];
            log.error(`Missing Python module: ${missingModule}`);
            
            // Special handling for annzarro modules
            if (missingModule.startsWith('annzarro.')) {
              log.error(`Package structure issue detected with: ${missingModule}`);
              log.info('This is a packaging problem rather than a missing dependency');
              
              // Create enhanced path and symlinks to help with imports
              if (serverStartAttempts <= 2) {
                try {
                  // First check if module exists in resources directory
                  const moduleDir = missingModule.split('.');
                  const modulePath = path.join(appPath, ...moduleDir);
                  const parentPath = path.dirname(modulePath);
                  
                  log.info(`Checking for module directory at: ${parentPath}`);
                  
                  if (fs.existsSync(parentPath)) {
                    log.info(`Found parent module directory: ${parentPath}`);
                    
                    // Create an enhanced PYTHONPATH environment variable
                    const pythonPaths = [
                      appPath,
                      process.resourcesPath,
                      path.join(process.resourcesPath, 'app'),
                      path.join(process.resourcesPath, 'app', 'annzarro')
                    ];
                    
                    // Check if we have a venv to work with
                    const venvPath = app.isPackaged
                      ? path.join(app.getPath('userData'), 'python_venv')
                      : path.join(__dirname, 'python_venv');
                    
                    if (fs.existsSync(venvPath)) {
                      // Find all possible site-packages directories
                      const sitePackagesDirs = [];
                      
                      if (process.platform === 'win32') {
                        // Windows paths
                        sitePackagesDirs.push(
                          path.join(venvPath, 'Lib', 'site-packages'),
                          path.join(venvPath, 'lib', 'site-packages')
                        );
                      } else {
                        // Unix paths - try all possible Python versions
                        const libDir = path.join(venvPath, 'lib');
                        if (fs.existsSync(libDir)) {
                          const libContents = fs.readdirSync(libDir);
                          const pythonDirs = libContents.filter(item => item.startsWith('python'));
                          
                          // Add all Python version site-packages
                          for (const pyDir of pythonDirs) {
                            sitePackagesDirs.push(path.join(libDir, pyDir, 'site-packages'));
                          }
                          
                          // Fallback to guessing versions if none found
                          if (pythonDirs.length === 0) {
                            for (let i = 7; i <= 12; i++) {
                              sitePackagesDirs.push(path.join(libDir, `python3.${i}`, 'site-packages'));
                            }
                          }
                        }
                      }
                      
                      // Add site-packages directories to Python paths
                      pythonPaths.push(...sitePackagesDirs);
                      
                      // Create .pth files in all site-packages directories
                      for (const sitePackagesDir of sitePackagesDirs) {
                        if (fs.existsSync(sitePackagesDir)) {
                          // Create path file first
                          const pthFilePath = path.join(sitePackagesDir, 'annzarro_app.pth');
                          fs.writeFileSync(pthFilePath, appPath);
                          log.info(`Created Python path file at: ${pthFilePath}`);
                          
                          // Create symbolic links/directory copies for important modules
                          const moduleDirs = ['data', 'core', 'server', 'utils'];
                          
                          // Create main annzarro directory
                          const annzarroLinkPath = path.join(sitePackagesDir, 'annzarro');
                          if (!fs.existsSync(annzarroLinkPath)) {
                            try {
                              fs.mkdirSync(annzarroLinkPath, { recursive: true });
                              log.info(`Created annzarro package directory at ${annzarroLinkPath}`);
                              
                              // Create __init__.py
                              fs.writeFileSync(path.join(annzarroLinkPath, '__init__.py'), '');
                              
                              // Create subdirectories with links/copies
                              for (const dir of moduleDirs) {
                                const targetPath = path.join(appPath, 'annzarro', dir);
                                const linkPath = path.join(annzarroLinkPath, dir);
                                
                                if (fs.existsSync(targetPath) && !fs.existsSync(linkPath)) {
                                  // For Windows, copy files instead of symlinking
                                  if (process.platform === 'win32') {
                                    fs.mkdirSync(linkPath, { recursive: true });
                                    
                                    // Copy __init__.py and other essential files
                                    const initPyPath = path.join(targetPath, '__init__.py');
                                    if (fs.existsSync(initPyPath)) {
                                      fs.copyFileSync(initPyPath, path.join(linkPath, '__init__.py'));
                                    } else {
                                      fs.writeFileSync(path.join(linkPath, '__init__.py'), '');
                                    }
                                    
                                    // Copy key implementation files
                                    if (dir === 'data') {
                                      const managerPath = path.join(targetPath, 'manager.py');
                                      if (fs.existsSync(managerPath)) {
                                        fs.copyFileSync(managerPath, path.join(linkPath, 'manager.py'));
                                      }
                                    }
                                  } else {
                                    // On Unix, symlink the whole directory
                                    try {
                                      fs.symlinkSync(targetPath, linkPath, 'dir');
                                      log.info(`Created symbolic link from ${targetPath} to ${linkPath}`);
                                    } catch (linkErr) {
                                      log.error(`Error creating symlink: ${linkErr.message}`);
                                      
                                      // If symlink fails, try directory copy instead
                                      fs.mkdirSync(linkPath, { recursive: true });
                                      const initPyPath = path.join(targetPath, '__init__.py');
                                      if (fs.existsSync(initPyPath)) {
                                        fs.copyFileSync(initPyPath, path.join(linkPath, '__init__.py'));
                                      } else {
                                        fs.writeFileSync(path.join(linkPath, '__init__.py'), '');
                                      }
                                    }
                                  }
                                }
                              }
                            } catch (dirErr) {
                              log.error(`Error creating module directories: ${dirErr.message}`);
                            }
                          }
                        }
                      }
                    } else {
                      log.error(`No virtual environment found at: ${venvPath}`);
                    }
                  } else {
                    log.error(`Parent module directory not found: ${parentPath}`);
                  }
                } catch (err) {
                  log.error(`Error creating module symlinks: ${err.message}`);
                }
                
                // Kill the process so it restarts with updated path
                if (serverProcess) {
                  log.info('Restarting server process with improved path configuration');
                  serverProcess.kill();
                }
              }
            } else {
              // Standard missing dependency
              if (serverStartAttempts <= 2) {
                log.info(`Missing module detected: ${missingModule}`);
                log.info('Restarting server with full dependency check...');
                
                // Instead of installing individual modules, run the full installer
                // which will handle all dependencies including this one
                installDependencies().then(() => {
                  // Restart the server after dependencies are installed
                  if (serverProcess) {
                    serverProcess.kill();
                  }
                }).catch(err => {
                  log.error(`Failed to install dependencies: ${err.message}`);
                });
              }
            }
          }
        }
      });

      serverProcess.on('error', (err) => {
        clearTimeout(serverReadyTimeout);
        log.error(`Failed to start server: ${err.message}`);
        
        if (serverStartAttempts < MAX_SERVER_START_ATTEMPTS) {
          setTimeout(startServer, 1000);
        } else {
          dialog.showErrorBox(
            'Server Error',
            `Failed to start the server: ${err.message}\n\nPlease check the logs for more details.`
          );
          
          // Load error page if main window exists
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.loadFile(path.join(__dirname, 'error.html'));
          }
        }
      });

      serverProcess.on('close', (code) => {
        clearTimeout(serverReadyTimeout);
        log.info(`Server process exited with code ${code}`);
        serverProcess = null;
        isServerReady = false;
        
        // Don't attempt to restart if app is quitting or if we've reached max attempts
        if (!app.isQuitting && serverStartAttempts < MAX_SERVER_START_ATTEMPTS) {
          log.info('Restarting server...');
          setTimeout(startServer, 1000);
        } else if (code !== 0 && !app.isQuitting) {
          // Show error page in case of abnormal exit and we're not retrying anymore
          if (mainWindow && !mainWindow.isDestroyed()) {
            if (!mainWindow.webContents.getURL().includes('error.html')) {
              mainWindow.loadFile(path.join(__dirname, 'error.html'));
            }
          }
        }
      });
    } catch (err) {
      log.error(`Exception spawning server process: ${err.message}`);
      dialog.showErrorBox(
        'Server Launch Error',
        `Failed to launch the server process: ${err.message}\n\nPlease check the logs for more details.`
      );
      
      // Try one more time if we haven't reached max attempts
      if (serverStartAttempts < MAX_SERVER_START_ATTEMPTS) {
        setTimeout(startServer, 1000);
      }
    }
}

// Stop the server gracefully
function stopServer() {
  // Don't try to stop externally managed servers
  if (isServerExternallyManaged) {
    log.info('Server is externally managed, not stopping');
    return Promise.resolve();
  }
  
  if (!serverProcess) {
    log.info('No server process to stop');
    return Promise.resolve();
  }
  
  log.info('Stopping server...');
  
  return new Promise((resolve) => {
    // Try to stop the server gracefully 
    const venvPath = path.join(app.getPath('userData'), 'python_venv');
    const cliPath = path.join(appPath, 'annzarro-cli');
    
    // Check if CLI exists
    const cliExists = fs.existsSync(cliPath);
    
    // Execute the stop command
    let stopProcess;
    
    if (cliExists) {
      log.info("Using CLI to stop server");
      // Add venv path to ensure the CLI uses the correct environment
      const stopArgs = ['--venv-path', venvPath, 'stop'];
      
      // Execute the CLI directly or through Python depending on platform
      if (process.platform === 'win32') {
        // On Windows, use Python to run the CLI
        stopProcess = spawn(pythonExecutable, [cliPath, ...stopArgs], {
          cwd: appPath,
          env: process.env
        });
      } else {
        // On Unix, execute the CLI script directly
        // Ensure the CLI script is executable
        try {
          fs.chmodSync(cliPath, 0o755);
        } catch (err) {
          log.error(`Failed to make CLI executable: ${err.message}`);
        }
        
        stopProcess = spawn(cliPath, stopArgs, {
          cwd: appPath,
          env: process.env
        });
      }
    } else {
      log.warn("CLI not found, using direct Python execution to stop server");
      // Fall back to direct Python execution
      stopProcess = spawn(pythonExecutable, ['-m', 'annzarro.cli', 'stop'], {
        cwd: appPath,
        env: process.env
      });
    }
    
    // Set timeout for force kill if graceful stop fails
    const forceKillTimeout = setTimeout(() => {
      log.warn('Force killing server process...');
      if (serverProcess) {
        serverProcess.kill('SIGKILL');
      }
      serverProcess = null;
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

// Check if port is in use
function checkPortInUse(port) {
  return new Promise((resolve) => {
    const net = require('net');
    const tester = net.createServer()
      .once('error', err => {
        // If we get EADDRINUSE, the port is in use
        if (err.code === 'EADDRINUSE') {
          resolve(true);
        } else {
          resolve(false);
        }
      })
      .once('listening', () => {
        // If we can listen, the port is free
        tester.once('close', () => resolve(false))
          .close();
      })
      .listen(port, 'localhost');
  });
}

// Find a free port starting from the given number
async function findFreePort(startPort) {
  let port = startPort;
  const maxPort = startPort + 20; // Try up to 20 ports
  
  while (port < maxPort) {
    const inUse = await checkPortInUse(port);
    if (!inUse) {
      return port;
    }
    port++;
  }
  
  // If we couldn't find a free port, return the original
  return startPort;
}

// Wait for server to be ready
function waitForServerReady(attempts = 0, maxAttempts = 30, interval = 500) {
  return new Promise((resolve, reject) => {
    if (isServerReady) {
      resolve();
      return;
    }
    
    if (attempts >= maxAttempts) {
      // Before rejecting, check if a server is actually running on the port
      checkPortInUse(serverPort)
        .then(isInUse => {
          if (isInUse) {
            // If port is in use, consider it an external server and mark ready
            log.info(`Server is running on port ${serverPort}, considering it ready`);
            isServerExternallyManaged = true;
            isServerReady = true;
            resolve();
          } else {
            reject(new Error('Server failed to start within the timeout period'));
          }
        })
        .catch(() => {
          reject(new Error('Server failed to start within the timeout period'));
        });
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

// Inject desktop integration script into the renderer
function injectDesktopIntegration(window) {
  try {
    const integrationScriptPath = path.join(__dirname, 'desktop-integration.js');
    
    if (!fs.existsSync(integrationScriptPath)) {
      log.error(`Desktop integration script not found: ${integrationScriptPath}`);
      return;
    }
    
    const scriptContent = fs.readFileSync(integrationScriptPath, 'utf8');
    
    // Inject the script into the page
    window.webContents.executeJavaScript(scriptContent)
      .then(() => {
        log.info('Desktop integration script injected successfully');
      })
      .catch(err => {
        log.error(`Failed to inject desktop integration script: ${err.message}`);
      });
      
  } catch (error) {
    log.error(`Error setting up desktop integration: ${error.message}`);
  }
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
  
  // Handle window close event - stop server when window is closed
  mainWindow.on('close', async (e) => {
    if (serverProcess && !app.isQuitting) {
      // Prevent the window from closing until server is stopped
      e.preventDefault();
      
      log.info('Window closing - stopping server');
      try {
        await stopServer();
        // Now close the window
        mainWindow.destroy();
      } catch (err) {
        log.error(`Error stopping server on window close: ${err.message}`);
        // Force close anyway
        mainWindow.destroy();
      }
    }
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
    
    // Add desktop integration after page loads
    mainWindow.webContents.on('did-finish-load', () => {
      injectDesktopIntegration(mainWindow);
    });
  } else {
    // Load a loading screen while waiting for server
    mainWindow.loadFile(path.join(__dirname, 'loading.html'));
    
    // Wait for server to start and then load the main URL
    waitForServerReady()
      .then(() => {
        log.info(`Loading ${serverUrl} in main window`);
        mainWindow.loadURL(serverUrl);
        
        // Add desktop integration after page loads
        mainWindow.webContents.on('did-finish-load', () => {
          injectDesktopIntegration(mainWindow);
        });
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

// Set up global error handler
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  
  // Show error dialog if we have a window, otherwise create one for the error
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      dialog.showErrorBox(
        'Application Error',
        `An unexpected error occurred: ${error.message}\n\nPlease restart the application.`
      );
    } else {
      const errorWindow = new BrowserWindow({
        width: 600,
        height: 400,
        show: true,
        webPreferences: {
          nodeIntegration: true
        }
      });
      
      errorWindow.loadURL(`data:text/html;charset=utf-8,
        <html>
          <head>
            <title>Application Error</title>
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 20px; }
              h2 { color: #d32f2f; }
              pre { background: #f5f5f5; padding: 10px; overflow: auto; }
            </style>
          </head>
          <body>
            <h2>Application Error</h2>
            <p>An unexpected error occurred in the application:</p>
            <pre>${error.stack || error.message}</pre>
            <p>Please restart the application.</p>
          </body>
        </html>
      `);
    }
  } catch (dialogError) {
    // If even showing the error fails, just log it
    console.error('Error showing error dialog:', dialogError);
  }
});

// App ready event handler
app.whenReady().then(() => {
  try {
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
  } catch (error) {
    console.error('Error during app initialization:', error);
    dialog.showErrorBox(
      'Initialization Error', 
      `Error initializing the application: ${error.message}\n\nPlease check the logs for more details.`
    );
    
    // Force quit if initialization fails
    app.exit(1);
  }
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
  
  // Disable console logging to prevent EPIPE errors during shutdown
  try {
    log.transports.console.level = false;
  } catch (e) {
    // Ignore errors when disabling logging
  }
  
  // If server is running and not externally managed, stop it before quitting
  if (serverProcess && !isServerExternallyManaged) {
    event.preventDefault();
    
    try {
      await stopServer();
      // Actually quit after server is stopped
      app.quit();
    } catch (err) {
      console.error(`Error stopping server: ${err.message}`);
      app.exit(1); // Force exit if there was an error
    }
  } else if (isServerExternallyManaged) {
    log.info('Not stopping externally managed server on exit');
  }
});

// IPC Handlers
ipcMain.handle('app:getVersion', () => app.getVersion());
ipcMain.handle('app:checkForUpdates', async () => {
  if (!app.isPackaged) {
    return { status: 'skipped', message: 'Auto-updates are disabled in development mode' };
  }
  
  try {
    const updateConfigPath = path.join(process.resourcesPath, 'app-update.yml');
    if (!fs.existsSync(updateConfigPath)) {
      return { status: 'skipped', message: 'Update configuration not found' };
    }
    
    const result = await autoUpdater.checkForUpdatesAndNotify();
    return { status: 'success', result };
  } catch (err) {
    log.error(`Error checking for updates: ${err.message}`);
    return { status: 'error', message: err.message };
  }
});
ipcMain.handle('app:restartServer', async () => {
  await stopServer();
  serverStartAttempts = 0;
  startServer();
  return true;
});

// Get app info for troubleshooting
ipcMain.handle('app:getInfo', () => {
  return {
    version: app.getVersion(),
    isPackaged: app.isPackaged,
    appPath: appPath,
    pythonExecutable: pythonExecutable,
    appDataPath: app.getPath('userData'),
    logPath: app.getPath('logs'),
    venvPath: app.isPackaged
      ? path.join(app.getPath('userData'), 'python_venv')
      : path.join(__dirname, 'python_venv')
  };
});

// Get system info for troubleshooting
ipcMain.handle('app:getSystemInfo', () => {
  return {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    electronVersion: process.versions.electron,
    chromiumVersion: process.versions.chrome,
    v8Version: process.versions.v8,
    hostname: require('os').hostname(),
    totalmem: require('os').totalmem(),
    freemem: require('os').freemem(),
    homedir: require('os').homedir(),
    cpus: require('os').cpus().length
  };
});

// Handle directory selection dialog
ipcMain.handle('app:selectDirectory', async () => {
  if (!mainWindow) {
    return null;
  }
  
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Dataset Directory',
    properties: ['openDirectory']
  });
  
  if (result.canceled) {
    return null;
  }
  
  return result.filePaths[0];
});