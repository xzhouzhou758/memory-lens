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

import { buildTaskMessages as aiTaskMessages } from './ai/ai-model.js';

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
        ai: createAiAccess(resolveApi),
        edit: createEditAccess(resolveApi),
    };
}

// ---------------------------------------------------------------------------
// Editing stored memories
// ---------------------------------------------------------------------------
//
// Mirrors memory-graph's own manual-edit commit (as used by its graph
// iteration studio): edit a copy of the live store with the write-api
// (preserveSeqOnEdit, so the node keeps its place on the timeline), commit it
// through commitGraphUiMutation (persists + fires onStoreCommit), then
// re-sync vectors. Falls back to the public openSession().editNode if those
// internals ever move. Undo writes the previous values back the same way.

function createEditAccess(resolveApi) {
    let internals = null;
    const loadInternals = async () => {
        if (!internals) {
            internals = Promise.all([import(`${MG_BASE}/main.js`), import(`${MG_BASE}/write-api.js`)])
                .then(([main, write]) => ({ main, write }))
                .catch(() => ({ main: {}, write: {} }));
        }
        return internals;
    };
    const split = (fields) => {
        const setFields = {};
        const clearFields = [];
        for (const [key, value] of Object.entries(fields || {})) {
            const empty = value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length);
            if (empty) clearFields.push(key);
            else setFields[key] = value;
        }
        return { setFields, clearFields };
    };
    const check = (result) => {
        if (result && result.ok === false) throw new SourceError('write-failed', result.error?.message || result.error?.code || 'edit failed');
        return result;
    };
    const run = async (id, fields, title) => {
        const { ctx, api: mg } = resolveApi();
        const { main, write } = await loadInternals();
        const op = { id, ...split(fields), ...(title !== undefined ? { title } : {}) };
        const manual = ['ensureStoreSyncedWithChat', 'commitGraphUiMutation', 'getChatKey'].every(k => typeof main[k] === 'function')
            && typeof write.getMemoryGraphWriteApi === 'function';
        if (manual) {
            const live = await main.ensureStoreSyncedWithChat(ctx);
            const chatKey = String(main.getChatKey(ctx) || '').trim();
            if (!live || !chatKey) throw new SourceError('no-chat');
            const working = structuredClone(live);
            const api = write.getMemoryGraphWriteApi(working, ctx, { onCommit: null, useInFlightAnchor: false, preserveSeqOnEdit: true });
            const result = check(await api.editNode(op));
            if (result?.changed === false) return result;
            await main.commitGraphUiMutation(ctx, chatKey, { beforeStore: live, afterStore: working, replaceGraph: false, seq: null });
            try { await main.syncGraphVectorsAfterMutation?.(ctx, chatKey, working); } catch (err) { console.warn('[memory-lens] vector sync after edit failed', err); }
            return result;
        }
        if (typeof mg.openSession !== 'function') throw new SourceError('edit-unsupported');
        const session = await mg.openSession(ctx);
        if (!session || typeof session.editNode !== 'function') throw new SourceError('edit-unsupported');
        return check(await session.editNode(op));
    };
    return {
        /**
         * @param {object} node model node
         * @param {{ fields?: object, title?: string }} patch
         * @returns previous values, for restore()
         */
        async updateNode(node, { fields = {}, title } = {}) {
            const previous = { id: node.id, fields: {}, title: undefined };
            for (const key of Object.keys(fields)) previous.fields[key] = structuredClone(node.fields?.[key] ?? null);
            if (title !== undefined) previous.title = node.rawTitle || '';
            await run(node.id, fields, title);
            return previous;
        },
        async restore(previous) {
            await run(previous.id, previous.fields, previous.title);
        },
    };
}

// ---------------------------------------------------------------------------
// AI schema assistant
// ---------------------------------------------------------------------------
//
// Reuses memory-graph's exported pieces: the tool catalog + sandbox
// (schema-iteration/tools.js), the read tool dispatcher, the default system
// prompt and Luker's tool-calling runner. The turn loop and the UI are ours.
// Edits land in the structure editor as unsaved drafts; nothing is written
// until the user presses 保存 there. Sessions live in our own settings key.

const ITER_BASE = `${MG_BASE}/schema-iteration`;
const SCHEMA_READ_TOOL = {
    type: 'function',
    function: {
        name: 'mg_schema_read_fields',
        description: 'Read exact values from the current working MG node-type schema by lodash-style paths. Read-only. The root is the schema array; common paths: "[N].id", "[N].label", "[N].tableColumns", "[N].columnHints", "[N].extractionInstructions", "[N].compression.mode", "length". Prefer specific indexed paths.',
        parameters: {
            type: 'object',
            properties: { paths: { type: 'array', items: { type: 'string' }, description: 'Lodash-style paths into the schema array.' } },
            required: ['paths'],
            additionalProperties: false,
        },
    },
};
const LANGUAGE_NOTE = [
    '',
    '# Working mode',
    'Your edits go into a working draft that the user reviews in a visual editor and saves themselves; do not ask them to confirm each step.',
    'Always reply to the user in Simplified Chinese, in short plain sentences. Avoid technical field names (tableColumns, primaryKeyColumns…) in replies; describe changes by their display names.',
    'Write label and columnHints values in Simplified Chinese unless the user asks otherwise. Keep existing column keys unchanged; new column keys must be snake_case ASCII.',
].join('\n');

