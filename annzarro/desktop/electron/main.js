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

// Install Python dependencies with uv
function installDependencies() {
  return new Promise((resolve, reject) => {
    log.info('Checking and installing Python dependencies...');
    
    // Get paths for venv and uv
    const venvPath = app.isPackaged
      ? path.join(app.getPath('userData'), 'python_venv')
      : path.join(__dirname, 'python_venv');
    
    log.info(`Using virtual environment at: ${venvPath}`);
    
    // Get platform-specific uv executable
    const findUvExecutable = () => {
      if (app.isPackaged) {
        // Get platform and architecture for binary selection
        const platform = process.platform;
        const arch = process.arch;
        
        // Map to directory name based on platform and arch
        let platformDir;
        if (platform === 'darwin') {
          platformDir = arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
        } else if (platform === 'win32') {
          platformDir = 'win32-x64';
        } else if (platform === 'linux') {
          platformDir = 'linux-x64';
        } else {
          platformDir = 'unknown';
        }
        
        // Check for bundled uv in platform-specific directory
        const uvName = platform === 'win32' ? 'uv.exe' : 'uv';
        const bundledUvPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'bin', platformDir, uvName);
        const bundledUvPathAlt = path.join(__dirname, 'bin', platformDir, uvName);
        
        if (fs.existsSync(bundledUvPath)) {
          log.info(`Found uv executable at: ${bundledUvPath}`);
          return bundledUvPath;
        } else if (fs.existsSync(bundledUvPathAlt)) {
          log.info(`Found uv executable at: ${bundledUvPathAlt}`);
          return bundledUvPathAlt;
        } else {
          log.warn(`Bundled uv executable not found at ${bundledUvPath} or ${bundledUvPathAlt}`);
        }
      } else {
        // Development mode - check local bin directory first
        const devUvPath = path.join(__dirname, 'bin', 
          process.platform === 'darwin' 
            ? (process.arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64')
            : process.platform === 'win32' ? 'win32-x64' : 'linux-x64',
          process.platform === 'win32' ? 'uv.exe' : 'uv'
        );
        
        if (fs.existsSync(devUvPath)) {
          log.info(`Found uv executable at: ${devUvPath}`);
          return devUvPath;
        }
      }
      
      // Check for uv in PATH as fallback
      const uvName = process.platform === 'win32' ? 'uv.exe' : 'uv';
      
      // Common locations to check
      const possiblePaths = [
        '/usr/local/bin/uv',
        '/usr/bin/uv',
        '/opt/homebrew/bin/uv',
        path.join(process.env.HOME || '', '.cargo', 'bin', 'uv')
      ];
      
      for (const testPath of possiblePaths) {
        if (fs.existsSync(testPath)) {
          log.info(`Found system uv executable at: ${testPath}`);
          return testPath;
        }
      }
      
      // Default to just the command name, hoping it's in PATH
      log.warn('No uv executable found, defaulting to system PATH');
      return uvName;
    };
    
    const uvExecutable = findUvExecutable();
    log.info(`Using uv at: ${uvExecutable}`);
    
    // Find requirements.txt file (try multiple locations)
    let requirementsPath = '';
    const possiblePaths = [
      path.join(__dirname, 'requirements.txt'),
      path.join(process.resourcesPath, 'requirements.txt'),
      path.join(appPath, 'requirements.txt'),
      path.join(process.resourcesPath, 'app.asar.unpacked', 'requirements.txt')
    ];
    
    for (const testPath of possiblePaths) {
      if (fs.existsSync(testPath)) {
        requirementsPath = testPath;
        log.info(`Found requirements file at: ${requirementsPath}`);
        break;
      }
    }
    
    if (!requirementsPath) {
      log.error('Requirements file not found in any expected location');
      // Create a fallback requirements file with essential dependencies
      try {
        const tempRequirementsPath = path.join(app.getPath('temp'), 'annzarro-requirements.txt');
        log.info(`Creating fallback requirements file at: ${tempRequirementsPath}`);
        const essentialDeps = [
          'flask>=2.0.0',
          'flask-cors>=3.0.0',
          'zarr>=2.13.0',
          'numpy>=1.20.0',
          'pandas>=1.3.0',
          'matplotlib>=3.4.0',
          'werkzeug>=2.0.0',
          'pyjwt>=2.0.0',
          'cryptography>=35.0.0',
          'numba>=0.53.0',
          'psutil>=5.9.0',
          'pyyaml>=6.0.0'
        ].join('\n');
        fs.writeFileSync(tempRequirementsPath, essentialDeps);
        requirementsPath = tempRequirementsPath;
      } catch (err) {
        log.error(`Failed to create fallback requirements file: ${err.message}`);
        return reject(new Error('Could not find or create requirements file'));
      }
    }
    
    // Check if venv exists and is correctly configured
    let venvBinPath = process.platform === 'win32' 
      ? path.join(venvPath, 'Scripts') 
      : path.join(venvPath, 'bin');
    
    let venvPythonPath = process.platform === 'win32'
      ? path.join(venvBinPath, 'python.exe')
      : path.join(venvBinPath, 'python');
    
    if (!fs.existsSync(venvPythonPath) && process.platform !== 'win32') {
      // Try python3 instead of python
      venvPythonPath = path.join(venvBinPath, 'python3');
    }
    
    // Create site-packages directory in the venv if it doesn't exist
    const venvSitePackagesDir = path.join(venvPath, 'lib', 
      process.platform === 'win32' ? 'site-packages' : 'python3*/site-packages');
      
    // Check site-packages dir exists for Python modules
    const venvExists = fs.existsSync(venvPath) && fs.existsSync(venvPythonPath);
    
    // Function to install dependencies in the venv
    const installInVenv = () => {
      log.info(`Installing dependencies with uv in venv: ${venvPath}`);
      
      // Updated Python path
      const venvPythonPath = process.platform === 'win32'
        ? path.join(venvPath, 'Scripts', 'python.exe')
        : path.join(venvPath, 'bin', 'python');
      
      // Update pythonExecutable to use the venv
      pythonExecutable = venvPythonPath;
      
      // Run uv pip install
      const uvProcess = spawn(uvExecutable, ['pip', 'install', '-r', requirementsPath, '--venv', venvPath], {
        stdio: ['ignore', 'pipe', 'pipe']
      });
      
      let uvOutput = '';
      let uvError = '';
      
      uvProcess.stdout.on('data', (data) => {
        const output = data.toString().trim();
        uvOutput += output + '\n';
        log.info(`UV stdout: ${output}`);
      });
      
      uvProcess.stderr.on('data', (data) => {
        const output = data.toString().trim();
        uvError += output + '\n';
        log.error(`UV stderr: ${output}`);
      });
      
      uvProcess.on('close', (code) => {
        if (code === 0) {
          log.info('Python dependencies installed successfully with uv');
          
          // Also install the annzarro package in development mode if packaged
          if (app.isPackaged) {
            log.info('Installing annzarro package');
            
            // Use uv to install the annzarro package in development mode
            const installAnnzarroProcess = spawn(uvExecutable, [
              'pip', 'install', '-e', appPath, '--venv', venvPath
            ], {
              stdio: ['ignore', 'pipe', 'pipe']
            });
            
            installAnnzarroProcess.stdout.on('data', (data) => {
              log.info(`Install annzarro stdout: ${data.toString().trim()}`);
            });
            
            installAnnzarroProcess.stderr.on('data', (data) => {
              log.warn(`Install annzarro stderr: ${data.toString().trim()}`);
            });
            
            installAnnzarroProcess.on('close', (installCode) => {
              if (installCode === 0) {
                log.info('Annzarro package installed successfully');
              } else {
                log.warn(`Failed to install annzarro package, exit code: ${installCode}`);
              }
              resolve();
            });
            
            installAnnzarroProcess.on('error', (err) => {
              log.error(`Error installing annzarro package: ${err.message}`);
              resolve(); // Continue anyway
            });
          } else {
            resolve();
          }
        } else {
          log.error(`Failed to install dependencies with uv, exit code: ${code}`);
          log.error(`UV error output: ${uvError}`);
          
          // Fall back to pip if uv fails
          fallbackToPip(requirementsPath, resolve, reject);
        }
      });
      
      uvProcess.on('error', (err) => {
        log.error(`Error running uv: ${err.message}`);
        // Try with pip as fallback
        fallbackToPip(requirementsPath, resolve, reject);
      });
    };
    
    // Fallback to pip if uv fails or is not available
    const fallbackToPip = (requirementsPath, resolve, reject) => {
      log.info('Falling back to pip for dependency installation');
      
      const pipProcess = spawn(pythonExecutable, ['-m', 'pip', 'install', '-r', requirementsPath], {
        stdio: ['ignore', 'pipe', 'pipe']
      });
      
      let pipOutput = '';
      let pipError = '';
      
      pipProcess.stdout.on('data', (data) => {
        const output = data.toString().trim();
        pipOutput += output + '\n';
        log.info(`Pip stdout: ${output}`);
      });
      
      pipProcess.stderr.on('data', (data) => {
        const output = data.toString().trim();
        pipError += output + '\n';
        log.error(`Pip stderr: ${output}`);
      });
      
      pipProcess.on('close', (code) => {
        if (code === 0) {
          log.info('Python dependencies installed successfully with pip');
          resolve();
        } else {
          log.error(`Failed to install dependencies with pip, exit code: ${code}`);
          log.error(`Pip error output: ${pipError}`);
          
          // Show error to user but continue anyway
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
      
      pipProcess.on('error', (err) => {
        log.error(`Error installing dependencies with pip: ${err.message}`);
        reject(err);
      });
    };
    
    // Main logic - create venv if needed, then install dependencies
    if (venvExists) {
      log.info('Using existing virtual environment');
      installInVenv();
    } else {
      log.info('Creating new virtual environment with uv');
      
      // Create virtual environment directory
      if (!fs.existsSync(venvPath)) {
        try {
          fs.mkdirSync(venvPath, { recursive: true });
        } catch (err) {
          log.error(`Failed to create virtual environment directory: ${err.message}`);
          return reject(new Error('Failed to create virtual environment directory'));
        }
      }
      
      // Create venv with uv directly
      const uvVenvProcess = spawn(uvExecutable, ['venv', venvPath], {
        stdio: ['ignore', 'pipe', 'pipe']
      });
      
      uvVenvProcess.stdout.on('data', (data) => {
        log.info(`UV venv stdout: ${data.toString().trim()}`);
      });
      
      uvVenvProcess.stderr.on('data', (data) => {
        log.error(`UV venv stderr: ${data.toString().trim()}`);
      });
      
      uvVenvProcess.on('close', (code) => {
        if (code === 0) {
          log.info('Virtual environment created successfully with uv');
          installInVenv();
        } else {
          log.error(`Failed to create virtual environment with uv, exit code: ${code}`);
          
          // Try using python's venv module as fallback
          const venvProcess = spawn(pythonExecutable, ['-m', 'venv', venvPath], {
            stdio: ['ignore', 'pipe', 'pipe']
          });
          
          venvProcess.on('close', (venvCode) => {
            if (venvCode === 0) {
              log.info('Virtual environment created with python venv module');
              installInVenv();
            } else {
              log.error(`Failed to create virtual environment with python venv, exit code: ${venvCode}`);
              // Fall back to using system Python without venv
              fallbackToPip(requirementsPath, resolve, reject);
            }
          });
          
          venvProcess.on('error', (err) => {
            log.error(`Error creating venv with python: ${err.message}`);
            fallbackToPip(requirementsPath, resolve, reject);
          });
        }
      });
      
      uvVenvProcess.on('error', (err) => {
        log.error(`Error creating venv with uv: ${err.message}`);
        
        // Try using python's venv module as fallback
        const venvProcess = spawn(pythonExecutable, ['-m', 'venv', venvPath], {
          stdio: ['ignore', 'pipe', 'pipe']
        });
        
        venvProcess.on('close', (venvCode) => {
          if (venvCode === 0) {
            log.info('Virtual environment created with python venv module');
            installInVenv();
          } else {
            log.error(`Failed to create virtual environment with python venv, exit code: ${venvCode}`);
            // Fall back to using system Python without venv
            fallbackToPip(requirementsPath, resolve, reject);
          }
        });
        
        venvProcess.on('error', (err) => {
          log.error(`Error creating venv with python: ${err.message}`);
          fallbackToPip(requirementsPath, resolve, reject);
        });
      });
    }
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
        path.join(app.getPath('userData'), 'python_venv', 'lib', 
          process.platform === 'win32' ? 'site-packages' : 
          `python${pythonExecutable.includes('python3') ? '3' : ''}*/site-packages`)
      );
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

// Check required dependencies
async function checkDependencies() {
  log.info('Checking required Python dependencies...');
  
  // Check essential modules
  const essentialModules = ['numpy', 'flask', 'zarr'];
  const missingModules = [];
  
  for (const module of essentialModules) {
    if (!await checkPythonModule(module)) {
      missingModules.push(module);
    }
  }
  
  if (missingModules.length > 0) {
    log.warn(`Missing Python modules: ${missingModules.join(', ')}`);
    // Install dependencies if missing
    try {
      await installDependencies();
    } catch (err) {
      log.error(`Failed to install dependencies: ${err.message}`);
    }
  } else {
    log.info('All essential Python modules are present');
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

  // Check if port is already in use
  try {
    const list = await findProcess('port', serverPort);
    
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
        path.join(app.getPath('userData'), 'python_venv', 'lib', 
          process.platform === 'win32' ? 'site-packages' : 
          `python${pythonExecutable.includes('python3') ? '3' : ''}*/site-packages`)
      );
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
    log.info(`Setting PYTHONPATH to: ${env.PYTHONPATH}`);

    // Create data directory if it doesn't exist
    const dataDirectory = path.join(dataDir, 'annzarro_data');
    if (!fs.existsSync(dataDirectory)) {
      fs.mkdirSync(dataDirectory, { recursive: true });
    }
    
    try {
      // Log the complete command and environment for debugging
      log.info('Server environment variables:');
      Object.keys(env).forEach(key => {
        if (key.toLowerCase().includes('path')) {
          log.info(`${key}=${env[key]}`);
        }
      });
      
      // Create data directory if it doesn't exist
      if (!fs.existsSync(dataDirectory)) {
        fs.mkdirSync(dataDirectory, { recursive: true });
        log.info(`Created data directory: ${dataDirectory}`);
      }
      
      // Spawn the server process
      serverProcess = spawn(pythonExecutable, args, {
        cwd: appPath,
        env,
        // Ensure stdout and stderr are treated as text
        stdio: ['ignore', 'pipe', 'pipe']
      });

      // Set up a timeout for server readiness
      const serverReadyTimeout = setTimeout(() => {
        if (!isServerReady && serverProcess) {
          log.warn('Server failed to start within timeout period');
          
          // Show a simple message to the user
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.loadFile(path.join(__dirname, 'error.html'));
          }
          
          // Don't kill the server yet, it might still start up
        }
      }, 30000); // 30 seconds timeout
      
      // Handle server process events
      serverProcess.stdout.on('data', (data) => {
        const output = data.toString().trim();
        log.info(`Server stdout: ${output}`);
        
        // Check if server is ready
        if (output.includes('Running on http://')) {
          log.info('Server is ready');
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
      });

      serverProcess.stderr.on('data', (data) => {
        const output = data.toString().trim();
        log.error(`Server stderr: ${output}`);
        
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
              log.info('This is likely a packaging problem rather than a missing dependency');
              
              // Create symbolic link in the venv site-packages to help with imports
              if (serverStartAttempts <= 2) {
                try {
                  // Check if we have a venv to work with
                  const venvPath = app.isPackaged
                    ? path.join(app.getPath('userData'), 'python_venv')
                    : path.join(__dirname, 'python_venv');
                  
                  // Find the actual site-packages directory (may have Python version in path)
                  let sitePackagesDir = '';
                  if (process.platform === 'win32') {
                    sitePackagesDir = path.join(venvPath, 'lib', 'site-packages');
                  } else {
                    // Try to find actual site-packages directory 
                    const libDir = path.join(venvPath, 'lib');
                    if (fs.existsSync(libDir)) {
                      const libContents = fs.readdirSync(libDir);
                      const pythonDirs = libContents.filter(item => item.startsWith('python'));
                      if (pythonDirs.length > 0) {
                        // Use the first python directory found
                        sitePackagesDir = path.join(libDir, pythonDirs[0], 'site-packages');
                      }
                    }
                  }
                  
                  // If we found site-packages directory, create an annzarro link there
                  if (sitePackagesDir && fs.existsSync(sitePackagesDir)) {
                    // Create annzarro.pth file for Python path configuration
                    const pthFilePath = path.join(sitePackagesDir, 'annzarro.pth');
                    fs.writeFileSync(pthFilePath, appPath);
                    log.info(`Created Python path file at: ${pthFilePath} pointing to ${appPath}`);
                    
                    // Also create an annzarro directory symlink/copy if it doesn't exist
                    const annzarroLinkPath = path.join(sitePackagesDir, 'annzarro');
                    if (!fs.existsSync(annzarroLinkPath)) {
                      if (app.isPackaged) {
                        // In packaged app, create a symbolic link if possible
                        try {
                          const targetPath = path.join(appPath, 'annzarro');
                          if (process.platform === 'win32') {
                            // On Windows we might need to copy the directory instead
                            // of creating a symlink due to permission issues
                            log.info(`Creating directory copy from ${targetPath} to ${annzarroLinkPath}`);
                            fs.mkdirSync(annzarroLinkPath, { recursive: true });
                          } else {
                            // On Unix systems, create a symlink
                            log.info(`Creating symbolic link from ${targetPath} to ${annzarroLinkPath}`);
                            fs.symlinkSync(targetPath, annzarroLinkPath, 'dir');
                          }
                        } catch (linkErr) {
                          log.error(`Error creating annzarro symlink: ${linkErr.message}`);
                        }
                      }
                    }
                  } else {
                    log.error(`Could not find site-packages directory in: ${venvPath}`);
                  }
                } catch (err) {
                  log.error(`Error creating module symlink: ${err.message}`);
                }
                
                // Kill the process so it restarts with updated path
                if (serverProcess) {
                  serverProcess.kill();
                }
              }
            } else {
              // Standard missing dependency - install it
              if (serverStartAttempts <= 2) {
                log.info(`Attempting to install missing module: ${missingModule}`);
                const pipProcess = spawn(pythonExecutable, ['-m', 'pip', 'install', missingModule], {
                  stdio: ['ignore', 'pipe', 'pipe']
                });
                
                pipProcess.on('close', (code) => {
                  if (code === 0) {
                    log.info(`Successfully installed ${missingModule}`);
                    // Kill the server process so it can be restarted
                    if (serverProcess) {
                      serverProcess.kill();
                    }
                  } else {
                    log.error(`Failed to install ${missingModule}, exit code: ${code}`);
                  }
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
  } catch (err) {
    log.error(`Error checking port: ${err.message}`);
    // Try to start the server anyway
    startServer();
  }
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
  
  // If server is running, prevent quit and stop server first
  if (serverProcess) {
    event.preventDefault();
    
    try {
      await stopServer();
      // Actually quit after server is stopped
      app.quit();
    } catch (err) {
      console.error(`Error stopping server: ${err.message}`);
      app.exit(1); // Force exit if there was an error
    }
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