/**
 * The last sessions (static/js/utils/last-sessions.js): which ones are
 * listed and in what order, how the history keeps them (one per page and
 * per view, at most three, within the storage budget), when a page restores
 * the autosave by itself, and how a restore marker left by a page that is
 * gone marks its session "did not finish loading".
 *
 * Run:  node --test annzarro/tests/js/last-sessions.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const {
    autoRestoreMode, shouldAutoRestore, navigationType, cameFromOwnPage, sessionFingerprint, pushHistory, trimHistory, lastSessionList,
    unfinishedReason, deadMarker, linkDidNotFinish, withDefaultSubset, sessionLabel, sessionSummary, unfinishedText,
    panelCount, hashString, MAX_SESSIONS, MAX_ENTRY_CHARS, MARKER_LIVE_MS
} = await import('../../../static/js/utils/last-sessions.js');

/** An autosave as session-manager.js writes it: `page` wrote it at minute `min` of the day. */
function session(page, min, { dataset = '/data/a.zarr', tiles = ['cell-plot-1'], subset } = {}) {
    const hierarchy = tiles.length === 1 ? [{ type: 'tile', id: tiles[0] }]
        : [{ type: 'split', children: tiles.map(id => ({ type: 'tile', id })) }];
    const view = { v: 1, layout: { v: 1, hierarchy, panelConfigs: Object.fromEntries(tiles.map(id => [id, { id }])) }, annzarro: '0.6.0' };
    if (subset !== undefined) view.subset = subset;
    return {
        name: 'Autosave', isAutosave: true, page, dataset,
        timestamp: new Date(2026, 9, 17, 14, min).toISOString(),
        panelConfigs: Object.fromEntries(tiles.map(id => [id, { id, type: 'cell-plot', config: { id } }])),
        view
    };
}

test('auto_restore: reload by default; true and false are always and never; anything else is reload', () => {
    assert.equal(autoRestoreMode(undefined), 'reload');
    assert.equal(autoRestoreMode(null), 'reload');
    assert.equal(autoRestoreMode(true), 'always');
    assert.equal(autoRestoreMode(false), 'never');
    assert.equal(autoRestoreMode('ALWAYS'), 'always');
    assert.equal(autoRestoreMode(' never '), 'never');
    assert.equal(autoRestoreMode('sometimes'), 'reload');
});

test('a fresh visit restores only under always; a reload or Back/Forward under reload too; never and unfinished never', () => {
    const cases = [
        ['reload', 'navigate', false], ['reload', 'reload', true], ['reload', 'back_forward', true], ['reload', 'prerender', false],
        ['always', 'navigate', true], ['always', 'reload', true],
        ['never', 'navigate', false], ['never', 'reload', false]
    ];
    for (const [mode, navigation, expected] of cases) {
        assert.equal(shouldAutoRestore({ mode, navigation }), expected, `${mode} / ${navigation}`);
    }
    for (const mode of ['reload', 'always']) {
        assert.equal(shouldAutoRestore({ mode, navigation: 'reload', unfinished: true }), false, mode);
    }
});

test('navigationType reads the navigation entry, the older interface, or says navigate', () => {
    assert.equal(navigationType({ getEntriesByType: () => [{ type: 'reload' }] }), 'reload');
    assert.equal(navigationType({ getEntriesByType: () => [], navigation: { type: 1 } }), 'reload');
    assert.equal(navigationType({ getEntriesByType: () => [], navigation: { type: 2 } }), 'back_forward');
    assert.equal(navigationType({ getEntriesByType: () => [] }), 'navigate');
    assert.equal(navigationType(undefined), 'navigate');
    assert.equal(navigationType({ getEntriesByType: () => { throw new Error('no'); } }), 'navigate');
});

test('cameFromOwnPage knows the admin and account pages of this server, under a mount point too', () => {
    const o = 'http://h:1';
    assert.equal(cameFromOwnPage(`${o}/admin`, o), true);
    assert.equal(cameFromOwnPage(`${o}/admin#data`, o), true);
    assert.equal(cameFromOwnPage(`${o}/account/password`, o), true);
    assert.equal(cameFromOwnPage(`${o}/x/admin`, o, '/x'), true);
    assert.equal(cameFromOwnPage(`${o}/admin`, o, '/x'), false);
    assert.equal(cameFromOwnPage(`${o}/administrator`, o), false);
    assert.equal(cameFromOwnPage('http://other/admin', o), false);
    assert.equal(cameFromOwnPage(`${o}/`, o), false);
    assert.equal(cameFromOwnPage('', o), false);
});

