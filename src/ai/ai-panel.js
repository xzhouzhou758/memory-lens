// SPDX-License-Identifier: AGPL-3.0-or-later
//
// AI 助手 panel for the structure editor. The user describes a change in
// plain words; the AI edits a working copy of the schema with memory-graph's
// own tools. Each turn's result lands in the editor as unsaved changes, with
// a Chinese summary and 撤销这一轮. Nothing is written until 保存.

import { h, clear, put } from '../util.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { button, iconButton } from '../ui/components.js';
import { runTurn, newSession, sessionTitle, upsertSession, toolCallText, isEditTool, markRolledBack, makeId } from './ai-model.js';

const SUGGESTIONS = [
    '加一个「物品」类型，记录名称、持有人、当前状态',
    '帮我检查有没有重复或用不上的记录项',
    '把每一项的说明改得更清楚、更简短',
];
const ROLLED_BACK = { status: 'rolled_back', message: 'The user undid this edit; the working draft no longer contains it.' };

/**
 * @param {object} access source.ai
 * @param {{ getLive(): object[], applyLive(types: object[]): void, snapshot(): any,
 *   restore(snap: any): void, describe(before: any, after: any): { name: string, kind: string, lines: string[] }[],
 *   onClose(): void, onBusy(busy: boolean): void }} host
 */
