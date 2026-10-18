/**
 * The colour bar of a continuous colour, built from the panel's settings in one
 * place: title and tick labels in the panel's font, position, length and tick
 * count. Every site that draws or redraws a colour bar uses it (a first draw,
 * a change of colour, large-plot mode), so none drops an option.
 */
import { getPositioningByLocation } from './plot-aesthetics-menu.js';
import { colorbarPosition, colorbarExtras } from './plot-options.js';
import { plotColour } from '../../utils/plot-theme.js';

/** The panel's text font for a colour bar title (`extra` points larger than the text) or its tick labels (0). */
function barFont(settings, extra) {
  return {
    size: settings.fontSize ? settings.fontSize + extra : 12 + extra,
    family: settings.fontFamily || 'Arial, Helvetica, sans-serif',
    color: plotColour(settings, 'textColor')
  };
}

/**
 * @param {Object} settings - the panel's settings
 * @param {string} title - the colour bar's title
 * @returns {Object} a Plotly colorbar
 */
export function colourBar(settings, title) {
  const pos = getPositioningByLocation(colorbarPosition(settings));
  return {
    title: { text: title, side: 'right', font: barFont(settings, 2) },
    tickfont: barFont(settings, 0),
    ...colorbarExtras(settings),
    x: pos.x, xanchor: pos.xanchor, y: pos.y, yanchor: pos.yanchor,
    ypad: pos.ypad, ticklabelposition: pos.ticklabelposition,
    titleside: pos.titleside, orientation: pos.orientation
  };
}
