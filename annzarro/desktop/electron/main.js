/**
 * AnnZarro desktop app: an Electron window around the AnnZarro server.
 *
 * The server is the `annzarro` command frozen with PyInstaller
 * (annzarro/desktop/server/annzarro-server.spec), shipped in the app's
 * resources, so the user needs no Python. This process starts it as
 *
 *   annzarro-server start --host 127.0.0.1 --port <free port>
 *       --data-dir ~/annzarro-data --auth-disabled --no-browser
 *
 * i.e. bound to the loopback interface only and with login off, which is the
 * server's local single-user mode: free browsing of the user's own disk,
 * read-only access to datasets. Run from a source checkout (`npm start`), it
 * runs `python -m annzarro.cli start` with the same arguments instead.
 *
 * Environment switches, for development and automated tests:
 *   ANNZARRO_SERVER_BINARY   run this server executable instead
 *   ANNZARRO_PYTHON          Python used from a source checkout (default python3/python)
 *   ANNZARRO_DESKTOP_DATA_DIR  data directory instead of ~/annzarro-data
 *   ANNZARRO_DESKTOP_SMOKE=1 start, load the UI, check /api/v1/datasets, print
 *                            "ANNZARRO_DESKTOP_SMOKE ok <url>" and quit (exit 0,
 *                            or 1 on failure). The network is cut off for the
 *                            window: any request not to 127.0.0.1 is cancelled
 *                            and fails the check.
 */
const { app, BrowserWindow, dialog, ipcMain, session, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const { spawn } = require('child_process');
const log = require('electron-log');

log.transports.file.level = 'info';
log.transports.console.level = 'info';

const HOST = '127.0.0.1';
// First port tried; a less common one, to stay clear of other local servers.
const DEFAULT_PORT = 39487;
// First launch can be slow: macOS Gatekeeper and Windows Defender scan the
// server's libraries before it may run.
const SERVER_START_TIMEOUT_MS = 180 * 1000;
const SMOKE = process.env.ANNZARRO_DESKTOP_SMOKE === '1';

let mainWindow = null;
let serverProcess = null;
let serverUrl = null;
let isQuitting = false;
let appDataPath = null;
// SMOKE: requests the window tried to make beyond the local server.
const externalRequests = [];

/**
 * The directory datasets are browsed from by default, created on first run.
 */
function initDataDir() {
    appDataPath = process.env.ANNZARRO_DESKTOP_DATA_DIR || path.join(os.homedir(), 'annzarro-data');
    for (const dir of [appDataPath, path.join(appDataPath, 'datasets'), path.join(appDataPath, 'sessions')]) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return appDataPath;
}

/**
 * The executable and leading arguments that run `annzarro`.
 */
function serverCommand() {
    const exe = process.platform === 'win32' ? 'annzarro-server.exe' : 'annzarro-server';
    if (process.env.ANNZARRO_SERVER_BINARY) {
        return { command: process.env.ANNZARRO_SERVER_BINARY, args: [] };
    }
    if (app.isPackaged) {
        return { command: path.join(process.resourcesPath, 'server', exe), args: [] };
    }
    // Source checkout: a server frozen by scripts/build_server.py, if any,
    // else the checkout's own Python package.
    const frozen = path.join(__dirname, 'server', 'annzarro-server', exe);
    if (fs.existsSync(frozen)) {
        return { command: frozen, args: [] };
    }
    const python = process.env.ANNZARRO_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
    return {
        command: python,
        args: ['-m', 'annzarro.cli'],
        cwd: path.resolve(__dirname, '..', '..', '..'),
    };
}

function isPortFree(port) {
    return new Promise((resolve) => {
        const probe = net.createServer();
        probe.once('error', () => resolve(false));
        probe.once('listening', () => probe.close(() => resolve(true)));
        probe.listen(port, HOST);
    });
}

async function findFreePort(start) {
    for (let port = start; port < start + 50; port++) {
        if (await isPortFree(port)) return port;
    }
    throw new Error(`No free port in ${start}-${start + 49}`);
}

/**
 * Resolve once GET /api/v1/datasets answers; reject if the server exits
 * first or does not answer in time.
 */
function waitForServer(url, proc) {
    const deadline = Date.now() + SERVER_START_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
        let exited = null;
        proc.once('exit', (code, signal) => { exited = `exited with ${signal || code}`; });
        const attempt = async () => {
            if (exited) return reject(new Error(`The server ${exited} before it was ready`));
            if (Date.now() > deadline) {
                return reject(new Error(`The server did not answer within ${SERVER_START_TIMEOUT_MS / 1000}s`));
            }
            try {
                const response = await fetch(`${url}/api/v1/datasets`);
                if (response.ok) return resolve();
            } catch (err) {
                // not listening yet
            }
            setTimeout(attempt, 300);
        };
        attempt();
    });
}

