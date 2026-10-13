/**
 * The administrator's policy at the moment of a Run (gene-set.js syncPolicy).
 *
 * The panel reads it fresh before anything is sent, so a tab opened before a
 * change obeys the change; the document's CSP stops a modified tab at the
 * browser, this stops the app from trying.
 */
import { geneSetPolicy } from '../../policy.js';

const offline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

const UNREADABLE = 'The administrator\'s settings could not be read: nothing was sent.';

/**
 * Read the policy now and resolve what the panel may do.
 * @param {{fresh: Function, values: Function}} policy - the page's Policy (policy.js)
 * @param {Object} integrations - Config.INTEGRATIONS
 * @returns {Promise<{gs: Object, unreadable: boolean, notice: string|null}>}
 *   A server with a policy that cannot be read (an HTTP error, a malformed
 *   reply) sends nothing (externalRequests 'off'), rather than assuming the
 *   last answer still holds. With no answer at all (the browser is offline)
 *   the last known policy stands: nothing can be sent, the panel says the
 *   browser is offline, and the next online Run reads the policy again.
 */
export async function readRunPolicy(policy, integrations) {
    const read = await policy.fresh();
    const gs = geneSetPolicy(policy.values(), integrations);
    if (read.status === 'error' && !(read.network || offline())) return { gs: { ...gs, externalRequests: 'off' }, unreadable: true, notice: UNREADABLE };
    return { gs, unreadable: false, notice: null };
}

/**
 * What the bar says when a Run finds that the policy turned something off
 * since the panel was built (or since its last Run), or null.
 * @param {Object} before - the panel's earlier geneSetPolicy
 * @param {Object} now - the fresh one
 * @param {Array<{provider: {name: string}}>} gone - adapters no longer offered
 */
export function turnedOffNotice(before, now, gone) {
    if (now.externalRequests === 'off' && before.externalRequests !== 'off') {
        return 'External services were turned off by the administrator: nothing was sent.';
    }
    if (gone.length) {
        const names = [...new Set(gone.map(a => a.provider.name))];
        return `The administrator turned off ${names.join(', ')}.`;
    }
    return null;
}
