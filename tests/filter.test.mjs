import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTag, parseTagList, addToList, buildScripts, filterText, inspectText, planWarnings, invalidTokens } from '../src/filter/tag-filter.js';

const REPLY = `<think>
先想一想……很长很长的思维链
</think>
<content>
雨停了。林栖推开灯塔的门。
</content>
<!-- 作者备注 -->
<statusbar>体力 80</statusbar>`;

test('parses the three tag forms', () => {
    assert.deepEqual(parseTag('<think>'), { kind: 'angle', name: 'think', label: 'think' });
    assert.deepEqual(parseTag('[时间]'), { kind: 'square', name: '时间', label: '[时间]' });
    assert.equal(parseTag('!--').kind, 'comment');
    assert.equal(parseTag('<!--').kind, 'comment');
    assert.equal(parseTag('a b'), null);
    assert.deepEqual(parseTagList('think, Think、[时间] ；details').map(t => t.label), ['think', '[时间]', 'details']);
    assert.deepEqual(invalidTokens('think, <<x'), ['<<x']);
    assert.equal(addToList('think', 'details'), 'think, details');
    assert.equal(addToList('think, details', 'THINK'), 'think, details');
});

test('blacklist removes tags and their content', () => {
    const out = filterText(REPLY, { black: 'think, !--, statusbar' });
    assert.equal(out, '<content>\n雨停了。林栖推开灯塔的门。\n</content>');
});

test('blacklist handles a thought missing its opener or closer', () => {
    assert.equal(filterText('思考过程……\n</think>\n正文在这里', { black: 'think' }), '正文在这里');
    assert.equal(filterText('正文在这里\n<think>没写完的思考', { black: 'think' }), '正文在这里');
});

test('whitelist keeps only listed blocks, without the tags', () => {
    const out = filterText(REPLY, { white: 'content, statusbar' });
    assert.equal(out, '雨停了。林栖推开灯塔的门。\n\n体力 80');
});

test('whitelist runs after the blacklist, so fake tags inside a thought do not survive', () => {
    const text = '<think>草稿：<content>假的</content></think><content>真的</content>';
    assert.equal(filterText(text, { black: 'think', white: 'content' }), '真的');
});

test('square tags: paired blocks and single-line markers', () => {
    assert.equal(filterText('[歌曲]晴天[/歌曲]\n正文', { black: '[歌曲]' }), '正文');
    assert.equal(filterText('[时间] 第三天傍晚\n多余的话', { white: '[时间]' }), '[时间] 第三天傍晚');
});

test('whitelist on a bare reply deletes everything and is flagged', () => {
    const bare = '雨停了。林栖推开灯塔的门，海风灌进来。';
    assert.equal(filterText(bare, { white: 'content' }), '');
    assert.deepEqual(planWarnings({ white: 'content' }, bare), ['empty']);
    assert.deepEqual(planWarnings({ black: 'think' }, bare), []);
});

test('scripts target only the plugin input lane', () => {
    const scripts = buildScripts({ black: 'think', white: 'content' });
    assert.ok(scripts.length > 2);
    for (const s of scripts) {
        assert.equal(s.pluginOnly, true);
        assert.equal(s.promptOnly, true);
        assert.deepEqual(s.placement, [2]);
        assert.ok(s.id.startsWith('memory-lens-tagfilter-'));
    }
    assert.deepEqual(buildScripts({ enabled: false, black: 'think' }), []);
    assert.deepEqual(buildScripts({ black: '', white: '' }), []);
});

test('inspectText tells wrapped replies from bare ones', () => {
    const wrapped = inspectText(REPLY);
    assert.ok(wrapped.tags.some(t => t.label === 'content'));
    assert.ok(wrapped.tags.some(t => t.label === 'think'));
    assert.equal(wrapped.bareChars, 0);
    const bare = inspectText('<think>想</think>\n雨停了，林栖推门出去。');
    assert.ok(bare.bareChars > 5);
});

import { readDiagnosis, diagnoseUserPrompt } from '../src/filter/filter-ai.js';
import { readFilterSettings, activePlan } from '../src/filter/filter-runtime.js';

test('AI diagnosis: bare body never gets a whitelist', () => {
    const bare = '<think>想</think>\n雨停了，林栖推门出去。';
    const plan = readDiagnosis({ body: 'bare', black: ['think'], white: ['content'], reason: 'x' }, bare);
    assert.equal(plan.white, '');
    assert.equal(plan.black, 'think');
    assert.equal(plan.notes.length, 1);
    // Claims "wrapped" but the whitelist would empty the sample → dropped too.
    const wrong = readDiagnosis({ body: 'wrapped', black: [], white: ['content'], reason: '' }, bare);
    assert.equal(wrong.white, '');
    const ok = readDiagnosis({ body: 'wrapped', black: ['think'], white: ['content'] }, '<think>a</think><content>正文</content>');
    assert.equal(ok.white, 'content');
    assert.match(diagnoseUserPrompt('<content>正文</content>'), /content（尖括号）/);
});

test('filter settings default and active plan', () => {
    const s = readFilterSettings({ extensionSettings: {} });
    assert.equal(s.enabled, false);
    assert.equal(s.presets.length, 1);
    const ctx = { extensionSettings: { memory_lens: { tagFilter: { enabled: true, active: 'b', presets: [{ id: 'a', black: 'x' }, { id: 'b', black: 'think', white: 'content' }] } } } };
    assert.deepEqual(activePlan(readFilterSettings(ctx)), { enabled: true, black: 'think', white: 'content' });
});