async function startServer() {
    if (serverProcess) return;
    const dataDir = initDataDir();
    const port = await findFreePort(DEFAULT_PORT);
    const { command, args, cwd } = serverCommand();
    const fullArgs = args.concat([
        'start',
        '--host', HOST,
        '--port', String(port),
        '--data-dir', dataDir,
        '--auth-disabled',
        '--no-browser',
    ]);
    log.info(`Starting server: ${command} ${fullArgs.join(' ')}`);
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    if (path.isAbsolute(command) && !fs.existsSync(command)) {
        throw new Error(`Server executable not found: ${command}`);
    }
    const proc = spawn(command, fullArgs, {
        cwd: cwd || app.getPath('userData'),
        env: {
            ...process.env,
            ANNZARRO_ELECTRON_APP: 'true',
            ANNZARRO_HEADLESS: '1',
            ANNZARRO_AUTH_DISABLED: 'true',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
    });
    serverProcess = proc;
    proc.stdout.on('data', (d) => log.info(`server: ${d.toString().trimEnd()}`));
    proc.stderr.on('data', (d) => log.info(`server: ${d.toString().trimEnd()}`));
    proc.on('error', (err) => log.error(`Server process error: ${err.message}`));
    proc.on('exit', (code, signal) => {
        log.info(`Server exited (code ${code}, signal ${signal || 'none'})`);
        if (serverProcess === proc) serverProcess = null;
        if (!isQuitting && mainWindow && serverUrl) {
            showErrorScreen('The AnnZarro server stopped unexpectedly. Use "Restart server" to start it again.');
        }
        serverUrl = null;
    });

    const url = `http://${HOST}:${port}`;
    try {
        await waitForServer(url, proc);
    } catch (err) {
        stopServer();
        throw err;
    }
    serverUrl = url;
    log.info(`Server ready at ${url}`);
    // A stable line for scripts that launch the app and wait for it.
    console.log(`ANNZARRO_DESKTOP_READY ${url}`);
}

/**
 * Stop the server: SIGTERM, then SIGKILL if it is still running after 3 s.
 * (On Windows, kill() terminates the process at once.)
 */
function stopServer() {
    const proc = serverProcess;
    serverProcess = null;
    serverUrl = null;
    if (!proc || proc.exitCode !== null) return Promise.resolve();
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            try { proc.kill('SIGKILL'); } catch (e) { /* already gone */ }
            resolve();
        }, 3000);
        proc.once('exit', () => { clearTimeout(timer); resolve(); });
        try { proc.kill(); } catch (e) { clearTimeout(timer); resolve(); }
    });
}

function showErrorScreen(message) {
    log.error(message);
    if (mainWindow) {
        mainWindow.loadFile(path.join(__dirname, 'error.html'), { query: { error: message } });
    }
}

async function launch() {
    try {
        await startServer();
        if (mainWindow) await mainWindow.loadURL(serverUrl);
        if (SMOKE) await smokeCheck();
    } catch (err) {
        log.error(`Failed to start: ${err.message}`);
        if (SMOKE) {
            console.log(`ANNZARRO_DESKTOP_SMOKE failed: ${err.message}`);
            isQuitting = true;
            await stopServer();
            app.exit(1);
            return;
        }
        showErrorScreen(`Failed to start the AnnZarro server: ${err.message}`);
    }
}

/**
 * ANNZARRO_DESKTOP_SMOKE=1: the window has loaded the UI from the bundled
 * server; check the page and the dataset list, then quit.
 */
