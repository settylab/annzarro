/**
 * The re-authentication modal (design 1.4, 3.1 step 5).
 *
 * Admin changes need the password entered within server.admin_reauth_minutes.
 * When the API client meets 403 `reauth_required` it calls `request()`; the
 * modal asks for the password, posts it to /admin/reauth and resolves, after
 * which the client retries the call. A wrong password keeps the modal open with
 * the server's message (a locked account says so); Cancel rejects.
 */

import { h } from './dom.js';

/**
 * Show and hide a modal element. Bootstrap's Modal when it is loaded, plain
 * classes otherwise (and in tests).
 * @param {HTMLElement} modal
 * @returns {{show: function, hide: function, onHidden: function(function): void}}
 */
export function bootstrapController(modal) {
    const BS = globalThis.bootstrap;
    if (BS && BS.Modal) {
        const instance = new BS.Modal(modal, { backdrop: 'static', keyboard: false });
        return {
            show: () => instance.show(),
            hide: () => instance.hide(),
            onHidden: (fn) => modal.addEventListener('hidden.bs.modal', fn),
        };
    }
    return {
        show: () => { modal.classList.add('show'); modal.style.display = 'block'; },
        hide: () => { modal.classList.remove('show'); modal.style.display = 'none'; },
        onHidden: () => {},
    };
}

/**
 * @param {Object} options
 * @param {{reauth: function(string): Promise}} options.api
 * @param {HTMLElement} [options.parent] - defaults to document.body
 * @param {function(HTMLElement): Object} [options.controller]
 * @param {number|null} [options.minutes] - the window length to mention, when known
 * @returns {{request: function(): Promise<void>, element: HTMLElement}}
 */
export function createReauthModal({ api, parent, controller = bootstrapController, minutes = null }) {
    const input = h('input', {
        type: 'password', class: 'form-control', id: 'reauth-password', autocomplete: 'current-password', required: true,
    });
    const error = h('div', { class: 'invalid-feedback d-block', role: 'alert', hidden: true });
    const confirm = h('button', { type: 'submit', class: 'btn btn-primary', text: 'Confirm' });
    const cancel = h('button', { type: 'button', class: 'btn btn-outline-secondary', text: 'Cancel' });
    const form = h('form', { novalidate: true },
        h('div', { class: 'modal-header' }, h('h2', { class: 'modal-title h5', id: 'reauth-title', text: 'Confirm your password' })),
        h('div', { class: 'modal-body' },
            h('p', { text: `Confirm your password to make changes${minutes ? ` (valid ${minutes} min)` : ''}.` }),
            h('label', { for: 'reauth-password', class: 'form-label', text: 'Password' }), input, error),
        h('div', { class: 'modal-footer' }, cancel, confirm));
    const element = h('div', {
        class: 'modal fade', id: 'admin-reauth', tabindex: '-1', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'reauth-title',
    }, h('div', { class: 'modal-dialog modal-dialog-centered' }, h('div', { class: 'modal-content' }, form)));
    (parent || globalThis.document.body).appendChild(element);
    const ctl = controller(element);

    let pending = null;

    function settle(ok) {
        if (!pending) return;
        const { resolve, reject } = pending;
        pending = null;
        ctl.hide();
        input.value = '';
        error.hidden = true;
        if (ok) resolve();
        else reject(new Error('Password confirmation was cancelled.'));
    }

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!pending || !input.value) return;
        confirm.disabled = true;
        error.hidden = true;
        try {
            await api.reauth(input.value);
            settle(true);
        } catch (e) {
            error.textContent = (e && e.message) || 'Could not confirm the password.';
            error.hidden = false;
            input.select && input.select();
        } finally {
            confirm.disabled = false;
        }
    });
    cancel.addEventListener('click', () => settle(false));

    return {
        element,
        request() {
            if (pending) return pending.promise;
            let resolve;
            let reject;
            const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
            pending = { promise, resolve, reject };
            ctl.show();
            if (input.focus) input.focus();
            return promise;
        },
    };
}
