/**
 * In-app updates from GitHub releases (settylab/annzarro).
 *
 * The app checks on launch and then at most once a day while it runs, and never
 * downloads without asking: "AnnZarro X is available" with Download / Later /
 * Skip this version, then "Restart to update" once the file is downloaded and
 * verified. macOS, the Windows installer and the Linux AppImage replace
 * themselves (electron-updater, GitHub provider); a .deb or the
 * portable Windows zip cannot, so they are pointed to the release page. Only github.com (and the
 * objects.githubusercontent.com it redirects downloads to) is contacted.
 *
 * Off: ANNZARRO_DISABLE_UPDATES=1 (managed installs), the "Check for Updates
 * Automatically" menu item (stored in <userData>/update-settings.json), and in
 * test runs (ANNZARRO_DESKTOP_SMOKE / ANNZARRO_DESKTOP_USER_DATA), which must
 * not reach the network. The decisions are in update-logic.js.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const logic = require('./update-logic');

const FIRST_CHECK_DELAY_MS = 15 * 1000;
const TICK_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 20 * 1000;

/**
 * @param {object} deps
 *   app, dialog, shell, Menu, MenuItem, net  Electron modules
 *   log                                       electron-log
 *   getWindow()                               the main window or null
 *   prepareToQuit()                           async: autosave, stop the server, mark the app as quitting
 *   testProfile                               true in smoke and test runs
 */
