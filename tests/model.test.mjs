import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildModel, parseEventSummary, isPlaceholderTitle, searchNodes, visibleSubgraph, buildChapters,
    defaultFilters, neighborsOf, entitiesOfEvent, contextState, formatFloor, isDefaultFilters,
} from '../src/model.js';
import { forceLayout, chronoLayout, nodeRadius } from '../src/graph/layout.js';
import { createMockSnapshot, createLargeSnapshot } from '../preview/mock-data.js';

test('parseEventSummary extracts anchors, prose and optional sections', () => {
    const parsed = parseEventSummary([
        '时间: 霜月三日 深夜',
        '地点：第七灯塔',
        '',
        '第一段。',
        '仍是第一段。',
        '',
        '第二段。',
        '',
        '不可逆:',
        '- 叶舟左腿留下长疤',
        '',
        '未结:',
        '- → thread "父亲的航海日志能否找到"',
        '- 普通未结项',
        '',
        '原文摘录:',
        '- 林栖: "三短，是父亲的暗号。"',
    ].join('\n'));
    assert.equal(parsed.time, '霜月三日 深夜');
    assert.equal(parsed.place, '第七灯塔');
    assert.deepEqual(parsed.prose, ['第一段。\n仍是第一段。', '第二段。']);
    assert.deepEqual(parsed.irreversible, ['叶舟左腿留下长疤']);
    assert.equal(parsed.open[0].threadTitle, '父亲的航海日志能否找到');
    assert.equal(parsed.open[1].threadTitle, undefined);
    assert.equal(parsed.open[1].text, '普通未结项');
    assert.deepEqual(parsed.quotes, [{ label: '林栖', quote: '三短，是父亲的暗号。' }]);
});

test('parseEventSummary tolerates free-form text', () => {
    const parsed = parseEventSummary('Just a plain summary without headers.');
    assert.equal(parsed.time, '');
    assert.deepEqual(parsed.prose, ['Just a plain summary without headers.']);
    assert.deepEqual(parseEventSummary(null).prose, []);
});

test('buildModel indexes nodes, edges, hierarchy and injection', () => {
    const model = buildModel(createMockSnapshot());
    assert.ok(model.nodes.size > 30);
    assert.equal(model.typeList[0], 'event');
    const rollup = model.nodes.get('r2_a');
    assert.equal(rollup.isRollup, true);
    assert.equal(rollup.depth, 2);
    assert.equal(model.nodes.get('r1_a').parentId, 'r2_a');
    assert.equal(model.nodes.get('e01').parentId, 'r1_a');
    assert.equal(model.nodes.get('e01').parsed.place, '第七灯塔');
    assert.equal(contextState(model, 'e13'), 'recalled');
    assert.equal(contextState(model, 't_log'), 'pinned');
    assert.equal(contextState(model, 'e01'), '');
    assert.equal(formatFloor(model.nodes.get('e01')), '#1–4');
});

test('buildModel drops dangling edges, recall diagnostics and self loops', () => {
    const model = buildModel({
        nodes: [
            { id: 'a', type: 'character_sheet', title: 'A' },
            { id: 'b', type: 'character_sheet', title: 'B' },
            { id: 'r', type: 'recall_trace', title: 'diag' },
        ],
        edges: [
            { from: 'a', to: 'b', type: 'allied_with' },
            { from: 'a', to: 'missing', type: 'related' },
            { from: 'a', to: 'a', type: 'related' },
            { from: 'a', to: 'r', type: 'related' },
        ],
    });
    assert.equal(model.nodes.size, 2);
    assert.equal(model.edges.length, 1);
    assert.equal(model.edges[0].directed, false);
    assert.equal(model.edges[0].category, 'bond');
    assert.equal(model.nodes.get('a').degree, 1);
});

test('mirrored edge pairs collapse into one undirected edge', () => {
    const model = buildModel({
        nodes: [
            { id: 'ev', type: 'event', title: 'E', fields: {} },
            { id: 'c', type: 'character_sheet', title: 'C' },
            { id: 'd', type: 'character_sheet', title: 'D' },
        ],
        edges: [
            { from: 'ev', to: 'c', type: 'involved_in' },
            { from: 'c', to: 'ev', type: 'involved_in' },
            { from: 'ev', to: 'c', type: 'involved_in' },
            { from: 'c', to: 'd', type: 'mentor_of' },
        ],
    });
    assert.equal(model.edges.length, 2);
    const involve = model.edges.find(e => e.type === 'involved_in');
    assert.equal(involve.directed, false);
    assert.equal(model.edges.find(e => e.type === 'mentor_of').directed, true);
    assert.equal(model.nodes.get('ev').degree, 1);
    assert.equal(neighborsOf(model, 'c').length, 2);
});

test('event titles fall back to the first prose sentence', () => {
    const model = buildModel({ nodes: [{ id: 'x', type: 'event', fields: { summary: '时间: 早上\n地点: 港口\n\n林栖醒来。然后出门。' } }] });
    assert.equal(model.nodes.get('x').title, '林栖醒来。');
});