async function smokeCheck() {
    const title = await mainWindow.webContents.executeJavaScript('document.title');
    const hasPlotly = await mainWindow.webContents.executeJavaScript(
        'new Promise(r => { const t = Date.now(); (function w() { if (window.Plotly) r(true); ' +
        'else if (Date.now() - t > 30000) r(false); else setTimeout(w, 200); })(); })');
    const response = await fetch(`${serverUrl}/api/v1/datasets`);
    const datasets = await response.json();
    if (!hasPlotly || !response.ok) {
        throw new Error(`UI loaded without Plotly (${hasPlotly}) or /api/v1/datasets failed (${response.status})`);
    }
    if (externalRequests.length) {
        throw new Error(`the UI requested external resources: ${externalRequests.join(', ')}`);
    }
    console.log(`ANNZARRO_DESKTOP_SMOKE ok ${serverUrl} title="${title}" datasets=${datasets.length} external_requests=0`);
    isQuitting = true;
    await stopServer();
    app.exit(0);
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        show: !SMOKE,
        icon: path.join(__dirname, 'icons', 'icon.png'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            preload: path.join(__dirname, 'preload.js'),
        },
    });
    mainWindow.loadFile(path.join(__dirname, 'loading.html'));

    // Links to anything but the local server open in the system browser.
    const isLocal = (url) => Boolean(serverUrl) && (url === serverUrl || url.startsWith(serverUrl + '/'));
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (isLocal(url)) return { action: 'allow' };
        if (/^https?:\/\//.test(url)) shell.openExternal(url);
        return { action: 'deny' };
    });
    mainWindow.webContents.on('will-navigate', (event, url) => {
        if (isLocal(url) || url.startsWith('file:')) return;
        event.preventDefault();
        if (/^https?:\/\//.test(url)) shell.openExternal(url);
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

function setupIpcHandlers() {
    ipcMain.handle('app:getVersion', () => app.getVersion());
    ipcMain.handle('app:restartServer', async () => {
        try {
            await stopServer();
            await startServer();
            if (mainWindow) mainWindow.loadURL(serverUrl);
            return { success: true };
        } catch (err) {
            log.error(`Failed to restart server: ${err.message}`);
            return { error: err.message };
        }
    });
    ipcMain.handle('app:selectDirectory', async () => {
        const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
        return result.canceled ? null : result.filePaths[0];
    });
    ipcMain.handle('app:getInfo', () => ({
        version: app.getVersion(),
        isPackaged: app.isPackaged,
        serverUrl,
        appDataPath,
        serverCommand: serverCommand().command,
        logFile: log.transports.file.getFile().path,
    }));
    ipcMain.handle('app:getSystemInfo', () => ({
        platform: process.platform,
        arch: process.arch,
        osVersion: os.release(),
        cpus: os.cpus().length,
        totalMemory: Math.round(os.totalmem() / (1024 ** 3)),
        freeMemory: Math.round(os.freemem() / (1024 ** 3)),
    }));
}

// One instance: a second launch focuses the existing window instead of
// starting a second server.
if (!SMOKE && !app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });

    app.whenReady().then(() => {
        log.info(`AnnZarro ${app.getVersion()} starting (packaged: ${app.isPackaged})`);
        if (SMOKE) {
            // Everything the UI needs is bundled; prove it by cutting it off.
            session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
                const local = /^(https?|wss?):\/\/127\.0\.0\.1(:\d+)?\//.test(details.url)
                    || /^(file|data|blob|devtools|chrome):/.test(details.url);
                if (!local) externalRequests.push(details.url);
                callback({ cancel: !local });
            });
        }
        setupIpcHandlers();
        createWindow();
        launch();
        app.on('activate', () => {
            if (!mainWindow) {
                createWindow();
                if (serverUrl) mainWindow.loadURL(serverUrl);
                else launch();
            }
        });
    });
}

app.on('window-all-closed', () => {
    app.quit();
});

app.on('before-quit', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    isQuitting = true;
    if (mainWindow && mainWindow.webContents) {
        // Lets the page autosave (preload.js) before the server goes away.
        mainWindow.webContents.send('app:will-quit');
    }
    setTimeout(() => {
        stopServer().finally(() => app.exit(0));
    }, 500);
});