function createAiAccess(resolveApi) {
    let modules = null;
    const loadModules = async () => {
        if (!modules) {
            modules = Promise.all([
                import(`${MG_BASE}/main.js`),
                import(`${MG_BASE}/character-overrides.js`),
                import(`${ITER_BASE}/tools.js`),
                import(`${ITER_BASE}/system-prompt.js`),
                import(`${ITER_BASE}/read-fields-dispatcher.js`),
                import('/scripts/iteration-library/runner.js'),
            ]).then(([main, overrides, tools, prompt, readFields, runner]) => {
                const needed = [main.getSettings, main.normalizeNodeTypeSchema, tools.buildToolCatalog, tools.normalizeToolCallToEdit,
                    readFields.dispatchMgSchemaReadFields, runner.requestToolCallsWithRetry];
                if (needed.some(fn => typeof fn !== 'function')) throw new SourceError('ai-unsupported');
                return { main, overrides, tools, prompt, readFields, runner };
            }).catch((err) => {
                modules = null;
                throw err instanceof SourceError ? err : new SourceError('ai-unsupported', String(err?.message || err));
            });
        }
        return modules;
    };

    const bucket = (ctx) => {
        const all = ctx.extensionSettings || {};
        all[LABEL_KEY] ||= {};
        all[LABEL_KEY].aiSessions ||= {};
        return all[LABEL_KEY].aiSessions;
    };
    const scopeKey = (ctx, main, mg) => {
        const info = mg.getSchemaScopeInfo?.(ctx, main.getSettings());
        return info?.hasAvatar ? `character_${info.avatar}` : 'global';
    };

    return {
        async check() {
            await loadModules();
            return true;
        },

        async listSessions() {
            const { ctx, api: mg } = resolveApi();
            const { main } = await loadModules();
            return structuredClone(bucket(ctx)[scopeKey(ctx, main, mg)] || []);
        },

        async saveSessions(list) {
            const { ctx, api: mg } = resolveApi();
            const { main } = await loadModules();
            bucket(ctx)[scopeKey(ctx, main, mg)] = structuredClone(list);
            ctx.saveSettingsDebounced?.();
        },

        /**
         * One model round. Read tools run against `live`; edit tools run in
         * memory-graph's sandbox and chain onto `live`.
         */
        async round({ messages, live, signal }) {
            const { ctx } = resolveApi();
            const { main, overrides, tools, prompt, readFields, runner } = await loadModules();
            const settings = main.getSettings();
            const effective = (typeof overrides.getEffectiveSettings === 'function' ? overrides.getEffectiveSettings(ctx, settings) : null) || settings;
            const basePrompt = String(effective?.schemaIterSystemPrompt || '').trim() || prompt.DEFAULT_SCHEMA_ITER_SYSTEM_PROMPT || '';
            const control = new Set(Object.values(tools.CONTROL_TOOL_NAMES || {}));
            const catalog = [...tools.buildToolCatalog().filter(def => !control.has(def?.function?.name)), SCHEMA_READ_TOOL];
            const result = await runner.requestToolCallsWithRetry(ctx, {
                toolCallRetryMax: settings?.toolCallRetryMax,
                rpmLimit: settings?.rpmLimit,
            }, {
                taskMessages: aiTaskMessages(`${basePrompt}${LANGUAGE_NOTE}`, messages),
                runtimeWorldInfo: null,
                apiPresetName: String(settings?.requestApiPresetName || '').trim(),
                llmPresetName: String(settings?.requestLlmPresetName || '').trim(),
                tools: catalog,
                abortSignal: signal,
                includeAssistantText: true,
                allowNoToolCalls: true,
            });
            let current = live;
            const calls = [];
            for (const raw of Array.isArray(result?.toolCalls) ? result.toolCalls : []) {
                const name = String(raw?.name || '');
                if (control.has(name)) continue;
                const args = raw?.args && typeof raw.args === 'object' ? raw.args : {};
                const id = String(raw?.id || '') || `ml_call_${Date.now().toString(36)}_${calls.length}`;
                let content;
                let ok = true;
                try {
                    if (name === SCHEMA_READ_TOOL.function.name) {
                        content = await readFields.dispatchMgSchemaReadFields({ liveSchema: current, args });
                    } else {
                        const edits = await tools.normalizeToolCallToEdit(
                            { function: { name, arguments: JSON.stringify(args) } },
                            { live: current, normalizeNodeTypeSchema: main.normalizeNodeTypeSchema },
                        );
                        if (edits?.length) {
                            current = edits[edits.length - 1].newValue;
                            content = { status: 'applied', message: 'Applied to the working draft. The user reviews and saves it.' };
                        } else {
                            ok = false;
                            content = { status: 'noop', message: 'No change produced; the schema already matches. Re-read before retrying.' };
                        }
                    }
                } catch (err) {
                    ok = false;
                    content = { error: String(err?.message || err || 'failed') };
                }
                calls.push({ id, name, args, result: content, ok });
            }
            return {
                assistantText: String(result?.assistantText || ''),
                reasoning: String(result?.reasoning || ''),
                reasoningBlocks: result?.reasoningBlocks || null,
                reasoningDetails: result?.reasoningDetails || null,
                calls,
                live: current,
            };
        },
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
