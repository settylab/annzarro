import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const logic = createRequire(import.meta.url)('../../desktop/electron/dataset-open-logic.js');

function tree(spec) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'az-open-'));
    for (const [rel, content] of Object.entries(spec)) {
        const full = path.join(root, rel);
        if (content === null) {
            fs.mkdirSync(full, { recursive: true });
        } else {
            fs.mkdirSync(path.dirname(full), { recursive: true });
            fs.writeFileSync(full, content);
        }
    }
    return root;
}
const classify = (p) => logic.classifyPath(p, fs, path.join);

test('an .h5ad file, a zarr store and a plain folder are told apart', () => {
    const root = tree({
        'a.h5ad': 'x', 'A.H5AD': 'x', 'notes.txt': 'x', 'plain/readme': 'x',
        'named.zarr': null, 'v2/.zgroup': '{}', 'v2attrs/.zattrs': '{}', 'v3/zarr.json': '{}',
        'legacy/X/data': 'x', 'legacy2/obs/x': 'x',
    });
    const kind = (rel) => classify(path.join(root, rel)).kind;
    assert.equal(kind('a.h5ad'), 'h5ad');
    assert.equal(kind('A.H5AD'), 'h5ad', 'the extension is not case sensitive');
    assert.equal(kind('notes.txt'), 'other');
    assert.equal(kind('plain'), 'folder');
    assert.equal(kind('named.zarr'), 'zarr', 'a .zarr name is a store, as on the server');
    for (const rel of ['v2', 'v2attrs', 'v3', 'legacy', 'legacy2']) assert.equal(kind(rel), 'zarr', rel);
    assert.equal(kind('gone.h5ad'), 'missing');
    assert.equal(classify('').kind, 'missing');
    assert.equal(classify(undefined).kind, 'missing');
});

test('a folder named like a file is not an .h5ad file', () => {
    const root = tree({ 'dir.h5ad/inside': 'x' });
    assert.equal(classify(path.join(root, 'dir.h5ad')).kind, 'folder');
});

test('what cannot be opened is explained, what can is not', () => {
    assert.equal(logic.refusal({ kind: 'h5ad', path: '/x/a.h5ad' }), null);
    assert.equal(logic.refusal({ kind: 'zarr', path: '/x/a.zarr' }), null);
    assert.equal(logic.refusal({ kind: 'folder', path: '/x/plain' }), null, 'a folder is the dialog\'s to place or refuse');
    assert.match(logic.refusal({ kind: 'other', path: '/x/notes.txt' }), /notes\.txt is not a dataset\. AnnZarro opens \.zarr folders and \.h5ad files\./);
    assert.match(logic.refusal({ kind: 'missing', path: '/x/gone.zarr' }), /gone\.zarr does not exist/);
});

test('several items: the first is opened and the rest are mentioned', () => {
    assert.deepEqual(logic.pickOpenTarget(['/a', '/b', '/c']), { path: '/a', extra: 2 });
    assert.deepEqual(logic.pickOpenTarget(['/a']), { path: '/a', extra: 0 });
    assert.deepEqual(logic.pickOpenTarget([]), { path: null, extra: 0 });
    assert.deepEqual(logic.pickOpenTarget(['', null, '/b']), { path: '/b', extra: 0 });
    assert.equal(logic.extraNotice('/a/x.zarr', 0), null);
    assert.match(logic.extraNotice('/a/x.zarr', 1), /Opening x\.zarr\..*the other item was not opened/);
    assert.match(logic.extraNotice('/a/x.zarr', 3), /the other 3 items were not opened/);
});

