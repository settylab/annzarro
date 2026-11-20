/**
 * The one registry of what a notice's buttons do. A notice offers [action, label] pairs (utils/source-notices.js); the
 * page asks here whether an action applies to a host (a plot's or a table's container) and runs it.
 *
 * An action is declared once, as a `target` (what it would act on, or null) and a `run` of that target. It is
 * available exactly when it has a target, and running it does exactly that, so a button cannot be offered and then do
 * nothing: the registry, not the provider, makes `available` and `run` agree. A provider says which hosts are its own
 * (`owns`) and brings only the actions that make sense there.
 */

/** Every action a notice may offer. A provider may declare only some of them. */
const ACTIONS = Object.freeze(['score-offer', 'score-compute', 'score-cancel', 'score-retry', 'score-update', 'score-open', 'score-choose',
    'score-remove']);

/**
 * @typedef {Object} ActionProvider
 * @property {string} id
 * @property {(host: HTMLElement) => boolean} owns - whether the host is this provider's
 * @property {Record<string, {target: (host: HTMLElement) => *, run: (target: *, host: HTMLElement) => void}>} actions
 *   `target` returns what the action acts on, or null when it does not apply now
 */

/** A registry of providers. The page uses the one exported as `actions`; tests make their own. */
function createActionRegistry() {
    /** @type {ActionProvider[]} */
    const providers = [];

    function targetOf(name, host) {
        const owner = providers.find(p => p.owns(host));
        const action = owner && owner.actions[name];
        if (!action) return null;
        const target = action.target(host);
        return target === null || target === undefined || target === false ? null : { action, target };
    }

    return {
        /** Add a provider. An action it names that the registry does not know, or a second provider of the same id, is a bug and throws. */
        register(provider) {
            if (providers.some(p => p.id === provider.id)) throw new Error(`Action provider '${provider.id}' is already registered`);
            for (const [name, action] of Object.entries(provider.actions)) {
                if (!ACTIONS.includes(name)) throw new Error(`Unknown action '${name}' in provider '${provider.id}'`);
                if (typeof action.target !== 'function' || typeof action.run !== 'function') {
                    throw new Error(`Action '${name}' of provider '${provider.id}' needs a target and a run`);
                }
            }
            providers.push(provider);
        },
        providerIds() {
            return providers.map(p => p.id);
        },
        /** Every action a notice may offer. */
        known: ACTIONS,
        /** An empty registry under the same rules, to hold one provider apart (a test, or a provider being checked). */
        fresh: createActionRegistry,
        /** Whether an action applies to this host now. */
        available(name, host) {
            return targetOf(name, host) !== null;
        },
        /** Run an action on this host. @returns {boolean} whether it ran: always the same as `available` was */
        run(name, host) {
            const found = targetOf(name, host);
            if (!found) return false;
            found.action.run(found.target, host);
            return true;
        }
    };
}

/** The page's registry: score-source.js registers the plots' provider, panels/table-utilities/table-score-ui.js the tables'. */
export const actions = createActionRegistry();
