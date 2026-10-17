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

import { readFilterSettings, writeFilterSettings } from './filter/filter-runtime.js';
import { SUBMIT_FILTER, diagnoseSystemPrompt, diagnoseUserPrompt, readDiagnosis } from './filter/filter-ai.js';
import { countTokens, readEntries, clearEntries, TOKENS_EVENT, META_KEY as TOKENS_META_KEY } from './token-stats.js';
import { buildTaskMessages as aiTaskMessages, rewriteSystemPrompt, rewriteUserPrompt, suggestSystemPrompt, suggestUserPrompt } from './ai/ai-model.js';

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
    let tokenCache = { at: 0, core: 0, focus: 0 };

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
            let tokens = null;
            try {
                const at = Number(lastRecall?.at || 0);
                if (at && tokenCache.at !== at) {
                    const [core, focus] = await Promise.all([countTokens(ctx, lastRecall.blocks?.corePacket), countTokens(ctx, lastRecall.blocks?.focusPacket)]);
                    tokenCache = { at, core, focus };
                }
                tokens = { current: at ? { ...tokenCache } : null, entries: structuredClone(readEntries(ctx)) };
            } catch { tokens = null; }
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
                tokens,
            };
        },

        /** Clears this chat's token log; returns the old entries for undo. */
        clearTokens() {
            const ctx = getContext();
            const previous = structuredClone(readEntries(ctx));
            clearEntries(ctx);
            return previous;
        },

        restoreTokens(entries) {
            const ctx = getContext();
            if (!ctx.chatMetadata) return;
            ctx.chatMetadata[TOKENS_META_KEY] = { v: 1, entries: structuredClone(entries || []) };
            ctx.saveMetadataDebounced?.();
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
                const onTokens = () => onChange('tokens');
                globalThis.addEventListener?.(TOKENS_EVENT, onTokens);
                offs.push(() => globalThis.removeEventListener?.(TOKENS_EVENT, onTokens));
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
        filter: createFilterAccess(),
    };
}

// ---------------------------------------------------------------------------
// 标签过滤: settings + sample replies (the scripts live in filter-runtime.js)
// ---------------------------------------------------------------------------

