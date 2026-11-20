/**
 * A panel of a view that is open without data: its store was not found
 * here, or the user chose not to open it on a store that differs.
 *
 * It stands in the layout where the real panel goes, under the same tile id,
 * and keeps the panel's settings exactly as saved: a share link or panel set
 * saved meanwhile carries them unchanged, and choosing a dataset ("Change
 * dataset") replaces every placeholder with the real panel built from them.
 * It reads no data and takes no data updates.
 *
 * The same stand-in serves a panel type the administrator disabled
 * ({disabled: true}): in a panel set or a link, the tile says so and keeps the
 * saved settings, so saving the set again loses nothing and enabling the type
 * again brings the panel back.
 *
 * A panel type that is registered but not released ({unreleased: true}, the
 * stubs of panels/cell-grouping.js, cell-gene.js and cell-count.js) stands the
 * same way: a link that names one keeps its settings until the type ships.
 */
import panelTypes from '../panels/panel-types.json' with { type: 'json' };

const LABELS = {
    'cell-plot': 'Cell plot', 'gene-plot': 'Gene plot', 'cell-table': 'Cell table',
    'gene-table': 'Gene table', 'gene-set': 'Gene set analysis', 'gene-signature': 'Gene signature'
};

/** What a tile calls its type: the sentence-case names above, else the registry's label. */
const labelOf = (type) => LABELS[type] || (panelTypes.find(e => e.type === type) || {}).label || type;

/**
 * @param {HTMLElement} container - the tile's .tile-content
 * @param {string} type - the panel type the tile id names
 * @param {Object} config - the saved config (kept, never changed)
 * @param {{message?: string, onChangeDataset?: Function, disabled?: boolean, unreleased?: boolean}} [opts]
 */
export function createPlaceholderPanel(container, type, config, opts = {}) {
    const saved = JSON.parse(JSON.stringify(config || {}));
    delete saved._closed; // the manager's flag for a panel kept closed; a saved view never carries it
    let title = saved.title || labelOf(type);

    function init() {
        container.innerHTML = '';
        const box = document.createElement('div');
        box.className = 'panel-no-data';
        box.dataset.panelType = type;
        const head = document.createElement('div');
        head.className = 'panel-no-data-title';
        const text = document.createElement('div');
        text.className = 'panel-no-data-message';
        if (opts.disabled) {
            box.dataset.disabledByPolicy = 'true';
            head.textContent = 'Disabled by the administrator';
            text.textContent = `${labelOf(type)} is turned off on this server. Its settings are kept and come back if it is turned on again.`;
        } else if (opts.unreleased) {
            box.dataset.unreleased = 'true';
            head.textContent = labelOf(type);
            text.textContent = 'This panel is not available in this version. Its settings are kept.';
        } else {
            head.textContent = `${LABELS[type] || type}: no data`;
            text.textContent = opts.message || 'This view is open without a dataset. Its settings are kept.';
        }
        box.append(head, text);
        if (typeof opts.onChangeDataset === 'function') {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'btn btn-sm btn-outline-primary panel-no-data-change';
            button.textContent = 'Change dataset';
            button.addEventListener('click', () => opts.onChangeDataset());
            box.appendChild(button);
        }
        container.appendChild(box);
    }

    return {
        isPlaceholder: true,
        getId: () => saved.id,
        getType: () => type,
        getTitle: () => title,
        setTitle: (t) => { title = t; saved.title = t; },
        getConfig: () => JSON.parse(JSON.stringify(saved)),
        setConfig: () => {},
        updateConfig: () => {},
        init,
        cleanup: () => { container.innerHTML = ''; },
        destroy: () => { container.innerHTML = ''; }
    };
}
