import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const state = createRequire(import.meta.url)('../../desktop/electron/state-logic.js');

test('the state folder is inside the profile, never the data folder', () => {
    assert.equal(state.stateDirFor('/p/AnnZarro'), '/p/AnnZarro/state');
});

test('the server gets the data folder itself and an explicit state folder', () => {
    const args = state.serverArgs({ port: 39487, host: '127.0.0.1', dataDir: '/d/annzarro-data', stateDir: '/p/state' });
    assert.deepEqual(args, ['start', '--host', '127.0.0.1', '--port', '39487',
        '--data-dir', '/d/annzarro-data', '--state-dir', '/p/state', '--auth-disabled', '--no-browser']);
    assert.ok(!args.some((a) => /datasets|sessions/.test(a)), 'no datasets/ or sessions/ subfolder');
});

test('CLI commands carry the same locations as the server', () => {
    const where = { dataDir: '/d', stateDir: '/s' };
    assert.deepEqual(state.cliArgs(['paths'], where, ['--format', 'json']),
        ['paths', '--data-dir', '/d', '--state-dir', '/s', '--format', 'json']);
    assert.deepEqual(state.cliArgs(['panel-sets', 'migrate'], where),
        ['panel-sets', 'migrate', '--data-dir', '/d', '--state-dir', '/s']);
});

test('legacy mode is read from the paths report', () => {
    const report = (legacy) => JSON.stringify({ locations: [
        { label: 'data directory', path: '/d', why: 'flag' },
        { label: 'panel sets', path: '/d/sessions', legacy, why: 'x' }] });
    assert.equal(state.isLegacy(report(true)), true);
    assert.equal(state.isLegacy(report(false)), false);
    for (const bad of ['', 'not json', '{}', '{"locations": 3}', 'null']) {
        assert.equal(state.isLegacy(bad), false, bad);
    }
});

test('the offer is made once per launch and never after "Don\'t ask again"', () => {
    const ask = { panelSetsOffer: 'ask' };
    assert.equal(state.shouldOffer({ legacy: true, settings: ask, askedThisLaunch: false }), true);
    assert.equal(state.shouldOffer({ legacy: true, settings: null, askedThisLaunch: false }), true);
    assert.equal(state.shouldOffer({ legacy: true, settings: ask, askedThisLaunch: true }), false);
    assert.equal(state.shouldOffer({ legacy: false, settings: ask, askedThisLaunch: false }), false);
    assert.equal(state.shouldOffer({ legacy: true, settings: { panelSetsOffer: 'never' }, askedThisLaunch: false }), false);
});

test('only "Don\'t ask again" is remembered', () => {
    const ask = { panelSetsOffer: 'ask' };
    assert.deepEqual(state.CHOICES, ['copy', 'later', 'never']);
    assert.equal(state.afterAnswer(ask, 0).panelSetsOffer, 'ask');
    assert.equal(state.afterAnswer(ask, 1).panelSetsOffer, 'ask');
    assert.equal(state.afterAnswer(ask, -1).panelSetsOffer, 'ask');
    assert.equal(state.afterAnswer(ask, 2).panelSetsOffer, 'never');
    assert.equal(state.afterAnswer({ panelSetsOffer: 'never' }, 0).panelSetsOffer, 'never');
});

test('settings with junk fall back to asking', () => {
    assert.equal(state.normalizeSettings({ panelSetsOffer: 5 }).panelSetsOffer, 'ask');
    assert.equal(state.normalizeSettings('x').panelSetsOffer, 'ask');
});

test('the result dialog shows stdout on success and stderr on failure', () => {
    assert.deepEqual(state.migrationSummary(0, 'From a\nTo b\n\nCopied 2\n', ''), { ok: true, detail: 'From a\nTo b\nCopied 2' });
    assert.deepEqual(state.migrationSummary(1, 'partial', 'Error: locked'), { ok: false, detail: 'Error: locked' });
});

test('the app turns the Fred Hutch logo on for its own server, with no login', () => {
    const env = state.serverEnv('abc');
    assert.equal(env.ANNZARRO_SITE_FRED_HUTCH_LOGO, 'true');
    assert.equal(env.ANNZARRO_ELECTRON_APP, 'true');
    assert.equal(env.ANNZARRO_AUTH_DISABLED, 'true');
    assert.equal(env.ANNZARRO_INSTANCE_ID, 'abc');
});
