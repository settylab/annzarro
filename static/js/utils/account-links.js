/**
 * The links the header offers a signed-in user, from `auth/me`.
 *
 * Only the admin interface for an admin. Whether the link shows is cosmetic:
 * the server checks the user on every request to /admin and answers 403 to
 * anyone else. Pure, so it runs under `node --test`.
 */
import { appUrl } from './app-url.js';

/**
 * @param {Object|null} me - `{auth_enabled, username, is_admin}`.
 * @returns {Array<{id: string, text: string, title: string, href: string}>}
 */
export function accountLinks(me) {
    if (!me || !me.auth_enabled || !me.username) return [];
    const links = [];
    if (me.is_admin) {
        links.push({ id: 'admin', text: 'Admin', title: 'Open the admin interface', href: appUrl('/admin') });
    }
    return links;
}
