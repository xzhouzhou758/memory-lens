import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTaskMessages, runTurn, newSession, upsertSession, markRolledBack, toolCallText, MAX_SESSIONS } from '../src/ai/ai-model.js';

test('buildTaskMessages replays tool calls with matching tool results', () => {
    const messages = [
        { id: 'u1', role: 'user', content: '加一个物品类型' },
        { id: 'a1', role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'mg_schema_set_node_type', args: { id: 'item' } }], toolResults: [{ tool_call_id: 'c1', content: { status: 'applied' }, status: 'ok' }] },
        { id: 'n1', role: 'note', content: '已停止' },
        { id: 'a2', role: 'assistant', content: '好了' },
    ];
    const out = buildTaskMessages('SYS', messages);
    assert.deepEqual(out.map(m => m.role), ['system', 'user', 'assistant', 'tool', 'assistant']);
    assert.equal(out[2].tool_calls[0].function.arguments, '{"id":"item"}');
    assert.equal(out[3].tool_call_id, 'c1');
    assert.equal(out[3].content, '{"status":"applied"}');
});

test('runTurn loops while the AI calls tools and reports change', async () => {
    const session = newSession();
    session.messages.push({ id: 'u', role: 'user', content: 'x' });
    let n = 0;
    const round = async ({ live }) => {
        n++;
        if (n === 1) return { assistantText: '', calls: [{ id: 'c', name: 'mg_schema_set_node_type', args: {}, result: {}, ok: true }], live: [...live, { id: 'item' }] };
        return { assistantText: '完成', calls: [], live };
    };
    const out = await runTurn(round, session, { live: [{ id: 'event' }] });
    assert.equal(out.rounds, 2);
    assert.equal(out.changed, true);
    assert.deepEqual(out.live.map(t => t.id), ['event', 'item']);
    assert.equal(session.messages.length, 3);
    assert.equal(session.messages[1].toolResults[0].status, 'ok');
});

test('runTurn stops at the round cap and honours abort', async () => {
    const session = newSession();
    const round = async ({ live }) => ({ assistantText: '', calls: [{ id: 'c', name: 'mg_schema_read_fields', args: {}, result: {}, ok: true }], live });
    const out = await runTurn(round, session, { live: [], maxRounds: 3 });
    assert.equal(out.rounds, 3);
    assert.equal(out.changed, false);
    const ac = new AbortController();
    ac.abort();
    await assert.rejects(runTurn(round, session, { live: [], signal: ac.signal }), { name: 'AbortError' });
});

test('upsertSession keeps newest first, drops empty, caps length', () => {
    let list = [];
    for (let i = 0; i < MAX_SESSIONS + 3; i++) list = upsertSession(list, { id: `s${i}`, at: i, messages: [{}] });
    assert.equal(list.length, MAX_SESSIONS);
    assert.equal(list[0].id, `s${MAX_SESSIONS + 2}`);
    assert.equal(upsertSession(list, { id: 'empty', at: 999, messages: [] }).length, MAX_SESSIONS);
});

test('markRolledBack rewrites only successful edit results', () => {
    const messages = [{ id: 'a', role: 'assistant', toolCalls: [{ id: 'r', name: 'mg_schema_read_fields' }, { id: 'e', name: 'mg_schema_set_node_type' }], toolResults: [{ tool_call_id: 'r', content: 'R', status: 'ok' }, { tool_call_id: 'e', content: 'E', status: 'ok' }] }];
    markRolledBack(messages, ['a'], { status: 'rolled_back' });
    assert.equal(messages[0].toolResults[0].content, 'R');
    assert.deepEqual(messages[0].toolResults[1].content, { status: 'rolled_back' });
    assert.equal(messages[0].rolledBack, true);
});

test('toolCallText names the target in Chinese', () => {
    assert.equal(toolCallText({ name: 'mg_schema_set_node_type', args: { label: '物品' } }), '修改类型「物品」');
    assert.equal(toolCallText({ name: 'mg_schema_read_fields', args: {} }), '查看当前结构');
});

test('rewrite prompts carry the field instruction and forbid new facts', async () => {
    const { rewriteSystemPrompt, rewriteUserPrompt } = await import('../src/ai/ai-model.js');
    assert.match(rewriteSystemPrompt('memoryValue'), /Do NOT add facts/);
    assert.match(rewriteSystemPrompt('columnHint'), /field instruction/);
    const user = rewriteUserPrompt({ kind: 'memoryValue', text: '原文', typeName: '角色', itemName: '目标', instruction: '一句话 40 字内', siblings: ['林书瑶', '周派'] });
    assert.match(user, /Field instruction: 一句话 40 字内/);
    assert.match(user, /Known names: 林书瑶、周派/);
    assert.ok(user.endsWith('原文'));
});
