// SPDX-License-Identifier: AGPL-3.0-or-later
//
// UI strings (zh default, en fallback) plus display metadata for the
// memory-graph node types / relation types. Pure — safe to import in Node.

const STRINGS = {
    zh: {
        appName: '记忆透镜', readOnly: '只读', close: '关闭', search: '搜索', searchHint: '搜索节点、角色、事件…',
        viewGraph: '图谱', viewTimeline: '时间线', viewTable: '数据表',
        refresh: '刷新', theme: '切换主题', filters: '筛选', inspector: '详情', toggleSidebar: '侧栏', toggleInspector: '详情栏',
        openNative: '在原生面板中编辑', openNativeUnavailable: '未找到原生记忆图面板（请先在扩展设置中启用记忆图）',
        types: '节点类型', relations: '关系类型', display: '显示', depth: '事件层级',
        depthAll: '全部', depthLeaf: '原始事件', depthRollup: '摘要',
        showArchived: '显示已归档', showHierarchy: '显示层级连线', onlyInContext: '只看 AI 当前记忆',
        context: 'AI 当前记忆', recalled: '本轮召回', pinned: '常驻注入', candidates: '候选池',
        lastRecall: '上次召回', never: '尚未召回', viewInjection: '查看注入文本', injectionText: '最近一次注入文本',
        corePacket: '核心记忆包', focusPacket: '焦点记忆包', empty: '（空）',
        nodes: '节点', edges: '关系', events: '事件', floors: '覆盖楼层', visible: '可见',
        overview: '概览', overviewHint: '选择一个节点查看详情，或按 Ctrl K 搜索。',
        id: 'ID', floor: '楼层', seq: '轮次', level: '层级', degree: '连接', status: '状态', type: '类型', title: '标题',
        time: '时间', place: '地点', irreversible: '不可逆', open: '未结', quotes: '原文摘录',
        fields: '字段', related: '关系', hierarchy: '层级', parent: '上级摘要', children: '下级事件', characters: '角色', locations: '地点',
        locate: '在图谱中定位', showInTimeline: '在时间线中查看', copyId: '复制 ID', copied: '已复制',
        focusEntity: '只看与「{0}」相关的事件', clearFocus: '清除', back: '返回',
        layoutForce: '关系网', layoutChrono: '时间轴', zoomIn: '放大', zoomOut: '缩小', fit: '适应窗口',
        legend: '图例', truncated: '节点过多，仅显示最近 {0} 个；可通过左侧筛选缩小范围。',
        noResults: '没有匹配的结果', commands: '命令', results: '节点',
        cmdSwitch: '切换到{0}', cmdTheme: '切换明暗主题', cmdRefresh: '重新读取记忆', cmdFit: '图谱适应窗口',
        loading: '正在读取记忆…', sync: '已同步', syncing: '同步中', live: '实时',
        errNoHost: '未检测到 Luker 运行环境。', errNoExtension: '未检测到记忆图插件，请确认已启用。',
        errNoChat: '请先打开一个聊天。', errApi: '无法读取记忆图数据（插件版本可能不兼容）。', errGeneric: '读取失败',
        emptyGraph: '当前聊天还没有记忆节点。', emptyGraphHint: '记忆图会在对话进行后自动提取。',
        emptyFilter: '当前筛选条件下没有可显示的节点。', resetFilters: '重置筛选',
        showMore: '显示更多', chapterLoose: '未归入摘要', items: '{0} 项', depthTag: 'L{0}',
        archived: '已归档', rollup: '摘要', semantic: '语义', episodic: '情景', none: '无',
        kbdPalette: '打开搜索', kbdViews: '切换视图', kbdEsc: '关闭 / 取消选择',
    },
    en: {
        appName: 'Memory Lens', readOnly: 'Read-only', close: 'Close', search: 'Search', searchHint: 'Search nodes, characters, events…',
        viewGraph: 'Graph', viewTimeline: 'Timeline', viewTable: 'Table',
        refresh: 'Refresh', theme: 'Toggle theme', filters: 'Filters', inspector: 'Inspector', toggleSidebar: 'Sidebar', toggleInspector: 'Inspector',
        openNative: 'Edit in native panel', openNativeUnavailable: 'Native memory graph panel not found (enable Memory in extension settings).',
        types: 'Node types', relations: 'Relations', display: 'Display', depth: 'Event level',
        depthAll: 'All', depthLeaf: 'Raw events', depthRollup: 'Summaries',
        showArchived: 'Show archived', showHierarchy: 'Show hierarchy links', onlyInContext: 'Only what the AI remembers',
        context: 'In AI context', recalled: 'Recalled this turn', pinned: 'Always injected', candidates: 'Candidates',
        lastRecall: 'Last recall', never: 'Not yet', viewInjection: 'View injected text', injectionText: 'Last injected text',
        corePacket: 'Core packet', focusPacket: 'Focus packet', empty: '(empty)',
        nodes: 'Nodes', edges: 'Edges', events: 'Events', floors: 'Floors', visible: 'Visible',
        overview: 'Overview', overviewHint: 'Select a node to inspect it, or press Ctrl K to search.',
        id: 'ID', floor: 'Floor', seq: 'Turn', level: 'Level', degree: 'Links', status: 'Status', type: 'Type', title: 'Title',
        time: 'Time', place: 'Place', irreversible: 'Irreversible', open: 'Open', quotes: 'Quotes',
        fields: 'Fields', related: 'Relations', hierarchy: 'Hierarchy', parent: 'Parent summary', children: 'Child events', characters: 'Characters', locations: 'Locations',
        locate: 'Locate in graph', showInTimeline: 'Show in timeline', copyId: 'Copy ID', copied: 'Copied',
        focusEntity: 'Only events involving “{0}”', clearFocus: 'Clear', back: 'Back',
        layoutForce: 'Network', layoutChrono: 'Chronology', zoomIn: 'Zoom in', zoomOut: 'Zoom out', fit: 'Fit',
        legend: 'Legend', truncated: 'Too many nodes; showing the latest {0}. Narrow down with filters.',
        noResults: 'No matches', commands: 'Commands', results: 'Nodes',
        cmdSwitch: 'Switch to {0}', cmdTheme: 'Toggle light/dark', cmdRefresh: 'Reload memory', cmdFit: 'Fit graph',
        loading: 'Loading memory…', sync: 'Synced', syncing: 'Syncing', live: 'Live',
        errNoHost: 'Luker runtime not detected.', errNoExtension: 'Memory graph extension not found. Is it enabled?',
        errNoChat: 'Open a chat first.', errApi: 'Could not read memory graph data (incompatible version?).', errGeneric: 'Failed to load',
        emptyGraph: 'This chat has no memory nodes yet.', emptyGraphHint: 'The memory graph is extracted automatically as the chat goes on.',
        emptyFilter: 'Nothing matches the current filters.', resetFilters: 'Reset filters',
        showMore: 'Show more', chapterLoose: 'Not yet summarized', items: '{0} items', depthTag: 'L{0}',
        archived: 'Archived', rollup: 'Summary', semantic: 'Semantic', episodic: 'Episodic', none: 'None',
        kbdPalette: 'Open search', kbdViews: 'Switch view', kbdEsc: 'Close / deselect',
    },
};

