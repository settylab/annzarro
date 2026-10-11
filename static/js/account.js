/**
 * The change-password page (templates/account.html): POST
 * /api/v1/account/password {current, new} with the session's CSRF token.
 *
 * `checkNewPassword` is pure, for `node --test`; the DOM wiring runs only in
 * the page.
 */

import { appUrl } from './utils/app-url.js';

export const MIN_PASSWORD = 10;

/**
 * What is wrong with the form before it is sent, or '' when nothing is.
 * The server checks again; this only saves a round trip.
 * @param {string} current
 * @param {string} next
 * @param {string} confirm
 * @param {string} username
 * @returns {string}
 */
export function checkNewPassword(current, next, confirm, username) {
    if (!current) return 'Enter your current password.';
    if (next.length < MIN_PASSWORD) return `The new password needs at least ${MIN_PASSWORD} characters.`;
    if (next.toLowerCase() === String(username || '').toLowerCase()) return 'The new password must differ from your username.';
    if (next === current) return 'Pick a password different from the current one.';
    if (next !== confirm) return 'The two new passwords differ.';
    return '';
}

/**
 * Send the change.
 * @param {Object} options
 * @param {function} options.fetchImpl
 * @param {string} options.csrf
 * @param {string} options.url
 * @param {string} options.current
 * @param {string} options.next
 * @returns {Promise<{ok: boolean, message: string}>}
 */
export async function changePassword({ fetchImpl, csrf, url, current, next }) {
    let response;
    try {
        response = await fetchImpl(url, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-AnnZarro-CSRF': csrf, Accept: 'application/json' },
            body: JSON.stringify({ current, new: next }),
        });
    } catch {
        return { ok: false, message: 'Could not reach the server. Check your connection.' };
    }
    let body;
    try {
        body = JSON.parse(await response.text());
    } catch {
        body = null;
    }
    if (response.ok) return { ok: true, message: 'Your password was changed.' };
    if (response.status === 401) return { ok: false, message: 'Your login has expired. Sign in again.' };
    return { ok: false, message: (body && body.error) || `The change failed (HTTP ${response.status}).` };
}

function boot() {
    const doc = globalThis.document;
    const form = doc.getElementById('account-form');
    if (!form) return;
    const meta = doc.querySelector('meta[name="annzarro-csrf"]');
    const csrf = meta ? meta.getAttribute('content') || '' : '';
    const username = doc.getElementById('account-user').textContent;
    const message = doc.getElementById('account-message');
    const submit = doc.getElementById('account-submit');
    const field = (id) => doc.getElementById(id);

    function show(text, ok) {
        message.className = `alert ${ok ? 'alert-success' : 'alert-danger'} py-2 mb-3`;
        message.textContent = text;
        message.hidden = false;
    }

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const current = field('account-current').value;
        const next = field('account-new').value;
        const problem = checkNewPassword(current, next, field('account-confirm').value, username);
        if (problem) {
            show(problem, false);
            return;
        }
        submit.disabled = true;
        try {
            const result = await changePassword({
                fetchImpl: (...a) => globalThis.fetch(...a), csrf, current, next,
                url: appUrl('/api/v1/account/password'),
            });
            show(result.message, result.ok);
            if (result.ok) form.reset();
        } finally {
            submit.disabled = false;
        }
    });
}

if (globalThis.document) boot();
