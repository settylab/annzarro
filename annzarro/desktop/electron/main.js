/**
 * AnnZarro desktop app: an Electron window around the AnnZarro server.
 *
 * The server is the `annzarro` command frozen with PyInstaller
 * (annzarro/desktop/server/annzarro-server.spec), shipped in the app's
 * resources, so the user needs no Python. This process starts it as
 *
 *   annzarro-server start --host 127.0.0.1 --port <free port>
 *       --data-dir ~/annzarro-data --state-dir <userData>/state --auth-disabled --no-browser
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
 *   ANNZARRO_DESKTOP_USER_DATA profile directory (settings, local storage, log
 *                            and the single-instance lock) instead of the
 *                            user's; tests set it so they never meet a
 *                            running AnnZarro. ANNZARRO_DESKTOP_SMOKE=1 uses a
 *                            fresh temporary one when it is not set.
 *   ANNZARRO_DESKTOP_SMOKE=1 start, load the UI, check /api/v1/datasets, print
 *                            "ANNZARRO_DESKTOP_SMOKE ok <url>" and quit (exit 0,
 *                            or 1 on failure). The network is cut off for the
 *                            window: any request not to 127.0.0.1 is cancelled
 *                            and fails the check.
 *   ANNZARRO_DISABLE_UPDATES=1 never look for updates (managed installs); see updates.js.
 *                            Smoke and test profiles do not look for them either.
 */