test('the fingerprint is the view and dataset, not the page, the time or the version', () => {
    const a = session('p1', 10), b = session('p2', 20);
    b.view.annzarro = '0.7.0';
    assert.equal(sessionFingerprint(a), sessionFingerprint(b));
    assert.notEqual(sessionFingerprint(a), sessionFingerprint(session('p3', 30, { dataset: '/data/b.zarr' })));
    assert.notEqual(sessionFingerprint(a), sessionFingerprint(session('p3', 30, { subset: null })));
    assert.notEqual(sessionFingerprint(a), sessionFingerprint(session('p3', 30, { tiles: ['cell-plot-1', 'cell-plot-2'] })));
    assert.equal(hashString('x'), hashString('x'));
    assert.match(hashString(''), /^[0-9a-f]{8}$/);
});

test('the history keeps the newest first, one per page and one per view, at most three', () => {
    let h = [];
    h = pushHistory(h, session('p1', 1, { dataset: '/d/1.zarr' }));
    h = pushHistory(h, session('p2', 2, { dataset: '/d/2.zarr' }));
    h = pushHistory(h, session('p3', 3, { dataset: '/d/3.zarr' }));
    h = pushHistory(h, session('p4', 4, { dataset: '/d/4.zarr' }));
    assert.deepEqual(h.map(s => s.page), ['p4', 'p3', 'p2']);
    assert.equal(h.length, MAX_SESSIONS);
    // the same page again: its newer state replaces its older one
    h = pushHistory(h, session('p3', 5, { dataset: '/d/3b.zarr' }));
    assert.deepEqual(h.map(s => s.page), ['p3', 'p4', 'p2']);
    // the same view from another page (a reload that restored it): kept once
    h = pushHistory(h, session('p5', 6, { dataset: '/d/4.zarr' }));
    assert.deepEqual(h.map(s => s.page), ['p5', 'p3', 'p2']);
});

test('the history skips sessions without panels or too large, and fits the storage budget', () => {
    const empty = session('p1', 1, { tiles: [] });
    assert.equal(panelCount(empty), 0);
    assert.deepEqual(pushHistory([], empty), []);
    const big = session('p2', 2);
    big.view.layout.panelConfigs['cell-plot-1'].blob = 'x'.repeat(MAX_ENTRY_CHARS);
    assert.deepEqual(pushHistory([], big), []);
    const h = [session('p1', 1), session('p2', 2, { dataset: '/d/2.zarr' }), session('p3', 3, { dataset: '/d/3.zarr' })];
    const one = JSON.stringify([h[2]]).length;
    assert.deepEqual(trimHistory(h, { maxChars: one + 10 }).map(s => s.page), ['p3']);
    assert.deepEqual(trimHistory(h, { maxChars: 10 }), []);
});

test('the list: newest first, the autosave this page wrote left out with its view, one per page and view, at most three', () => {
    const autosave = session('older-page', 50, { dataset: '/d/now.zarr' });
    const history = [session('p1', 40, { dataset: '/d/1.zarr' }), session('p2', 45, { dataset: '/d/2.zarr' }),
        session('p3', 30, { dataset: '/d/3.zarr' }), session('p4', 20, { dataset: '/d/4.zarr' })];
    const list = lastSessionList({ autosave, history, page: 'this-page' });
    assert.deepEqual(list.map(e => e.key), ['older-page', 'p2', 'p1']);
    assert.deepEqual(list.map(e => e.dataset), ['now.zarr', '2.zarr', '1.zarr']);
    assert.equal(list[0].panels, 1);
    // what this page has open is not offered, nor an earlier session of the same view
    const mine = { ...session('this-page', 55, { dataset: '/d/1.zarr' }) };
    const list2 = lastSessionList({ autosave: mine, history, page: 'this-page' });
    assert.deepEqual(list2.map(e => e.key), ['p2', 'p3', 'p4']);
    // duplicates of one view in the history: the newest is listed
    const dup = lastSessionList({ autosave: null, history: [session('a', 1), session('b', 2)], page: 'x' });
    assert.deepEqual(dup.map(e => e.key), ['b']);
    // a session saved before pages had ids is listed as "autosave"
    const legacy = session(undefined, 5);
    delete legacy.page;
    assert.equal(lastSessionList({ autosave: legacy, history: [], page: 'x' })[0].key, 'autosave');
});

