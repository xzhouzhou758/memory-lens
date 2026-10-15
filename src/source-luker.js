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
            getSettings: main.getSettings,
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
            // Full schema (labels + column hints) for display names; the
            // read-api view omits those. Fall back to the read-api view.
            let schema = null;
            try {
                const info = mg.getSchemaScopeInfo?.(ctx, internals.getSettings?.());
                if (Array.isArray(info?.schema)) schema = { types: structuredClone(info.schema) };
            } catch { schema = null; }
            if (!schema) {
                try { schema = read.getSchema(); } catch { schema = null; }
            }
            let columnLabels = {};
            try { columnLabels = structuredClone(ctx.extensionSettings?.[LABEL_KEY]?.columnLabels || {}); } catch { columnLabels = {}; }
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
                columnLabels,
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

        schema: createSchemaAccess(resolveApi),
    };
}

// ---------------------------------------------------------------------------
// Memory structure (node-type schema) read / write
// ---------------------------------------------------------------------------
//
// Mirrors memory-graph's own schema editor: global = settings.nodeTypeSchema
// + saveSettings(); per character = the registered persistCharacterSchemaOverride.
// Everything goes through memory-graph's normalizeNodeTypeSchema first, so the
// stored shape is exactly what the native editor would have written.

const LABEL_KEY = 'memory_lens';

function createSchemaAccess(resolveApi) {
    let mainModule = null;
    const loadMain = async () => {
        if (!mainModule) {
            mainModule = import(`${MG_BASE}/main.js`).catch((err) => {
                mainModule = null;
                throw new SourceError('api', String(err?.message || err));
            });
        }
        return mainModule;
    };

    const labelStore = (ctx) => {
        const all = ctx.extensionSettings || {};
        all[LABEL_KEY] ||= {};
        all[LABEL_KEY].columnLabels ||= {};
        return all[LABEL_KEY].columnLabels;
    };

    return {
        async read() {
            const { ctx, api: mg } = resolveApi();
            const main = await loadMain();
            if (typeof main.getSettings !== 'function' || typeof main.normalizeNodeTypeSchema !== 'function' || typeof mg.getSchemaScopeInfo !== 'function') {
                throw new SourceError('schema-unsupported');
            }
            const settings = main.getSettings();
            const info = mg.getSchemaScopeInfo(ctx, settings);
            return {
                scope: info.hasOverride ? 'character' : 'global',
                hasCharacter: Boolean(info.hasAvatar),
                characterName: info.characterName || '',
                types: structuredClone(main.normalizeNodeTypeSchema(info.schema)),
                defaults: structuredClone(main.normalizeNodeTypeSchema(main.getDefaultNodeTypeSchema?.() || null)),
                labels: structuredClone(labelStore(ctx)),
            };
        },

        /**
         * @param {object[]} types full type list
         * @param {{ scope: 'global'|'character', labels?: object }} options
         * @returns the previous stored state, for undo
         */
        async write(types, { scope, labels = null }) {
            const { ctx, api: mg } = resolveApi();
            const main = await loadMain();
            const settings = main.getSettings();
            const normalized = main.normalizeNodeTypeSchema(types);
            const info = mg.getSchemaScopeInfo(ctx, settings);
            const previous = {
                scope: info.hasOverride ? 'character' : 'global',
                globalTypes: structuredClone(settings.nodeTypeSchema ?? null),
                characterTypes: info.hasOverride ? structuredClone(info.schema) : null,
                labels: structuredClone(labelStore(ctx)),
            };
            if (scope === 'character') {
                if (!info.hasAvatar) throw new SourceError('no-character');
                const ok = await mg.persistCharacterSchemaOverride(ctx, info.avatar, normalized);
                if (!ok) throw new SourceError('write-failed');
            } else {
                settings.nodeTypeSchema = normalized;
                if (info.hasOverride) {
                    // Saving "for everyone" while a character override exists
                    // would otherwise be shadowed by that override.
                    await mg.removeCharacterSchemaOverride?.(ctx, info.avatar);
                }
            }
            if (labels) {
                const store = labelStore(ctx);
                for (const key of Object.keys(store)) delete store[key];
                Object.assign(store, labels);
            }
            await (ctx.saveSettings ? ctx.saveSettings() : ctx.saveSettingsDebounced?.());
            return previous;
        },

        /** Restores a snapshot returned by write(). */
        async restore(previous) {
            const { ctx, api: mg } = resolveApi();
            const main = await loadMain();
            const settings = main.getSettings();
            const info = mg.getSchemaScopeInfo(ctx, settings);
            settings.nodeTypeSchema = previous.globalTypes ?? settings.nodeTypeSchema;
            if (previous.characterTypes && info.hasAvatar) {
                await mg.persistCharacterSchemaOverride(ctx, info.avatar, previous.characterTypes);
            } else if (!previous.characterTypes && info.hasOverride) {
                await mg.removeCharacterSchemaOverride?.(ctx, info.avatar);
            }
            const store = labelStore(ctx);
            for (const key of Object.keys(store)) delete store[key];
            Object.assign(store, previous.labels || {});
            await (ctx.saveSettings ? ctx.saveSettings() : ctx.saveSettingsDebounced?.());
        },

        async clearCharacter() {
            const { ctx, api: mg } = resolveApi();
            const main = await loadMain();
            const info = mg.getSchemaScopeInfo(ctx, main.getSettings());
            if (!info.hasAvatar) return false;
            return Boolean(await mg.removeCharacterSchemaOverride?.(ctx, info.avatar));
        },

        labels() {
            try {
                const { ctx } = resolveApi();
                return structuredClone(labelStore(ctx));
            } catch {
                return {};
            }
        },
    };
}
