// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Pure helpers for the visual memory-structure editor. memory-graph stores a
// node type with the same column names repeated across tableColumns /
// requiredColumns / embeddingColumns / primaryKeyColumns / columnHints; the
// editor works on "one row per record item" drafts and converts back.
// Every field the editor does not expose (extraction / compression rules,
// numbers, keywords …) is carried through untouched.

import { builtinTypeLabel, hasFieldLabel, fieldLabel } from '../i18n.js';

const DEFAULT_ENGLISH_LABELS = {
    event: 'Event',
    character_sheet: 'Character Sheet',
    location_state: 'Location State',
    thread: 'Thread',
    rule_constraint: 'Rule Constraint',
};
const IDENTITY_CANDIDATES = ['title', 'name', 'aliases'];
const LOCKED_COLUMNS = { event: ['summary'] };
const UNDELETABLE_TYPES = new Set(['event']);
const CJK = /[\u3400-\u9fff]/;

let uidCounter = 0;
const uid = (prefix) => `${prefix}${++uidCounter}`;

const list = (value) => (Array.isArray(value) ? value.map(v => String(v ?? '').trim()).filter(Boolean) : []);
const clone = (value) => (typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value)));

/** Display name of a node type; replaces memory-graph's English defaults. */
export function typeDisplayName(spec) {
    const id = String(spec?.id || spec?.type || '');
    const label = String(spec?.label || '').trim();
    const builtin = builtinTypeLabel(id);
    if (!label || label === id || label === DEFAULT_ENGLISH_LABELS[id]) return builtin || label || '未命名类型';
    const template = label.match(/^Custom Type (\d+)$/i);
    if (template) return `自定义类型 ${template[1]}`;
    return label;
}

/**
 * Short Chinese name for a column: user label > built-in translation >
 * the head of its hint ("剧情线名称，简短可指认…" → "剧情线名称") > raw key.
 */
