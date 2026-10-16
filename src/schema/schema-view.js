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
import { button, iconButton, emptyState, segmented, checkRow } from '../ui/components.js';
import {
    toDrafts, fromDraft, newColumn, newTypeDraft, labelsFromDrafts, validateDrafts,
    describeChanges, draftsEqual, cloneDrafts,
} from './schema-model.js';
import { createAiPanel } from '../ai/ai-panel.js';
import { diffSchemas, applyChanges, changeMarks } from '../ai/schema-diff.js';
import { changeList } from '../ai/change-list.js';
import { TEMPLATES, buildTemplate, templateTypeNames } from './templates.js';

const UNDO_MS = 12000;

export function createSchemaView(app, source) {
    const access = source.schema || null;
    const bar = h('header', { class: 'ml-schema-bar' });
    const list = h('aside', { class: 'ml-schema-list', 'aria-label': t('schemaTypes') });
    const editor = h('section', { class: 'ml-schema-editor' });
    const body = h('div', { class: 'ml-schema-body' }, list, editor);
    const aiAccess = source.ai || null;
    let ai = null;
    let aiOpen = false;
    let aiBusy = false;
    let aiMarks = {}; // typeId → { count, added, columns: { key: 'added'|'changed' } }
    const handEdits = new Set(); // 'typeId:key' the user changed by hand (staleness)
    let suggestState = null;
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
    let modalCancel = null;
    let errors = [];
    const openItems = new Set();

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
            aiMarks = {};
            handEdits.clear();
            suggestState = null;
            ai?.reset();
        } catch (err) {
            status = err?.code === 'schema-unsupported' ? 'unsupported' : 'error';
            errorText = String(err?.message || err);
        }
        paint();
    }

    // ----- Painting -------------------------------------------------------
    function paint() {
        root.classList.toggle('is-pane-editor', pane === 'editor');
        root.classList.toggle('is-ai-open', aiOpen);
        root.classList.toggle('is-ai-busy', aiBusy);
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

    // One slim row: where it applies (left) · save state + buttons (right).
    function paintBar() {
        clear(bar);
        const dirty = isDirty();
        const statusLine = saving
            ? h('span', { class: 'ml-schema-state', text: t('schemaSaving') })
            : dirty ? h('span', { class: 'ml-schema-state is-dirty' }, h('span', { class: 'ml-schema-dot', 'aria-hidden': 'true' }), h('span', { text: t('schemaUnsaved') })) : null;
        const charName = info?.characterName || t('schemaNoChar');
        const scope = status === 'ready' && info?.hasCharacter
            ? h('div', { class: 'ml-schema-scope' },
                h('span', { class: 'ml-schema-scope-label', text: t('schemaScopeLabel') }),
                segmented([
                    { value: 'global', label: t('schemaScopeAll') },
                    { value: 'character', label: t('schemaScopeOnly', charName), title: t('schemaScopeOnly', charName) },
                ], scopeCharacter ? 'character' : 'global', (value) => {
                    scopeCharacter = value === 'character';
                    paintBar();
                }, { ariaLabel: t('schemaScopeLabel'), className: 'ml-seg-sm ml-schema-scope-seg' }),
                info.scope === 'character' && !scopeCharacter
                    ? h('span', { class: 'ml-schema-scope-note', text: t('schemaScopeLeaveNote') })
                    : null,
                info.scope === 'character' && !dirty
                    ? h('button', { type: 'button', class: 'ml-linkbtn ml-schema-scope-note', onClick: () => useGlobal() }, h('span', { text: t('schemaUseGlobal') }))
                    : null)
            : h('div', { class: 'ml-schema-scope' }, h('span', { class: 'ml-schema-scope-label', text: t('schemaScopeAllOnly') }));
        put(bar,
            scope,
            h('div', { class: 'ml-schema-actions' },
                statusLine,
                aiAccess && status === 'ready'
                    ? button(t('aiTitle'), () => toggleAi(), { iconName: 'sparkle', className: `ml-schema-aibtn ${aiOpen ? 'is-on' : ''}`.trim() })
                    : null,
                dirty && !saving ? button(t('schemaDiscard'), () => discard(), { className: 'ml-btn-ghost' }) : null,
                button(t('schemaSave'), () => save(), { iconName: 'check', className: 'ml-btn-primary', disabled: !dirty || saving || aiBusy })),
        );
        if (errors.length) {
            put(bar, h('div', { class: 'ml-schema-errors', role: 'alert' },
                icon('alert', { size: 14 }),
                h('span', { text: errors[0].message }),
                errors.length > 1 ? h('span', { class: 'ml-schema-errors-more', text: `等 ${errors.length} 处` }) : null));
        }
    }

    function typeMeta(draft) {
        const count = nodeCount(draft.id);
        const ai = aiMarks[draft.id];
        const aiText = ai ? ` · ${ai.added ? t('aiMarkNewType') : t('aiMarkCount', ai.count)}` : '';
        return `${draft.columns.length} 项 · ${count ? t('schemaUsage', count) : t('schemaNoUsage')}${aiText}`;
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
                        class: `ml-schema-type ${hasError ? 'has-error' : ''} ${aiMarks[draft.id] ? 'has-ai' : ''}`.trim(),
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
                button(t('schemaTemplates'), () => pickTemplate(), { iconName: 'layers', className: 'ml-btn-ghost' }),
                access.importFile || access.exportFile
                    ? h('div', { class: 'ml-schema-io' },
                        access.importFile ? button(t('schemaImport'), () => importSchema(), { iconName: 'upload', className: 'ml-btn-ghost' }) : null,
                        access.exportFile ? button(t('schemaExport'), () => exportSchema(), { iconName: 'download', className: 'ml-btn-ghost' }) : null)
                    : null,
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
        const intro = promptBlock({
            original: draft.usesDefaultIntro ? draft.originalIntro : '',
            note: t('aiPromptTypeNote'),
            compact: true,
            optimize: () => ({ kind: 'typeIntro', typeName: draft.name, itemName: '', siblings: draft.columns.map(c => c.label).filter(Boolean) }),
            value: draft.intro,
            placeholder: draft.usesDefaultIntro ? t('schemaDefaultHint') : t('schemaIntroPh'),
            label: t('schemaIntroLabel'),
            className: 'ml-schema-intro',
            onInput: (value) => { draft.intro = value; handEdits.add(`${draft.id}:intro`); touched(); },
        });
        const suggestBtn = aiAccess?.suggestType
            ? button(t('aiSuggestBtn'), () => suggestForType(draft), { iconName: 'sparkle', className: 'ml-btn-sm ml-schema-suggest', disabled: aiBusy, title: t('aiSuggestHint') })
            : null;
        const items = h('ol', { class: 'ml-schema-items' }, draft.columns.map(column => itemRow(draft, column)));
        put(editor, h('div', { class: 'ml-schema-editor-inner' },
            h('button', { type: 'button', class: 'ml-schema-back', onClick: () => { pane = 'list'; paint(); } },
                icon('chevronLeft', { size: 16 }), h('span', { text: t('schemaTypes') })),
            h('div', { class: 'ml-schema-typehead', dataset: { tone: typeVisual(draft.id).tone } },
                h('span', { class: 'ml-dot', dataset: { tone: typeVisual(draft.id).tone, shape: typeVisual(draft.id).shape }, style: { '--ml-dot-size': '14px' } }),
                nameInput,
                h('span', { class: 'ml-schema-usage', text: count ? t('schemaUsage', count) : t('schemaNoUsage') }),
                suggestBtn,
                draft.deletable ? iconButton('trash', t('schemaDeleteType'), () => deleteType(draft), { className: 'ml-schema-danger' }) : null),
            suggestPanel(draft),
            intro,
            h('section', { class: 'ml-schema-section' },
                h('div', { class: 'ml-section-title' }, h('span', { text: `${t('schemaItems')} · ${draft.columns.length}` })),
                items,
                button(t('schemaAddItem'), () => addItem(draft), { iconName: 'plus', className: 'ml-btn-ghost ml-schema-additem' })),
            h('section', { class: 'ml-schema-section' },
                h('div', { class: 'ml-section-title' }, h('span', { text: t('schemaBehavior') })),
                h('div', { class: 'ml-schema-flags' },
                    flag(draft, 'alwaysInject', t('schemaAlwaysInject'), t('schemaAlwaysInjectHint')),
                    flag(draft, 'latestOnly', t('schemaLatestOnly'), t('schemaLatestOnlyHint')),
                    draft.id === 'event' || draft.compression ? flag(draft, 'compression', t('schemaCompression'), t('schemaCompressionHint')) : null)),
            h('p', { class: 'ml-schema-note', text: t('schemaRulesNote') }),
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
                handEdits.add(`${draft.id}:${key}`);
                touched();
            },
        },
        h('span', { class: 'ml-schema-flag-text' },
            h('span', { class: 'ml-schema-flag-title', text: title }),
            h('span', { class: 'ml-schema-flag-hint', text: hint })),
        h('span', { class: 'ml-switch-track' }, h('span', { class: 'ml-switch-thumb' })));
        return card;
    }

    // One line per item: grip · name · hint preview · 必填 · delete.
    // The hint opens below only when clicked.
    function itemRow(draft, column) {
        const invalid = errors.some(e => e.column === column.uid);
        const open = openItems.has(column.uid);
        const nameInput = h('input', {
            type: 'text',
            class: 'ml-schema-input ml-schema-itemname',
            value: column.label,
            placeholder: column.isNew ? t('schemaItemNamePh') : t('schemaUnnamedPh'),
            'aria-label': t('schemaItemName'),
            'aria-invalid': invalid ? 'true' : null,
            maxlength: 30,
            onInput: (event) => {
                column.label = event.target.value;
                event.target.removeAttribute('aria-invalid');
                handEdits.add(`${draft.id}:${column.key}`);
                touched();
            },
        });
        const preview = column.hint.trim() || (column.usesDefaultHint ? t('schemaDefaultHint') : t('schemaNoHint'));
        const toggle = h('button', {
            type: 'button',
            class: `ml-schema-hintbtn ${column.hint.trim() ? '' : 'is-empty'}`.trim(),
            'aria-expanded': String(open),
            title: t('schemaItemHint'),
            onClick: () => {
                if (openItems.has(column.uid)) openItems.delete(column.uid);
                else openItems.add(column.uid);
                paintEditor();
                if (openItems.has(column.uid)) requestAnimationFrame(() => editor.querySelector(`[data-uid="${column.uid}"] .ml-schema-itemhint`)?.focus());
            },
        },
        h('span', { class: 'ml-schema-ai-mark', title: t('aiPromptTag'), 'aria-label': t('aiPromptTag') }, icon('sparkle', { size: 11 })),
        h('span', { class: 'ml-schema-hintbtn-text', text: open ? t('aiPromptEditing') : preview }),
        icon(open ? 'chevronUp' : 'chevronDown', { size: 13 }));
        const required = h('button', {
            type: 'button',
            role: 'switch',
            class: 'ml-schema-req',
            'aria-checked': String(Boolean(column.required)),
            disabled: column.locked,
            title: column.locked ? t('schemaLocked') : t('schemaRequired'),
            onClick: () => {
                column.required = !column.required;
                required.setAttribute('aria-checked', String(column.required));
                handEdits.add(`${draft.id}:${column.key}`);
                touched();
            },
        }, h('span', { text: t('schemaRequiredShort') }));
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
        }, icon('grip', { size: 14 }));
        const aiMark = aiMarks[draft.id]?.columns[column.key];
        const row = h('li', { class: `ml-schema-item ${column.isNew ? 'is-new' : ''} ${open ? 'is-open' : ''} ${aiMark ? 'has-ai' : ''}`.trim(), dataset: { uid: column.uid } },
            h('div', { class: 'ml-schema-item-line' },
                grip,
                nameInput,
                aiMark ? h('span', { class: 'ml-ai-tag', dataset: { kind: aiMark }, title: t('aiTagHint'), text: aiMark === 'added' ? t('aiTagAdded') : t('aiTagChanged') }) : null,
                toggle,
                required,
                iconButton('trash', column.locked ? t('schemaLocked') : t('schemaDeleteItem'), () => removeItem(draft, column), { className: 'ml-iconbtn-sm ml-schema-danger', disabled: column.locked })),
            open ? promptBlock({
                value: column.hint,
                original: column.usesDefaultHint ? column.originalHint : '',
                placeholder: column.usesDefaultHint ? t('schemaDefaultHint') : t('schemaItemHintPh'),
                label: t('schemaItemHint'),
                note: t('aiPromptItemNote'),
                className: 'ml-schema-itemhint',
                optimize: () => ({ kind: 'columnHint', typeName: draft.name, itemName: column.label, siblings: draft.columns.map(c => c.label).filter(Boolean) }),
                onInput: (value) => { column.hint = value; handEdits.add(`${draft.id}:${column.key}`); touched(); },
            }) : null);
        return row;
    }

    // A "给 AI 的提示" block: tag + note, the text, and AI优化 when available.
    function promptBlock({ value, original = '', placeholder, label, note, className = '', compact = false, optimize = null, onInput }) {
        let area = null;
        const optimizeBtn = aiAccess?.rewrite && optimize
            ? button(t('aiOptimize'), async () => {
                const base = area.value.trim() || original;
                if (!base) return;
                optimizeBtn.disabled = true;
                optimizeBtn.classList.add('is-busy');
                try {
                    const next = await aiAccess.rewrite({ ...optimize(), text: base });
                    if (next && next !== area.value) {
                        area.value = next;
                        area.dispatchEvent(new Event('input'));
                        area.focus();
                    }
                } catch (err) {
                    showToast(t('aiFailed', String(err?.message || err)));
                } finally {
                    optimizeBtn.disabled = false;
                    optimizeBtn.classList.remove('is-busy');
                }
            }, { iconName: 'sparkle', className: 'ml-btn-sm ml-btn-ghost ml-ai-optimize', title: t('aiOptimizeHint') })
            : null;
        area = autoTextarea({ value, placeholder, label, className, onInput });
        return h('div', { class: `ml-prompt ${compact ? 'is-compact' : ''}`.trim() },
            h('div', { class: 'ml-prompt-head' },
                h('span', { class: 'ml-prompt-tag' }, icon('sparkle', { size: 11 }), h('span', { text: t('aiPromptTag') })),
                h('span', { class: 'ml-prompt-note', text: note }),
                optimizeBtn),
            area);
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
        aiMarks = {};
        handEdits.clear();
        ai?.reset();
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

    // Replaces the type list (unsaved); uids of matching types are kept so the
    // selection and the 未保存 dots behave like a hand edit.
    function replaceTypes(types, labels = {}) {
        const fresh = toDrafts(types, { ...(info.labels || {}), ...labels }, info.defaults);
        for (const draft of fresh) {
            const prev = drafts.find(d => d.id === draft.id);
            if (prev) draft.uid = prev.uid;
        }
        drafts = fresh;
        aiMarks = {};
        errors = [];
        ai?.reset();
        if (!drafts.some(d => d.uid === selectedUid)) selectedUid = drafts[0]?.uid || '';
        pane = 'list';
        paint();
    }

    function pickTemplate() {
        let chosen = TEMPLATES[0].id;
        const nameOf = (id) => {
            const spec = drafts.find(d => d.id === id) || null;
            return spec?.name.trim() || toDrafts([info.defaults.find(d => d.id === id) || { id }])[0].name;
        };
        const cards = TEMPLATES.map(tpl => h('button', {
            type: 'button',
            role: 'radio',
            class: 'ml-tpl',
            'aria-checked': String(tpl.id === chosen),
            dataset: { id: tpl.id },
            onClick: () => {
                chosen = tpl.id;
                for (const el of wrap.querySelectorAll('.ml-tpl')) el.setAttribute('aria-checked', String(el.dataset.id === chosen));
            },
        },
        h('span', { class: 'ml-tpl-radio', 'aria-hidden': 'true' }),
        h('span', { class: 'ml-tpl-main' },
            h('span', { class: 'ml-tpl-name', text: tpl.name }),
            h('span', { class: 'ml-tpl-note', text: tpl.note }),
            h('span', { class: 'ml-tpl-types' }, templateTypeNames(tpl, nameOf).map(name => h('span', { class: 'ml-tpl-type', text: name }))))));
        const wrap = h('div', { class: 'ml-tpls' },
            h('p', { class: 'ml-ask-text', text: t('schemaTemplatesNote') }),
            h('div', { role: 'radiogroup', 'aria-label': t('schemaTemplatesTitle'), class: 'ml-tpl-list' }, cards));
        confirmModal({
            title: t('schemaTemplatesTitle'),
            content: wrap,
            okLabel: t('schemaTemplateApply'),
            focus: cards[0],
            onOk: () => {
                const tpl = TEMPLATES.find(x => x.id === chosen);
                const { types, labels } = buildTemplate(tpl, drafts.map(fromDraft), info.defaults);
                replaceTypes(types, labels);
                showToast(t('schemaTemplateApplied', tpl.name), { tone: 'ok' });
            },
        });
    }

    async function importSchema() {
        const run = async () => {
            try {
                const result = await access.importFile();
                if (!result) return;
                replaceTypes(result.types, result.labels);
                showToast(t('schemaImported'), { tone: 'ok' });
            } catch (err) {
                showToast(t('schemaIoFailed', String(err?.message || err)));
            }
        };
        if (!isDirty()) { run(); return; }
        confirmModal({ title: t('schemaImport'), lines: [t('schemaImportReplace')], okLabel: t('schemaImport'), onOk: run });
    }

    async function exportSchema() {
        try {
            const name = await access.exportFile(drafts.map(fromDraft), currentLabels());
            showToast(t('schemaExported', name), { tone: 'ok' });
        } catch (err) {
            showToast(t('schemaIoFailed', String(err?.message || err)));
        }
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

    // ----- AI assistant ---------------------------------------------------
    function toggleAi() {
        aiOpen = !aiOpen;
        if (aiOpen && !ai) {
            ai = createAiPanel(aiAccess, {
                getLive: () => drafts.map(fromDraft),
                labels: () => currentLabels(),
                applyChanges: (changes) => applyAiChanges(changes),
                snapshot: () => ({ drafts: cloneDrafts(drafts), selectedUid, marks: structuredClone(aiMarks) }),
                restore: (snap) => {
                    drafts = cloneDrafts(snap.drafts);
                    aiMarks = snap.marks || {};
                    selectedUid = drafts.some(d => d.uid === snap.selectedUid) ? snap.selectedUid : drafts[0]?.uid || '';
                    errors = [];
                    paint();
                },
                touched: () => handEdits,
                focusChange: (change) => focusChange(change),
                openSettings: () => openAiSettings(),
                onClose: () => toggleAi(),
                onBusy: (value) => {
                    aiBusy = value;
                    root.classList.toggle('is-ai-busy', aiBusy);
                    paintBar();
                },
            });
            put(body, ai.el);
        }
        paint();
        if (aiOpen) ai.focus();
    }

    // Names the user can see right now, so applied AI specs keep them.
    function currentLabels() {
        const labels = {};
        for (const draft of drafts) {
            for (const column of draft.columns) {
                if (column.label.trim()) (labels[draft.id] ||= {})[column.key] = column.label.trim();
            }
        }
        return labels;
    }

    // Applies chosen AI changes onto the drafts, keeping uids, selection and
    // every visible name; marks what changed so the editor can show it.
    function applyAiChanges(changes) {
        if (!changes.length) return;
        const labels = currentLabels();
        const { specs, labels: renames } = applyChanges(drafts.map(fromDraft), changes);
        for (const [typeId, cols] of Object.entries(renames)) labels[typeId] = { ...(labels[typeId] || {}), ...cols };
        const prevById = new Map(drafts.map(d => [d.id, d]));
        const next = toDrafts(specs, labels, info?.defaults || []);
        for (const draft of next) {
            const prev = prevById.get(draft.id);
            if (!prev) { draft.isNew = true; continue; }
            draft.uid = prev.uid;
            draft.isNew = prev.isNew;
            const prevCols = new Map(prev.columns.map(c => [c.key, c]));
            for (const column of draft.columns) {
                const old = prevCols.get(column.key);
                if (old) { column.uid = old.uid; column.isNew = old.isNew; } else column.isNew = true;
            }
        }
        drafts = next;
        const marks = changeMarks(changes);
        for (const [typeId, m] of Object.entries(marks)) {
            const cur = (aiMarks[typeId] ||= { count: 0, columns: {}, added: false });
            cur.count += m.count;
            cur.added ||= m.added;
            Object.assign(cur.columns, m.columns);
            for (const key of Object.keys(m.columns)) handEdits.delete(`${typeId}:${key}`);
        }
        const first = changes.find(c => c.typeId && drafts.some(d => d.id === c.typeId));
        if (first) selectedUid = drafts.find(d => d.id === first.typeId).uid;
        else if (!drafts.some(d => d.uid === selectedUid)) selectedUid = drafts[0]?.uid || '';
        errors = [];
        pane = 'editor';
        paint();
    }

    function focusChange(change) {
        const draft = drafts.find(d => d.id === change.typeId);
        if (!draft) return;
        selectedUid = draft.uid;
        pane = 'editor';
        paint();
        const column = change.key ? draft.columns.find(c => c.key === change.key) : null;
        requestAnimationFrame(() => {
            const target = column ? editor.querySelector(`[data-uid="${column.uid}"]`) : editor.querySelector('.ml-schema-typehead');
            if (!target) return;
            target.scrollIntoView({ block: 'center', behavior: 'smooth' });
            target.classList.add('is-flash');
            setTimeout(() => target.classList.remove('is-flash'), 1200);
        });
    }

    // ----- 「AI 帮我完善这个类型」 ------------------------------------------
    async function suggestForType(draft) {
        if (!aiAccess?.suggestType || aiBusy) return;
        const request = await askText({
            title: t('aiSuggestTitle', draft.name.trim() || t('schemaNewType')),
            text: t('aiSuggestIntro'),
            placeholder: t('aiSuggestPh'),
            okLabel: t('aiSuggestGo'),
        });
        if (request === null) return;
        suggestState = { typeUid: draft.uid, status: 'busy', changes: [], note: '' };
        aiBusy = true;
        paint();
        try {
            const live = drafts.map(fromDraft);
            const out = await aiAccess.suggestType({ live, typeId: draft.id, request });
            const changes = diffSchemas(live, out.live, currentLabels());
            suggestState = { typeUid: draft.uid, status: changes.length ? 'ready' : 'empty', changes, note: out.note };
        } catch (err) {
            suggestState = { typeUid: draft.uid, status: 'error', changes: [], note: String(err?.message || err) };
        } finally {
            aiBusy = false;
            paint();
        }
    }

    function suggestPanel(draft) {
        if (!suggestState || suggestState.typeUid !== draft.uid) return null;
        const close = () => { suggestState = null; paintEditor(); };
        if (suggestState.status === 'busy') {
            return h('div', { class: 'ml-suggest is-busy' }, h('span', { class: 'ml-spinner', 'aria-hidden': 'true' }), h('span', { text: t('aiSuggestBusy') }));
        }
        if (suggestState.status !== 'ready') {
            return h('div', { class: 'ml-suggest' },
                h('span', { text: suggestState.status === 'error' ? t('aiFailed', suggestState.note) : t('aiSuggestNone') }),
                iconButton('x', t('close'), close, { className: 'ml-iconbtn-sm' }));
        }
        return h('div', { class: 'ml-suggest' },
            h('div', { class: 'ml-suggest-head' },
                h('span', { class: 'ml-prompt-tag' }, icon('sparkle', { size: 11 }), h('span', { text: t('aiSuggestLabel') })),
                suggestState.note ? h('span', { class: 'ml-suggest-note', text: suggestState.note }) : null,
                iconButton('x', t('close'), close, { className: 'ml-iconbtn-sm' })),
            changeList({
                changes: suggestState.changes,
                stale: new Set(),
                onApply: (chosen) => { suggestState = null; applyAiChanges(chosen); showToast(t('aiAppliedN', chosen.length)); },
                onDiscard: close,
                onFocus: (change) => focusChange(change),
            }));
    }

    // ----- AI settings ------------------------------------------------------
    async function openAiSettings() {
        if (!aiAccess?.settings) return;
        let data;
        try { data = await aiAccess.settings(); } catch (err) { showToast(t('aiFailed', String(err?.message || err))); return; }
        const state = structuredClone(data.ai);
        const select = (value, items, emptyLabel, onChange) => {
            const el = h('select', { class: 'ml-select', onChange: (e) => onChange(e.target.value) },
                h('option', { value: '', text: emptyLabel }),
                items.map(name => h('option', { value: name, text: name })),
                value && !items.includes(value) ? h('option', { value, text: `${value}（${t('aiMissing')}）` }) : null);
            el.value = value || '';
            return el;
        };
        const followMemory = t('aiFollowMemory', data.memory.api || t('aiCurrentApi'));
        const followPreset = t('aiFollowMemory', data.memory.preset || t('aiCurrentPreset'));
        const testBtn = (role) => {
            const btn = button(t('aiTest'), async () => {
                await aiAccess.saveSettings(state);
                btn.disabled = true;
                btn.lastChild.textContent = t('aiTesting');
                try {
                    await aiAccess.test(role);
                    btn.lastChild.textContent = t('aiTestOk');
                } catch (err) {
                    btn.lastChild.textContent = t('aiTestFail');
                    showToast(t('aiFailed', String(err?.message || err)));
                } finally {
                    btn.disabled = false;
                }
            }, { className: 'ml-btn-sm' });
            return btn;
        };
        const toolsFields = h('div', { class: 'ml-aiset-fields' });
        const paintTools = () => {
            clear(toolsFields);
            if (state.tools.same) return;
            put(toolsFields,
                field(t('aiConnection'), select(state.tools.api, data.connections, followMemory, (v) => { state.tools.api = v; })),
                field(t('aiPreset'), select(state.tools.preset, data.presets, followPreset, (v) => { state.tools.preset = v; })));
        };
        const sameRow = checkRow({
            checked: state.tools.same,
            label: t('aiSameAsAssistant'),
            onChange: (value) => { state.tools.same = value; paintTools(); },
        });
        paintTools();
        if (state.tools.builtinPrompt === undefined) state.tools.builtinPrompt = true;
        const builtinRow = checkRow({
            checked: state.tools.builtinPrompt,
            label: t('aiBuiltinPrompt'),
            note: t('aiBuiltinPromptNote'),
            onChange: (value) => { state.tools.builtinPrompt = value; },
        });
        const content = h('div', { class: 'ml-aiset' },
            h('p', { class: 'ml-aiset-intro', text: t('aiSettingsIntro') }),
            h('section', { class: 'ml-aiset-group' },
                h('div', { class: 'ml-aiset-title' }, h('span', { text: t('aiTitle') }), testBtn('assistant')),
                h('p', { class: 'ml-aiset-note', text: t('aiSettingsAssistantNote') }),
                h('div', { class: 'ml-aiset-fields' },
                    field(t('aiConnection'), select(state.assistant.api, data.connections, followMemory, (v) => { state.assistant.api = v; })),
                    field(t('aiPreset'), select(state.assistant.preset, data.presets, followPreset, (v) => { state.assistant.preset = v; })))),
            h('section', { class: 'ml-aiset-group' },
                h('div', { class: 'ml-aiset-title' }, h('span', { text: t('aiToolsTitle') }), testBtn('tools')),
                h('p', { class: 'ml-aiset-note', text: t('aiSettingsToolsNote') }),
                sameRow,
                toolsFields,
                builtinRow),
            !data.connections.length ? h('p', { class: 'ml-aiset-warn', text: t('aiNoConnections') }) : null);
        confirmModal({
            title: t('aiSettings'),
            content,
            okLabel: t('aiSettingsSave'),
            onOk: async () => {
                try { await aiAccess.saveSettings(state); showToast(t('aiSettingsSaved')); } catch (err) { showToast(t('aiFailed', String(err?.message || err))); }
            },
        });
    }

    function field(label, control) {
        return h('label', { class: 'ml-aiset-field' }, h('span', { class: 'ml-aiset-label', text: label }), control);
    }

    /** Small modal with one optional text box. Resolves null on cancel. */
    function askText({ title, text, placeholder, okLabel }) {
        return new Promise((resolve) => {
            const area = h('textarea', { class: 'ml-schema-input ml-schema-textarea ml-ask-input', rows: 3, placeholder });
            let settled = false;
            const done = (value) => { if (!settled) { settled = true; resolve(value); } };
            confirmModal({
                title,
                content: h('div', { class: 'ml-ask' }, h('p', { class: 'ml-ask-text', text }), area),
                okLabel,
                onOk: () => done(area.value.trim()),
                onCancel: () => done(null),
                focus: area,
            });
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

    function showToast(text, { action = '', onAction = null, tone = '' } = {}) {
        clear(toast);
        put(toast,
            icon(action || tone === 'ok' ? 'check' : 'alert', { size: 15 }),
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
    function confirmModal({ title, lines = [], changes = null, content: custom = null, okLabel, danger = false, onOk, onCancel = null, focus = null }) {
        closeModal();
        const content = custom || (changes
            ? h('ul', { class: 'ml-schema-changes' }, changes.map(change => h('li', { dataset: { kind: change.kind } },
                h('div', { class: 'ml-schema-change-name' }, h('span', { class: 'ml-schema-change-kind', text: change.kind === 'added' ? '新建' : change.kind === 'removed' ? '删除' : '修改' }), h('span', { text: change.name || t('schemaNewType') })),
                h('ul', null, change.lines.map(line => h('li', { text: line }))))))
            : h('div', { class: 'ml-schema-confirm-text' }, lines.filter(Boolean).map(line => h('p', { text: line }))));
        modalCancel = onCancel;
        const ok = button(okLabel, async () => { modalCancel = null; closeModal(); await onOk(); }, { className: danger ? 'ml-btn-danger' : 'ml-btn-primary' });
        const panel = h('div', { class: `ml-dialog ml-schema-modal ${custom ? 'is-wide' : ''}`.trim(), role: 'alertdialog', 'aria-modal': 'true', 'aria-label': title, tabIndex: -1 },
            h('header', { class: 'ml-dialog-head' }, h('h3', { class: 'ml-dialog-title', text: title })),
            h('div', { class: 'ml-dialog-body' }, content),
            h('footer', { class: 'ml-schema-modal-foot' }, button(t('schemaCancel'), () => closeModal(), { className: 'ml-btn-ghost' }), ok));
        modal = h('div', { class: 'ml-dialog-backdrop', onMousedown: (event) => { if (event.target === modal) closeModal(); } }, panel);
        app.root.appendChild(modal);
        requestAnimationFrame(() => (focus || ok).focus());
    }

    function closeModal() {
        if (!modal) return false;
        modal.remove();
        modal = null;
        const cancel = modalCancel;
        modalCancel = null;
        cancel?.();
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
            if (aiOpen && app.isCompact()) {
                toggleAi();
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
            ai?.destroy();
            clearTimeout(undoTimer);
            closeModal();
        },
    };
}