function createUpdater(deps) {
    const { app, dialog, shell, Menu, MenuItem, net, log, getWindow, prepareToQuit } = deps;
    const settingsFile = () => path.join(app.getPath('userData'), 'update-settings.json');
    const reason = logic.disabledReason({
        env: process.env, isPackaged: app.isPackaged, testProfile: deps.testProfile,
    });
    // The NSIS installer puts "Uninstall AnnZarro.exe" beside the app; the portable zip has none.
    const kind = logic.installKind({
        platform: process.platform,
        env: process.env,
        hasUninstaller: process.platform === 'win32'
            && fs.existsSync(path.join(path.dirname(process.execPath), 'Uninstall AnnZarro.exe')),
    });

    let settings = logic.normalizeSettings(null);
    let autoUpdater = null;
    let busy = false;
    let downloaded = null; // version of an update that is downloaded and verified
    let autoCheckItem = null;
    let timer = null;

    function loadSettings() {
        try {
            settings = logic.normalizeSettings(JSON.parse(fs.readFileSync(settingsFile(), 'utf8')));
        } catch (err) {
            settings = logic.normalizeSettings(null);
        }
    }

    function saveSettings(patch) {
        settings = { ...settings, ...patch };
        try {
            fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
            fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
        } catch (err) {
            log.warn(`Could not save the update settings: ${err.message}`);
        }
    }

    function getAutoUpdater() {
        if (!autoUpdater) {
            ({ autoUpdater } = require('electron-updater'));
            autoUpdater.logger = log;
            autoUpdater.autoDownload = false;
            autoUpdater.autoInstallOnAppQuit = false; // quitting runs through main.js, not Electron's quit event
            autoUpdater.allowPrerelease = false;
            autoUpdater.allowDowngrade = false;
        }
        return autoUpdater;
    }

    async function fetchLatestVersion() {
        const response = await net.fetch(logic.LATEST_LINUX_YML_URL, {
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
        const version = logic.parseLatestVersion(await response.text());
        if (!version) throw new Error('the release has no version');
        return version;
    }

    function say(options) {
        return dialog.showMessageBox({ type: 'info', noLink: true, ...options });
    }

    /** Ask what to do about `version`; resolves 'download' | 'later' | 'skip'. */
    async function offer(version) {
        const self = kind === 'self';
        for (;;) {
            const { response } = await say({
                message: `AnnZarro ${version} is available`,
                detail: `You have ${app.getVersion()}. `
                    + (self ? 'Download it now and install it with a restart, or later.'
                        : 'This installation (a .deb, or the portable Windows zip) cannot update itself; '
                          + 'the release page has the new files.')
                    + `\n\n${logic.releaseUrl(version)}`,
                buttons: [self ? 'Download' : 'Open download page', 'Later', 'Skip this version', 'Release notes'],
                defaultId: 0,
                cancelId: 1,
            });
            if (response === 3) {
                shell.openExternal(logic.releaseUrl(version));
                continue;
            }
            return ['download', 'later', 'skip'][response] || 'later';
        }
    }

    async function promptRestart(version) {
        const { response } = await say({
            message: `AnnZarro ${version} is ready to install`,
            detail: 'AnnZarro closes, installs the update and starts again.',
            buttons: ['Restart to update', 'Later'],
            defaultId: 0,
            cancelId: 1,
        });
        if (response !== 0) return;
        log.info(`Restarting to install ${version}`);
        await prepareToQuit();
        getAutoUpdater().quitAndInstall(true, true);
    }

    async function download(version) {
        const win = getWindow();
        const progress = (p) => {
            if (win && !win.isDestroyed()) win.setProgressBar(Math.min(1, p.percent / 100));
        };
        const updater = getAutoUpdater();
        updater.on('download-progress', progress);
        try {
            await updater.downloadUpdate();
        } finally {
            updater.removeListener('download-progress', progress);
            if (win && !win.isDestroyed()) win.setProgressBar(-1);
        }
        downloaded = version;
        await promptRestart(version);
    }

    /**
     * Check for a newer release. `manual` is a check the user asked for: it
     * ignores the skipped version and answers "up to date" and errors in a dialog.
     */
    async function check({ manual = false } = {}) {
        if (reason) {
            if (manual) await say({ message: 'Updates are turned off', detail: describeReason() });
            return;
        }
        if (busy) return;
        if (downloaded) {
            if (manual) await promptRestart(downloaded);
            return;
        }
        busy = true;
        try {
            let latest;
            if (kind === 'self') {
                const result = await getAutoUpdater().checkForUpdates();
                latest = result && result.updateInfo && result.updateInfo.version;
            } else {
                latest = await fetchLatestVersion();
            }
            saveSettings({ lastCheck: Date.now() });
            log.info(`Update check: latest ${latest}, running ${app.getVersion()}`);
            if (!logic.shouldOffer({ current: app.getVersion(), latest, skipped: settings.skippedVersion, manual })) {
                if (manual) {
                    await say({
                        message: logic.isNewer(latest, app.getVersion())
                            ? `AnnZarro ${latest} is skipped` : 'AnnZarro is up to date',
                        detail: `You have ${app.getVersion()}.`,
                    });
                }
                return;
            }
            const choice = await offer(latest);
            if (choice === 'skip') {
                saveSettings({ skippedVersion: latest });
            } else if (choice === 'download') {
                if (kind === 'self') await download(latest);
                else shell.openExternal(logic.releaseUrl(latest));
            }
        } catch (err) {
            log.warn(`Update check failed: ${err.message}`);
            if (manual) {
                await dialog.showMessageBox({
                    type: 'warning',
                    message: 'Could not check for updates',
                    detail: `${err.message}\n\nAnnZarro looks for updates on github.com. `
                        + `You can also download the newest version from ${logic.RELEASES_URL}.`,
                });
            }
        } finally {
            busy = false;
        }
    }

    function describeReason() {
        if (reason === 'env') return 'ANNZARRO_DISABLE_UPDATES is set, so this installation does not look for updates.';
        if (reason === 'unpackaged') return 'Updates are only available in the installed app, not when it runs from a source checkout.';
        return 'Updates are turned off in this test run.';
    }

    /** The two menu items, at the place each platform expects them. */
    function installMenu() {
        const menu = Menu.getApplicationMenu();
        if (!menu) return;
        const checkItem = new MenuItem({
            label: 'Check for Updates...',
            click: () => { check({ manual: true }); },
        });
        autoCheckItem = new MenuItem({
            label: 'Check for Updates Automatically',
            type: 'checkbox',
            checked: !reason && settings.autoCheck,
            enabled: !reason,
            click: (item) => saveSettings({ autoCheck: item.checked }),
        });
        if (process.platform === 'darwin') {
            const appMenu = menu.items[0] && menu.items[0].submenu;
            if (!appMenu) return;
            appMenu.insert(1, checkItem);
            appMenu.insert(2, autoCheckItem);
        } else {
            let help = menu.items.find((i) => i.role === 'help' || i.label === 'Help');
            if (!help) {
                help = new MenuItem({ label: 'Help', role: 'help', submenu: [] });
                menu.append(help);
            }
            if (help.submenu.items.length) help.submenu.append(new MenuItem({ type: 'separator' }));
            help.submenu.append(checkItem);
            help.submenu.append(autoCheckItem);
        }
        Menu.setApplicationMenu(menu);
    }

    /** Once after launch, then hourly: a check is made when a day has passed since the last. */
    function start() {
        loadSettings();
        installMenu();
        if (reason) {
            log.info(`Updates are off (${reason})`);
            return;
        }
        setTimeout(() => {
            if (settings.autoCheck) check();
        }, FIRST_CHECK_DELAY_MS).unref();
        timer = setInterval(() => {
            if (logic.checkDue({ autoCheck: settings.autoCheck, lastCheck: settings.lastCheck, now: Date.now() })) check();
        }, TICK_MS);
        timer.unref();
    }

    return { start, check, installMenu };
}

module.exports = { createUpdater };
