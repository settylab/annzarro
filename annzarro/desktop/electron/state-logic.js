/**
 * Where the desktop app keeps things and how it offers to copy panel sets, as pure functions
 * (no Electron, no disk) so annzarro/tests/js/desktop-state.test.mjs can test them. main.js does
 * the I/O around them.
 *
 *   - stateDirFor        the server's state directory, inside the app's own profile
 *   - serverArgs         the server's command line (the data folder is the datasets folder itself)
 *   - cliArgs            the same location flags for `paths` and `panel-sets migrate`
 *   - isLegacy           whether `annzarro paths --format json` reports panel sets in <data>/sessions
 *   - normalizeSettings / shouldOffer / afterAnswer   the once-only "copy panel sets" prompt
 */
'use strict';

const path = require('path');

const SETTINGS_FILE = 'panel-sets-settings.json';
// The dialog's buttons, in order.
const CHOICES = ['copy', 'later', 'never'];

/** Desktop state (logs, caches, panel sets) never lands in a data folder: it lives in the profile. */
function stateDirFor(userDataDir) {
    return path.join(userDataDir, 'state');
}

/** Flags that say where the data and the state are; the same for the server and the CLI commands. */
function locationArgs(dataDir, stateDir) {
    return ['--data-dir', dataDir, '--state-dir', stateDir];
}

function serverArgs({ port, host, dataDir, stateDir }) {
    return ['start', '--host', host, '--port', String(port), ...locationArgs(dataDir, stateDir),
        '--auth-disabled', '--no-browser'];
}

/** `annzarro <command...>` with the locations; `extra` goes after them. */
function cliArgs(command, { dataDir, stateDir }, extra = []) {
    return [...command, ...locationArgs(dataDir, stateDir), ...extra];
}

/** Whether the JSON text of `annzarro paths --format json` says panel sets are in the legacy place. */
function isLegacy(jsonText) {
    let report;
    try {
        report = JSON.parse(jsonText);
    } catch (err) {
        return false;
    }
    const locations = report && Array.isArray(report.locations) ? report.locations : [];
    return locations.some((loc) => loc && loc.label === 'panel sets' && loc.legacy === true);
}

/** The settings file's content with every field valid. */
function normalizeSettings(raw) {
    return { panelSetsOffer: raw && raw.panelSetsOffer === 'never' ? 'never' : 'ask' };
}

/** Ask once per launch while the server is in legacy mode, unless "Don't ask again" was chosen. */
function shouldOffer({ legacy, settings, askedThisLaunch }) {
    return Boolean(legacy) && !askedThisLaunch && normalizeSettings(settings).panelSetsOffer !== 'never';
}

/** The settings after the user's answer (an index into CHOICES, or -1 for a closed dialog). */
function afterAnswer(settings, index) {
    const next = normalizeSettings(settings);
    if (CHOICES[index] === 'never') next.panelSetsOffer = 'never';
    return next;
}

/** One line for the result dialog from the exit code and output of `panel-sets migrate`. */
function migrationSummary(code, stdout, stderr) {
    const text = String(code === 0 ? stdout : (stderr || stdout) || '').trim();
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    return { ok: code === 0, detail: lines.join('\n') };
}

module.exports = {
    SETTINGS_FILE, CHOICES, stateDirFor, locationArgs, serverArgs, cliArgs, isLegacy,
    normalizeSettings, shouldOffer, afterAnswer, migrationSummary,
};