test('the recent list is distinct, newest first, capped, and survives bad files', () => {
    let list = [];
    for (let i = 0; i < 12; i++) list = logic.addRecent(list, `/d/${i}.zarr`);
    assert.equal(list.length, logic.RECENT_CAP);
    assert.equal(list[0], '/d/11.zarr');
    assert.equal(list.at(-1), '/d/2.zarr');
    list = logic.addRecent(list, '/d/5.zarr');
    assert.equal(list[0], '/d/5.zarr');
    assert.equal(list.filter((p) => p === '/d/5.zarr').length, 1);
    assert.equal(logic.removeRecent(list, '/d/5.zarr').includes('/d/5.zarr'), false);
    assert.deepEqual(logic.addRecent(['/a'], ''), ['/a']);

    assert.deepEqual(logic.parseRecents(logic.serializeRecents(list)), list);
    for (const bad of ['', 'not json', '{"recent": 3}', 'null', '[1, null, {}]']) {
        assert.deepEqual(logic.parseRecents(bad), [], bad);
    }
    assert.deepEqual(logic.parseRecents('{"recent": ["/a", "/a", 3, "", "/b"]}'), ['/a', '/b']);
    assert.equal(logic.parseRecents(JSON.stringify({ recent: Array.from({ length: 30 }, (_, i) => `/p${i}`) })).length, logic.RECENT_CAP);
});

test('recent labels are names, or whole paths where names collide', () => {
    const labels = logic.recentLabels(['/a/x.zarr', '/b/x.zarr', '/c/y.h5ad']);
    assert.deepEqual(labels.map((l) => l.label), ['/a/x.zarr', '/b/x.zarr', 'y.h5ad']);
    assert.equal(logic.baseName('C:\\data\\x.zarr\\'), 'x.zarr');
});

test('launch arguments: paths only, not switches, the app path of a source run or URLs', () => {
    assert.deepEqual(logic.argvPaths(['/Applications/AnnZarro.app/Contents/MacOS/AnnZarro', '/d/x.zarr'], false), ['/d/x.zarr']);
    assert.deepEqual(logic.argvPaths(['electron', '.', '/d/x.zarr', '--inspect=0'], true), ['/d/x.zarr']);
    assert.deepEqual(logic.argvPaths(['electron', '.'], true), []);
    assert.deepEqual(logic.argvPaths(['AnnZarro.exe', '--no-sandbox', '-psn_0_1', 'C:\\d\\a.h5ad', 'https://x/y'], false), ['C:\\d\\a.h5ad']);
    assert.deepEqual(logic.argvPaths(undefined, false), []);
});

test('paths that arrive before the page is ready are held, then handed over once', () => {
    const flushed = [];
    const q = logic.createOpenQueue((paths) => flushed.push(paths));
    q.push('/a');
    q.push(['/b', '', null]);
    q.push([]);
    assert.equal(q.size, 2);
    assert.deepEqual(flushed, []);
    q.markReady();
    assert.deepEqual(flushed, [['/a', '/b']]);
    q.markReady();
    assert.equal(flushed.length, 1, 'nothing is handed over twice');
    q.push('/c');
    assert.deepEqual(flushed.at(-1), ['/c'], 'a ready page takes it at once');
    q.markBusy();
    q.push('/d');
    assert.equal(flushed.length, 2);
    q.markReady();
    assert.deepEqual(flushed.at(-1), ['/d']);
});

const labelsOf = (items) => items.filter((i) => i.label).map((i) => i.label);
const fileMenu = (platform, recents = []) =>
    logic.menuTemplate({ platform, recents }).find((i) => i.label === 'File').submenu;

test('the File menu has one dialog on macOS and one item per kind elsewhere', () => {
    const mac = fileMenu('darwin');
    assert.deepEqual(labelsOf(mac).slice(0, 2), ['Open Dataset...', 'Open File or Folder...']);
    assert.equal(mac[0].accelerator, 'CmdOrCtrl+O');
    assert.equal(mac[1].accelerator, 'CmdOrCtrl+Shift+O');
    assert.equal(mac[1].action, 'open-path');
    for (const platform of ['win32', 'linux']) {
        const items = fileMenu(platform);
        assert.deepEqual(labelsOf(items).slice(0, 3), ['Open Dataset...', 'Open .h5ad File...', 'Open .zarr Folder...'], platform);
        assert.equal(items.some((i) => i.action === 'open-path'), false);
        assert.equal(items.find((i) => i.action === 'open-h5ad').accelerator, 'CmdOrCtrl+Shift+O');
    }
    for (const platform of ['darwin', 'win32', 'linux']) {
        const items = fileMenu(platform);
        assert.ok(items.some((i) => i.label === 'Open Recent'), platform);
        assert.ok(items.some((i) => i.label === 'Refresh Dataset' && i.action === 'refresh'), platform);
    }
});

