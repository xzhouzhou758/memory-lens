import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    toDrafts, fromDraft, newColumn, newTypeDraft, labelsFromDrafts, validateDrafts,
    describeChanges, draftsEqual, cloneDrafts, buildLabelMaps, columnDisplayName, typeDisplayName,
} from '../src/schema/schema-model.js';
import { setDisplayLabels, typeLabel, fieldLabel, depthLabel } from '../src/i18n.js';

const LONG_HINT = 'Canonical character name only. Do not include aliases, English names, titles, translations, or any parenthetical clarification here.';

const DEFAULTS = [
    {
        id: 'event', label: 'Event', tableName: 'event_table', tableColumns: ['summary'], embeddingColumns: ['summary'],
        columnHints: { summary: 'A prose body covering event skeleton…' }, requiredColumns: ['summary'],
        extractHint: 'Critical plot events…', extractionInstructions: 'LONG EVENT RULES', alwaysInject: true, latestOnly: false,
        primaryKeyColumns: [], compression: { mode: 'hierarchical', threshold: 5, fanIn: 3, maxDepth: 10, keepRecentLeaves: 3, summarizeInstruction: 'LONG COMPRESS' },
    },
    {
        id: 'character_sheet', label: 'Character Sheet', tableName: 'character_table',
        tableColumns: ['title', 'aliases', 'identity', 'goal'], embeddingColumns: ['title', 'aliases', 'identity'],
        columnHints: { title: LONG_HINT, aliases: 'Nicknames…', identity: 'Long-term identity…', goal: 'Long-term goal…' },
        requiredColumns: ['title'], extractHint: 'Stable character facts…', extractionInstructions: 'LONG CHAR RULES',
        alwaysInject: false, latestOnly: true, primaryKeyColumns: ['title', 'aliases'], extractEveryN: 1, keywords: ['character'],
        compression: { mode: 'none', threshold: 2, fanIn: 2, maxDepth: 1, keepRecentLeaves: 1, summarizeInstruction: '' },
    },
];

const CUSTOM = {
    id: 'storyline', label: '剧情线', tableName: 'storyline_table',
    tableColumns: ['name', 'track', 'status', 'stage'], embeddingColumns: ['name', 'track', 'status'],
    columnHints: { name: '剧情线名称，简短可指认，不带前缀', track: '主线|支线', status: '进行中/已完结', stage: 'current stage' },
    requiredColumns: ['name', 'track', 'status'], extractHint: '追踪剧情线', alwaysInject: true, latestOnly: true,
    primaryKeyColumns: ['name'], compression: { mode: 'none' }, extractionInstructions: '自定义规则',
};

const fresh = () => toDrafts([...structuredClone(DEFAULTS), structuredClone(CUSTOM)], {}, DEFAULTS);

test('built-in English labels become Chinese, custom labels stay', () => {
    assert.equal(typeDisplayName(DEFAULTS[0]), '事件');
    assert.equal(typeDisplayName(DEFAULTS[1]), '角色');
    assert.equal(typeDisplayName(CUSTOM), '剧情线');
    assert.equal(typeDisplayName({ id: 'custom_3', label: 'Custom Type 3' }), '自定义类型 3');
});

test('column names: built-in translation, then Chinese hint head, then key', () => {
    assert.equal(columnDisplayName('character_sheet', 'identity', 'Long-term identity…', {}), '身份');
    assert.equal(columnDisplayName('storyline', 'name', CUSTOM.columnHints.name, {}), '名称');
    assert.equal(columnDisplayName('storyline', 'track', '主线|支线', {}), '主线');
    assert.equal(columnDisplayName('storyline', 'stage', 'current stage', {}), 'stage');
    assert.equal(columnDisplayName('storyline', 'stage', 'x', { storyline: { stage: '阶段' } }), '阶段');
});

test('unchanged drafts round-trip to the same spec (nothing lost)', () => {
    const drafts = fresh();
    const specs = drafts.map(fromDraft);
    const originals = [...DEFAULTS, CUSTOM];
    for (let i = 0; i < specs.length; i++) {
        for (const key of ['extractionInstructions', 'tableName', 'columnHints', 'requiredColumns', 'embeddingColumns', 'primaryKeyColumns', 'extractHint', 'keywords']) {
            assert.deepEqual(specs[i][key], originals[i][key], `${originals[i].id}.${key}`);
        }
        assert.equal(specs[i].compression.summarizeInstruction, originals[i].compression.summarizeInstruction);
        assert.equal(specs[i].compression.mode, originals[i].compression.mode);
    }
    assert.ok(draftsEqual(drafts, fresh()));
});

test('long default English hints are hidden in the editor but kept on save', () => {
    const [, character] = fresh();
    const title = character.columns.find(c => c.key === 'title');
    assert.equal(title.hint, '');
    assert.equal(title.label, '名称');
    assert.equal(character.intro, '');
    assert.equal(fromDraft(character).columnHints.title, LONG_HINT);
    title.hint = '角色的正式名字';
    assert.equal(fromDraft(character).columnHints.title, '角色的正式名字');
});

