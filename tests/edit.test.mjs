import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editRule, toEditText, fromEditText, isChanged, hasParagraphs } from '../src/edit/edit-model.js';

test('editRule blocks rollups, archived nodes and event titles', () => {
    assert.equal(editRule({ type: 'character_sheet' }, 'identity').ok, true);
    assert.equal(editRule({ type: 'event', isRollup: true }, 'summary').ok, false);
    assert.equal(editRule({ type: 'thread', archived: true }, 'state').ok, false);
    assert.equal(editRule({ type: 'event' }, '').ok, false);
    assert.equal(editRule({ type: 'event' }, 'summary').ok, true);
    assert.match(editRule(null, 'x').reason, /找不到/);
});

test('values round-trip keeping their stored shape', () => {
    assert.equal(toEditText(['阿林', '小林']), '阿林、小林');
    assert.deepEqual(fromEditText('阿林、小林, 林栖', ['x']), ['阿林', '小林', '林栖']);
    assert.deepEqual(fromEditText('  ', ['x']), []);
    assert.equal(fromEditText('12', 3), 12);
    assert.equal(fromEditText('十二', 3), '十二');
    assert.equal(fromEditText('  守灯人 \r\n', '旧'), '守灯人');
    assert.deepEqual(fromEditText('{"a":1}', { a: 0 }), { a: 1 });
});

test('isChanged ignores whitespace and identical lists', () => {
    assert.equal(isChanged(' 守灯人 ', '守灯人'), false);
    assert.equal(isChanged('阿林、小林', ['阿林', '小林']), false);
    assert.equal(isChanged('阿林', ['阿林', '小林']), true);
    assert.equal(isChanged('新的', undefined), true);
    assert.equal(isChanged('', undefined), false);
});

test('only paragraph text saves with Ctrl+Enter', () => {
    assert.equal(hasParagraphs('summary', '短'), true);
    assert.equal(hasParagraphs('identity', 'x'.repeat(80)), false);
    assert.equal(hasParagraphs('note', 'a\nb'), true);
});