test('the File menu does not take the accelerators of the page', () => {
    // Load Panel Set is Cmd/Ctrl+Shift+L; the View menu owns Cmd/Ctrl+R (reload)
    for (const platform of ['darwin', 'win32', 'linux']) {
        const accelerators = fileMenu(platform).map((i) => i.accelerator).filter(Boolean);
        assert.deepEqual(new Set(accelerators).size, accelerators.length);
        for (const a of accelerators) assert.ok(!/\+L$|\+R$/.test(a), a);
    }
});

test('Open Recent lists the paths, says when there are none, and clears', () => {
    const empty = fileMenu('darwin').find((i) => i.label === 'Open Recent').submenu;
    assert.equal(empty[0].label, 'No Recent Datasets');
    assert.equal(empty[0].enabled, false);
    assert.equal(empty.find((i) => i.action === 'clear-recent').enabled, false);

    const sub = fileMenu('linux', ['/a/x.zarr', '/b/y.h5ad']).find((i) => i.label === 'Open Recent').submenu;
    const entries = sub.filter((i) => i.action === 'open-recent');
    assert.deepEqual(entries.map((i) => [i.label, i.path]), [['x.zarr', '/a/x.zarr'], ['y.h5ad', '/b/y.h5ad']]);
    assert.equal(sub.find((i) => i.action === 'clear-recent').enabled, true);
});

test('the menu keeps the standard menus and the platform\'s app menu', () => {
    const roles = (platform) => logic.menuTemplate({ platform, recents: [] }).map((i) => i.role || i.label);
    assert.deepEqual(roles('darwin'), ['appMenu', 'File', 'editMenu', 'viewMenu', 'windowMenu', 'help']);
    assert.deepEqual(roles('win32'), ['File', 'editMenu', 'viewMenu', 'windowMenu', 'help']);
    assert.equal(fileMenu('darwin').at(-1).role, 'close');
    assert.equal(fileMenu('win32').at(-1).role, 'quit');
});

test('dialogs: macOS shows one for a file or a folder, elsewhere never both', () => {
    const mac = logic.dialogOptions(undefined, 'darwin');
    assert.deepEqual(mac.properties, ['openFile', 'openDirectory']);
    assert.equal(mac.filters[0].extensions[0], 'h5ad');
    for (const platform of ['win32', 'linux']) {
        assert.deepEqual(logic.dialogOptions(undefined, platform).properties, ['openFile'], platform);
    }
    assert.deepEqual(logic.dialogOptions('zarr', 'win32').properties, ['openDirectory']);
    assert.deepEqual(logic.dialogOptions('h5ad', 'darwin').properties, ['openFile']);
});

test('only datasets are recorded as opened', () => {
    assert.equal(logic.isRecordable({ kind: 'zarr', path: '/a.zarr' }), true);
    assert.equal(logic.isRecordable({ kind: 'h5ad', path: '/a.h5ad' }), true);
    for (const kind of ['folder', 'other', 'missing']) assert.equal(logic.isRecordable({ kind, path: '/x' }), false, kind);
});

test('the notice for the page carries the message as data, never as code', async () => {
    const vm = await import('node:vm');
    const nasty = 'a "quote", a \\ backslash, `tick` ${1+1} </script>   and \'single\'';
    const run = (annzarro) => {
        const calls = [];
        const win = { annzarro: annzarro && { notify: (...a) => calls.push(a) } };
        const result = vm.runInNewContext(logic.notifyScript(nasty), { window: win });
        return { result, calls };
    };
    const withNotify = run(true);
    assert.equal(withNotify.result, true);
    assert.deepEqual(JSON.parse(JSON.stringify(withNotify.calls)), [[nasty, { level: 'warning' }]]);  // across vm realms
    assert.equal(run(false).result, false, 'a page without notify gets the message box');
    assert.equal(vm.runInNewContext(logic.notifyScript('x'), { window: { annzarro: { notify: 'no' } } }), false);
});
