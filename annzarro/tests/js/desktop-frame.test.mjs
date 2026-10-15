import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { cssColorToHex, overlayColors, startDesktopFrame } from '../../../static/js/utils/desktop-frame.js';
import { THEME_EVENT } from '../../../static/js/utils/theme.js';

const chrome = createRequire(import.meta.url)('../../desktop/electron/window-chrome.js');

test('only macOS and Windows lose the native frame', () => {
    assert.equal(chrome.frameFlag('darwin'), 'mac');
    assert.equal(chrome.frameFlag('win32'), 'win');
    assert.equal(chrome.frameFlag('linux'), null);
    assert.equal(chrome.frameFlag('freebsd'), null);
    assert.deepEqual(chrome.frameOptions('linux', false), {});
    assert.deepEqual(chrome.frameArguments('linux'), []);
    assert.deepEqual(chrome.frameArguments('darwin'), ['--annzarro-frame=mac']);
    assert.deepEqual(chrome.frameArguments('win32'), ['--annzarro-frame=win']);
});

test('macOS: traffic lights above the title, no title bar', () => {
    const o = chrome.frameOptions('darwin', false);
    assert.equal(o.titleBarStyle, 'hidden');
    assert.ok(o.trafficLightPosition.x > 0);
    // the lights (about 16 px tall) end where the page says they do; the title starts below that
    assert.ok(o.trafficLightPosition.y + 16 <= chrome.MAC_LIGHTS_BOTTOM_PX);
    assert.equal(o.titleBarOverlay, undefined);
});

test('Windows: overlay in the page colours, light and dark', () => {
    const light = chrome.frameOptions('win32', false);
    const dark = chrome.frameOptions('win32', true);
    assert.equal(light.titleBarStyle, 'hidden');
    assert.equal(light.titleBarOverlay.height, chrome.WIN_OVERLAY_HEIGHT_PX);
    assert.notEqual(light.titleBarOverlay.color, dark.titleBarOverlay.color);
    for (const o of [light, dark]) {
        assert.ok(chrome.sanitizeOverlay(o.titleBarOverlay), 'valid colours');
    }
});

test('the page may only send #rgb / #rrggbb colours for the overlay', () => {
    assert.equal(chrome.sanitizeColor('#ABC'), '#aabbcc');
    assert.equal(chrome.sanitizeColor(' #23282d '), '#23282d');
    for (const bad of ['red', 'rgb(1,2,3)', '#12', '#12345g', '', null, undefined, 5, '#1234567']) {
        assert.equal(chrome.sanitizeColor(bad), null, String(bad));
    }
    assert.deepEqual(chrome.sanitizeOverlay({ color: '#fff', symbolColor: '#000000' }), { color: '#ffffff', symbolColor: '#000000' });
    assert.equal(chrome.sanitizeOverlay({ color: '#fff' }), null);
    assert.equal(chrome.sanitizeOverlay(null), null);
});

test('computed colours become #rrggbb, transparent ones are refused', () => {
    assert.equal(cssColorToHex('rgb(248, 249, 250)'), '#f8f9fa');
    assert.equal(cssColorToHex('rgba(35, 40, 45, 1)'), '#23282d');
    assert.equal(cssColorToHex('rgb(0 0 0 / 100%)'), '#000000');
    assert.equal(cssColorToHex('rgba(0, 0, 0, 0)'), null);
    assert.equal(cssColorToHex('rgba(1, 2, 3, 0.5)'), null);
    assert.equal(cssColorToHex('rgb(300, 0, 0)'), null);
    assert.equal(cssColorToHex('color(srgb 1 0 0)'), null);
    assert.deepEqual(overlayColors({ backgroundColor: 'rgb(248, 249, 250)', color: 'rgb(33, 37, 41)' }),
        { color: '#f8f9fa', symbolColor: '#212529' });
    assert.equal(overlayColors({ backgroundColor: 'rgba(0, 0, 0, 0)', color: 'rgb(33, 37, 41)' }), null);
});

function fakeWindow({ frame, api = true }) {
    const listeners = {};
    const sent = [];
    let header = { backgroundColor: 'rgb(248, 249, 250)', color: 'rgb(33, 37, 41)' };
    const win = {
        document: {
            documentElement: { getAttribute: (n) => (n === 'data-desktop-frame' ? frame : null) },
            getElementById: (id) => (id === 'app-header' ? {} : null),
        },
        api: api ? { setTitleBarOverlay: (c) => sent.push(c) } : undefined,
        getComputedStyle: () => header,
        addEventListener: (type, fn) => { listeners[type] = fn; },
        requestAnimationFrame: (fn) => fn(),
    };
    return { win, sent, listeners, setHeader: (h) => { header = h; } };
}

test('Windows follows the header colours on theme changes; other frames do nothing', () => {
    const w = fakeWindow({ frame: 'win' });
    assert.equal(startDesktopFrame(w.win), true);
    assert.deepEqual(w.sent, [{ color: '#f8f9fa', symbolColor: '#212529' }]);
    w.setHeader({ backgroundColor: 'rgb(35, 40, 45)', color: 'rgb(230, 233, 236)' });
    w.listeners[THEME_EVENT]();
    assert.deepEqual(w.sent[1], { color: '#23282d', symbolColor: '#e6e9ec' });

    for (const frame of ['mac', null]) {
        const o = fakeWindow({ frame });
        assert.equal(startDesktopFrame(o.win), false);
        assert.deepEqual(o.sent, []);
    }
    assert.equal(startDesktopFrame(fakeWindow({ frame: 'win', api: false }).win), false, 'a browser has no api');
});
