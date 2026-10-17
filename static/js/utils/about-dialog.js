/**
 * The "About AnnZarro" dialog, opened by the app name at the top left.
 *
 * The markup is in index.html and Bootstrap opens it (the title button carries
 * data-bs-toggle, so Escape and the close button are Bootstrap's). Only the version is filled in here, on opening,
 * because the server reports it after the page has loaded. The text is the
 * one the title's tooltip shows (config.js showVersion).
 */
import { Config } from '../config.js';
import { appVersion } from './store-identity.js';

/**
 * @param {string} siteName - The app name the page shows (the title button's text).
 * @param {string|null} version - The version the server runs.
 * @returns {{version: string, site: string|null}} `version` is the line after "AnnZarro";
 *   `site` is the custom app name, or null when the page is plainly called AnnZarro.
 */
export function aboutText(siteName, version) {
    const name = String(siteName || '').trim();
    return {
        version: version ? String(version) : '',
        site: name && name !== 'AnnZarro' ? name : null
    };
}

/** Fill the dialog when it opens. */
export function initAboutDialog(doc = document) {
    const modal = doc.getElementById('about-modal');
    const opener = doc.getElementById('about-open');
    if (!modal || !opener) return;
    const siteName = (opener.textContent || '').trim();
    const fill = () => {
        const text = aboutText(siteName, appVersion());
        doc.getElementById('about-version').textContent = text.version;
        const site = doc.getElementById('about-site');
        site.hidden = !text.site;
        site.textContent = text.site ? `This is ${text.site}, a site running AnnZarro.` : '';
        return text.version;
    };
    modal.addEventListener('show.bs.modal', () => {
        // opened before the server's config has arrived: fill the version in when it does
        if (!fill()) Config.ready.then(fill);
    });
    // Back to the name, however the dialog closed
    modal.addEventListener('hidden.bs.modal', () => opener.focus());
}
