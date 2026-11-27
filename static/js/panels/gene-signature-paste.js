/**
 * The Gene Signature panel's "Paste or upload" way of adding genes (design 9, UX 2.4).
 *
 * A source for the panel's ADD_SOURCES: it gives one inline button, and a `drop` hook so a file
 * dropped anywhere on the panel opens the preview. The flow itself is utils/gene-paste-preview.js,
 * mounted inline in the panel (not a modal). The file is read in the browser and never sent to the
 * server; only the resulting genes enter the recipe, in one undoable step.
 *
 * It takes the panel's api as `ctx.panel` and imports nothing from the panel, so the two can load in
 * either order.
 */
import { mountGenePaste } from '../utils/gene-paste-preview.js';

const ID = 'paste-upload';
const open = new WeakMap();      // panel api -> the mounted flow

/** Open the flow (or focus it when already open) and return it. */
function openPaste(panel) {
    const existing = open.get(panel);
    if (existing) { existing.focus(); return existing; }
    const host = document.createElement('div');
    const close = () => {
        const flow = open.get(panel);
        if (!flow) return;
        open.delete(panel);
        flow.destroy();
        panel.closeFlow(ID);
    };
    const flow = mountGenePaste(host, {
        geneNames: panel.getDatasetGenes(),
        currentGenes: () => panel.getSelectedGenes(),
        directions: () => panel.directionsOn(),
        currentDown: () => panel.getRecipe().down,
        defaultDirection: () => panel.getAddAs(),
        idLookup: (kind) => panel.loadIdMap(kind),
        onCancel: close,
        onAdd: (genes, info) => {
            close();
            const label = info.fileName ? `file ${info.fileName}` : 'pasted list';
            if (info.up || info.down) {
                panel.addDirected(info.up || [], info.down || [], { label, outside: info.unmatched, move: info.move });
            } else {
                panel.addGenes(genes, { label, outside: info.unmatched, direction: info.direction, move: info.move });
            }
        }
    });
    open.set(panel, flow);
    panel.openFlow(host, { opener: ID, onClose: () => { if (open.get(panel) === flow) { open.delete(panel); flow.destroy(); } } });
    flow.focus();
    return flow;
}

/** @type {(ctx: {panel: Object}) => Object[]} */
export function pasteSource({ panel }) {
    return [{
        id: ID,
        label: 'Paste or upload',
        shortLabel: 'Paste',
        inline: true,
        run: () => { openPaste(panel); },
        drop: (file) => { openPaste(panel).loadFile(file); }
    }];
}