test('a session did not finish when it says so, or a marker or crash marker of its page says so', () => {
    const s = session('p1', 1);
    assert.equal(unfinishedReason(s), null);
    assert.deepEqual(unfinishedReason(s, { page: 'p1' }), { reason: 'ended' });
    assert.deepEqual(unfinishedReason(s, { page: 'p1', failed: ['cell-plot-3'] }), { reason: 'memory' });
    assert.deepEqual(unfinishedReason(s, null, { page: 'p1', panel: 'cell-plot-1' }), { reason: 'ended' });
    assert.equal(unfinishedReason(s, { page: 'p2' }, { page: 'p3' }), null);
    assert.deepEqual(unfinishedReason({ ...s, unfinished: { reason: 'memory' } }), { reason: 'memory' });
    const list = lastSessionList({ autosave: s, history: [], page: 'x', marker: { page: 'p1' } });
    assert.deepEqual(list[0].unfinished, { reason: 'ended' });
});

test('a marker is dead when its tab reloaded, or its page stopped refreshing it; this page\'s own never', () => {
    const now = 1e12;
    const fresh = { page: 'p1', beat: now - 1000 };
    assert.equal(deadMarker(fresh, { page: 'p9', now }), null, 'another tab still at it');
    assert.equal(deadMarker(fresh, { page: 'p9', previousPage: 'p1', now }), fresh, 'this tab reloaded');
    const stale = { page: 'p1', beat: now - MARKER_LIVE_MS - 1 };
    assert.equal(deadMarker(stale, { page: 'p9', now }), stale);
    assert.equal(deadMarker({ page: 'p1', at: now - MARKER_LIVE_MS - 1 }, { page: 'p9', now }).page, 'p1');
    assert.equal(deadMarker(stale, { page: 'p1', now }), null, "this page's own");
    assert.equal(deadMarker(null, { page: 'p9' }), null);
    assert.equal(deadMarker({ at: 1 }, { page: 'p9' }), null);
});

test('a link is held back when this tab\'s previous page or a page on the same link did not finish it', () => {
    const marker = { page: 'p1', link: hashString('#view=abc') };
    assert.equal(linkDidNotFinish(marker, { previousPage: 'p1', linkHash: hashString('#view=other') }), true);
    assert.equal(linkDidNotFinish(marker, { previousPage: 'p2', linkHash: hashString('#view=abc') }), true);
    assert.equal(linkDidNotFinish(marker, { previousPage: 'p2', linkHash: hashString('#view=other') }), false);
    assert.equal(linkDidNotFinish(null, { previousPage: 'p1', linkHash: 'x' }), false);
});

test('with the default subset: the saved subset is dropped, nothing else, and the original is untouched', () => {
    const s = session('p1', 1, { subset: null });
    const d = withDefaultSubset(s);
    assert.equal('subset' in d.view, false);
    assert.equal('subset' in s.view, true);
    assert.deepEqual(d.view.layout, s.view.layout);
    assert.equal(d.dataset, s.dataset);
});

test('the words: label by time (and date on another day), dataset and panels, why it did not finish', () => {
    const today = new Date(2026, 9, 17, 18, 0);
    const e = { savedAt: new Date(2026, 9, 17, 14, 32).getTime(), dataset: 'tahoe_95.6M.zarr', panels: 4 };
    assert.equal(sessionLabel(e, 0, today), 'Last session (autosaved 14:32)');
    assert.equal(sessionLabel(e, 1, today), 'Earlier session (autosaved 14:32)');
    assert.equal(sessionLabel({ ...e, savedAt: new Date(2026, 9, 12, 9, 5).getTime() }, 2, today),
        'Earlier session (autosaved 12 Oct, 09:05)');
    assert.equal(sessionLabel({ ...e, savedAt: new Date(2025, 0, 2, 9, 5).getTime() }, 0, today),
        'Last session (autosaved 2 Jan 2025, 09:05)');
    assert.equal(sessionSummary(e), 'tahoe_95.6M.zarr, 4 panels');
    assert.equal(sessionSummary({ dataset: '', panels: 1 }), '1 panel');
    assert.match(unfinishedText({ reason: 'ended' }), /^Did not finish loading: the tab ended .*default subset/);
    assert.match(unfinishedText({ reason: 'memory' }), /ran out of browser memory/);
    assert.equal(unfinishedText(null), '');
});
