/**
 * A panel of a view that is open without data: its store was not found
 * here, or the user chose not to open it on a store that differs.
 *
 * It stands in the layout where the real panel goes, under the same tile id,
 * and keeps the panel's settings exactly as saved: a share link or panel set
 * saved meanwhile carries them unchanged, and choosing a dataset ("Change
 * dataset") replaces every placeholder with the real panel built from them.
 * It reads no data and takes no data updates.
 */

const LABELS = {
    'cell-plot': 'Cell plot', 'gene-plot': 'Gene plot', 'cell-table': 'Cell table',
    'gene-table': 'Gene table', 'gene-set': 'Gene set analysis'
};

/**
 * @param {HTMLElement} container - the tile's .tile-content
 * @param {string} type - the panel type the tile id names
 * @param {Object} config - the saved config (kept, never changed)
 * @param {{message?: string, onChangeDataset?: Function}} [opts]
 */
export function createPlaceholderPanel(container, type, config, opts = {}) {
    const saved = JSON.parse(JSON.stringify(config || {}));
    let title = saved.title || LABELS[type] || type;

    function init() {
        container.innerHTML = '';
        const box = document.createElement('div');
        box.className = 'panel-no-data';
        box.dataset.panelType = type;
        const head = document.createElement('div');
        head.className = 'panel-no-data-title';
        head.textContent = `${LABELS[type] || type}: no data`;
        const text = document.createElement('div');
        text.className = 'panel-no-data-message';
        text.textContent = opts.message || 'This view is open without a dataset. Its settings are kept.';
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
