#!/usr/bin/env node
/**
 * The Gene Set Analysis panel in the desktop app: no external request
 * without consent, and a failure that is said as what it is.
 *
 *   node test/gene-set-consent.js <app executable | electron app dir> <dataset .zarr> [report.json]
 *
 * Given a directory (this one, annzarro/desktop/electron), the app runs from
 * source with node_modules' Electron and the checkout's Python
 * (ANNZARRO_PYTHON); given an executable, the built app runs. Every request
 * the window makes that is not to the app's own 127.0.0.1 server is
 * cancelled and recorded in the main process (session.webRequest), so
 * nothing reaches the network.
 *
 * The session: open the dataset with a gene table and the panel; Run, then
 * Cancel at the consent prompt: nothing may have left. Run again and Send:
 * the requests go out (and are cancelled by the guard), and each section
 * must say it could not connect, with Retry, and must not call it "not
 * found" or blame the species.
 */
const { _electron: electron } = require('playwright-core');
const fs = require('fs');
const os = require('os');
const path = require('path');

const STEP_TIMEOUT = 120000;

async function main() {
    setTimeout(() => { console.error('gene set consent test timed out'); process.exit(1); }, 600000).unref();
    const [target, dataset, reportPath] = process.argv.slice(2);
    if (!target || !dataset) {
        console.error('usage: gene-set-consent.js <app executable | electron app dir> <dataset> [report.json]');
        process.exit(2);
    }
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'annzarro-geneset-'));
    const dataDir = path.join(tmp, 'data');
    fs.mkdirSync(path.join(dataDir, 'datasets'), { recursive: true });
    const datasetPath = path.join(dataDir, 'datasets', path.basename(dataset));
    fs.cpSync(path.resolve(dataset), datasetPath, { recursive: true });

    const env = { ...process.env, ANNZARRO_DESKTOP_DATA_DIR: dataDir, ANNZARRO_DESKTOP_USER_DATA: path.join(tmp, 'profile') };
    const fromSource = fs.statSync(target).isDirectory();
    const app = await electron.launch(fromSource
        ? { args: [path.resolve(target)], env }
        : { executablePath: path.resolve(target), args: process.platform === 'linux' ? ['--no-sandbox'] : [], env });
    const t0 = Date.now();
    const log = (msg) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`);

    await app.evaluate(({ session }) => {
        global.__external = [];
        const isLocal = (url) => /^(https?|wss?):\/\/127\.0\.0\.1(:\d+)?\//.test(url)
            || /^(file|data|blob|devtools|chrome|chrome-extension):/.test(url);
        session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
            if (isLocal(details.url)) return callback({});
            global.__external.push(details.url);
            callback({ cancel: true });
        });
    });
    const external = () => app.evaluate(() => global.__external.slice());

    const win = await app.firstWindow();
    const pageErrors = [];
    win.on('pageerror', (err) => pageErrors.push(String(err)));
    win.setDefaultTimeout(STEP_TIMEOUT);
    await win.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//);
    const base = new URL(win.url()).origin;
    log(`UI loaded from ${base}`);

    const cfgs = {
        'gene-table-A': { id: 'gene-table-A', title: 'Gene Table 1', searchText: 'GENE00',
            columns: [{ type: 'var', key: 'gene_name', column: '' }] },
        'gene-set-G': { id: 'gene-set-G', title: 'Gene Set Analysis 1', tableFilter: 'gene-table-A' }
    };
    const view = { v: 1, constants: { focusedGene: 'GENE003', taxonomyId: '9606' },
        layout: { v: 1, hierarchy: [{ type: 'split', direction: 'horizontal', height: 1000,
            panes: [{ percentage: 35 }, { percentage: 65 }],
            children: [{ type: 'tile', id: 'gene-table-A' }, { type: 'tile', id: 'gene-set-G' }] }],
        controlState: {}, panelConfigs: cfgs } };
    const enc = Buffer.from(JSON.stringify(view)).toString('base64url');
    await win.goto(`${base}/?dataset_path=${encodeURIComponent(datasetPath)}#view=${enc}`);
    const GS = '.tile[data-tile-id="gene-set-G"]';
    await win.waitForFunction(() => {
        const p = window.PanelManager && window.PanelManager.getPanel('gene-set-G');
        return p && p._debugState().source.status === 'open' && p._debugState().source.count > 0;
    });
    await win.waitForTimeout(1500);
    const opened = await external();
    log(`panel open: ${opened.length} external requests`);

    // Run, then Cancel at the prompt
    await win.click(`${GS} .gs-run`);
    await win.waitForSelector(`${GS} .gs-consent:not([hidden])`);
    const prompt = (await win.innerText(`${GS} .gs-consent`)).replace(/\s+/g, ' ');
    await win.click(`${GS} .gs-consent button:has-text('Cancel')`);
    await win.waitForTimeout(1500);
    const cancelled = await external();
    log(`cancelled at the prompt: ${cancelled.length} external requests`);

    // Run and Send: the guard cancels every request, as no network would
    await win.click(`${GS} .gs-run`);
    await win.waitForSelector(`${GS} .gs-consent:not([hidden])`);
    await win.click(`${GS} .gs-consent button:has-text('Send')`);
    await win.waitForFunction(() => {
        const r = window.PanelManager.getPanel('gene-set-G')._debugState().runs;
        return ['string-enrichment', 'gprofiler-gost', 'mygene-card'].every(id => r[id] && r[id].status === 'error');
    }, null, { timeout: 90000 });
    const runs = await win.evaluate(() => window.PanelManager.getPanel('gene-set-G')._debugState().runs);
    const sections = {};
    for (const id of ['string-enrichment', 'gprofiler-gost', 'mygene-card']) {
        const text = (await win.innerText(`${GS} .gs-section[data-section="${id}"]`)).replace(/\s+/g, ' ');
        const retry = await win.locator(`${GS} .gs-section[data-section="${id}"] .gs-placeholder-do button:has-text("Retry")`).count();
        sections[id] = { kind: runs[id].error.kind, text, retry };
        log(`${id}: ${runs[id].error.kind}: ${runs[id].error.message}`);
    }
    const sent = await external();
    await app.close();
    fs.rmSync(tmp, { recursive: true, force: true });

    const problems = [];
    if (opened.length) problems.push(`opening the panel made external requests: ${opened.join(', ')}`);
    if (cancelled.length) problems.push(`cancelling consent still sent: ${cancelled.join(', ')}`);
    if (!/Send these to the services below/.test(prompt)) problems.push(`no consent prompt: ${prompt}`);
    if (!sent.length) problems.push('Send made no request');
    for (const [id, s] of Object.entries(sections)) {
        if (s.kind !== 'unreachable') problems.push(`${id}: kind ${s.kind}, not unreachable`);
        if (!/could not connect to/.test(s.text)) problems.push(`${id}: does not say it could not connect: ${s.text}`);
        if (/not found|knows none|is the species right/i.test(s.text)) problems.push(`${id}: says "not found": ${s.text}`);
        if (s.retry !== 1) problems.push(`${id}: no Retry`);
    }
    if (pageErrors.length) problems.push(`page errors: ${pageErrors.join('; ')}`);
    const report = { opened, cancelled, sentHosts: [...new Set(sent.map(u => new URL(u).host))].sort(), sections, problems };
    if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`sent after consent to: ${report.sentHosts.join(', ')}`);
    for (const p of problems) console.log(`  PROBLEM ${p}`);
    console.log(problems.length ? 'gene set consent test FAILED' : 'gene set consent test passed');
    process.exit(problems.length ? 1 : 0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