const TYPE_LABELS = {
    zh: { event: '事件', character_sheet: '角色', location_state: '地点', thread: '剧情线', rule_constraint: '规则' },
    en: { event: 'Event', character_sheet: 'Character', location_state: 'Location', thread: 'Thread', rule_constraint: 'Rule' },
};

const RELATION_LABELS = {
    zh: {
        related: '相关', involved_in: '参与', occurred_at: '发生于', mentions: '提及', evidence: '佐证', updates: '更新', advances: '推进',
        partner_of: '伴侣', family_of: '亲属', allied_with: '同盟', hostile_to: '敌对',
        mentor_of: '指导', sworn_to: '效忠', debt_owed_to: '亏欠', deceiving: '欺瞒',
        contains: '包含', semantic_contains: '摘要包含',
    },
    en: {
        related: 'related', involved_in: 'involves', occurred_at: 'at', mentions: 'mentions', evidence: 'evidence', updates: 'updates', advances: 'advances',
        partner_of: 'partner', family_of: 'family', allied_with: 'ally', hostile_to: 'hostile',
        mentor_of: 'mentors', sworn_to: 'sworn to', debt_owed_to: 'owes', deceiving: 'deceives',
        contains: 'contains', semantic_contains: 'summarizes',
    },
};

const FIELD_LABELS = {
    zh: {
        summary: '摘要', title: '名称', aliases: '别名', traits: '特征', identity: '身份', goal: '目标', inventory: '关键物品',
        language_sample: '语言风格', addressing_user: '对用户称呼', controller: '控制者', danger: '危险', resources: '资源',
        state: '状态', status: '状态', note: '说明',
    },
    en: {},
};

let lang = 'zh';

export function setLocale(locale) {
    const value = String(locale || '').toLowerCase();
    lang = value.startsWith('en') ? 'en' : 'zh';
    return lang;
}

export function getLang() {
    return lang;
}

export function t(key, ...args) {
    const template = STRINGS[lang][key] ?? STRINGS.zh[key] ?? key;
    return args.length ? template.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)] ?? '')) : template;
}

function humanize(id) {
    return String(id || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim() || '?';
}

export function typeLabel(type) {
    return TYPE_LABELS[lang][type] || TYPE_LABELS.en[type] || humanize(type);
}

export function relationLabel(type) {
    return RELATION_LABELS[lang][type] || RELATION_LABELS.en[type] || humanize(type).toLowerCase();
}

export function fieldLabel(key) {
    return FIELD_LABELS[lang][key] || humanize(key);
}