function createFilterAccess() {
    return {
        read: () => readFilterSettings(getContext()),
        write: (settings) => writeFilterSettings(getContext(), settings),
        /** Latest AI replies, newest first: { floor, text }. */
        recentReplies(limit = 8) {
            const chat = Array.isArray(getContext().chat) ? getContext().chat : [];
            const out = [];
            for (let i = chat.length - 1; i >= 0 && out.length < limit; i--) {
                const m = chat[i];
                if (!m || m.is_user || m.is_system || !String(m.mes || '').trim()) continue;
                out.push({ floor: i, text: String(m.mes) });
            }
            return out;
        },
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

    // ----- Which model each AI uses ------------------------------------------
    // Stored in our own settings; '' = follow memory-graph's request presets.
    // The 'tools' group (AI 优化 / 完善类型) may also say 'same' = AI 助手's.
    const aiSettings = (ctx) => {
        const all = ctx.extensionSettings || {};
        all[LABEL_KEY] ||= {};
        all[LABEL_KEY].ai ||= {};
        const ai = all[LABEL_KEY].ai;
        ai.assistant ||= { api: '', preset: '' };
        ai.tools ||= { same: true, api: '', preset: '' };
        if (ai.tools.builtinPrompt === undefined) ai.tools.builtinPrompt = true;
        return ai;
    };
    const presetsFor = (ctx, settings, role) => {
        const ai = aiSettings(ctx);
        const group = role === 'tools' && !ai.tools.same ? ai.tools : ai.assistant;
        return {
            apiPresetName: String(group.api || settings?.requestApiPresetName || '').trim(),
            llmPresetName: String(group.preset || settings?.requestLlmPresetName || '').trim(),
        };
    };
    const runnerSettings = (settings) => ({ toolCallRetryMax: settings?.toolCallRetryMax, rpmLimit: settings?.rpmLimit });

    const SUBMIT_TEXT = {
        type: 'function',
        function: {
            name: 'submit_text',
            description: 'Submit the rewritten text. Call exactly once.',
            parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
        },
    };

    const useBuiltin = () => {
        try { return aiSettings(resolveApi().ctx).tools.builtinPrompt !== false; } catch { return true; }
    };

    async function oneShot(role, { system, user, tools, allowedNames, signal = null }) {
        const { ctx } = resolveApi();
        const { main, runner } = await loadModules();
        const settings = main.getSettings();
        return runner.requestToolCallsWithRetry(ctx, runnerSettings(settings), {
            taskMessages: [{ role: 'system', content: system }, { role: 'user', content: user }],
            runtimeWorldInfo: null,
            ...presetsFor(ctx, settings, role),
            tools,
            allowedNames,
            abortSignal: signal,
            includeAssistantText: true,
            allowNoToolCalls: true,
        });
    }

    return {
        async check() {
            await loadModules();
            return true;
        },

        /** Connection profiles / generation presets the user can pick, plus current choices. */
        async settings() {
            const { ctx } = resolveApi();
            const { main } = await loadModules();
            const settings = main.getSettings();
            let connections = [];
            try {
                const resolver = await import('/scripts/extensions/connection-manager/profile-resolver.js');
                connections = (resolver.getChatCompletionConnectionProfiles?.() || []).map(p => p.name).filter(Boolean);
            } catch { connections = []; }
            let presets = [];
            try {
                const names = ctx.getPresetManager?.('openai')?.getAllPresets?.();
                presets = Array.isArray(names) ? [...new Set(names.map(n => String(n || '').trim()).filter(Boolean))] : [];
            } catch { presets = []; }
            return {
                connections,
                presets,
                memory: { api: String(settings?.requestApiPresetName || ''), preset: String(settings?.requestLlmPresetName || '') },
                ai: structuredClone(aiSettings(ctx)),
            };
        },

        async saveSettings(next) {
            const { ctx } = resolveApi();
            const ai = aiSettings(ctx);
            ai.assistant = { api: String(next?.assistant?.api || ''), preset: String(next?.assistant?.preset || '') };
            ai.tools = { same: next?.tools?.same !== false, api: String(next?.tools?.api || ''), preset: String(next?.tools?.preset || ''), builtinPrompt: next?.tools?.builtinPrompt !== false };
            ctx.saveSettingsDebounced?.();
        },

        /** Sends a tiny request with the given role's model. */
        async test(role) {
            const result = await oneShot(role, {
                system: 'Connectivity check. Call submit_text with the text "OK".',
                user: 'ping',
                tools: [SUBMIT_TEXT],
                allowedNames: ['submit_text'],
            });
            const ok = (result?.toolCalls || []).some(c => c?.name === 'submit_text') || Boolean(String(result?.assistantText || '').trim());
            if (!ok) throw new SourceError('ai-empty', 'AI 没有返回内容');
            return true;
        },

        /** 标签过滤 AI 诊断: proposes a black / white list for one reply. */
        async diagnoseFilter(sample) {
            const result = await oneShot('tools', {
                system: diagnoseSystemPrompt(),
                user: diagnoseUserPrompt(sample),
                tools: [SUBMIT_FILTER],
                allowedNames: ['submit_filter'],
            });
            const call = (result?.toolCalls || []).find(c => c?.name === 'submit_filter');
            if (!call) throw new SourceError('ai-empty', 'AI 没有给出方案');
            return readDiagnosis(call.args, sample);
        },

        /** AI 优化 for one schema text (item hint / type intro). */
        async rewrite(request) {
            const result = await oneShot('tools', {
                system: rewriteSystemPrompt(request.kind, { builtin: useBuiltin() }),
                user: rewriteUserPrompt(request),
                tools: [SUBMIT_TEXT],
                allowedNames: ['submit_text'],
            });
            const call = (result?.toolCalls || []).find(c => c?.name === 'submit_text');
            const text = String(call?.args?.text ?? result?.assistantText ?? '').trim();
            if (!text) throw new SourceError('ai-empty', 'AI 没有返回内容');
            return text;
        },

        /**
         * 「AI 帮我完善这个类型」: the AI calls memory-graph's own set_node_type
         * once; we run it in the sandbox and return the full proposed schema.
         * @returns {{ live: object[], note: string }}
         */
        async suggestType({ live, typeId, request = '', signal = null }) {
            const { main, tools } = await loadModules();
            const setTool = tools.buildToolCatalog().find(def => def?.function?.name === 'mg_schema_set_node_type');
            if (!setTool) throw new SourceError('ai-unsupported');
            const spec = live.find(t => String(t.id) === String(typeId));
            const result = await oneShot('tools', {
                system: suggestSystemPrompt({ builtin: useBuiltin() }),
                user: suggestUserPrompt({ spec, others: live.filter(t => t !== spec), request }),
                tools: [setTool],
                allowedNames: ['mg_schema_set_node_type'],
                signal,
            });
            const call = (result?.toolCalls || []).find(c => c?.name === 'mg_schema_set_node_type');
            if (!call) throw new SourceError('ai-empty', String(result?.assistantText || '').trim() || 'AI 没有给出建议');
            const args = { ...(call.args || {}), id: String(typeId) };
            const edits = await tools.normalizeToolCallToEdit(
                { function: { name: 'mg_schema_set_node_type', arguments: JSON.stringify(args) } },
                { live, normalizeNodeTypeSchema: main.normalizeNodeTypeSchema },
            );
            const next = edits?.length ? edits[edits.length - 1].newValue : live;
            return { live: next, note: String(result?.assistantText || '').trim() };
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
            const result = await runner.requestToolCallsWithRetry(ctx, runnerSettings(settings), {
                taskMessages: aiTaskMessages(`${basePrompt}${LANGUAGE_NOTE}`, messages),
                runtimeWorldInfo: null,
                ...presetsFor(ctx, settings, 'assistant'),
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

        /**
         * Downloads `types` as a memory-graph schema file (the same format and
         * file name as the native 导出). Our column names ride along in an
         * extra field the native importer ignores.
         */
        async exportFile(types, labels = {}) {
            const { ctx, api: mg } = resolveApi();
            const [main, io] = await Promise.all([loadMain(), loadIo()]);
            if (typeof ctx.download !== 'function' || typeof io.buildSchemaExportPayload !== 'function') throw new SourceError('schema-unsupported');
            const info = mg.getSchemaScopeInfo(ctx, main.getSettings());
            const payload = io.buildSchemaExportPayload(types, info, main.normalizeNodeTypeSchema);
            if (labels && Object.keys(labels).length) payload.memoryLensLabels = structuredClone(labels);
            const fileName = io.getSchemaExportFileName(info);
            ctx.download(JSON.stringify(payload, null, 2), fileName, 'application/json');
            return fileName;
        },

        /**
         * Lets the user pick a schema file and parses it with memory-graph's
         * own validator. Resolves null if no file was picked.
         * @returns {Promise<{ types: object[], labels: object }|null>}
         */
        async importFile() {
            const { ctx } = resolveApi();
            const [main, io] = await Promise.all([loadMain(), loadIo()]);
            if (typeof io.parseSchemaImportPayload !== 'function') throw new SourceError('schema-unsupported');
            const file = await pickFile('.json,application/json');
            if (!file) return null;
            const text = typeof ctx.getFileText === 'function' ? await ctx.getFileText(file) : await file.text();
            let parsed;
            try { parsed = JSON.parse(text); } catch { throw new SourceError('bad-file', '文件不是有效的 JSON'); }
            let types;
            try { types = io.parseSchemaImportPayload(parsed, main.normalizeNodeTypeSchema); } catch { throw new SourceError('bad-file', '这不是记忆结构文件'); }
            const labels = parsed && typeof parsed.memoryLensLabels === 'object' && !Array.isArray(parsed.memoryLensLabels) ? parsed.memoryLensLabels : {};
            return { types: structuredClone(types), labels: structuredClone(labels) };
        },
    };

    function loadIo() {
        return import(`${MG_BASE}/import-export.js`).catch(() => ({}));
    }
}

/** Opens the system file picker; resolves the chosen file or null. */
function pickFile(accept) {
    return new Promise((resolve) => {
        // Detached input, same as memory-graph's own importer.
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = accept;
        let done = false;
        const finish = (file) => { if (!done) { done = true; resolve(file || null); } };
        input.addEventListener('change', () => finish(input.files?.[0]), { once: true });
        input.addEventListener('cancel', () => finish(null), { once: true });
        input.click();
    });
}
