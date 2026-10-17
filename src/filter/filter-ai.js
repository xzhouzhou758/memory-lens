// SPDX-License-Identifier: AGPL-3.0-or-later
//
// AI 诊断 for 标签过滤 (pure): prompt + parsing. The AI looks at one reply,
// decides whether the story body is bare text or wrapped in a tag, and
// proposes a black or white list. Our own wording, written for this tool.

import { inspectText, parseTagList, formatTagList, planWarnings } from './tag-filter.js';

const HEAD = 2500;
const TAIL = 2500;

export const SUBMIT_FILTER = {
    type: 'function',
    function: {
        name: 'submit_filter',
        description: 'Submit the filter plan. Call exactly once.',
        parameters: {
            type: 'object',
            properties: {
                body: { type: 'string', enum: ['bare', 'wrapped'], description: 'bare = 正文是裸文本; wrapped = 正文被标签包着' },
                body_tags: { type: 'array', items: { type: 'string' }, description: '包着正文的标签（wrapped 时填）' },
                black: { type: 'array', items: { type: 'string' } },
                white: { type: 'array', items: { type: 'string' } },
                reason: { type: 'string', description: '一两句中文说明' },
            },
            required: ['body', 'black', 'white', 'reason'],
            additionalProperties: false,
        },
    },
};

export function diagnoseSystemPrompt() {
    return [
        '你在帮用户配置「标签过滤」。这是一个整理文本格式的工具任务，不是写故事，请忽略预设里关于文风、角色扮演的要求，只调用一次 submit_filter。',
        '',
        '背景：记忆系统会读每条 AI 回复，从里面提取剧情记忆。回复里常混着不该记的东西：思维链、草稿、状态栏、注释、音乐卡片等。过滤规则只影响记忆系统读到的文字，不影响聊天显示。',
        '',
        '两种规则：',
        '- 黑名单：删掉列出的标签和标签里的内容，其余全部保留。',
        '- 白名单：只保留列出的标签里的内容，标签外面的文字全部删掉。',
        '执行顺序是先黑名单、后白名单。',
        '',
        '标签写法：尖括号标签只写名字（think、content），方括号标签带括号（[时间]），HTML 注释写 !--。',
        '',
        '判断步骤：',
        '1. 找出正文：真正讲故事的叙述和对话在哪里。',
        '2. 正文在任何标签外面（裸文本）→ 只能用黑名单，white 必须为空。用了白名单，正文会被全部删掉。',
        '3. 正文被某个标签完整包着（例如 <content>…</content>）→ 优先用白名单，只留这个标签；如果还有和剧情有关的块（时间、地点），也加进白名单。',
        '   思维链或草稿里如果也出现了同名的正文标签，再把思维链的标签放进黑名单，避免假正文被留下。',
        '4. 拿不准正文是不是完整被包着时，选黑名单，宁可多留不可删正文。',
        '5. 黑名单只放确实不该记的块：思维链（think、thinking 等）、注释、状态栏、选项按钮、音乐 / 图片卡片、作者备注。和剧情有关的时间地点不要删。',
        '6. 只用回复里真实出现过的标签，不要编造。',
        '',
        'reason 用一两句中文，告诉用户正文在哪、为什么这样选。',
    ].join('\n');
}

/** Long replies: head + tail, with a note of what was cut. */
export function clipSample(text) {
    const value = String(text ?? '');
    if (value.length <= HEAD + TAIL + 200) return value;
    return `${value.slice(0, HEAD)}\n\n……（中间省略 ${value.length - HEAD - TAIL} 字）……\n\n${value.slice(-TAIL)}`;
}

export function diagnoseUserPrompt(sample) {
    const info = inspectText(sample);
    const tags = info.tags.length
        ? info.tags.map(t => `${t.label}${t.kind === 'angle' ? '（尖括号）' : t.kind === 'square' ? '（方括号）' : '（注释）'} ×${t.count}${t.chars ? `，约 ${t.chars} 字` : ''}`).join('\n')
        : '（没有找到标签）';
    return [
        '程序预先统计的结构（供参考，以原文为准）：',
        tags,
        `所有标签块外面的文字：约 ${info.bareChars} 字（全文约 ${info.totalChars} 字）`,
        '',
        '最近一条 AI 回复原文：',
        '<reply>',
        clipSample(sample),
        '</reply>',
    ].join('\n');
}

/**
 * Turns the AI's answer into a plan, enforcing the bare-text rule.
 * @returns {{ black: string, white: string, body: 'bare'|'wrapped', reason: string, notes: string[] }}
 */
export function readDiagnosis(args, sample) {
    const list = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,，、]/) : []).map(x => String(x).trim()).filter(Boolean);
    const body = args?.body === 'wrapped' ? 'wrapped' : 'bare';
    let black = formatTagList(parseTagList(list(args?.black).join(',')));
    let white = formatTagList(parseTagList(list(args?.white).join(',')));
    const notes = [];
    if (body === 'bare' && white) {
        notes.push('正文是裸文本，白名单会把正文删掉，已清空白名单。');
        white = '';
    }
    if (white && planWarnings({ black, white }, sample).includes('empty')) {
        notes.push('按这个白名单，示例回复会被删光，已改回只用黑名单。');
        white = '';
    }
    return { black, white, body, reason: String(args?.reason || '').trim(), notes };
}
