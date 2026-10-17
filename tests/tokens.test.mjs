import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addEntry, summarize, formatTokens } from '../src/token-stats.js';

test('same floor replaces, new floor appends, list is capped', () => {
    let list = addEntry([], { at: 1, floor: 4, core: 10, focus: 20 });
    list = addEntry(list, { at: 2, floor: 4, core: 10, focus: 50 });
    assert.equal(list.length, 1);
    assert.equal(list[0].focus, 50);
    list = addEntry(list, { at: 3, floor: 6, core: 10, focus: 5 });
    assert.equal(list.length, 2);
    let many = [];
    for (let i = 0; i < 10; i++) many = addEntry(many, { at: i, floor: i, core: 1, focus: 1 }, 4);
    assert.deepEqual(many.map(e => e.floor), [6, 7, 8, 9]);
});

test('summary totals and averages', () => {
    const s = summarize([{ core: 100, focus: 200 }, { core: 100, focus: 0 }]);
    assert.deepEqual(s, { count: 2, total: 400, avg: 200, max: 300, avgFocus: 100, avgCore: 100 });
    assert.equal(summarize([]).avg, 0);
});

test('formatTokens', () => {
    assert.equal(formatTokens(950), '950');
    assert.equal(formatTokens(1234), '1.2k');
    assert.equal(formatTokens(2000), '2k');
    assert.equal(formatTokens(15300), '15k');
    assert.equal(formatTokens(2400000), '2.4M');
});
