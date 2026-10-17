// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 标签过滤 (pure, no DOM): turns a black / white tag list into Luker regex
// scripts for the plugin input lane (pluginOnly + promptOnly), so only the
// text plugins read (memory-graph extraction / recall …) is filtered.
// The same scripts drive the preview, so what you see is what runs.
//
// Tag forms: angle `think` / `<think>`, square `[时间]`, HTML comment `!--`.
// Order: blacklist first (drops thinking chains, even ones that contain
// fake body tags), then the whitelist keeps only the listed blocks.

export const SCRIPT_PREFIX = 'memory-lens-tagfilter';
export const AI_OUTPUT = 2; // regex_placement.AI_OUTPUT

export const COMMON_BLACK = ['think', 'thinking', 'details', 'summary', '!--', 'Memory'];
export const COMMON_WHITE = ['content', 'message', 'statusbar', 'globalTime', '[时间]'];

const NAME_OK = /^[\p{L}\p{N}_.:-]+$/u;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/**
 * One tag token → { kind: 'angle'|'square'|'comment', name, label } or null.
 * Accepts think, <think>, </think>, [时间], [/时间], !--, <!--.
 */
export function parseTag(token) {
    const raw = String(token ?? '').trim();
    if (!raw) return null;
    if (/^<?!--(>)?$/.test(raw) || raw === '<!---->') return { kind: 'comment', name: '!--', label: '!--' };
    const square = raw.match(/^\[\/?([^\][]+)\]$/);
    if (square) {
        const name = square[1].trim();
        return NAME_OK.test(name) ? { kind: 'square', name, label: `[${name}]` } : null;
    }
    const name = raw.replace(/^<\/?/, '').replace(/\/?>$/, '').trim();
    return name && NAME_OK.test(name) ? { kind: 'angle', name, label: name } : null;
}