test('adding, renaming, requiring and deleting items keeps every list in sync', () => {
    const drafts = fresh();
    const story = drafts[2];
    const added = newColumn(story, '关键人物');
    added.hint = '这条线上最重要的几个人';
    added.required = true;
    story.columns.push(added);
    story.columns = story.columns.filter(c => c.key !== 'track');
    story.columns.find(c => c.key === 'stage').label = '阶段';
    const spec = fromDraft(story);
    assert.deepEqual(spec.tableColumns, ['name', 'status', 'stage', added.key]);
    assert.ok(!spec.requiredColumns.includes('track'));
    assert.ok(spec.requiredColumns.includes(added.key));
    assert.ok(!spec.embeddingColumns.includes('track'));
    assert.ok(spec.embeddingColumns.includes(added.key), 'new items are searchable');
    assert.ok(!spec.embeddingColumns.includes('stage'), 'existing search choice kept');
    assert.equal(spec.columnHints[added.key], '这条线上最重要的几个人');
    assert.ok(!('track' in spec.columnHints));
    assert.equal(spec.extractionInstructions, '自定义规则');
    assert.deepEqual(labelsFromDrafts(drafts), { storyline: { stage: '阶段', [added.key]: '关键人物' } });
});

test('new item keys are unique ASCII and never shown', () => {
    const drafts = fresh();
    const a = newColumn(drafts[2], '甲');
    drafts[2].columns.push(a);
    const b = newColumn(drafts[2], '乙');
    assert.match(a.key, /^custom_\d+$/);
    assert.notEqual(a.key, b.key);
});

test('latestOnly gets an identity column automatically', () => {
    const type = newTypeDraft(fresh());
    type.name = '物品';
    type.columns.push(newColumn(type, '持有者'));
    type.latestOnly = true;
    const spec = fromDraft(type);
    assert.deepEqual(spec.primaryKeyColumns, ['title']);
    type.columns = type.columns.filter(c => c.key !== 'title');
    assert.deepEqual(fromDraft(type).primaryKeyColumns, [type.columns[0].key]);
});

test('event summary cannot be dropped from required', () => {
    const [event] = fresh();
    const summary = event.columns.find(c => c.key === 'summary');
    assert.ok(summary.locked && summary.required);
    summary.required = false;
    assert.deepEqual(fromDraft(event).requiredColumns, ['summary']);
    assert.equal(event.deletable, false);
});

test('validation catches empty and duplicate names', () => {
    const drafts = fresh();
    drafts[2].columns[1].label = '名称';
    const type = newTypeDraft(drafts);
    drafts.push(type);
    const messages = validateDrafts(drafts).map(e => e.message);
    assert.ok(messages.some(m => m.includes('两项都叫「名称」')));
    assert.ok(messages.some(m => m.includes('没有名称')));
    assert.deepEqual(validateDrafts(fresh()), []);
});

test('describeChanges lists changes in plain Chinese', () => {
    const before = fresh();
    const after = cloneDrafts(before);
    after[2].columns.push(newColumn(after[2], '关键人物'));
    after[2].columns = after[2].columns.filter(c => c.key !== 'stage');
    after[2].alwaysInject = false;
    after[1].columns.find(c => c.key === 'goal').label = '长期目标';
    after.splice(0, 0, after.splice(1, 1)[0]);
    const extra = newTypeDraft(after);
    extra.name = '物品';
    after.push(extra);
    const changes = describeChanges(before, after, new Map([['storyline', 4]]));
    const text = JSON.stringify(changes);
    assert.ok(text.includes('新增 1 项：关键人物'));
    assert.ok(text.includes('删除 1 项：stage'));
    assert.ok(text.includes('关闭「一直让 AI 看到」'));
    assert.ok(text.includes('1 项改了名称'));
    assert.ok(text.includes('新建类型'));
    assert.ok(text.includes('调整了记忆类型的先后顺序'));
    assert.ok(!/[a-z]{4,}/.test(changes.flatMap(c => c.lines).join('').replace('stage', '')), 'no English words in summary');
    const removed = describeChanges(before, before.slice(0, 2), new Map([['storyline', 4]]));
    assert.ok(JSON.stringify(removed).includes('当前聊天有 4 条'));
    assert.deepEqual(describeChanges(before, cloneDrafts(before)), []);
});

test('display labels flow into the read views', () => {
    const maps = buildLabelMaps([...DEFAULTS, CUSTOM], { storyline: { stage: '阶段' } });
    setDisplayLabels(maps);
    assert.equal(typeLabel('storyline'), '剧情线');
    assert.equal(typeLabel('event'), '事件');
    assert.equal(fieldLabel('stage', 'storyline'), '阶段');
    assert.equal(fieldLabel('track', 'storyline'), '主线');
    assert.equal(fieldLabel('identity', 'character_sheet'), '身份');
    assert.equal(depthLabel(1), '一级摘要');
    assert.equal(depthLabel(2), '二级摘要');
    setDisplayLabels({});
});
