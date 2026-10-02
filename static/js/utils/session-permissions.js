/**
 * What the panel-set dialog may offer, and what to say when the server refuses.
 *
 * The server decides who may delete, rename or overwrite a shared panel set
 * (annzarro/server/permissions.py): its owner or an admin, and only an admin
 * for a set saved before owners were recorded. `sessions/list` reports
 * `owner` and `can_modify` per set so the dialog can stop offering an action
 * that would be refused, and a refusal is a 403 whose JSON carries `error`
 * (a sentence for the user), `reason` and `owner`.
 *
 * Pure functions, no DOM, so they run under `node --test`.
 */

/**
 * Escape text for interpolation into an HTML template string. Panel-set names,
 * dataset labels and owners come from files any user can upload.
 * @param {*} value
 * @returns {string}
 */
export function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Whether the current user may delete/rename/overwrite this listed set.
 * A server that predates ownership sends no `can_modify`; treat that as
 * allowed so an older server keeps its old behaviour.
 * @param {Object} session - An entry from `sessions/list`.
 * @returns {boolean}
 */
export function canModify(session) {
    return !session || session.can_modify !== false;
}

/**
 * One sentence saying why this set cannot be changed, or null if it can.
 * @param {Object} session - An entry from `sessions/list`.
 * @returns {string|null}
 */
export function lockReason(session) {
    if (canModify(session)) return null;
    if (session.owner) {
        return `Belongs to ${session.owner}. Only they or an admin can delete or overwrite it.`;
    }
    return 'Saved before owners were recorded. Only an admin can delete or overwrite it.';
}

/**
 * Turn a failed fetch Response into the `{status: 'error', ...}` shape the
 * SessionManager returns, keeping the server's own sentence when it sent one
 * instead of the bare status text ("FORBIDDEN").
 * @param {Response} response
 * @returns {Promise<{status: string, message: string, reason: (string|null), owner: (string|null), httpStatus: number}>}
 */
export async function errorFromResponse(response) {
    let body = null;
    try {
        body = await response.json();
    } catch (e) {
        body = null;
    }
    const message = (body && (body.error || body.message))
        || `Server answered ${response.status} ${response.statusText || ''}`.trim();
    return {
        status: 'error',
        message,
        reason: (body && body.reason) || null,
        owner: (body && body.owner) || null,
        httpStatus: response.status,
    };
}

/**
 * What the header should say about who is using the app, from `auth/me`.
 *
 * Local single-user mode says nothing. A server reachable from the network
 * with login disabled says so on every page, because that is the state in
 * which anyone can delete anyone's panel sets and nobody notices.
 *
 * @param {Object|null} me - `{auth_enabled, username, is_admin, exposed}`.
 * @returns {{text: string, title: string, variant: string, href: (string|null)}|null}
 */
export function authIndicator(me) {
    if (!me) return null;
    if (me.exposed) {
        return {
            text: 'No login',
            title: 'This server is reachable from the network with login disabled: '
                + 'anyone who can reach it can open every shared dataset and edit or delete every shared panel set.',
            variant: 'warning',
            href: null,
        };
    }
    if (me.auth_enabled && me.username) {
        return {
            text: me.is_admin ? `${me.username} (admin)` : me.username,
            title: me.is_admin
                ? `Signed in as ${me.username}, an admin: you can delete or overwrite any panel set. Click to log out.`
                : `Signed in as ${me.username}: you can delete or overwrite the panel sets you saved. Click to log out.`,
            variant: 'user',
            href: '/logout',
        };
    }
    return null;
}

/**
 * Notification title for a failed panel-set action. A permission refusal is
 * not a malfunction, so it gets a calmer title than "Failed to ...".
 * @param {Object} result - What SessionManager returned.
 * @param {string} fallback - Title to use for any other failure.
 * @returns {{title: string, type: string}}
 */
export function describeFailure(result, fallback) {
    if (result && result.httpStatus === 403) {
        return { title: 'Not allowed', type: 'warning' };
    }
    return { title: fallback, type: 'error' };
}

/**
 * What the header's Refresh button does for this user.
 *
 * On a hosted server (login on, or reachable from the network) clearing the
 * server's cache is admin-only (POST /cache/reset answers 403 admin_only):
 * the cache is shared by every user. Everyone else still gets a refresh of
 * the dataset and panels in their own browser, and a tooltip that does not
 * promise a server cache clear.
 * @param {Object|null} me - `{auth_enabled, username, is_admin, exposed}` from auth/me
 * @returns {{resetServerCache: boolean, title: string}}
 */
export function refreshPlan(me) {
    const hosted = !!(me && (me.auth_enabled || me.exposed));
    const resetServerCache = !hosted || !!(me && me.is_admin);
    return {
        resetServerCache,
        title: resetServerCache
            ? "Reload this dataset and clear the server's cache for it"
            : "Reload this dataset in this browser (only an admin can clear the server's shared cache)"
    };
}
