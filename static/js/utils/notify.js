/**
 * Let any module show a notice through the app's notification UI without
 * importing main.js (which would be circular). main.js listens for the
 * event and calls its _showNotification.
 *
 * @param {string} title
 * @param {string} message
 * @param {'info'|'warning'|'error'|'success'} [type]
 */
export const NOTIFY_EVENT = 'annzarro:notify';

export function notify(title, message, type = 'warning') {
    if (typeof document === 'undefined' || typeof document.dispatchEvent !== 'function') return;
    const Ctor = typeof CustomEvent === 'function' ? CustomEvent : null;
    if (!Ctor) return;
    document.dispatchEvent(new Ctor(NOTIFY_EVENT, { detail: { title, message, type } }));
}
