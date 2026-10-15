import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffSchemas, applyChanges, changeMarks, changeTarget } from '../src/ai/schema-diff.js';

const TODO = {
    id: 'todo', label: '待办与约定', extractHint: '记录待办。',
    tableColumns: ['title', 'who', 'kind'], embeddingColumns: ['title', 'who'],
    columnHints: { title: '显示名：当事人·事项', who: '事项的当事人', kind: '待办 / 约定 / 誓言 四选一。' },
    requiredColumns: ['title'], alwaysInject: false, latestOnly: true, compression: { mode: 'none' },
};

test('diffSchemas lists item-level changes in plain Chinese', () => {
    const after = structuredClone([TODO]);
    const t = after[0];
    t.tableColumns = ['title', 'kind', 'due'];
    t.columnHints.due = '截止时间：完整日期 + 钟点';
    t.columnHints.kind = '待办 / 约定 / 誓言 / 系统任务 四选一。';
    delete t.columnHints.who;
    t.requiredColumns = ['title', 'kind'];
    t.alwaysInject = true;
    after.push({ id: 'item', label: '物品', tableColumns: ['title'], columnHints: { title: '物品名称' } });
    const changes = diffSchemas([TODO], after);
    const texts = changes.map(c => c.text);
    assert.ok(texts.includes('新增记录项「截止时间」'), texts.join(' / '));
    assert.ok(texts.includes('删除记录项「事项的当事人」'));
    assert.ok(texts.some(x => /的提示改了$/.test(x)));
    assert.ok(texts.some(x => /改为必填$/.test(x)));
    assert.ok(texts.includes('「待办与约定」开启「一直让 AI 看到」'));
    assert.ok(texts.includes('新建类型「物品」'));
    assert.ok(!/[a-z_]{3,}/.test(texts.join('')), 'no keys in text');
    const hint = changes.find(c => c.kind === 'hint');
    assert.equal(hint.before, TODO.columnHints.kind);
});

test('applyChanges applies any subset independently', () => {
    const after = structuredClone([TODO]);
    after[0].tableColumns.push('due');
    after[0].columnHints.due = '截止时间';
    after[0].latestOnly = false;
    after[0].columnHints.who = '当事人，写全名';
    const changes = diffSchemas([TODO], after);
    const onlyAdd = applyChanges([TODO], changes.filter(c => c.kind === 'addColumn')).specs[0];
    assert.deepEqual(onlyAdd.tableColumns, ['title', 'who', 'kind', 'due']);
    assert.equal(onlyAdd.latestOnly, true, 'unchosen flag untouched');
    assert.equal(onlyAdd.columnHints.who, '事项的当事人', 'unchosen hint untouched');
    assert.ok(onlyAdd.embeddingColumns.includes('due'));
    const all = applyChanges([TODO], changes).specs;
    assert.equal(JSON.stringify(diffSchemas(after, all)), '[]', 'applying everything reproduces the target');
});

test('remove / reorder / new type round-trip', () => {
    const after = [{ ...structuredClone(TODO), tableColumns: ['kind', 'title'] }, { id: 'x', label: '新', tableColumns: ['title'] }];
    const changes = diffSchemas([TODO], after);
    const result = applyChanges([TODO], changes).specs;
    assert.deepEqual(result.map(s => s.id), ['todo', 'x']);
    assert.deepEqual(result[0].tableColumns, ['kind', 'title']);
    assert.equal(diffSchemas([TODO], []).at(-1).kind, 'removeType');
});

test('changeMarks and targets', () => {
    const after = structuredClone([TODO]);
    after[0].tableColumns.push('due');
    after[0].columnHints.kind = '新';
    const changes = diffSchemas([TODO], after);
    const marks = changeMarks(changes);
    assert.equal(marks.todo.count, 2);
    assert.deepEqual(marks.todo.columns, { due: 'added', kind: 'changed' });
    assert.deepEqual(changes.map(changeTarget).sort(), ['todo:due', 'todo:kind']);
});
