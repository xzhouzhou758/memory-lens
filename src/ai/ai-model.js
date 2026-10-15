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
        if (payload?.status === 'rolled_back' || payload?.status === 'rejected') m.rolledBack = true;
    }
}

// ----- Prompts for the structure tools (AI 优化 / 完善这个类型) -------------
//
// Two layers:
// - TASK: the bare minimum the tool needs to work (what to return, keep
//   column keys). Always sent.
// - BUILTIN: our optimisation guide — how memory-graph uses each part of a
//   type, what good hints look like, which switches suit what. Sent when
//   「使用内置优化提示词」 is ticked (default on).
// The user's generation preset (e.g. a jailbreak preset) wraps both; we don't
// touch it. The guide therefore tells the model to ignore prose-style
// instructions from the preset for this task.

const BUILTIN_GUIDE = [
    '【任务性质】这是整理「记忆结构」的工具任务，不是写故事。预设里关于文风、叙事、节奏、人设扮演的要求在这里不适用；只按下面的规则输出。',
    '',
    '【记忆系统怎么用这些内容】角色扮演聊天里的事实会被一个「提取 AI」按类型记成条目，之后相关条目会被召回给聊天模型。',
    '- 类型说明（extractHint）：提取 AI 靠它判断哪些事实属于这一类、什么时候新建或更新一条。一两句话。',
    '- 记录项（tableColumns）和每项的「给 AI 的提示」（columnHints）：提取 AI 填这一项时照着做。要写清：填什么、格式、长度、可选值、什么时候留空、人名地名怎么写才能和其他类型对上。',
    '- 必填（requiredColumns）：提取 AI 必须填。只给标识项和最核心的事实，少而精。',
    '- 一直让 AI 看到（alwaysInject）：每次回复都带上所有条目。只适合少而重要的内容（剧情线、规则、进行中的约定），会占上下文。',
    '- 同名只保留最新（latestOnly + primaryKeyColumns）：同一个对象只留一条，新信息覆盖旧的。适合「当前状态」类；主键必须是标识项。',
    '- 自动合并成摘要（compression hierarchical）：旧条目合并成摘要。只适合数量多、只增不改的类型（如事件）。',
    '',
    '【好的「给 AI 的提示」】具体、可执行、短（一到三句）。例：「当事人全名，写法须与角色类型的名称一致；本人写 {{user}}。」避免空泛的「详细描述」。保留已有的约束、宏（如 {{user}}）、可选值列表和对其他类型的引用。',
    '【语言】给人看的内容（名称、说明、提示）一律用简体中文；代码样的记号（{{user}}、表名）原样保留。',
];

const TASK = {
    columnHint: '任务：改写下面这一项的「给 AI 的提示」，让提取 AI 更容易照做。调用一次 submit_text，只交回改写后的提示文字。',
    typeIntro: '任务：改写下面这个类型的说明：这类记忆记什么、什么时候新建或更新一条，一两句话。调用一次 submit_text，只交回改写后的说明。',
    suggest: [
        '任务：完善下面这一个记忆类型，让它记得好、用得上。调用一次 mg_schema_set_node_type，传入改进后的完整类型（id 不变）。',
        '硬性要求：已有记录项的 key 一律不改（可以改它的提示）；没有用户要求不要删除已有记录项；新 key 用 snake_case 英文；extractionInstructions、keywords 等高级字段不要传。',
    ].join('\n'),
};

const SUGGEST_GUIDE = [
    '【完善类型时】',
    '- 给一个清楚的中文名称和一两句类型说明。',
    '- 记录项一般 4–9 个；第一项用来标识这一条（如「显示名」），每项都配上具体的提示。',
    '- 按上面的规则慎重选择三个开关；开启「同名只保留最新」时设好主键。',
    '- 与其他类型保持一致：提到人和地点时用它们的写法。',
    '- 工具调用后，用一句中文概括你的主要思路。',
];

export function rewriteSystemPrompt(kind, { builtin = true } = {}) {
    return [...(builtin ? [...BUILTIN_GUIDE, ''] : []), TASK[kind] || TASK.columnHint].join('\n');
}

export function suggestSystemPrompt({ builtin = true } = {}) {
    return [...(builtin ? [...BUILTIN_GUIDE, '', ...SUGGEST_GUIDE, ''] : []), TASK.suggest].join('\n');
}

export function rewriteUserPrompt({ kind, text, typeName = '', itemName = '', siblings = [] }) {
    const lines = [];
    if (typeName) lines.push(`记忆类型：${typeName}`);
    if (itemName) lines.push(`记录项：${itemName}`);
    if (siblings.length) lines.push(`这个类型的其他记录项：${siblings.slice(0, 40).join('、')}`);
    lines.push('', kind === 'typeIntro' ? '当前说明：' : '当前提示：', String(text || '') || '（空，请写一段）');
    return lines.join('\n');
}

const briefType = (t) => {
    const hints = t.columnHints || {};
    const cols = (t.tableColumns || []).map(k => `${k}${hints[k] ? `（${String(hints[k]).slice(0, 40)}）` : ''}`).join('、');
    return `- ${t.id}「${t.label || t.id}」：${cols}`;
};

export function suggestUserPrompt({ spec, others = [], request = '' }) {
    const current = spec ? {
        id: spec.id,
        label: spec.label,
        extractHint: spec.extractHint,
        tableColumns: spec.tableColumns,
        columnHints: spec.columnHints,
        requiredColumns: spec.requiredColumns,
        primaryKeyColumns: spec.primaryKeyColumns,
        alwaysInject: spec.alwaysInject,
        latestOnly: spec.latestOnly,
        compression: { mode: spec.compression?.mode || 'none' },
    } : {};
    return [
        `用户要求：${request.trim() || '（没有，按这个类型的用途自己判断，让它完整好用）'}`,
        '',
        '要完善的类型（JSON）：',
        JSON.stringify(current, null, 2),
        '',
        '结构里的其他类型（保持一致用）：',
        others.map(briefType).join('\n') || '（无）',
    ].join('\n');
}
