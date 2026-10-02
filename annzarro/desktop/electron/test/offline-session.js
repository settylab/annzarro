#!/usr/bin/env node
/**
 * Drive a built AnnZarro app through a full session with the network cut off.
 *
 *   node test/offline-session.js <app executable> <dataset .zarr/.h5ad> [report.json]
 *
 * Every request the window makes that is not to the app's own 127.0.0.1
 * server is cancelled and recorded (in the main process, with
 * session.webRequest, so nothing reaches the network), as is every local
 * request that fails, answers 5xx, or answers 4xx for a page or asset (a 4xx
 * from the API is an answer, e.g. no stored colours). The session: open the dataset,
 * open a cell plot, focus a gene and a cell, open a cell table, export the
 * plot as PNG. The test fails on any external request, any failed local
 * request, any page error, or a PNG that is not written.
 *
 * Uses playwright-core's Electron driver: no browser download, the app's own
 * Chromium runs the UI. On Linux CI, run under xvfb-run.
 */
const { _electron: electron } = require('playwright-core');
const fs = require('fs');
const os = require('os');
const path = require('path');

const STEP_TIMEOUT = 120000;

async function main() {
    // A native dialog (e.g. an unexpected save prompt) would block forever.
    setTimeout(() => { console.error('offline session test timed out'); process.exit(1); }, 600000).unref();
    const [exe, dataset, reportPath] = process.argv.slice(2);
    if (!exe || !dataset) {
        console.error('usage: offline-session.js <app executable> <dataset> [report.json]');
        process.exit(2);
    }
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'annzarro-offline-'));
    const dataDir = path.join(tmp, 'data');
    fs.mkdirSync(path.join(dataDir, 'datasets'), { recursive: true });
    const downloads = path.join(tmp, 'downloads');
    fs.mkdirSync(downloads);
    const datasetPath = path.resolve(dataset);

    const args = process.platform === 'linux' ? ['--no-sandbox'] : [];
    const app = await electron.launch({
        executablePath: path.resolve(exe),
        args,
        env: { ...process.env, ANNZARRO_DESKTOP_DATA_DIR: dataDir },
    });
    const t0 = Date.now();
    const log = (msg) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`);

    // Network guard, installed before the window loads anything from the server.
    await app.evaluate(({ session }, downloadsDir) => {
        const ses = session.defaultSession;
        global.__requests = { local: [], blocked: [], failed: [], ok: [] };
        const isLocal = (url) => /^(https?|wss?):\/\/127\.0\.0\.1(:\d+)?\//.test(url)
            || /^(file|data|blob|devtools|chrome|chrome-extension):/.test(url);
        ses.webRequest.onBeforeRequest((details, callback) => {
            if (isLocal(details.url)) {
                global.__requests.local.push({ url: details.url, type: details.resourceType });
                callback({});
            } else {
                global.__requests.blocked.push({ url: details.url, type: details.resourceType });
                callback({ cancel: true });
            }
        });
        ses.webRequest.onCompleted((details) => {
            if (!isLocal(details.url)) return;
            // A 4xx from the API is an answer (e.g. 404 for a dataset without
            // stored colours); a 4xx for a page or asset is a missing file.
            const api = new URL(details.url).pathname.startsWith('/api/');
            if (details.statusCode >= 500 || (details.statusCode >= 400 && !api)) {
                global.__requests.failed.push({ url: details.url, status: details.statusCode });
            } else {
                global.__requests.ok.push(details.url);
            }
        });
        ses.webRequest.onErrorOccurred((details) => {
            if (isLocal(details.url) && details.error !== 'net::ERR_ABORTED') {
                global.__requests.failed.push({ url: details.url, error: details.error });
            }
        });
        ses.on('will-download', (event, item) => {
            // (no require() in this context)
            const sep = process.platform === 'win32' ? '\\' : '/';
            item.setSavePath(downloadsDir + sep + item.getFilename());
        });
    }, downloads);

    const win = await app.firstWindow();
    process.on('unhandledRejection', () => {});
    global.__shot = async () => {
        if (process.env.OFFLINE_TEST_SCREENSHOT) await win.screenshot({ path: process.env.OFFLINE_TEST_SCREENSHOT });
    };
    const pageErrors = [];
    win.on('pageerror', (err) => pageErrors.push(String(err)));
    win.setDefaultTimeout(STEP_TIMEOUT);

    await win.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//);
    const base = new URL(win.url()).origin;
    log(`UI loaded from ${base}`);

    // Control: the guard must catch an external request. The page tries one
    // CDN fetch; it has to be cancelled and recorded, then is set aside.
    const probe = 'https://cdn.jsdelivr.net/npm/plotly.js-dist-min/plotly.min.js';
    const probeReached = await win.evaluate((u) => fetch(u).then(() => true, () => false), probe);
    const caught = await app.evaluate((_, u) => {
        const hit = global.__requests.blocked.some(r => r.url === u);
        global.__requests.blocked = global.__requests.blocked.filter(r => r.url !== u);
        return hit;
    }, probe);
    if (probeReached || !caught) {
        throw new Error(`network guard did not stop ${probe} (reached=${probeReached}, recorded=${caught})`);
    }
    log('network guard verified: an external fetch was cancelled and recorded');

    // 1. Open the dataset (as a share link / the dataset picker would).
    await win.goto(`${base}/?dataset_path=${encodeURIComponent(datasetPath)}`);
    await win.waitForFunction(() => /Cells:\s*[1-9]/.test(document.body.innerText));
    log(`dataset open: ${(await win.evaluate(() => document.body.innerText.match(/Cells:\s*[\d,]+/)[0]))}`);

    // 2. Cell plot.
    await win.getByText('Cell Plot', { exact: true }).first().click();
    await win.waitForSelector('.js-plotly-plot .main-svg');
    log('cell plot rendered');

    // 3. Focus a gene and a cell through their typeahead pickers.
    const pick = async (inputId, kind, index) => {
        const names = await win.evaluate(async ([k, ds]) => {
            const r = await fetch(`/api/v1/data/${k}?dataset_path=${encodeURIComponent(ds)}`);
            const body = await r.json();
            return body[k] || body;
        }, [kind, datasetPath]);
        const value = names[Math.min(index, names.length - 1)];
        const input = win.locator(`#${inputId}`);
        await input.click();
        await input.fill(value);
        await win.locator('.name-picker-option', { hasText: value }).first().click();
        await win.waitForFunction(([id, v]) => document.getElementById(id).value === v, [inputId, value]);
        return value;
    };
    const gene = await pick('focused-gene', 'genes', 5);
    log(`focused gene ${gene}`);
    const cell = await pick('focused-cell', 'cells', 3);
    log(`focused cell ${cell}`);

    // 4. Split the tile and open a cell table in the new half.
    await win.locator('.tile-split-h').first().click();
    await win.getByText('Cell Table', { exact: true }).first().click();
    await win.waitForSelector('table.table-sm tbody tr td');
    log(`cell table rendered (${await win.locator('table.table-sm tbody tr td').count()} rows shown)`);

    // 5. Export the plot as PNG through its Plot Options menu.
    await win.locator('[id^="aesthetics-menu-btn-cell-plot"]').first().click();
    // The menu is a popover taller than the default window, so its PNG button
    // can sit below the fold where a pointer cannot reach it; click it in the page.
    const pngButton = win.locator('[id^="download-png-cell-plot"]').first();
    await pngButton.waitFor({ state: 'attached' });
    await pngButton.evaluate((el) => el.click());
    const deadline = Date.now() + STEP_TIMEOUT;
    let png = null;
    while (!png && Date.now() < deadline) {
        const done = fs.readdirSync(downloads).filter(f => f.endsWith('.png'));
        if (done.length) {
            const p = path.join(downloads, done[0]);
            const head = fs.readFileSync(p).subarray(0, 8);
            if (head.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) png = p;
        }
        if (!png) await new Promise(r => setTimeout(r, 250));
    }
    if (png) log(`PNG exported: ${path.basename(png)} (${fs.statSync(png).size} bytes)`);

    await win.waitForTimeout(1000);
    const requests = await app.evaluate(() => global.__requests);
    // Chromium reports a font fetch that a navigation interrupted as
    // ERR_CACHE_MISS; it is fetched again. Only a request that never
    // succeeded counts as missing.
    const succeeded = new Set(requests.ok);
    requests.failed = requests.failed.filter(r => r.status || !succeeded.has(r.url));
    await app.close();

    const assets = [...new Set(requests.local.map(r => new URL(r.url).pathname)
        .filter(p => p.startsWith('/static/') || p === '/'))].sort();
    const report = {
        dataset: datasetPath, gene, cell, png: Boolean(png),
        localRequests: requests.local.length, assets,
        blocked: requests.blocked, failed: requests.failed, pageErrors,
    };
    if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    log(`${requests.local.length} local requests, ${assets.length} distinct static assets, ` +
        `${requests.blocked.length} external (blocked), ${requests.failed.length} failed, ` +
        `${pageErrors.length} page errors`);
    for (const r of requests.blocked) console.log(`  EXTERNAL ${r.type} ${r.url}`);
    for (const r of requests.failed) console.log(`  FAILED ${r.status || r.error} ${r.url}`);
    for (const e of pageErrors) console.log(`  PAGE ERROR ${e}`);
    fs.rmSync(tmp, { recursive: true, force: true });

    const ok = png && !requests.blocked.length && !requests.failed.length && !pageErrors.length;
    console.log(ok ? 'offline session test passed' : 'offline session test FAILED');
    process.exit(ok ? 0 : 1);
}

main().catch(async (err) => {
    try { await global.__shot(); } catch (e) { /* window gone */ }
    console.error(String(err).split('\n').slice(0, 3).join('\n'));
    process.exit(1);
});