const { app, BrowserWindow, dialog, ipcMain, Menu, MenuItem, nativeTheme, net: electronNet, session, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const { spawn } = require('child_process');
const crypto = require('crypto');
const log = require('electron-log');
const { createUpdater } = require('./updates');
const chrome = require('./window-chrome');
const logic = require('./dataset-open-logic');
const { createDatasetOpener } = require('./dataset-open');
const stateLogic = require('./state-logic');

log.transports.file.level = 'info';
log.transports.console.level = 'info';

const HOST = '127.0.0.1';
// First port tried; a less common one, to stay clear of other local servers.
const DEFAULT_PORT = 39487;
// First launch can be slow: macOS Gatekeeper and Windows Defender scan the
// server's libraries before it may run.
const SERVER_START_TIMEOUT_MS = 180 * 1000;
// From the moment the server answers, the UI page must finish loading in this
// time, or the window shows the error page instead of a spinner.
const UI_LOAD_TIMEOUT_MS = 60 * 1000;
// One readiness probe; a server that is up answers it in milliseconds.
const PROBE_TIMEOUT_MS = 3000;
const SMOKE = process.env.ANNZARRO_DESKTOP_SMOKE === '1';

// A test's profile: its own settings, local storage, log and single-instance
// lock, so a test never hands a user's launch to its own window (or restores
// its panels into the user's next session), and vice versa.
const PROFILE_DIR = process.env.ANNZARRO_DESKTOP_USER_DATA
    || (SMOKE ? fs.mkdtempSync(path.join(os.tmpdir(), 'annzarro-smoke-profile-')) : null);
if (PROFILE_DIR) {
    app.setPath('userData', PROFILE_DIR);
    log.transports.file.resolvePathFn = () => path.join(PROFILE_DIR, 'logs', 'main.log');
}

let mainWindow = null;
let serverProcess = null;
let serverUrl = null;
let isQuitting = false;
let appDataPath = null;
let updater = null;
let opener = null;
// SMOKE: requests the window tried to make beyond the local server.
const externalRequests = [];

/**
 * The directory datasets are browsed from by default, created on first run. It is the datasets
 * folder itself: nothing is created inside it (an older install's datasets/ and sessions/ stay
 * as they are).
 */
function initDataDir() {
    appDataPath = process.env.ANNZARRO_DESKTOP_DATA_DIR || path.join(os.homedir(), 'annzarro-data');
    fs.mkdirSync(appDataPath, { recursive: true });
    return appDataPath;
}

/** Where the server writes (logs, caches, panel sets): inside the app's own profile. */
function stateDir() {
    return stateLogic.stateDirFor(app.getPath('userData'));
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
function waitForServer(url, proc, instanceId) {
    // Every way out is armed independently of the polling: a probe that
    // hangs (another program holding the port, accepting connections and
    // never answering) used to block the loop, so neither the server's exit
    // nor the deadline was ever noticed and the window spun forever.
    return new Promise((resolve, reject) => {
        let done = false;
        const finish = (fn, arg) => {
            if (done) return;
            done = true;
            clearTimeout(deadline);
            proc.removeListener('exit', onExit);
            fn(arg);
        };
        const onExit = (code, signal) => finish(reject,
            new Error(`The server exited with ${signal || code} before it was ready`));
        proc.once('exit', onExit);
        const deadline = setTimeout(() => finish(reject,
            new Error(`The server did not answer within ${SERVER_START_TIMEOUT_MS / 1000}s`)),
            SERVER_START_TIMEOUT_MS);
        const attempt = async () => {
            if (done) return;
            try {
                const response = await fetch(`${url}/api/v1/datasets`,
                    { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
                // Only our own server: another AnnZarro that took the same
                // port a moment earlier answers without our token.
                if (response.ok && response.headers.get('x-annzarro-instance') === instanceId) {
                    return finish(resolve);
                }
            } catch (err) {
                // not listening yet, or a probe that timed out
            }
            if (!done) setTimeout(attempt, 300);
        };
        attempt();
    });
}

async function startServer() {
    if (serverProcess) return;
    const dataDir = initDataDir();
    // Two launches can pick the same free port at the same moment; the one
    // that loses the bind exits at once, and then tries the next port.
    let port = DEFAULT_PORT;
    for (let attempt = 1; ; attempt++) {
        port = await findFreePort(port);
        try {
            await startServerOn(port, dataDir);
            return;
        } catch (err) {
            if (!err.portInUse || attempt >= 5) throw err;
            log.warn(`Port ${port} was taken while the server started; trying the next one`);
            port += 1;
        }
    }
}

async function startServerOn(port, dataDir) {
    const { command, args, cwd } = serverCommand();
    const fullArgs = args.concat(stateLogic.serverArgs({ port, host: HOST, dataDir, stateDir: stateDir() }));
    log.info(`Starting server: ${command} ${fullArgs.join(' ')}`);
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    if (path.isAbsolute(command) && !fs.existsSync(command)) {
        throw new Error(`Server executable not found: ${command}`);
    }
    const instanceId = crypto.randomUUID();
    const proc = spawn(command, fullArgs, {
        cwd: cwd || app.getPath('userData'),
        env: {
            ...process.env,
            ANNZARRO_ELECTRON_APP: 'true',
            ANNZARRO_HEADLESS: '1',
            ANNZARRO_AUTH_DISABLED: 'true',
            ANNZARRO_INSTANCE_ID: instanceId,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
    });
    serverProcess = proc;
    let output = '';
    const onOutput = (d) => {
        const text = d.toString();
        if (output.length < 20000) output += text;
        log.info(`server: ${text.trimEnd()}`);
    };
    proc.stdout.on('data', onOutput);
    proc.stderr.on('data', onOutput);
    proc.on('error', (err) => log.error(`Server process error: ${err.message}`));
    proc.on('exit', (code, signal) => {
        log.info(`Server exited (code ${code}, signal ${signal || 'none'})`);
        if (serverProcess === proc) serverProcess = null;
        if (!isQuitting && mainWindow && serverUrl) {
            showErrorScreen('The AnnZarro server stopped unexpectedly. Use "Retry" to start it again.');
        }
        serverUrl = null;
    });

    const url = `http://${HOST}:${port}`;
    try {
        await waitForServer(url, proc, instanceId);
    } catch (err) {
        // 'exit' can come before the last of the server's output; wait for
        // the streams to close so the port-in-use message is not missed.
        const closed = new Promise((r) => {
            if (proc.stdout.readableEnded && proc.stderr.readableEnded) r();
            else proc.once('close', r);
        });
        await stopServer();
        await Promise.race([closed, new Promise((r) => setTimeout(r, 2000))]);
        if (/Port \d+ is in use|Address already in use/.test(output)) err.portInUse = true;
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

/**
 * Say on the loading page what is happening and for how long, so a slow
 * first start is never an anonymous spinner. Returns a function that stops it.
 */
function showStartupProgress() {
    const started = Date.now();
    const timer = setInterval(() => {
        if (!mainWindow || serverUrl) return;
        const s = Math.round((Date.now() - started) / 1000);
        let text = `Starting the AnnZarro server (${s} s)`;
        if (s >= 15) {
            text += '. The first start after installing can take up to a minute while the system checks the app.';
        }
        if (s >= 90) {
            text += ` The app gives up after ${SERVER_START_TIMEOUT_MS / 1000} s and shows the log.`;
        }
        mainWindow.webContents.executeJavaScript(
            `window.setStatus && window.setStatus(${JSON.stringify(text)})`).catch(() => {});
    }, 1000);
    return () => clearInterval(timer);
}

/**
 * Load the UI; if it has not finished loading within UI_LOAD_TIMEOUT_MS,
 * or fails to load, show the error page instead.
 */
function loadUi() {
    if (!mainWindow) return Promise.resolve();
    const win = mainWindow;
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`the interface did not finish loading within ${UI_LOAD_TIMEOUT_MS / 1000} s`));
        }, UI_LOAD_TIMEOUT_MS);
        win.loadURL(serverUrl).then(
            () => { clearTimeout(timer); resolve(); },
            (err) => { clearTimeout(timer); reject(new Error(`the interface failed to load: ${err.message}`)); });
    });
}

/**
 * Run a CLI command of the bundled server (`paths`, `panel-sets migrate`) against the same data
 * and state folders as the running server. Resolves {code, stdout, stderr}.
 */
function runCli(command, extra = []) {
    const { command: exe, args, cwd } = serverCommand();
    const fullArgs = args.concat(stateLogic.cliArgs(command, { dataDir: appDataPath, stateDir: stateDir() }, extra));
    return new Promise((resolve) => {
        const proc = spawn(exe, fullArgs, {
            cwd: cwd || app.getPath('userData'),
            env: { ...process.env, ANNZARRO_HEADLESS: '1' },
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        });
        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', (d) => { stdout += d; });
        proc.stderr.on('data', (d) => { stderr += d; });
        proc.on('error', (err) => resolve({ code: 1, stdout, stderr: err.message }));
        proc.on('close', (code) => resolve({ code, stdout, stderr }));
    });
}

const panelSetsSettingsFile = () => path.join(app.getPath('userData'), stateLogic.SETTINGS_FILE);
let askedAboutPanelSets = false;

function readPanelSetsSettings() {
    try {
        return stateLogic.normalizeSettings(JSON.parse(fs.readFileSync(panelSetsSettingsFile(), 'utf8')));
    } catch (err) {
        return stateLogic.normalizeSettings(null);
    }
}

/**
 * An install from before panel sets had a folder of their own keeps them in <data folder>/sessions
 * and the server goes on using that. Offer, once per launch, to copy them to the app's state
 * folder; the copy never deletes anything. "Don't ask again" is remembered in the app's settings.
 */
async function offerPanelSetsCopy() {
    const settings = readPanelSetsSettings();
    if (settings.panelSetsOffer === 'never' || askedAboutPanelSets) return;
    const paths = await runCli(['paths'], ['--format', 'json']);
    if (!stateLogic.shouldOffer({ legacy: stateLogic.isLegacy(paths.stdout), settings, askedThisLaunch: askedAboutPanelSets })) return;
    askedAboutPanelSets = true;
    if (!mainWindow) return;
    const { response } = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        noLink: true,
        buttons: ['Copy now', 'Not now', "Don't ask again"],
        defaultId: 0,
        cancelId: 1,
        message: 'Copy your panel sets to the app\'s own folder?',
        detail: `Your panel sets are saved in ${path.join(appDataPath, 'sessions')}, inside your data folder. `
            + 'AnnZarro can copy them to its own state folder, so the data folder holds only data. '
            + 'The originals stay where they are; nothing is deleted.',
    });
    const next = stateLogic.afterAnswer(settings, response);
    if (next.panelSetsOffer !== settings.panelSetsOffer) {
        try {
            fs.writeFileSync(panelSetsSettingsFile(), JSON.stringify(next, null, 2));
        } catch (err) {
            log.warn(`Could not save the panel-set settings: ${err.message}`);
        }
    }
    if (stateLogic.CHOICES[response] !== 'copy') return;
    const result = await runCli(['panel-sets', 'migrate']);
    const summary = stateLogic.migrationSummary(result.code, result.stdout, result.stderr);
    log.info(`Panel-set copy ${summary.ok ? 'finished' : 'failed'}: ${summary.detail}`);
    if (mainWindow) {
        await dialog.showMessageBox(mainWindow, {
            type: summary.ok ? 'info' : 'warning',
            noLink: true,
            message: summary.ok ? 'Panel sets copied' : 'Could not copy all panel sets',
            detail: summary.detail,
        });
    }
}

