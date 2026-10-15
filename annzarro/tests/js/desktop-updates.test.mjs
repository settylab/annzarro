import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const logic = createRequire(import.meta.url)('../../desktop/electron/update-logic.js');

test('versions compare by semver, a release above its pre-releases', () => {
    const order = ['0.5.1', '0.5.2-rc.1', '0.5.2-rc.2', '0.5.2-rc.10', '0.5.2', '0.5.10', '0.6.0', '1.0.0'];
    for (let i = 0; i < order.length; i++) {
        for (let j = 0; j < order.length; j++) {
            assert.equal(logic.compareVersions(order[i], order[j]), Math.sign(i - j), `${order[i]} vs ${order[j]}`);
        }
    }
    assert.equal(logic.compareVersions('v0.5.2', '0.5.2'), 0);
    assert.equal(logic.compareVersions('0.5.2-alpha', '0.5.2-1'), 1, 'letters sort above numbers');
    assert.equal(logic.compareVersions('0.5', '0.5.1'), null);
    assert.equal(logic.compareVersions('latest', '0.5.1'), null);
    assert.equal(logic.isNewer('0.5.2', '0.5.1'), true);
    assert.equal(logic.isNewer('0.5.1', '0.5.1'), false);
    assert.equal(logic.isNewer('0.5.0', '0.5.1'), false, 'never a downgrade');
    assert.equal(logic.isNewer('garbage', '0.5.1'), false);
});

test('a skipped version is not offered again, unless the user asks', () => {
    const base = { current: '0.5.1', latest: '0.5.2', skipped: null, manual: false };
    assert.equal(logic.shouldOffer(base), true);
    assert.equal(logic.shouldOffer({ ...base, skipped: '0.5.2' }), false);
    assert.equal(logic.shouldOffer({ ...base, skipped: '0.5.2', manual: true }), true);
    assert.equal(logic.shouldOffer({ ...base, skipped: '0.5.1' }), true, 'an older skip does not hide a newer release');
    assert.equal(logic.shouldOffer({ ...base, latest: '0.5.1' }), false);
    assert.equal(logic.shouldOffer({ ...base, latest: '0.5.1', manual: true }), false);
    assert.equal(logic.shouldOffer({ ...base, current: '0.5.3' }), false);
});

test('ANNZARRO_DISABLE_UPDATES turns updates off', () => {
    for (const v of ['1', 'true', 'TRUE', 'yes', 'on', ' 1 ']) {
        assert.equal(logic.disabledByEnv({ ANNZARRO_DISABLE_UPDATES: v }), true, v);
    }
    for (const v of ['', '0', 'false', 'no', undefined]) {
        assert.equal(logic.disabledByEnv({ ANNZARRO_DISABLE_UPDATES: v }), false, String(v));
    }
    assert.equal(logic.disabledByEnv({}), false);
    const packaged = { env: {}, isPackaged: true, testProfile: false };
    assert.equal(logic.disabledReason(packaged), null);
    assert.equal(logic.disabledReason({ ...packaged, env: { ANNZARRO_DISABLE_UPDATES: '1' } }), 'env');
    assert.equal(logic.disabledReason({ ...packaged, testProfile: true }), 'test');
    assert.equal(logic.disabledReason({ ...packaged, isPackaged: false }), 'unpackaged');
});

test('only installed apps self-update: AppImage, NSIS install, macOS; a .deb or portable zip is pointed to the download page', () => {
    assert.equal(logic.installKind({ platform: 'darwin', env: {} }), 'self');
    assert.equal(logic.installKind({ platform: 'win32', env: {}, hasUninstaller: true }), 'self');
    assert.equal(logic.installKind({ platform: 'win32', env: {}, hasUninstaller: false }), 'manual', 'portable zip');
    assert.equal(logic.installKind({ platform: 'linux', env: { APPIMAGE: '/home/u/AnnZarro.AppImage' } }), 'self');
    assert.equal(logic.installKind({ platform: 'linux', env: {} }), 'manual');
    assert.equal(logic.installKind({ platform: 'linux', env: { APPIMAGE: '' } }), 'manual');
});

test('the periodic check runs at most once a day, and never when off', () => {
    const now = 1_000_000_000_000;
    assert.equal(logic.checkDue({ autoCheck: true, lastCheck: null, now }), true);
    assert.equal(logic.checkDue({ autoCheck: true, lastCheck: now - logic.DAY_MS + 1, now }), false);
    assert.equal(logic.checkDue({ autoCheck: true, lastCheck: now - logic.DAY_MS, now }), true);
    assert.equal(logic.checkDue({ autoCheck: false, lastCheck: null, now }), false);
});

