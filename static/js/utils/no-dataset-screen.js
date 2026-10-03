/**
 * The screen a panel shows while no dataset is loaded.
 *
 * It used to carry a spinner. Nothing is loading in that state: a panel
 * restored from autosave or a panel set whose dataset is gone (moved,
 * deleted, on an unmounted disk) sits there until the user picks another
 * dataset, so the spinner turned forever and the app looked hung. Reported
 * from the desktop app as "it scrolls in circles".
 */
export function noDatasetScreenHtml(id) {
    return `
        <div class="loading-screen" id="loading-screen-${id}" style="display: none;">
            <div class="loading-content">
                <i class="fas fa-database fa-2x text-secondary" aria-hidden="true"></i>
                <h4 class="mt-3">No dataset loaded</h4>
                <p>Please select a dataset to begin visualization</p>
            </div>
        </div>`;
}
