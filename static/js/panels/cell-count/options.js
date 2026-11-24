/**
 * The Count Plot's own fields of the shared Plot Options (WP-5a, plot-utilities/options-schema.js): the 3D section (UX 6b,
 * WP-11), shown only while the plot is in 3D. Its values are stored under `view3d` (`footprint`, `lighting`, `box`,
 * `zTitle`), each absent at its default, and read by the 3D figure (draw-3d.js `figure3d`'s `opts.view3d`).
 */
import { VOCABULARY } from '../../utils/vocabulary.js';
import { BAR_FILL } from '../../utils/bars-3d.js';
import { registerPanelFields } from '../plot-utilities/options-schema.js';

const WO = VOCABULARY.countPlot.view3d.options;

/** Whether the plot is in 3D: the section's fields are shown only then. */
const in3d = (config) => !!config && config.view === '3d';

const FIELDS = Object.freeze([
    { id: 'footprint3d', section: 'panel:view3d', type: 'range', path: 'view3d.footprint', label: WO.footprint, dflt: BAR_FILL, min: 0.5, max: 1, step: 0.05, when: in3d },
    { id: 'lighting3d', section: 'panel:view3d', type: 'check', path: 'view3d.lighting', label: WO.lighting, dflt: true, when: in3d },
    { id: 'axisBox3d', section: 'panel:view3d', type: 'check', path: 'view3d.box', label: WO.box, dflt: true, when: in3d },
    { id: 'zTitle3d', section: 'panel:view3d', type: 'text', path: 'view3d.zTitle', label: WO.zTitle, dflt: '', copy: false, when: in3d }
]);
registerPanelFields('cell-count', FIELDS);

/** The panel's sections for the pop-over (options-popover.js `sections`). */
export const COUNT_SECTIONS = Object.freeze({ 'panel:view3d': { title: WO.section, when: in3d } });

/** The 3D figure's options from a resolved style (options-schema.js `resolveStyle`). */
export function view3dOptions(look) {
    return { footprint: look.footprint3d, lighting: look.lighting3d, box: look.axisBox3d, zTitle: look.zTitle3d };
}
