/**
 * The cell subset in the UI: the header's cell count and badge, and the
 * dialog that changes the subset (issue #7).
 *
 * The header always says how many cells are shown, of how many, and with
 * which seed; the badge opens the dialog. The dialog edits a spec
 * (utils/subset.js), previews what the server would select for it, and
 * hands the spec to `onApply`, which reloads the open view on those cells.
 */
import { Config } from './config.js';
import { DataManager } from './data-manager.js';
import { PanelManager } from './panel-manager.js';
import { getColumnKey } from './panels/table-utilities/table-data.js';
import {
    SUBSET_OPS, MAX_SEED, canonicalSubset, subsetParam, describeSubset,
    describeCondition, searchBuilderToWhere, describeParts, partSpec
} from './utils/subset.js';
import { escapeHtml } from './utils/session-permissions.js';

const fmt = (n) => Number(n).toLocaleString('en-US');

const SubsetControl = (function() {
    let _onApply = null;
    let _modal = null;
    let _el = null;            // modal root
    let _columns = [];         // [{name, type}] obs columns of the open dataset
    let _conditions = [];      // editor rows: {col, op, values|value}
    let _previewSeq = 0;
    let _previewTimer = null;

    /** Bind the header badge. `onApply(spec|null)` reloads the view. */
    function init({ onApply }) {
        _onApply = onApply;
        const button = document.getElementById('subset-button');
        if (button) button.addEventListener('click', open);
        const prev = document.getElementById('subset-part-prev');
        const next = document.getElementById('subset-part-next');
        const input = document.getElementById('subset-part-input');
        if (prev) prev.addEventListener('click', () => step(-1));
        if (next) next.addEventListener('click', () => step(1));
        if (input) {
            input.addEventListener('keydown', (e) => { if (e.key === 'Enter') goTo(Number(input.value) - 1); });
            input.addEventListener('change', () => goTo(Number(input.value) - 1));
        }
    }

    /** Show the part `delta` away (the ‹ › buttons). Same view, other cells. */
    function step(delta) {
        const info = DataManager.getSubset();
        const parts = describeParts(info);
        if (!parts) return;
        _goToSpec(partSpec(info, parts.part + delta));
    }

    /** Show part `part` (0-based; a typed number past the end shows the last). */
    function goTo(part) {
        _goToSpec(partSpec(DataManager.getSubset(), part, true));
        update();   // an unchanged or invalid entry snaps back to the current part
    }

    function _goToSpec(spec) {
        if (spec && _onApply) _onApply(spec, { step: true });
    }

    /** Refresh the header's cell count and badge from the DataManager. */
    function update() {
        const count = document.getElementById('cell-count');
        const button = document.getElementById('subset-button');
        const reply = DataManager.getSubsetReply();
        const text = describeSubset(DataManager.getSubset() || reply,
            reply ? reply.n_total : (DataManager.getCells() || []).length);
        if (count) {
            count.textContent = text.count;
            count.title = text.title;
        }
        if (button) {
            button.hidden = !DataManager.getCurrentDataset();
            button.textContent = text.badge;
            button.title = text.title;
            button.classList.toggle('subset-active', text.active);
        }
        const box = document.getElementById('subset-parts');
        const parts = describeParts(DataManager.getSubset());
        if (box) {
            box.hidden = !parts || !DataManager.getCurrentDataset();
            if (parts) {
                box.title = parts.title;
                const input = document.getElementById('subset-part-input');
                if (input) { input.value = String(parts.display); input.max = String(parts.parts); }
                const count = document.getElementById('subset-part-count');
                if (count) count.textContent = fmt(parts.parts);
                const prev = document.getElementById('subset-part-prev');
                const next = document.getElementById('subset-part-next');
                if (prev) prev.disabled = !parts.canPrev;
                if (next) next.disabled = !parts.canNext;
            }
        }
    }

    // -- dialog --------------------------------------------------------------

    function _build() {
        const el = document.createElement('div');
        el.className = 'modal fade';
        el.id = 'subset-modal';
        el.tabIndex = -1;
        el.setAttribute('aria-hidden', 'true');
        el.setAttribute('aria-labelledby', 'subset-modal-title');
        el.innerHTML = `
          <div class="modal-dialog modal-lg">
            <div class="modal-content">
              <div class="modal-header">
                <h5 class="modal-title" id="subset-modal-title">Cell subset</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
              </div>
              <div class="modal-body subset-dialog">
                <p class="text-muted small mb-2">Every panel, table and share link uses the same cells.
                  The same seed always selects the same cells, and more cells with the same seed
                  keeps every cell of fewer.</p>
                <p class="text-muted small mb-2">The subset is the first of several disjoint parts of
                  this size that together hold every cell; step through them with ‹ › next to the badge.</p>
                <div class="form-check form-switch mb-2">
                  <input class="form-check-input" type="checkbox" id="subset-enabled">
                  <label class="form-check-label" for="subset-enabled">Show a subset of the cells</label>
                </div>
                <div id="subset-fields">
                  <div class="row g-2 align-items-end mb-2">
                    <div class="col-sm-4">
                      <label class="form-label small mb-0" for="subset-n">Cells</label>
                      <input type="number" class="form-control form-control-sm" id="subset-n" min="1" step="1">
                      <div class="form-check small mt-1">
                        <input class="form-check-input" type="checkbox" id="subset-n-all">
                        <label class="form-check-label" for="subset-n-all">every cell passing the filter</label>
                      </div>
                    </div>
                    <div class="col-sm-4">
                      <label class="form-label small mb-0" for="subset-seed">Seed</label>
                      <div class="input-group input-group-sm">
                        <input type="number" class="form-control" id="subset-seed" min="0" max="${MAX_SEED}" step="1">
                        <button class="btn btn-outline-secondary" type="button" id="subset-new-seed" title="Draw another seed">New seed</button>
                      </div>
                    </div>
                    <div class="col-sm-4">
                      <label class="form-label small mb-0" for="subset-balance">Sampling</label>
                      <select class="form-select form-select-sm" id="subset-balance"></select>
                    </div>
                  </div>
                  <div class="mb-1 small fw-semibold">Filter (optional): only cells where</div>
                  <div id="subset-conditions" class="mb-1"></div>
                  <div class="d-flex flex-wrap gap-2 align-items-center mb-2">
                    <button type="button" class="btn btn-sm btn-outline-secondary" id="subset-add-condition">Add condition</button>
                    <span class="small text-muted">or use a cell table's filter:</span>
                    <select class="form-select form-select-sm w-auto" id="subset-table"></select>
                    <button type="button" class="btn btn-sm btn-outline-secondary" id="subset-import">Use filter</button>
                  </div>
                </div>
                <div id="subset-preview" class="subset-preview small" role="status" aria-live="polite"></div>
              </div>
              <div class="modal-footer">
                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                <button type="button" class="btn btn-primary" id="subset-apply">Apply</button>
              </div>
            </div>
          </div>`;
        document.body.appendChild(el);
        const q = (id) => el.querySelector(`#${id}`);
        q('subset-enabled').addEventListener('change', () => { _syncEnabled(); _schedulePreview(); });
        q('subset-n-all').addEventListener('change', () => { q('subset-n').disabled = q('subset-n-all').checked; _schedulePreview(); });
        ['subset-n', 'subset-seed', 'subset-balance'].forEach(id => q(id).addEventListener('input', _schedulePreview));
        q('subset-new-seed').addEventListener('click', () => {
            q('subset-seed').value = String(Math.floor(Math.random() * 100000));
            _schedulePreview();
        });
        q('subset-add-condition').addEventListener('click', () => {
            _conditions.push({ col: _columns[0] ? _columns[0].name : '', op: 'in', values: [] });
            _renderConditions();
        });
        q('subset-import').addEventListener('click', _importTableFilter);
        q('subset-apply').addEventListener('click', _apply);
        return el;
    }

    async function open() {
        const datasetPath = DataManager.getCurrentDataset();
        if (!datasetPath) return;
        if (!_el) _el = _build();
        if (!_modal) _modal = new bootstrap.Modal(_el);
        const q = (id) => _el.querySelector(`#${id}`);

        const reply = DataManager.getSubsetReply() || {};
        const defaults = reply.defaults || { size: 100000, seed: 0, threshold: 200000 };
        const current = DataManager.getSubset();
        const spec = current ? current.subset : null;
        const nTotal = reply.n_total || (DataManager.getCells() || []).length;

        const structure = await DataManager.getDatasetStructure(datasetPath);
        const info = (structure.obs && structure.obs.columns_info) || {};
        _columns = ((structure.obs && structure.obs.columns) || [])
            .filter(name => name !== '_index')
            .map(name => ({ name, type: (info[name] && info[name].type) || '' }));

        q('subset-enabled').checked = !!spec;
        q('subset-n').value = String(spec && spec.n !== null ? spec.n : Math.min(defaults.size, nTotal));
        q('subset-n').max = String(nTotal);
        q('subset-n-all').checked = !!spec && spec.n === null;
        q('subset-n').disabled = q('subset-n-all').checked;
        q('subset-seed').value = String(spec ? spec.seed : defaults.seed);

        const balance = q('subset-balance');
        balance.innerHTML = '<option value="">Uniform</option>' + _columns
            .filter(c => /categor|bool|str|object/i.test(c.type))
            .map(c => `<option value="${escapeHtml(c.name)}">Balanced across ${escapeHtml(c.name)}</option>`)
            .join('');
        balance.value = spec && spec.balance ? spec.balance : '';

        _conditions = spec && spec.where ? spec.where.map(c => ({ ...c })) : [];
        _renderConditions();
        _renderTables();
        _syncEnabled();
        _modal.show();
        _schedulePreview();
    }

    function _syncEnabled() {
        const on = _el.querySelector('#subset-enabled').checked;
        _el.querySelector('#subset-fields').classList.toggle('subset-disabled', !on);
        _el.querySelectorAll('#subset-fields input, #subset-fields select, #subset-fields button')
            .forEach(node => { node.disabled = !on || (node.id === 'subset-n' && _el.querySelector('#subset-n-all').checked); });
    }

    function _renderTables() {
        const select = _el.querySelector('#subset-table');
        const tables = PanelManager.getActivePanels().filter(p => p.getType && p.getType() === 'cell-table');
        select.innerHTML = tables.length
            ? tables.map(p => `<option value="${escapeHtml(p.getId())}">${escapeHtml(p.getTitle ? p.getTitle() : p.getId())}</option>`).join('')
            : '<option value="">no cell table open</option>';
        _el.querySelector('#subset-import').disabled = !tables.length;
    }

    function _renderConditions() {
        const box = _el.querySelector('#subset-conditions');
        box.innerHTML = '';
        _conditions.forEach((cond, i) => {
            const row = document.createElement('div');
            row.className = 'subset-condition d-flex flex-wrap gap-1 align-items-center mb-1';
            const opInfo = SUBSET_OPS.find(o => o.op === cond.op) || SUBSET_OPS[0];
            const value = opInfo.kind === 'text'
                ? `<input type="text" class="form-control form-control-sm subset-value" placeholder="values, comma separated"
                     value="${escapeHtml((cond.values || []).join(', '))}" list="subset-values-${i}">
                   <datalist id="subset-values-${i}"></datalist>`
                : opInfo.kind === 'range'
                    ? `<input type="number" class="form-control form-control-sm subset-lo" placeholder="low" value="${escapeHtml(String((cond.value || [])[0] ?? ''))}">
                       <input type="number" class="form-control form-control-sm subset-hi" placeholder="high" value="${escapeHtml(String((cond.value || [])[1] ?? ''))}">`
                    : `<input type="number" class="form-control form-control-sm subset-num" value="${escapeHtml(String(cond.value ?? ''))}">`;
            row.innerHTML = `
                <select class="form-select form-select-sm w-auto subset-col">${_columns.map(c =>
                    `<option value="${escapeHtml(c.name)}"${c.name === cond.col ? ' selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}</select>
                <select class="form-select form-select-sm w-auto subset-op">${SUBSET_OPS.map(o =>
                    `<option value="${o.op}"${o.op === cond.op ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}</select>
                <span class="subset-value-wrap d-flex gap-1 flex-grow-1">${value}</span>
                <button type="button" class="btn btn-sm btn-outline-danger subset-remove" title="Remove condition">&times;</button>`;
            row.querySelector('.subset-col').addEventListener('change', (e) => {
                cond.col = e.target.value; _renderConditions(); _schedulePreview();
            });
            row.querySelector('.subset-op').addEventListener('change', (e) => {
                cond.op = e.target.value;
                const kind = (SUBSET_OPS.find(o => o.op === cond.op) || {}).kind;
                if (kind === 'text') { cond.values = cond.values || []; delete cond.value; }
                else { delete cond.values; cond.value = kind === 'range' ? ['', ''] : ''; }
                _renderConditions(); _schedulePreview();
            });
            row.querySelector('.subset-remove').addEventListener('click', () => {
                _conditions.splice(i, 1); _renderConditions(); _schedulePreview();
            });
            const text = row.querySelector('.subset-value');
            if (text) {
                text.addEventListener('input', () => {
                    cond.values = text.value.split(',').map(v => v.trim()).filter(Boolean);
                    _schedulePreview();
                });
                _fillCategories(cond.col, row.querySelector('datalist'));
            }
            const num = row.querySelector('.subset-num');
            if (num) num.addEventListener('input', () => { cond.value = num.value; _schedulePreview(); });
            const lo = row.querySelector('.subset-lo'), hi = row.querySelector('.subset-hi');
            if (lo) {
                const both = () => { cond.value = [lo.value, hi.value]; _schedulePreview(); };
                lo.addEventListener('input', both);
                hi.addEventListener('input', both);
            }
            box.appendChild(row);
        });
        if (_el.querySelector('#subset-enabled').checked === false) _syncEnabled();
    }

    /** Offer a categorical column's categories as suggestions. */
    async function _fillCategories(col, datalist) {
        if (!datalist || !col) return;
        try {
            const reply = await DataManager.loadObs({ columns: [col], rows: [0] });
            const categories = (reply && reply.categories && reply.categories[col]) || [];
            datalist.innerHTML = categories.slice(0, 500)
                .map(c => `<option value="${escapeHtml(String(c))}"></option>`).join('');
        } catch {
            // suggestions only; typing values still works
        }
    }

    /** The spec the dialog describes, or null for every cell. Throws if malformed. */
    function _spec() {
        const q = (id) => _el.querySelector(`#${id}`);
        if (!q('subset-enabled').checked) return null;
        const all = q('subset-n-all').checked;
        const n = all ? null : Number(q('subset-n').value);
        const seed = Number(q('subset-seed').value || 0);
        const spec = { n, seed };
        if (q('subset-balance').value) spec.balance = q('subset-balance').value;
        if (_conditions.length) spec.where = _conditions;
        return canonicalSubset(spec);
    }

    function _schedulePreview() {
        clearTimeout(_previewTimer);
        _previewTimer = setTimeout(_preview, 250);
    }

    /** Ask the server what the spec selects, without applying it. */
    async function _preview() {
        const box = _el.querySelector('#subset-preview');
        const apply = _el.querySelector('#subset-apply');
        const seq = ++_previewSeq;
        const reply = DataManager.getSubsetReply() || {};
        let spec;
        try {
            spec = _spec();
        } catch (error) {
            box.className = 'subset-preview small text-danger';
            box.textContent = error.message;
            apply.disabled = true;
            return;
        }
        apply.disabled = false;
        if (spec === null) {
            const n = reply.n_total;
            const large = reply.defaults && n > reply.defaults.threshold;
            box.className = `subset-preview small ${large ? 'text-warning-emphasis' : 'text-muted'}`;
            box.textContent = n
                ? `All ${fmt(n)} cells.` + (large ? ' Drawing this many points can make the browser slow or unresponsive.' : '')
                : 'All cells.';
            return;
        }
        box.className = 'subset-preview small text-muted';
        box.textContent = 'Checking…';
        try {
            const params = new URLSearchParams({ dataset_path: DataManager.getCurrentDataset(), subset: subsetParam(spec) });
            const resp = await fetch(`${Config.API.SUBSET}?${params}`);
            const body = await resp.json().catch(() => ({}));
            if (seq !== _previewSeq) return;
            if (!resp.ok) throw new Error(body.error || `HTTP ${resp.status}`);
            const shown = body.subset ? body.n : body.n_total;
            const lines = [`${fmt(shown)} of ${fmt(body.n_total)} cells will be shown.`];
            if (spec.where) lines.push(`${fmt(body.n_eligible)} pass the filter (${spec.where.map(describeCondition).join(' and ')}).`);
            if (body.parts > 1) {
                lines.push(`These are part 1 of ${fmt(body.parts)}; the parts together show every cell once.`);
            }
            if (body.groups) {
                lines.push('Per group: ' + Object.entries(body.groups)
                    .map(([g, c]) => `${g} ${fmt(c.shown)}/${fmt(c.total)}`).join(', '));
            }
            if (shown === 0) {
                box.className = 'subset-preview small text-danger';
                lines.push('No cell passes the filter.');
                apply.disabled = true;
            } else if (body.defaults && shown > body.defaults.threshold) {
                box.className = 'subset-preview small text-warning-emphasis';
                lines.push('Drawing this many points can make the browser slow or unresponsive.');
            }
            box.textContent = lines.join(' ');
        } catch (error) {
            if (seq !== _previewSeq) return;
            box.className = 'subset-preview small text-danger';
            box.textContent = error.message || String(error);
            apply.disabled = true;
        }
    }

    /** Copy a cell table's SearchBuilder filter into the conditions. */
    function _importTableFilter() {
        const id = _el.querySelector('#subset-table').value;
        const panel = PanelManager.getActivePanels().find(p => p.getId() === id);
        const box = _el.querySelector('#subset-preview');
        if (!panel) return;
        const config = panel.getConfig ? panel.getConfig() : {};
        const booleans = new Set(_columns.filter(c => /bool/i.test(c.type)).map(c => c.name));
        const { where, unsupported } = searchBuilderToWhere(config.searchBuilderConfig || {},
            config.columns || [], getColumnKey, booleans);
        if (!where.length && !unsupported.length) {
            box.className = 'subset-preview small text-warning-emphasis';
            box.textContent = 'That table has no filter.';
            return;
        }
        _conditions = where.map(c => ({ ...c }));
        _renderConditions();
        if (unsupported.length) {
            box.className = 'subset-preview small text-warning-emphasis';
            box.textContent = `Not copied (the subset cannot apply them to all cells): ${unsupported.join('; ')}.`;
            setTimeout(_schedulePreview, 4000);
        } else {
            _schedulePreview();
        }
    }

    async function _apply() {
        let spec;
        try {
            spec = _spec();
        } catch {
            // _preview already shows why
            return;
        }
        _modal.hide();
        if (_onApply) await _onApply(spec);
    }

    return { init, update, open, step, goTo };
})();

export { SubsetControl };
