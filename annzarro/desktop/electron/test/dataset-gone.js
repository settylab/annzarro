#!/usr/bin/env node
/**
 * Start the app again after the dataset it last showed was deleted.
 *
 *   node test/dataset-gone.js <app executable> <dataset .zarr to copy>
 *
 * 1. With a fresh profile, open a copy of the dataset and a cell plot; the
 *    app autosaves the layout and dataset.
 * 2. Delete the copy (as when a dataset is moved, deleted or on a disk that
 *    is no longer mounted) and start the app again with the same profile.
 * 3. Five seconds after the interface loads, nothing may still be spinning:
 *    the user must see why the panels are empty and be able to go on (the
 *    "Create New Panel" cards are there, a dataset can be chosen).
 *
 * This is how the app was found "scrolling in circles": the restored panel
 * showed "No dataset loaded" under a spinner that never stopped.
 */
const { _electron: electron } = require('playwright-core');
const fs = require('fs');
const os = require('os');
const path = require('path');

async function launch(exe, profile, dataDir) {
    const args = process.platform === 'linux' ? ['--no-sandbox'] : [];
    const app = await electron.launch({
        executablePath: path.resolve(exe), args,
        env: { ...process.env, ANNZARRO_DESKTOP_USER_DATA: profile, ANNZARRO_DESKTOP_DATA_DIR: dataDir },
    });
    const win = await app.firstWindow();
    win.setDefaultTimeout(120000);
    await win.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//);
    return { app, win };
}

async function main() {
    setTimeout(() => { console.error('dataset-gone test timed out'); process.exit(1); }, 400000).unref();
    const [exe, source] = process.argv.slice(2);
    if (!exe || !source) {
        console.error('usage: dataset-gone.js <app executable> <dataset to copy>');
        process.exit(2);
    }
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'annzarro-gone-'));
    const profile = path.join(tmp, 'profile');
    const dataDir = path.join(tmp, 'data');
    const copy = path.join(dataDir, 'datasets', 'vanishing.zarr');
    fs.mkdirSync(path.dirname(copy), { recursive: true });
    fs.cpSync(path.resolve(source), copy, { recursive: true });

    // 1. Open it, so the layout and dataset are autosaved.
    let { app, win } = await launch(exe, profile, dataDir);
    await win.goto(`${new URL(win.url()).origin}/?dataset_path=${encodeURIComponent(copy)}`);
    await win.waitForFunction(() => /Cells:\s*[1-9]/.test(document.body.innerText));
    await win.getByText('Cell Plot', { exact: true }).first().click();
    await win.waitForSelector('.js-plotly-plot .main-svg');
    await win.waitForTimeout(3000);
    await app.close();
    console.log('opened and autosaved', copy);

    // 2. The dataset disappears; start again.
    fs.rmSync(copy, { recursive: true, force: true });
    ({ app, win } = await launch(exe, profile, dataDir));
    console.log(`restarted at ${win.url()} with the dataset gone`);
    await win.waitForTimeout(5000);

    // 3. Nothing visible may still be spinning.
    const state = await win.evaluate(() => {
        const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        const spinning = [...document.querySelectorAll('*')].filter((el) => {
            if (!visible(el)) return false;
            const cs = getComputedStyle(el);
            return cs.animationName && cs.animationName !== 'none'
                && cs.animationIterationCount === 'infinite';
        }).map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`);
        return {
            spinning,
            text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 300),
            canAddPanel: [...document.querySelectorAll('*')].some(
                (el) => visible(el) && el.textContent.trim() === 'Cell Plot'),
        };
    });
    if (process.env.DATASET_GONE_SCREENSHOT) await win.screenshot({ path: process.env.DATASET_GONE_SCREENSHOT });
    await app.close();
    fs.rmSync(tmp, { recursive: true, force: true });

    console.log(`page: ${state.text}`);
    console.log(`endlessly animated elements: ${state.spinning.length ? state.spinning.join(', ') : 'none'}`);
    const ok = state.spinning.length === 0 && state.canAddPanel;
    console.log(ok ? 'dataset-gone test passed' : 'dataset-gone test FAILED');
    process.exit(ok ? 0 : 1);
}

main().catch((err) => {
    console.error(String(err).split('\n').slice(0, 3).join('\n'));
    process.exit(1);
});
