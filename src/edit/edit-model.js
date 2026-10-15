// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Pure rules for in-place editing of stored memories (no DOM).
// Values are edited as plain text; arrays round-trip through "、" so a
// field stored as a list stays a list.

const LIST_SPLIT = /[、,，\n]+/;

/**
 * Whether a field of a node may be edited here, with a Chinese reason if not.
 * @param {object} node model node (from buildModel)
 * @param {string} key field key, or '' for the title
 */
export function editRule(node, key) {
    if (!node) return { ok: false, reason: '找不到这条记忆' };
    if (node.isRollup) return { ok: false, reason: '这是自动合并出的摘要，会在下次合并时重新生成，不能在这里修改' };
    if (node.archived) return { ok: false, reason: '已归档的记忆不能修改' };
    if (key === '' && node.type === 'event') return { ok: false, reason: '事件标题由正文自动生成，请修改正文' };
    return { ok: true, reason: '' };
}

/** Text shown in the editor for a stored value. */
export function toEditText(value) {
    if (value === undefined || value === null) return '';
    if (Array.isArray(value)) return value.map(v => toEditText(v)).filter(Boolean).join('、');
    if (typeof value === 'object') {
        try { return JSON.stringify(value); } catch { return ''; }
    }
    return String(value);
}

/**
 * Converts edited text back to the stored shape of `original`.
 * Lists stay lists, numbers stay numbers when the text is numeric.
 */
export function fromEditText(text, original) {
    const value = String(text ?? '').replace(/\r\n/g, '\n').trim();
    if (Array.isArray(original)) return value ? value.split(LIST_SPLIT).map(s => s.trim()).filter(Boolean) : [];
    if (typeof original === 'number') {
        const n = Number(value);
        return value !== '' && Number.isFinite(n) ? n : value;
    }
    if (original && typeof original === 'object') {
        try { return JSON.parse(value); } catch { return value; }
    }
    return value;
}

/** True when the edited text would store something different. */
export function isChanged(text, original) {
    return JSON.stringify(fromEditText(text, original)) !== JSON.stringify(original ?? (Array.isArray(original) ? [] : ''))
        && !(toEditText(original) === String(text ?? '').trim());
}

/** Text that already has paragraphs (event bodies, multi-line notes): Enter adds a line. */
export function hasParagraphs(key, text) {
    return key === 'summary' || String(text ?? '').includes('\n');
}
