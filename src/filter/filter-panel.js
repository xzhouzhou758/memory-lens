// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 标签过滤 dialog (opened from the 记忆结构 bar): on/off, presets, black /
// white lists with quick-add tags, AI 诊断 and a before / after preview.
// Edits stay in the dialog until 保存.

import { h, clear, put } from '../util.js';
import { t } from '../i18n.js';
import { button, switchControl, checkRow } from '../ui/components.js';
import { COMMON_BLACK, COMMON_WHITE, addToList, filterText, invalidTokens, planWarnings, parseTagList } from './tag-filter.js';

let presetCounter = 0;
const newId = () => `p${Date.now().toString(36)}${++presetCounter}`;

/**
 * @param {{ access, aiAccess, confirmModal, showToast }} deps
 */
export function openFilterDialog({ access, aiAccess, confirmModal, showToast }) {
    let state;
    try { state = structuredClone(access.read()); } catch (err) { showToast(t('filterFailed', String(err?.message || err))); return; }
    const replies = (() => { try { return access.recentReplies?.(8) || []; } catch { return []; } })();
    let sampleIndex = 0;
    const count = (text) => String(text ?? '').replace(/\s+/g, '').length;
    // Text memory-graph really reads (whitespace collapsed + the user's own
    // plugin-lane regex); falls back to the raw reply in the preview build.
    const readFor = (i, plan) => {
        const reply = replies[i];
        if (!reply) return null;
        if (access.preview) {
            try { return access.preview(reply.floor, plan); } catch { /* fall back */ }
        }
        return { before: reply.text, after: filterText(reply.text, plan), real: false };
    };
    const planNow = () => ({ ...current(), mirrorPrompt: state.mirrorPrompt !== false });
    const lensText = (i) => readFor(i, { black: '', white: '' })?.before || '';
    let diagnosis = null;
    let busy = false;
    const current = () => state.presets.find(p => p.id === state.active) || state.presets[0];

    const root = h('div', { class: 'ml-filter' });
    const presetBox = h('section', { class: 'ml-filter-presets' });
    const listsBox = h('div', { class: 'ml-filter-lists' });
    const aiBox = h('div', { class: 'ml-filter-ai' });
    const previewBox = h('section', { class: 'ml-filter-preview' });
    const blackInput = h('textarea', { class: 'ml-schema-input ml-filter-input', rows: 1, placeholder: t('filterBlackPh'), 'aria-label': t('filterBlack') });
    const whiteInput = h('textarea', { class: 'ml-schema-input ml-filter-input', rows: 1, placeholder: t('filterWhitePh'), 'aria-label': t('filterWhite') });
    const blackHint = h('p', { class: 'ml-filter-bad', hidden: true });
    const whiteHint = h('p', { class: 'ml-filter-bad', hidden: true });
    const whiteWarn = h('p', { class: 'ml-filter-warn', hidden: true });

    const onListInput = () => {
        const preset = current();
        preset.black = blackInput.value;
        preset.white = whiteInput.value;
        paintHints();
        paintPreview();
    };
    blackInput.addEventListener('input', onListInput);
    whiteInput.addEventListener('input', onListInput);

    // ----- Presets ---------------------------------------------------------
    function paintPresets() {
        clear(presetBox);
        const select = h('select', { class: 'ml-select', 'aria-label': t('filterPreset'), onChange: (e) => { state.active = e.target.value; diagnosis = null; paintAll(); } },
            state.presets.map(p => h('option', { value: p.id, text: p.name || t('filterUnnamed') })));
        select.value = current().id;
        const name = h('input', {
            type: 'text', class: 'ml-schema-input ml-filter-name', value: current().name, maxlength: 30,
            placeholder: t('filterPresetNamePh'), 'aria-label': t('filterPresetName'),
            onInput: (e) => {
                current().name = e.target.value;
                const option = select.querySelector(`option[value="${CSS.escape(current().id)}"]`);
                if (option) option.textContent = e.target.value.trim() || t('filterUnnamed');
            },
        });
        put(presetBox,
            h('div', { class: 'ml-filter-label', text: t('filterPreset') }),
            h('div', { class: 'ml-filter-presetrow' },
                select,
                name,
                button(t('filterPresetNew'), () => {
                    const preset = { id: newId(), name: t('filterPresetNewName', state.presets.length + 1), black: '', white: '' };
                    state.presets.push(preset);
                    state.active = preset.id;
                    diagnosis = null;
                    paintAll();
                }, { iconName: 'plus', className: 'ml-btn-sm ml-btn-ghost' }),
                button(t('filterPresetDelete'), () => {
                    if (state.presets.length <= 1) {
                        Object.assign(current(), { black: '', white: '' });
                    } else {
                        state.presets = state.presets.filter(p => p.id !== state.active);
                        state.active = state.presets[0].id;
                    }
                    diagnosis = null;
                    paintAll();
                }, { iconName: 'trash', className: 'ml-btn-sm ml-btn-ghost ml-filter-del' })));
    }

    // ----- Lists -----------------------------------------------------------
    function chips(tags, input) {
        return h('div', { class: 'ml-filter-chips' },
            h('span', { class: 'ml-filter-chips-label', text: t('filterCommon') }),
            tags.map(tag => h('button', {
                type: 'button', class: 'ml-filter-chip', text: tag,
                onClick: () => { input.value = addToList(input.value, tag); onListInput(); },
            })));
    }

    function listBlock(kind) {
        const black = kind === 'black';
        return h('section', { class: 'ml-filter-list', dataset: { kind } },
            h('div', { class: 'ml-filter-label' },
                h('span', { text: black ? t('filterBlack') : t('filterWhite') }),
                h('span', { class: 'ml-filter-label-note', text: black ? t('filterBlackNote') : t('filterWhiteNote') })),
            black ? blackInput : whiteInput,
            black ? blackHint : whiteHint,
            chips(black ? COMMON_BLACK : COMMON_WHITE, black ? blackInput : whiteInput),
            black ? null : h('p', { class: 'ml-filter-tip', text: t('filterWhiteTip') }),
            black ? null : whiteWarn);
    }

    function paintHints() {
        for (const [input, hint] of [[blackInput, blackHint], [whiteInput, whiteHint]]) {
            const bad = invalidTokens(input.value);
            hint.hidden = !bad.length;
            hint.textContent = bad.length ? t('filterBadTags', bad.join('、')) : '';
        }
        const r = readFor(sampleIndex, planNow());
        const warn = r && parseTagList(current().white).length && count(r.before) && !count(r.after) ? ['empty']
            : planWarnings(current(), lensText(sampleIndex));
        whiteWarn.hidden = !warn.length;
        whiteWarn.textContent = warn.includes('empty') ? t('filterWarnEmpty') : warn.includes('tiny') ? t('filterWarnTiny') : '';
    }

    // ----- AI 诊断 ---------------------------------------------------------
    function paintAi() {
        clear(aiBox);
        if (!aiAccess?.diagnoseFilter) return;
        const sample = lensText(0);
        const btn = button(busy ? t('filterDiagnosing') : t('filterDiagnose'), async () => {
            if (busy || !sample) return;
            busy = true;
            paintAi();
            try {
                diagnosis = await aiAccess.diagnoseFilter(sample);
                blackInput.value = diagnosis.black;
                whiteInput.value = diagnosis.white;
                sampleIndex = 0;
                onListInput();
            } catch (err) {
                diagnosis = null;
                showToast(t('aiFailed', String(err?.message || err)));
            } finally {
                busy = false;
                paintAi();
            }
        }, { iconName: 'sparkle', className: 'ml-btn-sm', disabled: busy || !sample, title: t('filterDiagnoseHint') });
        put(aiBox,
            h('div', { class: 'ml-filter-ai-row' }, btn,
                h('span', { class: 'ml-filter-ai-note', text: sample ? t('filterDiagnoseHint') : t('filterNoReply') })),
            diagnosis ? h('div', { class: 'ml-filter-diag', role: 'status' },
                h('div', { class: 'ml-filter-diag-head' },
                    h('span', { class: 'ml-filter-diag-tag', text: diagnosis.body === 'wrapped' ? t('filterBodyWrapped') : t('filterBodyBare') }),
                    h('span', { text: diagnosis.white ? t('filterUseWhite') : t('filterUseBlack') })),
                diagnosis.reason ? h('p', { text: diagnosis.reason }) : null,
                diagnosis.notes.map(note => h('p', { class: 'ml-filter-warn', text: note })),
                h('p', { class: 'ml-filter-tip', text: t('filterDiagnoseDone') })) : null);
    }

    // ----- Preview ---------------------------------------------------------
    function paintPreview() {
        clear(previewBox);
        put(previewBox, h('div', { class: 'ml-filter-label' },
            h('span', { text: t('filterPreview') }),
            replies.length ? (() => {
                const select = h('select', { class: 'ml-select ml-filter-sample', 'aria-label': t('filterPreviewPick'), onChange: (e) => { sampleIndex = Number(e.target.value); paintHints(); paintPreview(); } },
                    replies.map((r, i) => h('option', { value: String(i), text: i === 0 ? t('filterLatest', r.floor) : t('filterFloor', r.floor) })));
                select.value = String(sampleIndex);
                return select;
            })() : null));
        const result = readFor(sampleIndex, planNow());
        if (!result?.before && !replies[sampleIndex]) {
            put(previewBox, h('p', { class: 'ml-filter-tip', text: t('filterNoReply') }));
            return;
        }
        const { before, after } = result;
        put(previewBox,
            h('p', { class: 'ml-filter-tip', text: result.real ? t('filterPreviewReal') : t('filterPreviewRaw') }),
            h('div', { class: 'ml-filter-compare' },
                pane(t('filterBefore'), before, count(before), !count(before)),
                pane(t('filterAfter'), after, count(after), !count(after))));
    }
    const pane = (title, text, n, empty = false) => h('div', { class: `ml-filter-pane ${empty ? 'is-empty' : ''}`.trim() },
        h('div', { class: 'ml-filter-pane-head' }, h('span', { text: title }), h('span', { class: 'ml-filter-count', text: t('filterChars', n) })),
        h('pre', { class: 'ml-filter-text', text: empty ? t('filterAllGone') : text }));

    // ----- Assemble --------------------------------------------------------
    function paintAll() {
        blackInput.value = current().black || '';
        whiteInput.value = current().white || '';
        paintPresets();
        paintHints();
        paintAi();
        paintPreview();
    }

    const toggle = h('div', { class: 'ml-filter-toggle' });
    const statusLine = () => {
        let st = null;
        try { st = access.status?.() || null; } catch { st = null; }
        if (!st) return null;
        if (!st.registered) return h('p', { class: 'ml-filter-bad', text: t('filterNotRegistered') });
        const names = (list) => list.slice(0, 4).join('、') + (list.length > 4 ? ' 等' : '');
        return h('div', { class: 'ml-filter-status' },
            h('p', { class: st.active || st.mirrored.length ? '' : 'ml-filter-tip', text: st.active || st.mirrored.length ? t('filterRunning', st.active + st.mirrored.length) : t('filterIdle') }),
            st.mirrored.length ? h('p', { class: 'ml-filter-tip', text: t('filterMirrored', st.mirrored.length, names(st.mirrored)) }) : null,
            st.userRules.length ? h('p', { class: 'ml-filter-tip', text: t('filterUserRules', st.userRules.length, names(st.userRules)) }) : null);
    };
    const paintToggle = () => put(clear(toggle),
        switchControl(t('filterEnable'), state.enabled, (v) => { state.enabled = v; paintToggle(); }),
        checkRow({
            checked: state.mirrorPrompt !== false,
            label: t('filterMirror'),
            note: t('filterMirrorNote'),
            onChange: (v) => { state.mirrorPrompt = v; paintHints(); paintPreview(); },
        }),
        statusLine());
    paintToggle();

    put(listsBox, listBlock('black'), listBlock('white'));
    put(root,
        h('p', { class: 'ml-filter-intro', text: t('filterIntro') }),
        toggle,
        h('p', { class: 'ml-filter-scope', text: t('filterScope') }),
        presetBox,
        listsBox,
        aiBox,
        previewBox);
    paintAll();

    confirmModal({
        title: t('filterTitle'),
        content: root,
        className: 'is-xwide',
        okLabel: t('filterSave'),
        onOk: () => {
            for (const p of state.presets) {
                p.name = String(p.name || '').trim() || t('filterUnnamed');
                p.black = String(p.black || '').trim();
                p.white = String(p.white || '').trim();
            }
            try { access.write(state); showToast(state.enabled ? t('filterSaved') : t('filterSavedOff'), { tone: 'ok' }); } catch (err) { showToast(t('filterFailed', String(err?.message || err))); }
        },
    });
}