export function createAiPanel(access, host) {
    const log = h('div', { class: 'ml-ai-log', role: 'log', 'aria-live': 'polite' });
    const input = h('textarea', {
        class: 'ml-ai-input',
        rows: 1,
        placeholder: t('aiPlaceholder'),
        'aria-label': t('aiPlaceholder'),
        onInput: () => fit(),
        onKeydown: (event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
                event.preventDefault();
                send();
            }
        },
    });
    const sendBtn = h('button', { type: 'button', class: 'ml-ai-send', onClick: () => (busy ? stop() : send()) });
    const historyBox = h('div', { class: 'ml-ai-history', hidden: true });
    const head = h('header', { class: 'ml-ai-head' },
        h('span', { class: 'ml-ai-mark', 'aria-hidden': 'true' }, icon('sparkle', { size: 15 })),
        h('span', { class: 'ml-ai-title', text: t('aiTitle') }),
        h('span', { class: 'ml-spacer' }),
        iconButton('clock', t('aiHistory'), () => toggleHistory(), { className: 'ml-iconbtn-sm' }),
        iconButton('plus', t('aiNew'), () => startNew(), { className: 'ml-iconbtn-sm' }),
        iconButton('x', t('close'), () => host.onClose(), { className: 'ml-iconbtn-sm' }));
    const el = h('aside', { class: 'ml-ai', 'aria-label': t('aiTitle') },
        head, historyBox, log,
        h('div', { class: 'ml-ai-compose' }, input, sendBtn),
        h('p', { class: 'ml-ai-foot', text: t('aiFoot') }));

    let sessions = [];
    let session = newSession();
    let busy = false;
    let controller = null;
    let status = 'idle'; // idle | ready | unsupported
    // Per assistant-turn: { endId, before, after, changes } keyed by the user message id.
    const turns = new Map();

    function fit() {
        input.style.height = 'auto';
        input.style.height = `${Math.min(input.scrollHeight + 2, 160)}px`;
    }

    async function init() {
        try {
            await access.check();
            sessions = await access.listSessions();
            status = 'ready';
        } catch {
            status = 'unsupported';
        }
        paint();
    }

    function paintSend() {
        clear(sendBtn);
        sendBtn.setAttribute('aria-label', busy ? t('aiStop') : t('aiSend'));
        sendBtn.title = busy ? t('aiStop') : t('aiSend');
        sendBtn.classList.toggle('is-busy', busy);
        put(sendBtn, icon(busy ? 'x' : 'arrowUp', { size: 15 }));
        sendBtn.disabled = status !== 'ready';
        input.disabled = status !== 'ready';
    }

    function paint() {
        paintSend();
        clear(log);
        if (status === 'unsupported') {
            put(log, h('div', { class: 'ml-ai-empty' }, h('p', { text: t('aiUnsupported') })));
            return;
        }
        if (!session.messages.length) {
            put(log, h('div', { class: 'ml-ai-empty' },
                h('p', { class: 'ml-ai-empty-title', text: t('aiEmptyTitle') }),
                h('p', { class: 'ml-ai-empty-sub', text: t('aiEmptySub') }),
                h('div', { class: 'ml-ai-suggest' }, SUGGESTIONS.map(text => h('button', {
                    type: 'button',
                    class: 'ml-ai-chip',
                    onClick: () => { input.value = text; fit(); input.focus(); },
                }, h('span', { text }))))));
            return;
        }
        for (const m of session.messages) {
            if (m.role === 'user') {
                put(log, h('div', { class: 'ml-ai-msg is-user' }, h('div', { class: 'ml-ai-bubble', text: m.content })));
                continue;
            }
            if (m.role === 'note') {
                put(log, h('div', { class: 'ml-ai-note', text: m.content }));
                continue;
            }
            const calls = (m.toolCalls || []);
            const results = new Map((m.toolResults || []).map(r => [String(r.tool_call_id), r]));
            put(log, h('div', { class: `ml-ai-msg is-ai ${m.rolledBack ? 'is-rolled' : ''}`.trim() },
                calls.length ? h('ul', { class: 'ml-ai-tools' }, calls.map(c => {
                    const failed = results.get(String(c.id))?.status === 'fail';
                    return h('li', { class: failed ? 'is-fail' : '', dataset: { kind: isEditTool(c.name) ? 'edit' : 'read' } },
                        icon(failed ? 'alert' : isEditTool(c.name) ? 'check' : 'eye', { size: 12 }),
                        h('span', { text: toolCallText(c) }));
                })) : null,
                m.content ? h('div', { class: 'ml-ai-text', text: m.content }) : null));
            const turn = [...turns.values()].find(x => x.endId === m.id);
            if (turn) put(log, turnCard(turn));
        }
        if (busy) put(log, h('div', { class: 'ml-ai-thinking' }, h('span', { class: 'ml-spinner', 'aria-hidden': 'true' }), h('span', { text: t('aiThinking') })));
        requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });
    }

    function turnCard(turn) {
        if (!turn.changes.length) return null;
        return h('section', { class: `ml-ai-turn ${turn.undone ? 'is-undone' : ''}`.trim() },
            h('div', { class: 'ml-ai-turn-head' },
                h('span', { text: turn.undone ? t('aiTurnUndone') : t('aiTurnChanged') }),
                turn.undone ? null : button(t('aiUndoTurn'), () => undoTurn(turn), { iconName: 'undo', className: 'ml-btn-sm ml-btn-ghost' })),
            h('ul', { class: 'ml-ai-turn-list' }, turn.changes.map(change => h('li', null,
                h('span', { class: 'ml-ai-turn-kind', dataset: { kind: change.kind }, text: change.kind === 'added' ? '新建' : change.kind === 'removed' ? '删除' : '修改' }),
                h('span', { class: 'ml-ai-turn-name', text: change.name || t('schemaNewType') }),
                h('span', { class: 'ml-ai-turn-lines', text: change.lines.join('；') })))));
    }

    async function send() {
        const text = input.value.trim();
        if (!text || busy || status !== 'ready') return;
        input.value = '';
        fit();
        const userMsg = { id: makeId('msg'), role: 'user', content: text, at: Date.now() };
        if (!session.messages.length) session.title = sessionTitle(text);
        session.messages.push(userMsg);
        const before = host.snapshot();
        busy = true;
        host.onBusy(true);
        controller = new AbortController();
        paint();
        const firstAi = session.messages.length;
        try {
            const out = await runTurn(access.round, session, {
                live: host.getLive(),
                signal: controller.signal,
                onUpdate: (live) => { host.applyLive(live); paint(); },
            });
            const after = host.snapshot();
            const endId = session.messages[session.messages.length - 1]?.id;
            const ids = session.messages.slice(firstAi).map(m => m.id);
            if (out.changed) turns.set(userMsg.id, { endId, ids, before, after, changes: host.describe(before, after), undone: false });
        } catch (err) {
            if (err?.name !== 'AbortError' && !controller?.signal.aborted) {
                session.messages.push({ id: makeId('msg'), role: 'note', content: t('aiFailed', String(err?.message || err)), at: Date.now() });
            } else {
                session.messages.push({ id: makeId('msg'), role: 'note', content: t('aiStopped'), at: Date.now() });
            }
        } finally {
            busy = false;
            controller = null;
            host.onBusy(false);
            persist();
            paint();
        }
    }

    function stop() {
        controller?.abort();
    }

    function undoTurn(turn) {
        // Only the latest live turn can be undone cleanly; later turns built on it.
        const later = [...turns.values()].filter(x => !x.undone && session.messages.findIndex(m => m.id === x.endId) > session.messages.findIndex(m => m.id === turn.endId));
        for (const x of [turn, ...later]) x.undone = true;
        host.restore(turn.before);
        markRolledBack(session.messages, [turn, ...later].flatMap(x => x.ids), ROLLED_BACK);
        session.messages.push({ id: makeId('msg'), role: 'note', content: later.length ? t('aiUndoneMany', later.length + 1) : t('aiUndoneOne'), at: Date.now() });
        persist();
        paint();
    }

    function persist() {
        const stored = { ...session, messages: session.messages.filter(m => m.role !== 'note') };
        sessions = upsertSession(sessions, stored);
        access.saveSessions(sessions).catch(() => { /* best effort */ });
    }

    function startNew() {
        if (busy) return;
        session = newSession();
        turns.clear();
        historyBox.hidden = true;
        paint();
        input.focus();
    }

    function toggleHistory() {
        historyBox.hidden = !historyBox.hidden;
        if (historyBox.hidden) return;
        clear(historyBox);
        if (!sessions.length) {
            put(historyBox, h('p', { class: 'ml-ai-history-empty', text: t('aiNoHistory') }));
            return;
        }
        put(historyBox, h('ul', null, sessions.map(s => h('li', null,
            h('button', {
                type: 'button',
                class: `ml-ai-history-item ${s.id === session.id ? 'is-current' : ''}`.trim(),
                onClick: () => {
                    if (busy) return;
                    session = structuredClone(s);
                    turns.clear();
                    historyBox.hidden = true;
                    paint();
                },
            }, h('span', { class: 'ml-ai-history-title', text: s.title || t('aiUntitled') }), h('span', { class: 'ml-ai-history-meta', text: new Date(s.at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) })),
            iconButton('trash', t('aiDeleteSession'), () => {
                sessions = sessions.filter(x => x.id !== s.id);
                access.saveSessions(sessions).catch(() => {});
                if (s.id === session.id) startNew();
                else { historyBox.hidden = true; toggleHistory(); }
            }, { className: 'ml-iconbtn-sm ml-schema-danger' })))));
    }

    init();
    return {
        el,
        focus: () => requestAnimationFrame(() => input.focus()),
        isBusy: () => busy,
        /** The editor reloaded from storage: earlier turn snapshots no longer apply. */
        reset() {
            for (const turn of turns.values()) turn.undone = true;
            if (status === 'ready') paint();
        },
        destroy() { controller?.abort(); },
    };
}
