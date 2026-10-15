// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Pure helpers for the AI schema assistant (no DOM, no Luker imports).
// The conversation shape mirrors memory-graph's own schema studio so the
// tool-call history replays the same way: assistant messages carry
// `toolCalls` [{id,name,args}] and `toolResults` [{tool_call_id,content,status}].

const READ_TOOLS = new Set(['mg_schema_read_fields']);
const EDIT_TEXT = {
    mg_schema_set_node_type: '修改类型',
    mg_schema_remove_node_type: '删除类型',
    mg_schema_reorder_node_types: '调整类型顺序',
    mg_schema_read_fields: '查看当前结构',
};

export const MAX_ROUNDS = 8;
export const MAX_SESSIONS = 12;

export const makeId = (prefix = 'ml') => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export function isEditTool(name) {
    return String(name || '').startsWith('mg_schema_') && !READ_TOOLS.has(String(name));
}

/** Short Chinese label for a tool call, e.g. "修改类型「物品」". */
export function toolCallText(call) {
    const name = String(call?.name || '');
    const base = EDIT_TEXT[name] || (name.startsWith('world_') || name.includes('lorebook') ? '查阅世界书' : '查阅资料');
    const args = call?.args || {};
    const target = args.label || args.id || args.node_type || args.nodeType?.label || args.nodeType?.id || args.value?.label || args.value?.id || '';
    return target ? `${base}「${target}」` : base;
}

/** Messages the LLM sees: system prompt + replayable user/assistant turns. */
export function buildTaskMessages(systemPrompt, messages) {
    const out = [{ role: 'system', content: systemPrompt }];
    for (const m of messages || []) {
        const role = String(m?.role || '').toLowerCase();
        if (role !== 'user' && role !== 'assistant') continue;
        const content = String(m.content || '');
        const calls = Array.isArray(m.toolCalls) ? m.toolCalls : [];
        if (role === 'assistant' && calls.length) {
            const assistant = {
                role: 'assistant',
                content,
                tool_calls: calls.map(tc => ({
                    id: String(tc.id || ''),
                    type: 'function',
                    function: { name: String(tc.name || ''), arguments: JSON.stringify(tc.args || {}) },
                })),
            };
            if (m.reasoning) assistant.reasoning = m.reasoning;
            if (Array.isArray(m.reasoningBlocks) && m.reasoningBlocks.length) assistant.reasoning_blocks = m.reasoningBlocks;
            if (Array.isArray(m.reasoningDetails) && m.reasoningDetails.length) assistant.reasoning_details = m.reasoningDetails;
            out.push(assistant);
            const results = new Map((m.toolResults || []).map(r => [String(r.tool_call_id), r]));
            for (const tc of calls) {
                const r = results.get(String(tc.id));
                let serialized = '';
                try {
                    serialized = typeof r?.content === 'string' ? r.content : JSON.stringify(r?.content ?? { status: 'committed' });
                } catch { serialized = ''; }
                out.push({ role: 'tool', tool_call_id: String(tc.id || ''), content: serialized });
            }
            continue;
        }
        out.push({ role, content });
    }
    return out;
}

/**
 * Runs one user turn: keeps calling `round()` while the AI emits tool calls.
 * @param {(args: { messages: object[], live: object[], signal?: AbortSignal }) => Promise<{
 *   assistantText: string, reasoning?: string, reasoningBlocks?: any[], reasoningDetails?: any[],
 *   calls: { id: string, name: string, args: object, result: any, ok: boolean }[], live: object[] }>} round
 * @param {{ messages: object[] }} session mutated: assistant messages appended
 * @returns {Promise<{ live: object[], changed: boolean, rounds: number }>}
 */
export async function runTurn(round, session, { live, signal = null, onUpdate = null, maxRounds = MAX_ROUNDS } = {}) {
    const start = JSON.stringify(live);
    let current = live;
    let rounds = 0;
    while (rounds < maxRounds) {
        if (signal?.aborted) throw abortError();
        rounds++;
        const out = await round({ messages: session.messages, live: current, signal });
        const message = { id: makeId('msg'), role: 'assistant', content: String(out.assistantText || '').trim(), at: Date.now() };
        if (out.reasoning) message.reasoning = out.reasoning;
        if (out.reasoningBlocks?.length) message.reasoningBlocks = out.reasoningBlocks;
        if (out.reasoningDetails?.length) message.reasoningDetails = out.reasoningDetails;
        if (out.calls?.length) {
            message.toolCalls = out.calls.map(c => ({ id: c.id, name: c.name, args: c.args || {} }));
            message.toolResults = out.calls.map(c => ({ tool_call_id: c.id, content: c.result, status: c.ok ? 'ok' : 'fail' }));
        }
        session.messages.push(message);
        session.at = Date.now();
        current = Array.isArray(out.live) ? out.live : current;
        onUpdate?.(current, message);
        if (!out.calls?.length) break;
    }
    return { live: current, changed: JSON.stringify(current) !== start, rounds };
}

export function abortError() {
    const err = new Error('aborted');
    err.name = 'AbortError';
    return err;
}

export function newSession() {
    return { id: makeId('sess'), title: '', at: Date.now(), messages: [] };
}

export function sessionTitle(text) {
    const line = String(text || '').trim().split('\n')[0];
    return line.length > 24 ? `${line.slice(0, 24)}…` : line;
}

/** Keeps the newest sessions, drops empty ones, caps the list. */
export function upsertSession(list, session) {
    const rest = (list || []).filter(s => s.id !== session.id);
    const next = session.messages.length ? [session, ...rest] : rest;
    return next.sort((a, b) => b.at - a.at).slice(0, MAX_SESSIONS);
}

/** Marks the edit tool results of the given message ids as rolled back. */
export function markRolledBack(messages, ids, payload) {
    const set = new Set(ids);
    for (const m of messages) {
        if (!set.has(m.id) || !Array.isArray(m.toolResults)) continue;
        const editIds = new Set((m.toolCalls || []).filter(c => isEditTool(c.name)).map(c => String(c.id)));
        for (const r of m.toolResults) {
            if (editIds.has(String(r.tool_call_id)) && r.status === 'ok') r.content = payload;
        }
        m.rolledBack = true;
    }
}