export function columnDisplayName(typeId, key, hint, storedLabels) {
    const stored = storedLabels?.[typeId]?.[key];
    if (stored) return stored;
    if (hasFieldLabel(key)) return fieldLabel(key);
    const head = String(hint || '').trim().split(/[，,。．.；;：:（(\n|]/)[0].trim();
    if (head && CJK.test(head) && head.length <= 12) return head;
    return key;
}

/** Labels for every type/column, for the read views. */
export function buildLabelMaps(schemaTypes, storedLabels) {
    const types = {};
    const columns = {};
    for (const spec of Array.isArray(schemaTypes) ? schemaTypes : []) {
        const id = String(spec?.id || spec?.type || '');
        if (!id) continue;
        types[id] = typeDisplayName(spec);
        const hints = spec.columnHints || {};
        columns[id] = {};
        for (const key of list(spec.tableColumns)) columns[id][key] = columnDisplayName(id, key, hints[key], storedLabels);
    }
    return { types, columns };
}

/**
 * @param {object} spec memory-graph type spec
 * @param {object} storedLabels user column labels { typeId: { key: label } }
 * @param {object|null} defaultSpec the Luker default spec for this type id, if any.
 *   Hints/intro equal to the default are hidden (they are long English
 *   instructions) and kept as-is unless the user writes their own.
 */
export function toDraft(spec, storedLabels = {}, defaultSpec = null) {
    const raw = clone(spec || {});
    const id = String(raw.id || '');
    const hints = raw.columnHints && typeof raw.columnHints === 'object' ? raw.columnHints : {};
    const defaultHints = defaultSpec?.columnHints || {};
    const required = new Set(list(raw.requiredColumns));
    const locked = new Set(LOCKED_COLUMNS[id] || []);
    const originalIntro = String(raw.extractHint || '');
    const usesDefaultIntro = Boolean(originalIntro) && originalIntro === String(defaultSpec?.extractHint || '');
    return {
        uid: uid('t'),
        id,
        isNew: false,
        deletable: !UNDELETABLE_TYPES.has(id),
        name: typeDisplayName(raw),
        intro: usesDefaultIntro ? '' : originalIntro,
        originalIntro,
        usesDefaultIntro,
        alwaysInject: Boolean(raw.alwaysInject),
        latestOnly: Boolean(raw.latestOnly),
        compression: String(raw.compression?.mode || 'none') === 'hierarchical',
        columns: list(raw.tableColumns).map(key => {
            const originalHint = String(hints[key] || '');
            const usesDefaultHint = Boolean(originalHint) && originalHint === String(defaultHints[key] || '');
            return {
                uid: uid('c'),
                key,
                label: columnDisplayName(id, key, originalHint, storedLabels),
                hint: usesDefaultHint ? '' : originalHint,
                originalHint,
                usesDefaultHint,
                required: required.has(key) || locked.has(key),
                locked: locked.has(key),
                isNew: false,
            };
        }),
        raw,
    };
}

export function toDrafts(types, storedLabels = {}, defaults = []) {
    const byId = new Map((defaults || []).map(d => [String(d.id || ''), d]));
    return (types || []).map(spec => toDraft(spec, storedLabels, byId.get(String(spec?.id || '')) || null));
}

export function nextColumnKey(draft) {
    const used = new Set(draft.columns.map(c => c.key));
    let n = 1;
    while (used.has(`custom_${n}`)) n++;
    return `custom_${n}`;
}

export function newColumn(draft, label = '') {
    return { uid: uid('c'), key: nextColumnKey(draft), label, hint: '', originalHint: '', usesDefaultHint: false, required: false, locked: false, isNew: true };
}

export function newTypeDraft(existingDrafts) {
    const used = new Set(existingDrafts.map(d => d.id));
    let n = 1;
    while (used.has(`custom_${n}`)) n++;
    const id = `custom_${n}`;
    const raw = {
        id,
        label: '',
        tableName: `custom_table_${n}`,
        tableColumns: ['title'],
        level: 'semantic',
        extractHint: '',
        extractionInstructions: '',
        extractEveryN: 1,
        keywords: [],
        columnHints: { title: '名称' },
        requiredColumns: ['title'],
        forceUpdate: false,
        editable: true,
        alwaysInject: false,
        latestOnly: true,
        primaryKeyColumns: ['title'],
        compression: { mode: 'none', threshold: 6, fanIn: 3, maxDepth: 6, keepRecentLeaves: 0, summarizeInstruction: '' },
    };
    const draft = toDraft(raw);
    draft.isNew = true;
    draft.name = '';
    draft.columns[0].label = '名称';
    draft.columns[0].hint = '';
    return draft;
}

/** Converts a draft back into a memory-graph type spec (unexposed fields kept). */
export function fromDraft(draft) {
    const raw = clone(draft.raw || {});
    const keys = draft.columns.map(c => c.key);
    const keySet = new Set(keys);
    const originalKeys = new Set(list(raw.tableColumns));
    raw.id = draft.id;
    raw.label = draft.name.trim();
    raw.extractHint = draft.intro.trim() || (draft.usesDefaultIntro ? draft.originalIntro : '');
    raw.tableColumns = keys;
    raw.columnHints = Object.fromEntries(draft.columns
        .map(c => [c.key, c.hint.trim() || (c.usesDefaultHint ? c.originalHint : '') || c.label.trim()])
        .filter(([, value]) => value));
    raw.requiredColumns = draft.columns.filter(c => c.required || c.locked).map(c => c.key);

    const previousSearch = Array.isArray(raw.embeddingColumns) ? list(raw.embeddingColumns).filter(k => keySet.has(k)) : null;
    raw.embeddingColumns = previousSearch
        ? [...previousSearch, ...keys.filter(k => !originalKeys.has(k) && !previousSearch.includes(k))]
        : keys.slice();

    raw.alwaysInject = Boolean(draft.alwaysInject);
    raw.latestOnly = Boolean(draft.latestOnly);
    let identity = list(raw.primaryKeyColumns).filter(k => keySet.has(k));
    if (raw.latestOnly && !identity.length) {
        identity = IDENTITY_CANDIDATES.filter(k => keySet.has(k));
        if (!identity.length && keys.length) identity = [keys[0]];
    }
    raw.primaryKeyColumns = identity;
    raw.compression = { ...(raw.compression || {}), mode: draft.compression ? 'hierarchical' : 'none' };
    return raw;
}

/** Column labels that differ from what would be derived automatically. */
export function labelsFromDrafts(drafts) {
    const out = {};
    for (const draft of drafts) {
        for (const column of draft.columns) {
            const label = column.label.trim();
            if (!label) continue;
            const storedHint = column.hint.trim() || (column.usesDefaultHint ? column.originalHint : '') || label;
            const auto = columnDisplayName(draft.id, column.key, storedHint, {});
            if (label !== auto) (out[draft.id] ||= {})[column.key] = label;
        }
    }
    return out;
}

export function validateDrafts(drafts) {
    const errors = [];
    if (!drafts.length) errors.push({ uid: '', message: '至少需要一种记忆类型' });
    for (const draft of drafts) {
        const typeName = draft.name.trim();
        if (!typeName) errors.push({ uid: draft.uid, message: '有记忆类型没有名称' });
        if (!draft.columns.length) errors.push({ uid: draft.uid, message: `「${typeName || '未命名'}」至少需要一个记录项` });
        const seen = new Set();
        for (const column of draft.columns) {
            const label = column.label.trim();
            if (!label) errors.push({ uid: draft.uid, column: column.uid, message: `「${typeName || '未命名'}」有记录项没有名称` });
            else if (seen.has(label)) errors.push({ uid: draft.uid, column: column.uid, message: `「${typeName || '未命名'}」里有两项都叫「${label}」` });
            seen.add(label);
        }
    }
    return errors;
}

const FLAG_TEXT = {
    alwaysInject: ['开启「一直让 AI 看到」', '关闭「一直让 AI 看到」'],
    latestOnly: ['开启「同名只保留最新」', '关闭「同名只保留最新」'],
    compression: ['开启「自动合并成摘要」', '关闭「自动合并成摘要」'],
};

/**
 * Human-readable change list.
 * @returns {{ name: string, kind: 'added'|'removed'|'changed', lines: string[] }[]}
 */
export function describeChanges(beforeDrafts, afterDrafts, nodeCounts = new Map()) {
    const before = new Map(beforeDrafts.map(d => [d.id, d]));
    const after = new Map(afterDrafts.map(d => [d.id, d]));
    const out = [];
    for (const draft of afterDrafts) {
        const prev = before.get(draft.id);
        if (!prev) {
            out.push({ name: draft.name.trim(), kind: 'added', lines: [`新建类型，${draft.columns.length} 个记录项`] });
            continue;
        }
        const lines = [];
        if (prev.name.trim() !== draft.name.trim()) lines.push(`改名为「${draft.name.trim()}」`);
        if (prev.intro.trim() !== draft.intro.trim()) lines.push('修改了简介');
        const prevCols = new Map(prev.columns.map(c => [c.key, c]));
        const nextCols = new Map(draft.columns.map(c => [c.key, c]));
        const added = draft.columns.filter(c => !prevCols.has(c.key));
        const removed = prev.columns.filter(c => !nextCols.has(c.key));
        if (added.length) lines.push(`新增 ${added.length} 项：${added.map(c => c.label.trim()).join('、')}`);
        if (removed.length) lines.push(`删除 ${removed.length} 项：${removed.map(c => c.label.trim()).join('、')}（已有内容会保留，只是不再显示和记录）`);
        let renamed = 0;
        let hinted = 0;
        let requiredChanged = 0;
        for (const column of draft.columns) {
            const old = prevCols.get(column.key);
            if (!old) continue;
            if (old.label.trim() !== column.label.trim()) renamed++;
            if (old.hint.trim() !== column.hint.trim()) hinted++;
            if (Boolean(old.required) !== Boolean(column.required)) requiredChanged++;
        }
        if (renamed) lines.push(`${renamed} 项改了名称`);
        if (hinted) lines.push(`${hinted} 项改了说明`);
        if (requiredChanged) lines.push(`${requiredChanged} 项改了「必须填写」`);
        const kept = draft.columns.filter(c => prevCols.has(c.key)).map(c => c.key).join('|');
        const keptBefore = prev.columns.filter(c => nextCols.has(c.key)).map(c => c.key).join('|');
        if (kept !== keptBefore) lines.push('调整了记录项顺序');
        for (const flag of Object.keys(FLAG_TEXT)) {
            if (Boolean(prev[flag]) !== Boolean(draft[flag])) lines.push(FLAG_TEXT[flag][draft[flag] ? 0 : 1]);
        }
        if (lines.length) out.push({ name: prev.name.trim(), kind: 'changed', lines });
    }
    for (const prev of beforeDrafts) {
        if (after.has(prev.id)) continue;
        const count = nodeCounts.get(prev.id) || 0;
        out.push({ name: prev.name.trim(), kind: 'removed', lines: [count ? `删除这个类型（当前聊天有 ${count} 条，会保留但不再显示和记录）` : '删除这个类型'] });
    }
    const keptOrder = (drafts) => drafts.filter(d => before.has(d.id) && after.has(d.id)).map(d => d.id).join('|');
    if (keptOrder(afterDrafts) !== keptOrder(beforeDrafts)) {
        out.push({ name: '类型顺序', kind: 'changed', lines: ['调整了记忆类型的先后顺序'] });
    }
    return out;
}

export function draftsEqual(a, b) {
    return JSON.stringify(a.map(fromDraft)) === JSON.stringify(b.map(fromDraft))
        && JSON.stringify(labelsFromDrafts(a)) === JSON.stringify(labelsFromDrafts(b));
}

export function cloneDrafts(drafts) {
    return drafts.map(d => ({ ...d, raw: clone(d.raw), columns: d.columns.map(c => ({ ...c })) }));
}
