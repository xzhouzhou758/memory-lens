// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Double-click to edit a stored memory value in place.
// Enter (single line) or Ctrl/⌘+Enter (multi line) saves, Esc cancels,
// clicking away saves. Saving goes through app.editNode, which offers 撤销.

import { h } from '../util.js';
import { t } from '../i18n.js';
import { editRule, toEditText, prefersMultiline, isChanged } from './edit-model.js';
import { restoreSummaryLayout } from '../model.js';

let active = null; // only one editor at a time

/**
 * Makes `el` editable on double-click.
 * @param {HTMLElement} el element showing the value; replaced while editing
 * @param {{ app: object, node: object, key: string, value: any, label?: string }} opts
 *   key '' = the title.
 */
export function editable(el, { app, node, key, value, label = '' }) {
    if (!app.canEdit?.()) return el;
    const rule = editRule(node, key);
    el.classList.add('ml-editable');
    el.dataset.editable = rule.ok ? 'true' : 'false';
    el.title = rule.ok ? t('editHint') : rule.reason;
    el.addEventListener('dblclick', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!rule.ok) {
            app.notify?.(rule.reason);
            return;
        }
        open(el, { app, node, key, value, label });
    });
    if (rule.ok) {
        el.tabIndex = el.tabIndex >= 0 ? el.tabIndex : 0;
        el.addEventListener('keydown', (event) => {
            if (event.key === 'F2' || (event.key === 'Enter' && event.target === el && el.tagName !== 'TR')) {
                event.preventDefault();
                event.stopPropagation();
                open(el, { app, node, key, value, label });
            }
        });
    }
    return el;
}

function open(el, { app, node, key, value, label }) {
    active?.commit();
    const original = value;
    const text = key === 'summary' && node.type === 'event' ? restoreSummaryLayout(toEditText(value)) : toEditText(value);
    const multiline = prefersMultiline(key, value);
    const field = h(multiline ? 'textarea' : 'input', {
        class: `ml-inline-input ${multiline ? 'is-multi' : ''}`.trim(),
        'aria-label': label ? t('editField', label) : t('edit'),
        ...(multiline ? { rows: 2 } : { type: 'text' }),
    });
    field.value = text;
    const hint = h('span', { class: 'ml-inline-hint', text: multiline ? t('editKeysMulti') : t('editKeys') });
    const wrap = h('span', { class: `ml-inline ${multiline ? 'is-multi' : ''}`.trim(), onClick: (e) => e.stopPropagation(), onDblclick: (e) => e.stopPropagation() }, field, hint);
    const fit = () => {
        if (!multiline) return;
        field.style.height = 'auto';
        field.style.height = `${Math.min(field.scrollHeight + 2, 360)}px`;
    };
    let done = false;
    const close = () => {
        if (done) return;
        done = true;
        active = null;
        document.removeEventListener('pointerdown', outside, true);
        wrap.replaceWith(el);
    };
    const commit = () => {
        if (done) return;
        const next = field.value;
        const changed = isChanged(next, original) && !(key === 'summary' && next.trim() === text.trim());
        close();
        if (!changed) return;
        if (key === '' && !next.trim()) {
            app.notify?.(t('editEmptyTitle'));
            return;
        }
        app.editNode(node, key, next, original);
    };
    const cancel = () => { close(); el.focus?.(); };
    const outside = (event) => { if (!wrap.contains(event.target)) commit(); };
    field.addEventListener('input', fit);
    field.addEventListener('keydown', (event) => {
        event.stopPropagation();
        if (event.key === 'Escape') {
            event.preventDefault();
            cancel();
        } else if (event.key === 'Enter' && !event.isComposing && (!multiline || event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            commit();
            el.focus?.();
        }
    });
    el.replaceWith(wrap);
    active = { commit, cancel };
    document.addEventListener('pointerdown', outside, true);
    requestAnimationFrame(() => {
        fit();
        field.focus();
        if (!multiline) field.select();
    });
}

/** Closes any open editor without saving (e.g. before a re-render). */
export function cancelActiveEdit() {
    active?.cancel();
}

export function isEditing() {
    return Boolean(active);
}
