import { listAvailableColormaps } from './colors.js';
import { Config } from '../../config.js';

// Create array of discrete color scales
const COLOR_SCALES = (Config && Config.DEFAULTS && Config.DEFAULTS.COLOR_SCALES) || ['Portland'];

/**
 * Injects available colormaps into a <select> element with <optgroup> support.
 * @param {HTMLSelectElement} selectElement - The <select> element to populate.
 * @param {Object} colormapGroups - Output of listAvailableColormaps()
 * @param {string} [selected] - Optional selected value.
 */
export function populateColormapSelectorGrouped(selectElement, colormapGroups, selected = '') {
  for (const [groupLabel, colormaps] of Object.entries(colormapGroups)) {
    const optgroup = document.createElement('optgroup');
    optgroup.label = groupLabel;
    for (const cmap of colormaps) {
      const option = document.createElement('option');
      option.value = cmap;
      option.textContent = cmap;
      if (cmap === selected) option.selected = true;
      optgroup.appendChild(option);
    }
    selectElement.appendChild(optgroup);
  }
}

/**
 * Generates and injects a plot panel HTML structure into the given container.
 *
 * @param {HTMLElement} container - The DOM element into which the panel will be rendered.
 * @param {string} id - A unique identifier for the panel instance.
 * @param {Object} settings - An object containing configuration values.
 * @param {number} settings.pointSize - Default point size for plotting.
 * @param {number} settings.pointOpacity - Default point opacity.
 * @param {string} settings.colorScale - Default continuous colormap name.
 * @param {string} settings.categoryPalette - Default discrete palette name.
 * @param {number} [settings.colorMin=0] - Minimum value for color range.
 * @param {number} [settings.colorMax=100] - Maximum value for color range.
 * @returns {{ plotContainer: HTMLElement, controlsContainer: HTMLElement }}
 */
export function createPanelStructure(container, id, settings) {
  container.innerHTML = `
    <div class="plot-panel">
      <div class="plot-controls">
        <!-- X and Y Axis Selectors -->
        ${['x', 'y'].map(axis => `
        <div class="axis-selector-container">
          <div class="axis-selector-label">${axis.toUpperCase()}-Axis</div>
          <div class="axis-selector">
            <select class="form-select form-select-sm axis-type-select" data-axis="${axis}">
              <option value="obs">obs</option>
              <option value="obsm" selected>obsm</option>
              <option value="obsp">obsp</option>
              <option value="layer">layer</option>
            </select>
            <select class="form-select form-select-sm axis-key-select" data-axis="${axis}"></select>
            <select class="form-select form-select-sm axis-column-select" data-axis="${axis}"></select>
          </div>
        </div>
        `).join('')}

        <!-- Z-Axis Selector -->
        <div class="axis-selector-container" id="z-axis-container-${id}" style="display:none;">
          <div class="axis-selector-label">Z-Axis (3D)</div>
          <div class="axis-selector">
            <select class="form-select form-select-sm axis-type-select" data-axis="z">
              <option value="obs">obs</option>
              <option value="obsm" selected>obsm</option>
              <option value="obsp">obsp</option>
              <option value="layer">layer</option>
            </select>
            <select class="form-select form-select-sm axis-key-select" data-axis="z"></select>
            <select class="form-select form-select-sm axis-column-select" data-axis="z"></select>
          </div>
        </div>

        <!-- Color Controls and Selectors -->
        <div class="color-selector-container">
          <div class="axis-selector-label">Color</div>
          <div class="axis-selector">
            <select class="form-select form-select-sm axis-type-select" data-axis="color">
              <option value="none">None (constant)</option>
              <option value="obs">obs</option>
              <option value="obsm">obsm</option>
              <option value="obsp">obsp</option>
              <option value="layer">layer</option>
            </select>
            <select class="form-select form-select-sm axis-key-select" data-axis="color"></select>
            <select class="form-select form-select-sm axis-column-select" data-axis="color"></select>
          </div>

          <div class="color-options mt-2">
            <div class="btn-group" role="group">
              <button class="btn btn-sm btn-outline-secondary me-2" id="z-axis-toggle-${id}">3D Plot</button>
              <button class="btn btn-sm active btn-primary me-2" id="show-grid-${id}">Show Grid</button>
              <button class="btn btn-sm active btn-primary me-2" id="highlight-focused-cell-${id}">Highlight Focused Cell</button>
              <button class="btn btn-sm btn-outline-secondary me-2" id="refresh-plot-${id}">Refresh</button>
            </div>

            <div class="point-controls">
              <div class="point-size-control">
                <label>Size:</label>
                <input type="range" class="form-range" min="1" max="20" value="${settings.pointSize}" id="point-size-${id}">
              </div>
              <div class="point-opacity-control">
                <label>Opacity:</label>
                <input type="range" class="form-range" min="0.1" max="1" step="0.1" value="${settings.pointOpacity}" id="point-opacity-${id}">
              </div>
            </div>

            <div class="color-range-controls" id="color-range-container-${id}" style="display:none;">
              <div class="d-flex align-items-center mb-2">
                <label class="numerical-color-label me-2 mb-0">Color Map:</label>
                <label class="categorical-color-label me-2 mb-0" style="display:none;">Color Palette:</label>
                <select class="form-select form-select-sm color-palette-selector flex-grow-1" id="color-scale-${id}">
                  ${COLOR_SCALES.map(scale => `
                    <option value="${scale}" ${scale === settings.colorScale ? 'selected' : ''}>${scale}</option>
                  `).join('')}
                </select>
                <select class="form-select form-select-sm category-palette-selector flex-grow-1" id="category-palette-${id}" style="display:none;">
                  <!-- Options populated by external logic -->
                </select>
              </div>

              <div class="color-range-inputs">
                <div class="color-range-sliders">
                  <div class="color-min-slider-container">
                    <label>Min:</label>
                    <input type="range" class="form-range" id="color-min-slider-${id}" value="${settings.colorMin ?? 0}">
                    <input type="number" class="form-control form-control-sm" id="color-min-${id}" value="${settings.colorMin ?? 0}">
                  </div>
                  <div class="color-max-slider-container">
                    <label>Max:</label>
                    <input type="range" class="form-range" id="color-max-slider-${id}" value="${settings.colorMax ?? 100}">
                    <input type="number" class="form-control form-control-sm" id="color-max-${id}" value="${settings.colorMax ?? 100}">
                  </div>
                </div>
              </div>

              <div class="btn-toolbar d-flex flex-row" role="toolbar">
                <div class="btn-group d-flex flex-row flex-nowrap" role="group">
                  <button type="button" class="btn btn-sm btn-outline-secondary" id="center-colormap-${id}">Center at 0</button>
                  <button type="button" class="btn btn-sm btn-outline-secondary" id="reverse-colormap-${id}">Reverse Colormap</button>
                  <button type="button" class="btn btn-sm btn-outline-secondary" id="hide-outliers-${id}">Hide Outliers</button>
                  <button type="button" class="btn btn-sm btn-outline-secondary" id="lock-range-${id}">Lock Range</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="plot-container" id="plot-container-${id}"></div>
    </div>
  `;

  // Inject colormaps into the discrete palette selector
  const categoryPaletteSelector = container.querySelector(`#category-palette-${id}`);
  const groupedColormaps = listAvailableColormaps();  // returns { groupLabel: [names] }
  populateColormapSelectorGrouped(categoryPaletteSelector, groupedColormaps, settings.categoryPalette);

  return {
    plotContainer: document.getElementById(`plot-container-${id}`),
    controlsContainer: container.querySelector('.plot-controls')
  };
}
