// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Reviewable list of AI-proposed changes: one row per item that changed,
// with a checkbox, plain-language text and (for rewritten hints) a fold-out
// before / after. Used by the AI assistant and 「AI 帮我完善这个类型」.

import { h, clear, put } from '../util.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { button } from '../ui/components.js';

const KIND_TAG = { addType: '新建', addColumn: '新增', removeColumn: '删除', removeType: '删除' };

/**
 * @param {{ changes: object[], state?: 'pending'|'applied'|'discarded'|'undone',
 *   applied?: Set<string>, stale?: Set<string>, onApply?(chosen: object[]): void,
 *   onDiscard?(): void, onUndo?(): void, onFocus?(change: object): void }} opts
 */
export function changeList(opts) {
    const { changes, state = 'pending', applied = new Set(), stale = new Set(), onApply, onDiscard, onUndo, onFocus } = opts;
    const chosen = new Set(changes.filter(c => !stale.has(c.id)).map(c => c.id));
    const el = h('section', { class: 'ml-changes-card', dataset: { state } });
    const groups = new Map();
    for (const change of changes) {
        const name = change.typeName || t('aiTypesOrder');
        if (!groups.has(name)) groups.set(name, []);
        groups.get(name).push(change);
    }

    function row(change) {
        const isStale = stale.has(change.id);
        const done = state !== 'pending';
        // The box sits in a padded hit area so it's easy to tap.
        const box = h('button', {
            type: 'button',
            role: 'checkbox',
            class: 'ml-check ml-check-hit',
            'aria-checked': String(done ? applied.has(change.id) : chosen.has(change.id)),
            'aria-label': change.text,
            disabled: done || isStale,
            onClick: () => {
                if (chosen.has(change.id)) chosen.delete(change.id); else chosen.add(change.id);
                box.setAttribute('aria-checked', String(chosen.has(change.id)));
                paintFoot();
            },
        }, icon('check', { size: 11 }));
        const hasDetail = (change.before !== undefined && change.after !== undefined) || change.detail?.length || (change.kind === 'addColumn' && change.after);
        const detail = hasDetail ? detailBlock(change) : null;
        if (detail) detail.hidden = true;
        const text = h('button', {
            type: 'button',
            class: 'ml-change-text',
            onClick: () => {
                if (detail) {
                    // Text with a before / after: tap to read it (and jump to the item).
                    detail.hidden = !detail.hidden;
                    caret?.replaceWith(caret = icon(detail.hidden ? 'chevronDown' : 'chevronUp', { size: 12, className: 'ml-change-caret' }));
                } else if (!box.disabled) {
                    box.click(); // nothing to expand: tapping the text toggles the box
                }
                onFocus?.(change);
            },
        },
        KIND_TAG[change.kind] ? h('span', { class: 'ml-change-tag', dataset: { kind: change.kind }, text: KIND_TAG[change.kind] }) : null,
        h('span', { text: KIND_TAG[change.kind] ? change.text.replace(/^(新增记录项|删除记录项|新建类型|删除类型)/, '') : change.text }),
        isStale ? h('span', { class: 'ml-change-stale', text: t('aiStale'), title: t('aiStaleHint') }) : null);
        let caret = hasDetail ? icon('chevronDown', { size: 12, className: 'ml-change-caret' }) : null;
        put(text, caret);
        return h('li', { class: `ml-change ${isStale ? 'is-stale' : ''}`.trim() }, h('div', { class: 'ml-change-line' }, box, text), detail);
    }

    const foot = h('div', { class: 'ml-changes-foot' });
    function paintFoot() {
        clear(foot);
        if (state === 'pending') {
            put(foot,
                button(t('aiApplyChosen', chosen.size), () => onApply?.(changes.filter(c => chosen.has(c.id))), { iconName: 'check', className: 'ml-btn-sm ml-btn-primary', disabled: !chosen.size }),
                button(t('aiDiscardAll'), () => onDiscard?.(), { className: 'ml-btn-sm ml-btn-ghost' }));
        } else if (state === 'applied') {
            put(foot,
                h('span', { class: 'ml-changes-state', text: t('aiAppliedN', applied.size) }),
                onUndo ? button(t('aiUndoTurn'), () => onUndo(), { iconName: 'undo', className: 'ml-btn-sm ml-btn-ghost' }) : null);
        } else {
            const text = { undone: t('aiTurnUndone'), superseded: t('aiSuperseded') }[state] || t('aiDiscarded');
            put(foot, h('span', { class: 'ml-changes-state', text }));
        }
    }
    paintFoot();

    put(el,
        h('div', { class: 'ml-changes-head', text: state === 'pending' ? t('aiChangesPending', changes.length) : t('aiChangesTitle', changes.length) }),
        [...groups.entries()].map(([name, items]) => h('div', { class: 'ml-changes-group' },
            groups.size > 1 || items[0].kind !== 'addType' ? h('div', { class: 'ml-changes-type', text: name }) : null,
            h('ul', null, items.map(row)))),
        foot);
    return el;
}

function detailBlock(change) {
    if (change.detail?.length) {
        return h('ul', { class: 'ml-change-detail ml-change-cols' }, change.detail.map(line => h('li', { text: line })));
    }
    if (change.kind === 'addColumn') {
        return h('div', { class: 'ml-change-detail' }, h('div', { class: 'ml-diff-label', text: t('aiPromptTag') }), h('p', { text: change.after }));
    }
    const { before, after } = markDiff(change.before || '', change.after || '');
    return h('div', { class: 'ml-change-detail' },
        h('div', { class: 'ml-diff-label', text: t('aiBefore') }), h('p', { class: 'ml-diff-before' }, before),
        h('div', { class: 'ml-diff-label', text: t('aiAfter') }), h('p', { class: 'ml-diff-after' }, after));
}

/** Character-level diff (common prefix / suffix) → highlighted spans. */
export function markDiff(a, b) {
    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) start++;
    let endA = a.length;
    let endB = b.length;
    while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
    const pieces = (text, from, to, cls) => [
        text.slice(0, from) ? h('span', { text: text.slice(0, from) }) : null,
        text.slice(from, to) ? h('mark', { class: cls, text: text.slice(from, to) }) : null,
        text.slice(to) ? h('span', { text: text.slice(to) }) : null,
    ].filter(Boolean);
    return {
        before: a ? pieces(a, start, endA, 'is-del') : [h('span', { class: 'ml-diff-empty', text: t('aiEmptyText') })],
        after: b ? pieces(b, start, endB, 'is-add') : [h('span', { class: 'ml-diff-empty', text: t('aiEmptyText') })],
    };
}