async function launch() {
    const stopProgress = showStartupProgress();
    try {
        await startServer();
        stopProgress();
        await loadUi();
        log.info(`Interface loaded from ${serverUrl}`);
        if (SMOKE) await smokeCheck();
        else offerPanelSetsCopy().catch((err) => log.warn(`Panel-set offer failed: ${err.message}`));
    } catch (err) {
        stopProgress();
        log.error(`Failed to start: ${err.message}`);
        if (SMOKE) {
            console.log(`ANNZARRO_DESKTOP_SMOKE failed: ${err.message}`);
            isQuitting = true;
            await stopServer();
            app.exit(1);
            return;
        }
        showErrorScreen(`AnnZarro could not start: ${err.message}`);
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
    // The preload marks <html> for the frame this platform has (no frame flag on Linux)
    const frame = await mainWindow.webContents.executeJavaScript(
        "document.documentElement.getAttribute('data-desktop-frame') || ''");
    if (frame !== (chrome.frameFlag(process.platform) || '')) {
        throw new Error(`<html data-desktop-frame> is "${frame}" on ${process.platform}`);
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
        // No white flash before the page paints. nativeTheme.themeSource stays "system":
        // the page follows the OS through prefers-color-scheme (static/css/theme.css)
        backgroundColor: nativeTheme.shouldUseDarkColors ? '#14171a' : '#ffffff',
        icon: path.join(__dirname, 'icons', 'icon.png'),
        // No native title bar on macOS and Windows: the page's header is the title bar
        ...chrome.frameOptions(process.platform, nativeTheme.shouldUseDarkColors),
        webPreferences: {
            additionalArguments: chrome.frameArguments(process.platform),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            preload: path.join(__dirname, 'preload.js'),
        },
    });
    mainWindow.loadFile(path.join(__dirname, 'loading.html'));

    // The window controls follow the page: loading.html and error.html have their own colours,
    // the app's page sets those of its header (static/js/utils/desktop-frame.js)
    const win = mainWindow;
    win.webContents.on('did-finish-load', () => {
        if (win.webContents.getURL().startsWith('file:')) setOverlay(chrome.pageOverlay(nativeTheme.shouldUseDarkColors));
    });
    // Datasets asked for by the OS wait until the app's page is loaded (dataset-open.js)
    win.webContents.on('did-start-navigation', (event, url, isInPlace, isMainFrame) => {
        if (isMainFrame && !isInPlace && opener) opener.markPageBusy();
    });
    win.webContents.on('did-finish-load', () => {
        const url = win.webContents.getURL();
        if (opener && serverUrl && (url === serverUrl || url.startsWith(serverUrl + '/'))) opener.markPageReady();
    });
    win.on('enter-full-screen', () => win.webContents.send('app:fullscreen', true));
    win.on('leave-full-screen', () => win.webContents.send('app:fullscreen', false));

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

    mainWindow.webContents.on('render-process-gone', (event, details) => {
        if (!isQuitting) showErrorScreen(`The window's renderer stopped (${details.reason}).`);
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

function setOverlay(colors) {
    if (process.platform !== 'win32' || !mainWindow || mainWindow.isDestroyed()) return;
    try {
        mainWindow.setTitleBarOverlay({ ...colors, height: chrome.WIN_OVERLAY_HEIGHT_PX });
    } catch (err) {
        log.warn(`Could not set the title bar colours: ${err.message}`);
    }
}

function setupIpcHandlers() {
    ipcMain.handle('app:isFullScreen', () => Boolean(mainWindow && mainWindow.isFullScreen()));
    ipcMain.handle('app:setTitleBarOverlay', (event, colors) => {
        const clean = chrome.sanitizeOverlay(colors);
        if (clean) setOverlay(clean);
        return Boolean(clean);
    });
    ipcMain.handle('app:getVersion', () => app.getVersion());
    ipcMain.handle('app:restartServer', async () => {
        try {
            await stopServer();
            await startServer();
            await loadUi();
            return { success: true };
        } catch (err) {
            log.error(`Failed to restart server: ${err.message}`);
            return { error: err.message };
        }
    });
    // The File menu's dialogs, the browser's "open a file or folder" button and a drop all end
    // here. {which: 'h5ad' | 'zarr'} shows a dialog (none: the platform's best: one for a file or
    // a folder on macOS); {path} opens a local path. Both validate in the main process and then
    // run window.annzarro.openDataset(path) in the page. Resolves to {path, kind, result} (result:
    // the page's answer) or {path, kind, error}; null when the dialog was cancelled.
    ipcMain.handle('app:openDataset', async (event, request) => {
        if (!mainWindow || event.sender !== mainWindow.webContents) return null;
        const req = request && typeof request === 'object' ? request : {};
        if (typeof req.path === 'string' && req.path) return opener.open(req.path, { allowFolder: Boolean(req.allowFolder) });
        return opener.openDialog(req.which === 'h5ad' || req.which === 'zarr' ? req.which : undefined);
    });
    // Files dropped on the window (preload.js resolves their paths)
    ipcMain.handle('app:dropPaths', async (event, paths) => {
        if (!mainWindow || event.sender !== mainWindow.webContents || !Array.isArray(paths)) return null;
        return opener.openDropped(paths);
    });
    // The page reports the dataset it has open, wherever it was opened from
    ipcMain.handle('app:datasetOpened', (event, p) => {
        if (!mainWindow || event.sender !== mainWindow.webContents) return false;
        return opener.datasetOpened(p);
    });
    // Kept until the page's folder button moves to app:openDataset
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

// One instance per profile: a second launch focuses the existing window
// instead of starting a second server.
if (!app.requestSingleInstanceLock()) {
    log.info('AnnZarro is already running; handing this launch to its window');
    app.quit();
} else {
    app.on('second-instance', (event, argv) => {
        log.info('Second launch: focusing the existing window');
        if (opener) opener.openFromOs(logic.argvPaths(argv, process.defaultApp));
        if (!mainWindow) {
            createWindow();
            if (serverUrl) mainWindow.loadURL(serverUrl);
            else launch();
            return;
        }
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
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
        opener = createDatasetOpener({
            app, dialog, Menu, log,
            getWindow: () => mainWindow,
            userDataDir: app.getPath('userData'),
            // the updater adds its items to whichever menu is current
            onMenuBuilt: () => { if (updater) updater.installMenu(); },
        });
        opener.start();
        opener.openFromOs(pendingOsPaths.splice(0));
        opener.openFromOs(logic.argvPaths(process.argv, process.defaultApp));
        createWindow();
        launch();
        updater = createUpdater({
            app, dialog, shell, Menu, MenuItem, net: electronNet, log, prepareToQuit,
            getWindow: () => mainWindow,
            testProfile: SMOKE || Boolean(PROFILE_DIR),
        });
        updater.start();
        app.on('activate', () => {
            if (!mainWindow) {
                createWindow();
                if (serverUrl) mainWindow.loadURL(serverUrl);
                else launch();
            }
        });
    });
}

// macOS: double click, "Open With" and a drop on the Dock icon arrive here, also before the
// app is ready; Windows and Linux pass the path as an argument (above).
const pendingOsPaths = [];
app.on('open-file', (event, p) => {
    event.preventDefault();
    if (opener) opener.openFromOs(p);
    else pendingOsPaths.push(p);
});

app.on('window-all-closed', () => {
    app.quit();
});

/**
 * Get ready to exit: let the page autosave (preload.js), stop the server and
 * mark the app as quitting, so the before-quit handler below lets the quit
 * through. The updater calls this before it installs an update.
 */
async function prepareToQuit() {
    isQuitting = true;
    if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('app:will-quit');
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    await stopServer();
}

app.on('before-quit', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    prepareToQuit().finally(() => app.exit(0));
});