test('auto-generated event titles are replaced, real ones kept', () => {
    assert.ok(isPlaceholderTitle('Summary 1'));
    assert.ok(isPlaceholderTitle('摘要 12'));
    assert.ok(isPlaceholderTitle('event Summary L1 #3'));
    assert.ok(isPlaceholderTitle('Event Summary L2 #10'));
    assert.ok(!isPlaceholderTitle('Summary of the battle'));
    assert.ok(!isPlaceholderTitle('第一卷总结'));
    const model = buildModel({ nodes: [
        { id: 'a', type: 'event', title: 'Summary 4', fields: { summary: 'Time: dusk Place: Glade Seraphina found the traveler. Then left.' } },
        { id: 'b', type: 'event', title: '雾夜里的求救信号', fields: { summary: '…' } },
        { id: 'c', type: 'character_sheet', title: 'Summary 1', fields: {} },
    ] });
    assert.equal(model.nodes.get('a').title, 'Seraphina found the traveler.');
    assert.equal(model.nodes.get('a').autoTitle, 'Summary 4');
    assert.equal(model.nodes.get('b').title, '雾夜里的求救信号');
    assert.equal(model.nodes.get('c').title, 'Summary 1');
});

test('flattened summaries (whitespace-collapsed by memory-graph) still parse', () => {
    const flat = '时间: 霜月三日 深夜 地点: 第七灯塔 林栖在例行巡灯时看到海面上闪了三下红光。她独自记下了方位。 不可逆: - 叶舟左腿留下长疤 - 灯塔地下室被打开 未结: - → thread "父亲的航海日志能否找到" 原文摘录: - 林栖: "三短，是父亲的暗号。"';
    const parsed = parseEventSummary(flat);
    assert.equal(parsed.time, '霜月三日 深夜');
    assert.equal(parsed.place, '第七灯塔');
    assert.equal(parsed.prose.length, 1);
    assert.ok(parsed.prose[0].startsWith('林栖在例行巡灯时'));
    assert.deepEqual(parsed.irreversible, ['叶舟左腿留下长疤', '灯塔地下室被打开']);
    assert.equal(parsed.open[0].threadTitle, '父亲的航海日志能否找到');
    assert.deepEqual(parsed.quotes, [{ label: '林栖', quote: '三短，是父亲的暗号。' }]);

    const en = parseEventSummary('Time: dusk Place: Eldoria Glade Seraphina found the traveler collapsed near the glade. 不可逆: - The traveler now knows the glade location');
    assert.equal(en.time, 'dusk');
    assert.equal(en.place, 'Eldoria Glade');
    assert.equal(en.prose[0], 'Seraphina found the traveler collapsed near the glade.');
    assert.deepEqual(en.irreversible, ['The traveler now knows the glade location']);

    const plain = parseEventSummary('A plain one-line summary - with a dash inside.');
    assert.equal(plain.time, '');
    assert.equal(plain.prose.length, 1);
});

test('neighbors and event entities', () => {
    const model = buildModel(createMockSnapshot());
    const { characters, locations } = entitiesOfEvent(model, 'e14');
    assert.deepEqual(characters.map(c => c.id).sort(), ['c_lin', 'c_mo', 'c_qiao', 'c_wen']);
    assert.deepEqual(locations.map(l => l.id), ['l_guild']);
    const linNeighbors = neighborsOf(model, 'c_lin');
    assert.ok(linNeighbors.some(n => n.node.id === 'c_wen' && n.direction === 'both'));
    assert.ok(linNeighbors.some(n => n.node.id === 'c_gu' && n.edge.type === 'deceiving' && n.direction === 'in'));
    assert.ok(!neighborsOf(model, 'r1_a').some(n => n.edge.internal));
});

test('filters: types, depth, archived, context, hierarchy', () => {
    const model = buildModel(createMockSnapshot());
    const filters = defaultFilters();
    assert.ok(isDefaultFilters(filters));
    const all = visibleSubgraph(model, filters);
    assert.ok(!all.ids.has('c_lin_old'), 'archived hidden by default');
    assert.ok(all.edges.some(e => e.internal));

    const noEvents = visibleSubgraph(model, { ...filters, hiddenTypes: new Set(['event']) });
    assert.ok([...noEvents.nodes].every(n => n.type !== 'event'));

    const leaves = visibleSubgraph(model, { ...filters, depth: 'leaf' });
    assert.ok(leaves.nodes.every(n => !n.isRollup));

    const ctx = visibleSubgraph(model, { ...filters, onlyContext: true });
    assert.ok(ctx.nodes.length > 0 && ctx.nodes.every(n => model.injection.recalled.has(n.id) || model.injection.pinned.has(n.id)));

    const flat = visibleSubgraph(model, { ...filters, showHierarchy: false });
    assert.ok(flat.edges.every(e => !e.internal));
    const noAllies = visibleSubgraph(model, { ...filters, hiddenRelations: new Set(['allied_with']) });
    assert.ok(noAllies.edges.every(e => e.type !== 'allied_with'));
});