/** "think, details、[时间]" → unique parsed tags (invalid ones dropped). */
export function parseTagList(text) {
    const out = [];
    const seen = new Set();
    for (const token of String(text ?? '').split(/[,，、;；\s]+/)) {
        const tag = parseTag(token);
        if (!tag) continue;
        const key = `${tag.kind}:${tag.name.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(tag);
    }
    return out;
}

/** Tokens the parser could not read (shown as a hint under the input). */
export function invalidTokens(text) {
    return String(text ?? '').split(/[,，、;；\s]+/).filter(t => t.trim() && !parseTag(t));
}

export const formatTagList = (tags) => tags.map(t => t.label).join(', ');

/** Adds one tag to a list text unless it is already there. */
export function addToList(text, token) {
    const tags = parseTagList(text);
    const tag = parseTag(token);
    if (!tag || tags.some(t => t.kind === tag.kind && t.name.toLowerCase() === tag.name.toLowerCase())) return formatTagList(tags);
    return formatTagList([...tags, tag]);
}

const script = (n, scriptName, findRegex, replaceString) => ({
    id: `${SCRIPT_PREFIX}-${n}`,
    scriptName: `记忆透镜 · 标签过滤 · ${scriptName}`,
    findRegex,
    replaceString,
    trimStrings: [],
    placement: [AI_OUTPUT],
    disabled: false,
    markdownOnly: false,
    promptOnly: true,
    pluginOnly: true,
    runOnEdit: false,
    substituteRegex: 0,
    minDepth: null,
    maxDepth: null,
});

const angleOpen = (names) => `<(?:${names})(?=[\\s>/])`;

/**
 * @param {{ enabled?: boolean, black?: string, white?: string }} plan
 * @returns {object[]} Luker regex scripts, in run order ([] = nothing to do)
 */
export function buildScripts(plan) {
    if (!plan || plan.enabled === false) return [];
    const black = parseTagList(plan.black);
    const white = parseTagList(plan.white);
    if (!black.length && !white.length) return [];
    const out = [];
    let n = 0;
    const names = (list, kind) => list.filter(t => t.kind === kind).map(t => esc(t.name)).join('|');

    const bAngle = names(black, 'angle');
    const bSquare = names(black, 'square');
    if (bAngle) {
        // Whole blocks; then a stray closing tag whose opener got lost
        // (some models stream the thought without "<think>"): drop
        // everything before it; then an opener that never closes: drop to the end.
        out.push(script(++n, '删除标签块', `/<(${bAngle})(?=[\\s>/])[^>]*>[\\s\\S]*?<\\/\\1\\s*>/gi`, ''));
        out.push(script(++n, '删除缺开头的块', `/^(?:(?!${angleOpen(bAngle)})[\\s\\S])*?<\\/(?:${bAngle})\\s*>/i`, ''));
        out.push(script(++n, '删除没结尾的块', `/${angleOpen(bAngle)}[^>]*>(?![\\s\\S]*<\\/(?:${bAngle})\\s*>)[\\s\\S]*$/i`, ''));
    }
    if (bSquare) {
        out.push(script(++n, '删除方括号块', `/\\[(${bSquare})\\][\\s\\S]*?\\[\\/\\1\\]/gi`, ''));
        // memory-graph collapses newlines first, so a marker stops at the next tag too.
        out.push(script(++n, '删除方括号行', `/\\[(?:${bSquare})\\][^\\n<\\[]*/gi`, ''));
    }
    if (black.some(t => t.kind === 'comment')) {
        out.push(script(++n, '删除注释', '/<!--[\\s\\S]*?(?:-->|$)/g', ''));
    }

    if (white.length) {
        // One pass: each listed block keeps its inside; everything else
        // (runs of text up to the next listed opener) becomes nothing.
        const alts = [];
        const openers = [];
        let groups = 0;
        for (const tag of white) {
            const name = esc(tag.name);
            if (tag.kind === 'angle') {
                // A block cut off at the end (no closer) still counts.
                alts.push(`<${name}(?=[\\s>/])[^>]*>([\\s\\S]*?)(?:<\\/${name}\\s*>|$)`);
                openers.push(`<${name}(?=[\\s>/])`);
                groups += 1;
            } else if (tag.kind === 'square') {
                alts.push(`\\[${name}\\]([\\s\\S]*?)\\[\\/${name}\\]`);
                alts.push(`(\\[${name}\\][^\\n<\\[]*)`);
                openers.push(`\\[${name}\\]`);
                groups += 2;
            } else {
                alts.push('<!--([\\s\\S]*?)-->');
                openers.push('<!--');
                groups += 1;
            }
        }
        const keep = Array.from({ length: groups }, (_, i) => `$${i + 1}`).join('');
        out.push(script(++n, '只保留白名单', `/${alts.join('|')}|[\\s\\S]+?(?=${openers.join('|')}|$)/gi`, `\n${keep}`));
    }
    out.push(script(++n, '整理空行', '/\\n[ \\t]*(?:\\n[ \\t]*){2,}/g', '\n\n'));
    out.push(script(++n, '去掉首尾空白', '/^\\s+|\\s+$/g', ''));
    return out;
}

/** Same parsing as Luker's regexFromString. */
export function compileFind(findRegex) {
    const m = String(findRegex).match(/(\/?)(.+)\1([a-z]*)/i);
    try { return m ? new RegExp(m[2], m[3]) : null; } catch { return null; }
}

/** Runs scripts the way Luker does (minus macro expansion). */
export function applyScripts(text, scripts) {
    let value = String(text ?? '');
    for (const s of scripts) {
        const re = compileFind(s.findRegex);
        if (!re) continue;
        value = value.replace(re, s.replaceString);
    }
    return value;
}

export const filterText = (text, plan) => applyScripts(text, buildScripts({ ...plan, enabled: true }));

/**
 * What a reply looks like, for the AI and the warnings.
 * @returns {{ tags: {label, kind, count, chars}[], bareChars: number, totalChars: number }}
 *   bareChars: visible text outside every tag block (≈ "正文是裸文本").
 */
export function inspectText(text) {
    const value = String(text ?? '');
    const found = new Map();
    const note = (kind, label, chars) => {
        const key = `${kind}:${label.toLowerCase()}`;
        const cur = found.get(key) || { kind, label, count: 0, chars: 0 };
        cur.count++;
        cur.chars += chars;
        found.set(key, cur);
    };
    const NAME = '[\\p{L}_][\\p{L}\\p{N}_.:-]*';
    for (const m of value.matchAll(/<!--[\s\S]*?(?:-->|$)/g)) note('comment', '!--', m[0].length);
    for (const m of value.matchAll(new RegExp(`<(${NAME})(?=[\\s>/])[^>]*>([\\s\\S]*?)<\\/\\1\\s*>`, 'gu'))) note('angle', m[1], m[0].length);
    for (const m of value.matchAll(/\[([^\][\n/]{1,20})\]/gu)) note('square', `[${m[1]}]`, 0);
    // Bare text: strip outer blocks repeatedly, then lone tags / markers.
    let rest = value.replace(/<!--[\s\S]*?(?:-->|$)/g, ' ');
    const block = new RegExp(`<(${NAME})(?=[\\s>/])[^>]*>[\\s\\S]*?<\\/\\1\\s*>`, 'gu');
    for (let i = 0; i < 6; i++) {
        const before = rest;
        rest = rest.replace(block, ' ').replace(/\[([^\][\n/]{1,20})\][\s\S]*?\[\/\1\]/gu, ' ');
        if (rest === before) break;
    }
    rest = rest.replace(new RegExp(`<\\/?${NAME}[^>\\n]{0,200}>`, 'gu'), ' ');
    const bareChars = rest.replace(/\s+/g, '').length;
    return { tags: [...found.values()], bareChars, totalChars: value.replace(/\s+/g, '').length };
}

/** Plain-language warnings for a plan against one sample reply. */
export function planWarnings(plan, sample) {
    const out = [];
    const white = parseTagList(plan.white);
    if (!white.length || !sample) return out;
    const before = String(sample).replace(/\s+/g, '').length;
    const after = filterText(sample, plan).replace(/\s+/g, '').length;
    if (before && !after) out.push('empty');
    else if (before > 200 && after / before < 0.05) out.push('tiny');
    return out;
}