test('settings read from disk are always valid', () => {
    assert.deepEqual(logic.normalizeSettings(null), { autoCheck: true, skippedVersion: null, lastCheck: null });
    assert.deepEqual(logic.normalizeSettings({ autoCheck: false, skippedVersion: '0.5.2', lastCheck: 5 }),
        { autoCheck: false, skippedVersion: '0.5.2', lastCheck: 5 });
    assert.deepEqual(logic.normalizeSettings({ autoCheck: 'no', skippedVersion: 'x', lastCheck: 'soon' }),
        { autoCheck: true, skippedVersion: null, lastCheck: null });
    assert.deepEqual(logic.normalizeSettings('text'), { autoCheck: true, skippedVersion: null, lastCheck: null });
});

test('the version is read from an electron-builder update file', () => {
    const yml = "version: 0.5.2\nfiles:\n  - url: AnnZarro-0.5.2-linux-x86_64.AppImage\n    sha512: abc\n    size: 1\npath: x\nreleaseDate: '2026-10-14T10:00:00.000Z'\n";
    assert.equal(logic.parseLatestVersion(yml), '0.5.2');
    assert.equal(logic.parseLatestVersion("version: '0.5.2-rc.1'\n"), '0.5.2-rc.1');
    assert.equal(logic.parseLatestVersion('<html>Not Found</html>'), null);
    assert.equal(logic.parseLatestVersion('version: nonsense\n'), null);
    assert.equal(logic.parseLatestVersion(''), null);
});

test('links stay on github.com', () => {
    assert.equal(logic.releaseUrl('0.5.2'), 'https://github.com/settylab/annzarro/releases/tag/v0.5.2');
    for (const url of [logic.RELEASES_URL, logic.LATEST_LINUX_YML_URL]) {
        assert.equal(new URL(url).hostname, 'github.com');
    }
});

// updates.js around the decisions, with Electron replaced by fakes.
const { createUpdater } = createRequire(import.meta.url)('../../desktop/electron/updates.js');

function fakeElectron({ isPackaged = true } = {}) {
    const dialogs = [];
    class Menu {
        constructor() { this.items = []; }
        append(i) { this.items.push(i); }
        insert(pos, i) { this.items.splice(pos, 0, i); }
        static getApplicationMenu() { return Menu.current; }
        static setApplicationMenu(m) { Menu.current = m; }
    }
    class MenuItem {
        constructor(o) { Object.assign(this, o); if (o.role === 'help' || o.submenu) this.submenu = new Menu(); }
    }
    const top = new MenuItem({ label: 'AnnZarro', submenu: [] });
    top.submenu.append(new MenuItem({ role: 'about' }));
    const help = new MenuItem({ role: 'help', label: 'Help' });
    Menu.current = new Menu();
    Menu.current.append(top);
    Menu.current.append(help);
    const log = { info() {}, warn() {}, error() {} };
    return {
        dialogs, Menu, MenuItem, top, help,
        deps: {
            app: { isPackaged, getVersion: () => '0.5.1', getPath: () => '/nonexistent/annzarro-test' },
            dialog: { showMessageBox: async (o) => { dialogs.push(o); return { response: 1 }; } },
            shell: { openExternal() {} },
            Menu, MenuItem, log, net: {}, getWindow: () => null, prepareToQuit: async () => {},
            testProfile: false,
        },
    };
}

test('unpackaged and disabled apps explain themselves instead of checking', async () => {
    const f = fakeElectron({ isPackaged: false });
    const u = createUpdater(f.deps);
    await u.check({ manual: true });
    assert.match(f.dialogs[0].message, /turned off/);
    assert.match(f.dialogs[0].detail, /source checkout/);
    await u.check();
    assert.equal(f.dialogs.length, 1, 'an automatic check is silent');

    process.env.ANNZARRO_DISABLE_UPDATES = '1';
    try {
        const g = fakeElectron();
        await createUpdater(g.deps).check({ manual: true });
        assert.match(g.dialogs[0].detail, /ANNZARRO_DISABLE_UPDATES/);
    } finally {
        delete process.env.ANNZARRO_DISABLE_UPDATES;
    }
});

test('the menu gets "Check for Updates..." and the automatic-check switch', () => {
    const f = fakeElectron({ isPackaged: false });
    createUpdater(f.deps).start();
    const labels = (menu) => menu.items.map((i) => i.label || i.type || i.role);
    const where = process.platform === 'darwin' ? f.top.submenu : f.help.submenu;
    assert.ok(labels(where).includes('Check for Updates...'), labels(where).join());
    const auto = where.items.find((i) => i.label === 'Check for Updates Automatically');
    assert.equal(auto.type, 'checkbox');
    assert.equal(auto.enabled, false, 'switched off while updates are disabled');
});
