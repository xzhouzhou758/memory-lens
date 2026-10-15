// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 记忆结构 view: a simple editor for memory-graph's node-type schema.
// Left: memory types. Right: the selected type's record items (one row per
// item: name · 说明 · 必须填写) and three plain-language switches.
// Saving shows a change summary first and offers 撤销 afterwards.

import { h, clear, put } from '../util.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { typeVisual } from '../model.js';
import { button, iconButton, emptyState, switchControl } from '../ui/components.js';
import {
    toDrafts, fromDraft, newColumn, newTypeDraft, labelsFromDrafts, validateDrafts,
    describeChanges, draftsEqual, cloneDrafts,
} from './schema-model.js';

const UNDO_MS = 12000;

export function createSchemaView(app, source) {
    const access = source.schema || null;
    const bar = h('header', { class: 'ml-schema-bar' });
    const list = h('aside', { class: 'ml-schema-list', 'aria-label': t('schemaTypes') });
    const editor = h('section', { class: 'ml-schema-editor' });
    const body = h('div', { class: 'ml-schema-body' }, list, editor);
    const toast = h('div', { class: 'ml-schema-toast', role: 'status', 'aria-live': 'polite', hidden: true });
    const root = h('div', { class: 'ml-schema' }, bar, body, toast);

    let status = 'idle'; // idle | loading | ready | error | unsupported
    let errorText = '';
    let info = null;
    let base = [];
    let drafts = [];
    let selectedUid = '';
    let pane = 'list';
    let scopeCharacter = false;
    let saving = false;
    let undoSnapshot = null;
    let undoTimer = null;
    let needsReload = true;
    let modal = null;
    let errors = [];

    const selected = () => drafts.find(d => d.uid === selectedUid) || null;
    const nodeCount = (id) => app.model()?.typeCounts.get(id) || 0;
    const scopeChanged = () => Boolean(info?.hasCharacter) && scopeCharacter !== (info.scope === 'character');
    const isDirty = () => status === 'ready' && (!draftsEqual(base, drafts) || scopeChanged());

    // ----- Data -----------------------------------------------------------
    async function load() {
        needsReload = false;
        if (!access) {
            status = 'unsupported';
            paint();
            return;
        }
        const keepId = selected()?.id || '';
        status = 'loading';
        paint();
        try {
            info = await access.read();
            base = toDrafts(info.types, info.labels, info.defaults);
            drafts = cloneDrafts(base);
            scopeCharacter = info.scope === 'character';
            selectedUid = (drafts.find(d => d.id === keepId) || drafts[0])?.uid || '';
            errors = [];
            status = 'ready';
        } catch (err) {
            status = err?.code === 'schema-unsupported' ? 'unsupported' : 'error';
            errorText = String(err?.message || err);
        }
        paint();
    }

    // ----- Painting -------------------------------------------------------
    function paint() {
        root.classList.toggle('is-pane-editor', pane === 'editor');
        paintBar();
        clear(list);
        clear(editor);
        if (status === 'loading' || status === 'idle') {
            put(editor, h('div', { class: 'ml-loading' }, h('div', { class: 'ml-spinner', 'aria-hidden': 'true' }), h('span', { text: t('loading') })));
            return;
        }
        if (status === 'unsupported') {
            put(editor, emptyState('blocks', t('schemaUnavailable'), '', source.openNative ? button(t('openNative'), () => app.openNative(), { iconName: 'external' }) : null));
            return;
        }
        if (status === 'error') {
            put(editor, emptyState('alert', t('errGeneric'), errorText, button(t('refresh'), () => load(), { iconName: 'refresh' })));
            return;
        }
        paintList();
        paintEditor();
    }

    function paintBar() {
        clear(bar);
        const dirty = isDirty();
        const statusLine = saving
            ? h('span', { class: 'ml-schema-state', text: t('schemaSaving') })
            : dirty ? h('span', { class: 'ml-schema-state is-dirty' }, h('span', { class: 'ml-schema-dot', 'aria-hidden': 'true' }), h('span', { text: t('schemaUnsaved') })) : null;
        const scope = status === 'ready' && info?.hasCharacter
            ? h('div', { class: 'ml-schema-scope' },
                switchControl(t('schemaScopeChar', info.characterName || t('schemaNoChar')), scopeCharacter, (value) => {
                    scopeCharacter = value;
                    paintBar();
                }),
                !scopeCharacter ? h('span', { class: 'ml-schema-scope-note', text: t('schemaScopeGlobalNote') }) : null)
            : null;
        put(bar,
            h('div', { class: 'ml-schema-head' },
                h('h2', { class: 'ml-schema-title', text: t('schemaTitle') }),
                h('p', { class: 'ml-schema-sub', text: t('schemaIntro') })),
            scope,
            h('div', { class: 'ml-schema-actions' },
                statusLine,
                dirty && !saving ? button(t('schemaDiscard'), () => discard(), { className: 'ml-btn-ghost' }) : null,
                button(t('schemaSave'), () => save(), { iconName: 'check', className: 'ml-btn-primary', disabled: !dirty || saving })),
        );
        if (status === 'ready' && info?.scope === 'character') {
            put(bar, h('div', { class: 'ml-schema-banner' },
                icon('user', { size: 14 }),
                h('span', { text: t('schemaScopeCharActive', info.characterName) }),
                h('button', { type: 'button', class: 'ml-linkbtn', onClick: () => useGlobal() }, h('span', { text: t('schemaUseGlobal') }))));
        }
        if (errors.length) {
            put(bar, h('div', { class: 'ml-schema-errors', role: 'alert' },
                icon('alert', { size: 14 }),
                h('span', { text: errors[0].message }),
                errors.length > 1 ? h('span', { class: 'ml-schema-errors-more', text: `等 ${errors.length} 处` }) : null));
        }
    }

    function typeMeta(draft) {
        const count = nodeCount(draft.id);
        return `${draft.columns.length} 项 · ${count ? t('schemaUsage', count) : t('schemaNoUsage')}`;
    }

    function typeChanged(draft) {
        const prev = base.find(b => b.id === draft.id);
        return !prev || JSON.stringify(fromDraft(prev)) !== JSON.stringify(fromDraft(draft))
            || JSON.stringify(labelsFromDrafts([prev])) !== JSON.stringify(labelsFromDrafts([draft]));
    }

    function paintList() {
        clear(list);
        put(list,
            h('div', { class: 'ml-section-title' }, h('span', { text: t('schemaTypes') })),
            h('div', { class: 'ml-schema-types', role: 'listbox', 'aria-label': t('schemaTypes') },
                drafts.map(draft => {
                    const hasError = errors.some(e => e.uid === draft.uid);
                    return h('button', {
                        type: 'button',
                        role: 'option',
                        class: `ml-schema-type ${hasError ? 'has-error' : ''}`.trim(),
                        'aria-selected': String(draft.uid === selectedUid),
                        dataset: { uid: draft.uid, tone: typeVisual(draft.id).tone },
                        onClick: () => {
                            selectedUid = draft.uid;
                            pane = 'editor';
                            paint();
                        },
                    },
                    h('span', { class: 'ml-dot', dataset: { tone: typeVisual(draft.id).tone, shape: typeVisual(draft.id).shape }, style: { '--ml-dot-size': '12px' } }),
                    h('span', { class: 'ml-schema-type-main' },
                        h('span', { class: 'ml-schema-type-name', text: draft.name.trim() || t('schemaNewType') }),
                        h('span', { class: 'ml-schema-type-meta', text: typeMeta(draft) })),
                    typeChanged(draft) ? h('span', { class: 'ml-schema-dot', title: t('schemaUnsaved'), 'aria-label': t('schemaUnsaved') }) : null,
                    icon('chevronRight', { size: 14, className: 'ml-schema-type-chev' }));
                })),
            h('div', { class: 'ml-schema-list-actions' },
                button(t('schemaAddType'), () => addType(), { iconName: 'plus' }),
                button(t('schemaReset'), () => resetDefaults(), { iconName: 'undo', className: 'ml-btn-ghost' })),
        );
    }

    function paintEditor() {
        clear(editor);
        const draft = selected();
        if (!draft) return;
        const count = nodeCount(draft.id);
        const nameInput = h('input', {
            type: 'text',
            class: 'ml-schema-input ml-schema-typename',
            value: draft.name,
            placeholder: t('schemaNamePh'),
            'aria-label': t('schemaName'),
            'aria-invalid': errors.some(e => e.uid === draft.uid && !e.column && /名称/.test(e.message)) ? 'true' : null,
            maxlength: 40,
            onInput: (event) => {
                draft.name = event.target.value;
                event.target.removeAttribute('aria-invalid');
                touched();
                const label = list.querySelector(`[data-uid="${draft.uid}"] .ml-schema-type-name`);
                if (label) label.textContent = draft.name.trim() || t('schemaNewType');
            },
        });
        const intro = autoTextarea({
            value: draft.intro,
            placeholder: draft.usesDefaultIntro ? '沿用默认说明' : t('schemaIntroPh'),
            label: t('schemaIntroLabel'),
            onInput: (value) => { draft.intro = value; touched(); },
        });
        const items = h('ol', { class: 'ml-schema-items' }, draft.columns.map((column, index) => itemRow(draft, column, index)));
        put(editor, h('div', { class: 'ml-schema-editor-inner' },
            h('button', { type: 'button', class: 'ml-schema-back', onClick: () => { pane = 'list'; paint(); } },
                icon('chevronLeft', { size: 16 }), h('span', { text: t('schemaTypes') })),
            h('div', { class: 'ml-schema-typehead', dataset: { tone: typeVisual(draft.id).tone } },
                h('span', { class: 'ml-dot', dataset: { tone: typeVisual(draft.id).tone, shape: typeVisual(draft.id).shape }, style: { '--ml-dot-size': '16px' } }),
                nameInput,
                draft.deletable ? iconButton('trash', t('schemaDeleteType'), () => deleteType(draft), { className: 'ml-schema-danger' }) : null),
            h('p', { class: 'ml-schema-usage', text: count ? t('schemaUsage', count) : t('schemaNoUsage') }),
            h('label', { class: 'ml-schema-field' }, h('span', { class: 'ml-schema-label', text: t('schemaIntroLabel') }), intro),
            h('section', { class: 'ml-schema-section' },
                h('div', { class: 'ml-section-title' }, h('span', { text: `${t('schemaItems')} · ${draft.columns.length}` })),
                items,
                button(t('schemaAddItem'), () => addItem(draft), { iconName: 'plus', className: 'ml-schema-additem' })),
            h('section', { class: 'ml-schema-section' },
                h('div', { class: 'ml-section-title' }, h('span', { text: t('schemaBehavior') })),
                h('div', { class: 'ml-schema-flags' },
                    flag(draft, 'alwaysInject', t('schemaAlwaysInject'), t('schemaAlwaysInjectHint')),
                    flag(draft, 'latestOnly', t('schemaLatestOnly'), t('schemaLatestOnlyHint')),
                    draft.id === 'event' || draft.compression ? flag(draft, 'compression', t('schemaCompression'), t('schemaCompressionHint')) : null)),
            h('p', { class: 'ml-schema-note' }, icon('doc', { size: 14 }), h('span', { text: t('schemaRulesNote') })),
        ));
        if (draft.isNew && !draft.name) requestAnimationFrame(() => nameInput.focus());
    }

    function flag(draft, key, title, hint) {
        const card = h('button', {
            type: 'button',
            role: 'switch',
            class: 'ml-schema-flag',
            'aria-checked': String(Boolean(draft[key])),
            onClick: () => {
                draft[key] = !draft[key];
                card.setAttribute('aria-checked', String(draft[key]));
                touched();
            },
        },
        h('span', { class: 'ml-schema-flag-text' },
            h('span', { class: 'ml-schema-flag-title', text: title }),
            h('span', { class: 'ml-schema-flag-hint', text: hint })),
        h('span', { class: 'ml-switch-track' }, h('span', { class: 'ml-switch-thumb' })));
        return card;
    }

    function itemRow(draft, column, index) {
        const invalid = errors.some(e => e.column === column.uid);
        const nameInput = h('input', {
            type: 'text',
            class: 'ml-schema-input ml-schema-itemname',
            value: column.label,
            placeholder: t('schemaItemNamePh'),
            'aria-label': t('schemaItemName'),
            'aria-invalid': invalid ? 'true' : null,
            maxlength: 30,
            onInput: (event) => {
                column.label = event.target.value;
                event.target.removeAttribute('aria-invalid');
                touched();
            },
        });
        const hint = autoTextarea({
            value: column.hint,
            placeholder: column.usesDefaultHint ? '沿用默认说明' : t('schemaItemHintPh'),
            label: t('schemaItemHint'),
            className: 'ml-schema-itemhint',
            onInput: (value) => { column.hint = value; touched(); },
        });
        const required = h('button', {
            type: 'button',
            role: 'switch',
            class: 'ml-schema-req',
            'aria-checked': String(Boolean(column.required)),
            disabled: column.locked,
            title: column.locked ? t('schemaLocked') : null,
            onClick: () => {
                column.required = !column.required;
                required.setAttribute('aria-checked', String(column.required));
                touched();
            },
        }, icon('check', { size: 12 }), h('span', { text: t('schemaRequired') }));
        const grip = h('button', {
            type: 'button',
            class: 'ml-schema-grip',
            'aria-label': t('schemaDrag'),
            title: t('schemaDrag'),
            onPointerdown: (event) => startDrag(event, row, draft),
            onKeydown: (event) => {
                if (event.key === 'ArrowUp') { event.preventDefault(); moveItem(draft, column, -1, true); }
                if (event.key === 'ArrowDown') { event.preventDefault(); moveItem(draft, column, 1, true); }
            },
        }, icon('grip', { size: 16 }));
        const row = h('li', { class: `ml-schema-item ${column.isNew ? 'is-new' : ''}`.trim(), dataset: { uid: column.uid } },
            grip,
            h('div', { class: 'ml-schema-item-main' }, nameInput, hint),
            h('div', { class: 'ml-schema-item-side' },
                required,
                iconButton('arrowUp', t('schemaMoveUp'), () => moveItem(draft, column, -1), { className: 'ml-iconbtn-sm ml-schema-move', disabled: index === 0 }),
                iconButton('arrowDown', t('schemaMoveDown'), () => moveItem(draft, column, 1), { className: 'ml-iconbtn-sm ml-schema-move', disabled: index === draft.columns.length - 1 }),
                iconButton('trash', column.locked ? t('schemaLocked') : t('schemaDeleteItem'), () => removeItem(draft, column), { className: 'ml-iconbtn-sm ml-schema-danger', disabled: column.locked })));
        return row;
    }

    function autoTextarea({ value, placeholder, label, className = '', onInput }) {
        const area = h('textarea', {
            class: `ml-schema-input ml-schema-textarea ${className}`.trim(),
            rows: 1,
            placeholder,
            'aria-label': label,
            onInput: (event) => { fit(); onInput(event.target.value); },
        });
        area.value = value;
        const fit = () => {
            area.style.height = 'auto';
            area.style.height = `${Math.min(area.scrollHeight + 2, 220)}px`;
        };
        requestAnimationFrame(fit);
        return area;
    }

    // ----- Edits ----------------------------------------------------------
    let touchedFrame = 0;
    function touched() {
        if (errors.length) {
            errors = validateDrafts(drafts).filter(e => errors.some(prev => prev.uid === e.uid));
        }
        cancelAnimationFrame(touchedFrame);
        touchedFrame = requestAnimationFrame(() => {
            paintBar();
            for (const draft of drafts) {
                const item = list.querySelector(`[data-uid="${draft.uid}"]`);
                if (!item) continue;
                const meta = item.querySelector('.ml-schema-type-meta');
                if (meta) meta.textContent = typeMeta(draft);
                const dot = item.querySelector('.ml-schema-dot');
                const changed = typeChanged(draft);
                if (changed && !dot) item.insertBefore(h('span', { class: 'ml-schema-dot', 'aria-label': t('schemaUnsaved') }), item.lastChild);
                if (!changed && dot) dot.remove();
                item.classList.toggle('has-error', errors.some(e => e.uid === draft.uid));
            }
        });
    }

    function addItem(draft) {
        const column = newColumn(draft, '');
        draft.columns.push(column);
        paintEditor();
        touched();
        requestAnimationFrame(() => {
            const input = editor.querySelector(`[data-uid="${column.uid}"] .ml-schema-itemname`);
            input?.focus();
            input?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        });
    }

    function removeItem(draft, column) {
        if (column.locked) return;
        draft.columns = draft.columns.filter(c => c !== column);
        paintEditor();
        touched();
    }

    function moveItem(draft, column, delta, keepFocus = false) {
        const index = draft.columns.indexOf(column);
        const next = index + delta;
        if (index < 0 || next < 0 || next >= draft.columns.length) return;
        draft.columns.splice(index, 1);
        draft.columns.splice(next, 0, column);
        paintEditor();
        touched();
        if (keepFocus) requestAnimationFrame(() => editor.querySelector(`[data-uid="${column.uid}"] .ml-schema-grip`)?.focus());
    }

    function startDrag(event, row, draft) {
        if (event.button !== undefined && event.button !== 0) return;
        event.preventDefault();
        const grip = event.currentTarget;
        const container = row.parentElement;
        row.classList.add('is-dragging');
        grip.setPointerCapture?.(event.pointerId);
        const move = (e) => {
            const siblings = [...container.children].filter(x => x !== row);
            let before = null;
            for (const sibling of siblings) {
                const rect = sibling.getBoundingClientRect();
                if (e.clientY < rect.top + rect.height / 2) { before = sibling; break; }
            }
            if (before) {
                if (before !== row.nextSibling) container.insertBefore(row, before);
            } else if (container.lastChild !== row) {
                container.appendChild(row);
            }
        };
        const end = () => {
            grip.removeEventListener('pointermove', move);
            grip.removeEventListener('pointerup', end);
            grip.removeEventListener('pointercancel', end);
            row.classList.remove('is-dragging');
            const order = [...container.children].map(x => x.dataset.uid);
            const before = draft.columns.map(c => c.uid).join('|');
            draft.columns.sort((a, b) => order.indexOf(a.uid) - order.indexOf(b.uid));
            if (draft.columns.map(c => c.uid).join('|') !== before) {
                paintEditor();
                touched();
            }
        };
        grip.addEventListener('pointermove', move);
        grip.addEventListener('pointerup', end);
        grip.addEventListener('pointercancel', end);
    }

    function addType() {
        const draft = newTypeDraft(drafts);
        drafts.push(draft);
        selectedUid = draft.uid;
        pane = 'editor';
        paint();
    }

    function deleteType(draft) {
        const count = nodeCount(draft.id);
        confirmModal({
            title: t('schemaDeleteType'),
            lines: [t('schemaDeleteTypeConfirm', draft.name.trim() || t('schemaNewType'), count ? t('schemaDeleteTypeUsage', count) : '')],
            okLabel: t('schemaDeleteType'),
            danger: true,
            onOk: () => {
                const index = drafts.indexOf(draft);
                drafts = drafts.filter(d => d !== draft);
                selectedUid = (drafts[Math.max(0, index - 1)] || drafts[0])?.uid || '';
                pane = 'list';
                paint();
            },
        });
    }

    function discard() {
        drafts = cloneDrafts(base);
        scopeCharacter = info?.scope === 'character';
        errors = [];
        if (!drafts.some(d => d.uid === selectedUid)) selectedUid = drafts[0]?.uid || '';
        paint();
    }

    function resetDefaults() {
        confirmModal({
            title: t('schemaReset'),
            lines: [t('schemaResetConfirm')],
            okLabel: t('schemaReset'),
            onOk: () => {
                const fresh = toDrafts(info.defaults, {}, info.defaults);
                // Keep uids of matching types so the selection survives.
                for (const draft of fresh) {
                    const prev = drafts.find(d => d.id === draft.id);
                    if (prev) draft.uid = prev.uid;
                }
                drafts = fresh;
                errors = [];
                if (!drafts.some(d => d.uid === selectedUid)) selectedUid = drafts[0]?.uid || '';
                paint();
            },
        });
    }

    function useGlobal() {
        confirmModal({
            title: t('schemaUseGlobal'),
            lines: [t('schemaUseGlobalConfirm', info.characterName)],
            okLabel: t('schemaUseGlobal'),
            onOk: async () => {
                try {
                    await access.clearCharacter();
                    await load();
                    app.reload();
                } catch (err) {
                    showToast(t('schemaSaveFailed', String(err?.message || err)));
                }
            },
        });
    }

    // ----- Save / undo ----------------------------------------------------
    function save() {
        if (saving) return;
        errors = validateDrafts(drafts);
        if (errors.length) {
            const first = drafts.find(d => d.uid === errors[0].uid);
            if (first) selectedUid = first.uid;
            pane = 'editor';
            paint();
            requestAnimationFrame(() => editor.querySelector('[aria-invalid="true"]')?.focus());
            return;
        }
        const changes = describeChanges(base, drafts, app.model()?.typeCounts || new Map());
        if (scopeChanged()) {
            changes.push({
                name: '生效范围',
                kind: 'changed',
                lines: [scopeCharacter
                    ? `只对「${info.characterName}」生效，其他角色不受影响`
                    : `「${info.characterName}」改回通用结构，修改对所有角色生效`],
            });
        }
        if (!changes.length) return;
        confirmModal({
            title: t('schemaConfirmTitle'),
            changes,
            okLabel: t('schemaConfirmOk'),
            onOk: () => doWrite(),
        });
    }

    async function doWrite() {
        saving = true;
        paintBar();
        try {
            const labels = { ...(info.labels || {}) };
            const next = labelsFromDrafts(drafts);
            for (const id of new Set([...base.map(d => d.id), ...drafts.map(d => d.id)])) {
                if (next[id]) labels[id] = next[id];
                else delete labels[id];
            }
            const previous = await access.write(drafts.map(fromDraft), { scope: scopeCharacter ? 'character' : 'global', labels });
            saving = false;
            setUndo(previous);
            await load();
            app.reload();
        } catch (err) {
            saving = false;
            paintBar();
            showToast(t('schemaSaveFailed', String(err?.message || err)));
        }
    }

    function setUndo(previous) {
        undoSnapshot = previous;
        clearTimeout(undoTimer);
        showToast(t('schemaSaved'), {
            action: t('schemaUndo'),
            onAction: async () => {
                const snapshot = undoSnapshot;
                undoSnapshot = null;
                hideToast();
                if (!snapshot) return;
                try {
                    await access.restore(snapshot);
                    await load();
                    app.reload();
                    showToast(t('schemaUndone'));
                } catch (err) {
                    showToast(t('schemaSaveFailed', String(err?.message || err)));
                }
            },
        });
        undoTimer = setTimeout(() => { undoSnapshot = null; hideToast(); }, UNDO_MS);
    }

    function showToast(text, { action = '', onAction = null } = {}) {
        clear(toast);
        put(toast,
            icon(action ? 'check' : 'alert', { size: 15 }),
            h('span', { text }),
            action ? h('button', { type: 'button', class: 'ml-schema-toast-btn', onClick: onAction }, icon('undo', { size: 14 }), h('span', { text: action })) : null);
        toast.hidden = false;
        if (!action) {
            clearTimeout(undoTimer);
            undoTimer = setTimeout(hideToast, 3500);
        }
    }

    function hideToast() {
        toast.hidden = true;
    }

    // ----- Modal ----------------------------------------------------------
    function confirmModal({ title, lines = [], changes = null, okLabel, danger = false, onOk }) {
        closeModal();
        const content = changes
            ? h('ul', { class: 'ml-schema-changes' }, changes.map(change => h('li', { dataset: { kind: change.kind } },
                h('div', { class: 'ml-schema-change-name' }, h('span', { class: 'ml-schema-change-kind', text: change.kind === 'added' ? '新建' : change.kind === 'removed' ? '删除' : '修改' }), h('span', { text: change.name || t('schemaNewType') })),
                h('ul', null, change.lines.map(line => h('li', { text: line }))))))
            : h('div', { class: 'ml-schema-confirm-text' }, lines.filter(Boolean).map(line => h('p', { text: line })));
        const ok = button(okLabel, async () => { closeModal(); await onOk(); }, { className: danger ? 'ml-btn-danger' : 'ml-btn-primary' });
        const panel = h('div', { class: 'ml-dialog ml-schema-modal', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': title, tabIndex: -1 },
            h('header', { class: 'ml-dialog-head' }, h('h3', { class: 'ml-dialog-title', text: title })),
            h('div', { class: 'ml-dialog-body' }, content),
            h('footer', { class: 'ml-schema-modal-foot' }, button(t('schemaCancel'), () => closeModal(), { className: 'ml-btn-ghost' }), ok));
        modal = h('div', { class: 'ml-dialog-backdrop', onMousedown: (event) => { if (event.target === modal) closeModal(); } }, panel);
        app.root.appendChild(modal);
        requestAnimationFrame(() => ok.focus());
    }

    function closeModal() {
        if (!modal) return false;
        modal.remove();
        modal = null;
        return true;
    }

    return {
        id: 'schema',
        el: root,
        render() {
            if (status === 'idle' || (needsReload && !isDirty())) {
                load();
                return;
            }
            if (status === 'ready') touched();
        },
        onShow() {
            if (status === 'idle' || (needsReload && !isDirty())) load();
        },
        invalidate() {
            needsReload = true;
        },
        onEscape() {
            if (closeModal()) return true;
            const active = document.activeElement;
            if (active && root.contains(active) && /^(INPUT|TEXTAREA)$/.test(active.tagName)) {
                active.blur();
                root.focus?.();
                return true;
            }
            if (app.isCompact() && pane === 'editor') {
                pane = 'list';
                paint();
                return true;
            }
            return false;
        },
        isDirty,
        destroy() {
            clearTimeout(undoTimer);
            closeModal();
        },
    };
}