test('visibleSubgraph caps size and keeps newest', () => {
    const model = buildModel(createLargeSnapshot(700));
    const sub = visibleSubgraph(model, defaultFilters(), { maxNodes: 200 });
    assert.equal(sub.nodes.length, 200);
    assert.equal(sub.truncated, true);
    assert.ok(sub.ids.has('bulk_699'));
    assert.ok(!sub.ids.has('bulk_0'));
});

test('buildChapters nests rollups and collects loose leaves', () => {
    const model = buildModel(createMockSnapshot());
    const { chapters, loose } = buildChapters(model, defaultFilters());
    assert.equal(chapters.length, 1);
    assert.equal(chapters[0].node.id, 'r2_a');
    assert.equal(chapters[0].children.length, 4);
    assert.equal(chapters[0].leafCount, 12);
    assert.deepEqual(loose.map(t => t.node.id), ['e13', 'e14', 'e15', 'e16']);

    const focused = buildChapters(model, { ...defaultFilters(), focusEntityId: 'c_xiao' });
    const ids = [];
    const walk = (tree) => { if (!tree.node.isRollup) ids.push(tree.node.id); tree.children.forEach(walk); };
    focused.chapters.forEach(walk);
    focused.loose.forEach(walk);
    assert.deepEqual(ids.sort(), ['e10', 'e15']);
});

test('searchNodes ranks title matches first', () => {
    const model = buildModel(createMockSnapshot());
    const hits = searchNodes(model, '灯塔');
    assert.equal(hits[0].node.title.includes('灯塔'), true);
    assert.equal(searchNodes(model, '').length, 0);
    assert.equal(searchNodes(model, 'c_wen')[0].node.id, 'c_wen');
    assert.ok(searchNodes(model, '林栖 罗盘').every(h => h.node.searchText.includes('罗盘')));
});

test('layouts are deterministic and finite', () => {
    const model = buildModel(createMockSnapshot());
    const sub = visibleSubgraph(model, defaultFilters());
    const a = forceLayout(sub.nodes, sub.edges);
    const b = forceLayout(sub.nodes, sub.edges);
    assert.equal(a.size, sub.nodes.length);
    for (const [id, pos] of a) {
        assert.ok(Number.isFinite(pos.x) && Number.isFinite(pos.y), id);
        assert.deepEqual(pos, b.get(id));
    }
    const chrono = chronoLayout(sub.nodes, sub.edges);
    assert.equal(chrono.size, sub.nodes.length);
    assert.ok(chrono.get('e01').x < chrono.get('e12').x, 'events left to right');
    assert.ok(chrono.get('r2_a').y < chrono.get('r1_a').y, 'higher summaries above');
    assert.ok(chrono.get('c_lin').y > 0, 'characters below the spine');
});

test('chrono layout never overlaps nodes', () => {
    const model = buildModel(createMockSnapshot());
    const sub = visibleSubgraph(model, defaultFilters());
    const pos = chronoLayout(sub.nodes, sub.edges);
    const list = sub.nodes.map(node => ({ node, p: pos.get(node.id), r: nodeRadius(node) }));
    for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
            const a = list[i];
            const b = list[j];
            const dist = Math.hypot(a.p.x - b.p.x, a.p.y - b.p.y);
            assert.ok(dist >= a.r + b.r, `${a.node.id} overlaps ${b.node.id} (${dist.toFixed(1)} < ${a.r + b.r})`);
        }
    }
});

test('force layout warm start keeps existing nodes stable and seeds new ones nearby', () => {
    const model = buildModel(createMockSnapshot());
    const sub = visibleSubgraph(model, defaultFilters());
    const first = forceLayout(sub.nodes, sub.edges);
    const extra = { id: 'new_c', type: 'character_sheet', title: 'New', degree: 1, isRollup: false, depth: 0 };
    const nodes = [...sub.nodes, extra];
    const edges = [...sub.edges, { from: 'new_c', to: 'c_lin', type: 'allied_with', internal: false }];
    const second = forceLayout(nodes, edges, { initial: first });
    let maxShift = 0;
    for (const node of sub.nodes) {
        const a = first.get(node.id);
        const b = second.get(node.id);
        maxShift = Math.max(maxShift, Math.hypot(a.x - b.x, a.y - b.y));
    }
    assert.ok(maxShift < 120, `existing nodes moved up to ${maxShift.toFixed(1)}`);
    // "Near" relative to the drawing: well inside a third of its extent.
    const xs = [...first.values()].map(p => p.x);
    const ys = [...first.values()].map(p => p.y);
    const extent = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    const lin = second.get('c_lin');
    const added = second.get('new_c');
    const dist = Math.hypot(lin.x - added.x, lin.y - added.y);
    assert.ok(dist < extent / 3, `new node ${dist.toFixed(0)} away (extent ${extent.toFixed(0)})`);
});

test('force layout keeps nodes apart', () => {
    const model = buildModel(createMockSnapshot());
    const sub = visibleSubgraph(model, defaultFilters());
    const pos = forceLayout(sub.nodes, sub.edges);
    const list = [...pos.values()];
    let minDist = Infinity;
    for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
            minDist = Math.min(minDist, Math.hypot(list[i].x - list[j].x, list[i].y - list[j].y));
        }
    }
    assert.ok(minDist > 12, `min distance ${minDist}`);
});
