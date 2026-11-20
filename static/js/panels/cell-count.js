/**
 * Cell Count Plot, registered and not released (0.8.0 build, step F7).
 *
 * Until its panel is built, a tile of this type is the placeholder of
 * utils/placeholder-panel.js: it keeps the settings it was saved with, so a
 * link or panel set that names it loses nothing. The panel replaces this file.
 */
import { PanelManager } from '../panel-manager.js';
import { createPlaceholderPanel } from '../utils/placeholder-panel.js';

PanelManager.registerPanelType('cell-count', function (container, config) {
    return createPlaceholderPanel(container, 'cell-count', config, { unreleased: true });
});
