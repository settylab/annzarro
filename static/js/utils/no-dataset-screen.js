/**
 * The screen a panel shows while no dataset is loaded.
 *
 * It used to carry a spinner. Nothing is loading in that state: a panel
 * restored from autosave or a panel set whose dataset is gone (moved,
 * deleted, on an unmounted disk) sits there until the user picks another
 * dataset, so the spinner turned forever and the app looked hung. Reported
 * from the desktop app as "it scrolls in circles".
 *
 * When the dataset the page asked for is "not available" the screen says so
 * instead. The server answers a store the user may not read exactly as it
 * answers one that is not there (annzarro/server/access.py), so the page
 * cannot tell the two apart, and says what is true of both: the dataset is
 * not available to this user, or no longer exists. That covers a link or
 * panel set naming a dataset outside a collaborator's grants, and a dataset
 * whose grant was revoked while it was open.
 */

/** The dataset the page was asked for and may not have, or null. */
let unavailable = null;

function escapeText(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** The sentence for a dataset that is not available (its title is `UNAVAILABLE_TITLE`). */
export function notAvailableText(name) {
    return name ? `${name} is not available to you, or no longer exists. Please select a dataset.`
        : 'This dataset is not available to you, or no longer exists. Please select a dataset.';
}

export const UNAVAILABLE_TITLE = 'Dataset not available';
export const NO_DATASET_TITLE = 'No dataset loaded';
export const NO_DATASET_TEXT = 'Please select a dataset to begin visualization';

/** The dataset currently marked not available (null if none). */
export function datasetUnavailable() {
    return unavailable;
}

/**
 * Mark ``name`` as the dataset that is not available, so every no-dataset
 * screen (those already built and those built later) says so. Null clears it.
 */
export function markDatasetUnavailable(name) {
    unavailable = name ? String(name) : null;
    if (typeof document === 'undefined' || !document.querySelectorAll) return;
    for (const screen of document.querySelectorAll('[data-no-dataset-screen]')) {
        const title = screen.querySelector('[data-no-dataset-title]');
        const text = screen.querySelector('[data-no-dataset-text]');
        if (title) title.textContent = unavailable ? UNAVAILABLE_TITLE : NO_DATASET_TITLE;
        if (text) text.textContent = unavailable ? notAvailableText(unavailable) : NO_DATASET_TEXT;
        screen.dataset.unavailable = unavailable ? 'true' : 'false';
    }
}

export function clearDatasetUnavailable() {
    if (unavailable !== null) markDatasetUnavailable(null);
}

export function noDatasetScreenHtml(id) {
    const title = unavailable ? UNAVAILABLE_TITLE : NO_DATASET_TITLE;
    const text = unavailable ? notAvailableText(unavailable) : NO_DATASET_TEXT;
    return `
        <div class="loading-screen" id="loading-screen-${id}" style="display: none;"
             data-no-dataset-screen data-unavailable="${unavailable ? 'true' : 'false'}">
            <div class="loading-content">
                <i class="fas fa-database fa-2x text-secondary" aria-hidden="true"></i>
                <h4 class="mt-3" data-no-dataset-title>${escapeText(title)}</h4>
                <p data-no-dataset-text>${escapeText(text)}</p>
            </div>
        </div>`;
}
