/**
 * The "About AnnZarro" dialog, opened by the app name at the top left.
 *
 * The markup is in index.html and Bootstrap opens it (the title button carries
 * data-bs-toggle, so Escape and the close button are Bootstrap's). Only the version is filled in here, on opening,
 * because the server reports it after the page has loaded. The text is the
 * one the title's tooltip shows (config.js showVersion).
 *
 * A site that configures texts (site.imprint, site.privacy ... in config/base.yaml) has
 * a footer line of links; the ones for a text written in the configuration carry
 * data-about-section and open this dialog at that text (one click, so the imprint is
 * directly reachable). Without JavaScript they are plain links to /site/<kind>. A hosted
 * server's footer starts with "About" (data-about-open), which opens this dialog; elsewhere it
 * is the /site/about page.
 * The desktop app (<html data-desktop>) also shows its privacy statement.
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

/** The id of a text's section in the dialog (templates/index.html), or null for an unknown kind. */
export function aboutSectionId(kind) {
    return /^[a-z]+$/.test(String(kind || '')) ? `about-${kind}` : null;
}

/** Open the dialog at the text of `kind` (expanded, scrolled into view); false if the dialog has none. */
export function openAboutAt(kind, doc = document, win = window) {
    const modal = doc.getElementById('about-modal');
    const id = aboutSectionId(kind);
    const section = id && doc.getElementById(id);
    if (!modal || !section || !win.bootstrap) return false;
    const reveal = () => {
        section.open = true;
        section.scrollIntoView({ block: 'nearest' });
        const summary = section.querySelector('summary');
        if (summary) summary.focus({ preventScroll: true });
    };
    if (modal.classList.contains('show')) {
        reveal();
    } else {
        modal.addEventListener('shown.bs.modal', reveal, { once: true });
        win.bootstrap.Modal.getOrCreateInstance(modal).show();
    }
    return true;
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
        // The desktop app says what it sends where
        const privacy = doc.getElementById('about-desktop-privacy');
        if (privacy) privacy.hidden = !doc.documentElement.hasAttribute('data-desktop');
        return text.version;
    };
    // Fill it now and once the server's config has arrived, not only on
    // opening: the name can be clicked before this script has loaded, and
    // Bootstrap then opens the dialog without a show event this code sees.
    fill();
    Config.ready.then(fill);
    modal.addEventListener('show.bs.modal', fill);
    // Back to the name, however the dialog closed
    modal.addEventListener('hidden.bs.modal', () => opener.focus());
    // The footer's links to the site's own texts open the dialog at the text; "About" opens it
    const footer = doc.getElementById('site-footer');
    if (footer) {
        footer.addEventListener('click', (event) => {
            const link = event.target.closest && event.target.closest('a[data-about-section], a[data-about-open]');
            if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
            if (link.hasAttribute('data-about-open')) {
                const bootstrap = globalThis.bootstrap;
                if (!bootstrap) return;
                event.preventDefault();
                bootstrap.Modal.getOrCreateInstance(modal).show();
                return;
            }
            if (openAboutAt(link.dataset.aboutSection, doc)) event.preventDefault();
        });
    }

}
