/**
 * The decisions behind the desktop app's in-app updates, as pure functions
 * (no Electron, no network, no disk) so annzarro/tests/js/desktop-updates.test.mjs
 * can test them. updates.js does the I/O around them.
 */
'use strict';

const RELEASES_URL = 'https://github.com/settylab/annzarro/releases';
// Where an install that cannot replace itself (.deb, portable zip) looks for the newest version:
// the updater metadata of the latest published release.
const LATEST_LINUX_YML_URL = `${RELEASES_URL}/latest/download/latest-linux.yml`;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * "1.2.3", "v1.2.3" or "1.2.3-rc.1" as {core: [1, 2, 3], pre: ['rc', 1]};
 * null if it is not a version.
 */
function parseVersion(text) {
    const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(String(text || '').trim());
    if (!m) return null;
    const pre = m[4] ? m[4].split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p)) : [];
    return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre };
}

/** -1, 0 or 1 by semantic versioning; null if either is not a version. */
function compareVersions(a, b) {
    const x = parseVersion(a);
    const y = parseVersion(b);
    if (!x || !y) return null;
    for (let i = 0; i < 3; i++) {
        if (x.core[i] !== y.core[i]) return x.core[i] < y.core[i] ? -1 : 1;
    }
    // A release is newer than any of its pre-releases.
    if (!x.pre.length || !y.pre.length) {
        if (x.pre.length === y.pre.length) return 0;
        return x.pre.length ? -1 : 1;
    }
    for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
        const p = x.pre[i];
        const q = y.pre[i];
        if (p === undefined) return -1;
        if (q === undefined) return 1;
        if (p === q) continue;
        if (typeof p === 'number' && typeof q === 'number') return p < q ? -1 : 1;
        if (typeof p === 'number') return -1;
        if (typeof q === 'number') return 1;
        return p < q ? -1 : 1;
    }
    return 0;
}

function isNewer(latest, current) {
    return compareVersions(latest, current) === 1;
}

/** ANNZARRO_DISABLE_UPDATES=1 (or true/yes/on): for managed installs. */
function disabledByEnv(env) {
    return /^(1|true|yes|on)$/i.test(String((env || {}).ANNZARRO_DISABLE_UPDATES || '').trim());
}

/**
 * Why updates are off ('env', 'test', 'unpackaged') or null if they are on.
 * `test` is a smoke or test run, which must not reach the network.
 */
function disabledReason({ env, isPackaged, testProfile }) {
    if (disabledByEnv(env)) return 'env';
    if (testProfile) return 'test';
    if (!isPackaged) return 'unpackaged';
    return null;
}

/**
 * How this install updates: 'self' (the app downloads and installs it: macOS,
 * the Windows installer, the Linux AppImage) or 'manual' (a .deb or other Linux
 * install that is not an AppImage, and the portable Windows zip, which has no
 * uninstaller next to it: the user is pointed to the download page).
 */
function installKind({ platform, env, hasUninstaller }) {
    if (platform === 'darwin') return 'self';
    if (platform === 'win32') return hasUninstaller ? 'self' : 'manual';
    return (env || {}).APPIMAGE ? 'self' : 'manual';
}

/**
 * Whether to tell the user about `latest`: it must be newer than `current`,
 * and not the version they chose to skip (a check they asked for ignores that).
 */
function shouldOffer({ current, latest, skipped, manual }) {
    if (!isNewer(latest, current)) return false;
    return Boolean(manual) || skipped !== latest;
}

/** Whether the periodic check is due: on, and the last one was over a day ago. */
function checkDue({ autoCheck, lastCheck, now }) {
    if (!autoCheck) return false;
    return typeof lastCheck !== 'number' || now - lastCheck >= DAY_MS;
}

/** The settings file's content with every field valid. */
function normalizeSettings(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    return {
        autoCheck: r.autoCheck !== false,
        skippedVersion: parseVersion(r.skippedVersion) ? String(r.skippedVersion) : null,
        lastCheck: Number.isFinite(r.lastCheck) ? r.lastCheck : null,
    };
}

/** The `version:` of an electron-builder latest*.yml; null if there is none. */
function parseLatestVersion(ymlText) {
    const m = /^version:\s*['"]?([^'"\s#]+)['"]?\s*$/m.exec(String(ymlText || ''));
    return m && parseVersion(m[1]) ? m[1] : null;
}

function releaseUrl(version) {
    return `${RELEASES_URL}/tag/v${version}`;
}

module.exports = {
    RELEASES_URL,
    LATEST_LINUX_YML_URL,
    DAY_MS,
    parseVersion,
    compareVersions,
    isNewer,
    disabledByEnv,
    disabledReason,
    installKind,
    shouldOffer,
    checkDue,
    normalizeSettings,
    parseLatestVersion,
    releaseUrl,
};
