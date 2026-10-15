// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Double-click to edit a stored memory value in place.
// The editor takes the shown value's box: anything that wraps gets a growing
// textarea at the same width. Enter saves (Shift+Enter = new line); text that
// already has paragraphs (event bodies) saves with Ctrl/⌘+Enter instead.
// Esc cancels, clicking away saves. Saving goes through app.editNode (撤销).

import { h } from '../util.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { editRule, toEditText, isChanged, hasParagraphs } from './edit-model.js';
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
        if (el.classList.contains('is-editing')) return;
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
            if (event.target !== el || el.classList.contains('is-editing')) return;
            if (event.key === 'F2' || event.key === 'Enter') {
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
    // Measure the shown value before it is swapped out: wrapped → textarea.
    const box = el.getBoundingClientRect();
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 20;
    const wraps = el.scrollHeight > lineHeight * 1.6 || box.height > lineHeight * 1.8;
    const paragraphs = hasParagraphs(key, text);
    const multiline = paragraphs || wraps || text.length > 60;
    const field = h(multiline ? 'textarea' : 'input', {
        class: `ml-inline-input ${multiline ? 'is-multi' : ''}`.trim(),
        'aria-label': label ? t('editField', label) : t('edit'),
        ...(multiline ? { rows: 2 } : { type: 'text' }),
    });
    field.value = text;
    const hint = h('span', { class: 'ml-inline-hint', text: paragraphs ? t('editKeysMulti') : multiline ? t('editKeysWrap') : t('editKeys') });
    let busy = false;
    // AI 优化: fills the editor with a suggestion; the user still saves it.
    const optimize = app.canRewrite?.()
        ? h('button', {
            type: 'button',
            class: 'ml-inline-ai',
            title: t('aiOptimizeValueHint'),
            onPointerdown: (event) => event.preventDefault(), // keep focus in the field
            onClick: async () => {
                if (busy) return;
                const base = field.value.trim();
                if (!base) return;
                busy = true;
                optimize.disabled = true;
                optimize.lastChild.textContent = t('aiOptimizing');
                try {
                    const next = await app.rewriteValue(node, key, base);
                    if (!done && next) {
                        field.value = next;
                        fit();
                        field.focus({ preventScroll: true });
                    }
                } catch (err) {
                    app.notify?.(t('aiFailed', String(err?.message || err)));
                } finally {
                    busy = false;
                    optimize.disabled = false;
                    optimize.lastChild.textContent = t('aiOptimize');
                }
            },
        }, icon('sparkle', { size: 12 }), h('span', { text: t('aiOptimize') }))
        : null;
    const foot = h('span', { class: 'ml-inline-foot' }, hint, optimize);
    const wrap = h('span', { class: `ml-inline ${multiline ? 'is-multi' : ''}`.trim(), onClick: (e) => e.stopPropagation(), onDblclick: (e) => e.stopPropagation() }, field, foot);
    // Cells keep their element (table / list layout stays intact); the editor
    // replaces their content. Inline values are swapped out whole.
    const inCell = el.tagName === 'TD' || el.tagName === 'DD';
    const saved = inCell ? [...el.childNodes] : null;
    const fit = () => {
        if (!multiline) return;
        field.style.height = 'auto';
        field.style.height = `${Math.min(field.scrollHeight + 2, 420)}px`;
    };
    let done = false;
    const close = () => {
        if (done) return;
        done = true;
        active = null;
        document.removeEventListener('pointerdown', outside, true);
        if (inCell) {
            el.classList.remove('is-editing');
            el.replaceChildren(...saved);
        } else wrap.replaceWith(el);
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
    // Clicking away saves — except while AI 优化 is still working.
    const outside = (event) => { if (!wrap.contains(event.target) && !busy) commit(); };
    field.addEventListener('input', fit);
    field.addEventListener('keydown', (event) => {
        event.stopPropagation();
        if (event.key === 'Escape') {
            event.preventDefault();
            cancel();
        } else if (event.key === 'Enter' && !event.isComposing && (paragraphs ? (event.ctrlKey || event.metaKey) : !event.shiftKey)) {
            event.preventDefault();
            commit();
            el.focus?.();
        }
    });
    // Same cell / row element type, same width as what was shown.
    if (multiline && box.height) field.style.minHeight = `${Math.max(Math.round(box.height), 44)}px`;
    if (inCell) {
        // Hold the column at its current width so the table doesn't reflow.
        const pad = parseFloat(getComputedStyle(el).paddingLeft) + parseFloat(getComputedStyle(el).paddingRight);
        wrap.style.width = `${Math.max(Math.round(box.width - pad), 140)}px`;
        el.classList.add('is-editing');
        el.replaceChildren(wrap);
    } else {
        wrap.style.width = `${Math.max(Math.round(box.width), 160)}px`;
        el.replaceWith(wrap);
    }
    active = { commit, cancel };
    document.addEventListener('pointerdown', outside, true);
    requestAnimationFrame(() => {
        fit();
        field.focus({ preventScroll: true });
        const end = field.value.length;
        field.setSelectionRange?.(end, end);
        field.scrollLeft = 0;
    });
}

/** Closes any open editor without saving (e.g. before a re-render). */
export function cancelActiveEdit() {
    active?.cancel();
}

export function isEditing() {
    return Boolean(active);
}
