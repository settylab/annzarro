/**
 * Who decides whether a panel's control bar is shown.
 *
 * Two parties used to write `style.display` on the same element: the user
 * (the tile's toggle button, or a restored view's controlState) and the
 * dataset-loading code, which showed the controls whenever a dataset was
 * loaded. The loading code ran last, so a restored layout's hidden controls
 * came back the moment the dataset arrived; in a half-height tile they then
 * squeezed the plot to nothing and Plotly threw 'Something went wrong with
 * axis scaling', leaving the tile blank.
 *
 * Now the user's choice is recorded on the element (data-controls-hidden)
 * and the loading code only ever hides controls while there is no dataset,
 * never shows ones the user hid.
 */

/**
 * Record and apply the user's choice.
 * @param {HTMLElement|null} el - .plot-controls or .table-controls
 * @param {boolean} visible
 */
export function setControlsVisible(el, visible) {
    if (!el) return;
    el.dataset.controlsHidden = String(!visible);
    el.style.display = visible ? 'flex' : 'none';
}

/**
 * What dataset-loading code calls: controls are hidden without a dataset,
 * and with one they are shown unless the user hid them.
 * @param {HTMLElement|null} el
 * @param {boolean} isDatasetLoaded
 */
export function syncControlsWithDataset(el, isDatasetLoaded) {
    if (!el) return;
    el.style.display = isDatasetLoaded && el.dataset.controlsHidden !== 'true' ? 'flex' : 'none';
}
