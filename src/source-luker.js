// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Data source backed by Luker's memory-graph extension.
//
// Public surface used: `getExtensionApi('memory-graph')` → getCurrentInjection,
// getLastRecallProjection, onStoreCommit, onInjectionChanged.
// Full node/edge listing is not on the registered API, so we import the
// read-only factory from memory-graph's own modules. Browsers key ES modules
// by URL, so this resolves to the instance Luker already evaluated — no
// duplicate state. If the import path ever moves, `load()` reports a clear
// error instead of crashing the UI.

const MG_BASE = '/scripts/extensions/memory-graph';
const CHAT_EVENTS = ['CHAT_CHANGED', 'CHAT_DELETED'];
const MESSAGE_EVENTS = ['MESSAGE_DELETED', 'MESSAGE_SWIPED', 'MESSAGE_EDITED'];

export class SourceError extends Error {
    constructor(code, message) {
        super(message || code);
        this.code = code;
    }
}

function getContext() {
    const ctx = globalThis.Luker?.getContext?.() || globalThis.SillyTavern?.getContext?.();
    if (!ctx) throw new SourceError('no-host');
    return ctx;
}

let internalModules = null;
async function loadInternals() {
    if (!internalModules) {
        internalModules = Promise.all([
            import(`${MG_BASE}/main.js`),
            import(`${MG_BASE}/read-api.js`),
        ]).then(([main, read]) => ({
            ensureStoreSyncedWithChat: main.ensureStoreSyncedWithChat,
            ensureMemoryStoreLoaded: main.ensureMemoryStoreLoaded,
            getMemoryGraphReadApi: read.getMemoryGraphReadApi,
        })).catch((err) => {
            internalModules = null;
            throw new SourceError('api', String(err?.message || err));
        });
    }
    return internalModules;
}

function chatLabelOf(ctx) {
    try {
        if (ctx.groupId) {
            const group = (ctx.groups || []).find(g => String(g.id) === String(ctx.groupId));
            return group?.name || '';
        }
        return ctx.name2 || '';
    } catch {
        return '';
    }
}

export function createLukerSource() {
    let api = null;

    const resolveApi = () => {
        const ctx = getContext();
        api = ctx.getExtensionApi?.('memory-graph') || null;
        if (!api) throw new SourceError('no-extension');
        return { ctx, api };
    };

    return {
        kind: 'luker',
        locale() {
            try {
                return getContext().getCurrentLocale?.() || navigator.language;
            } catch {
                return navigator.language;
            }
        },

        async load() {
            const { ctx, api: mg } = resolveApi();
            const chatId = typeof ctx.getCurrentChatId === 'function' ? ctx.getCurrentChatId() : ctx.chatId;
            if (!chatId) throw new SourceError('no-chat');
            const internals = await loadInternals();
            const store = (await internals.ensureStoreSyncedWithChat?.(ctx))
                || (await internals.ensureMemoryStoreLoaded?.(ctx));
            if (!store) throw new SourceError('no-chat');
            const read = internals.getMemoryGraphReadApi(store, ctx);
            const nodes = read.listNodes({ activeOnly: false });
            const edges = read.listEdges({});
            let schema = null;
            try { schema = read.getSchema(); } catch { schema = null; }
            let injection = null;
            try { injection = mg.getCurrentInjection?.(ctx) || read.getInjectionState?.(); } catch { injection = null; }
            let lastRecall = null;
            try { lastRecall = await mg.getLastRecallProjection?.(ctx); } catch { lastRecall = null; }
            return {
                chatKey: String(chatId),
                chatLabel: chatLabelOf(ctx),
                loadedAt: Date.now(),
                nodes,
                edges,
                schema,
                injection,
                lastRecall,
            };
        },

        /**
         * @param {(reason: string) => void} onChange
         * @returns {() => void} unsubscribe
         */
        subscribe(onChange) {
            const offs = [];
            try {
                const { ctx, api: mg } = resolveApi();
                const offCommit = mg.onStoreCommit?.(() => onChange('commit'));
                if (typeof offCommit === 'function') offs.push(offCommit);
                const offInjection = mg.onInjectionChanged?.(() => onChange('injection'));
                if (typeof offInjection === 'function') offs.push(offInjection);
                const events = ctx.eventSource;
                const types = ctx.eventTypes || ctx.event_types || {};
                const bind = (names, reason) => {
                    for (const name of names) {
                        const type = types[name];
                        if (!type || !events?.on) continue;
                        const handler = () => onChange(reason);
                        events.on(type, handler);
                        offs.push(() => events.removeListener?.(type, handler));
                    }
                };
                bind(CHAT_EVENTS, 'chat');
                bind(MESSAGE_EVENTS, 'message');
            } catch {
                // No host / extension yet; load() will surface the error.
            }
            return () => {
                for (const off of offs.splice(0)) {
                    try { off(); } catch { /* ignore */ }
                }
            };
        },

        /** Opens memory-graph's built-in inspector (editing lives there). */
        openNative() {
            const button = document.getElementById('luker_rpg_memory_view_graph');
            if (!button) return false;
            button.click();
            return true;
        },
    };
}
