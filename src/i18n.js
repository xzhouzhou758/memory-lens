// SPDX-License-Identifier: AGPL-3.0-or-later
//
// UI strings and display names. Everything the user sees is Chinese;
// internal identifiers (type ids, column keys) never reach the screen.
// Pure — safe to import in Node.

const STRINGS = {
    appName: '记忆透镜', close: '关闭', search: '搜索', searchHint: '搜索节点、角色、事件…',
    viewGraph: '图谱', viewTimeline: '时间线', viewTable: '数据表', viewSchema: '记忆结构',
    refresh: '刷新', theme: '切换主题', filters: '筛选', inspector: '详情', toggleSidebar: '侧栏', toggleInspector: '详情栏',
    openNative: '在原生面板中编辑', openNativeUnavailable: '未找到原生记忆图面板（请先在扩展设置中启用记忆图）',
    types: '节点类型', relations: '关系类型', display: '显示', depth: '事件层级',
    depthAll: '全部', depthLeaf: '原始事件', depthRollup: '摘要',
    showArchived: '显示已归档', showHierarchy: '显示层级连线', onlyInContext: '只看 AI 当前记忆',
    context: 'AI 当前记忆', recalled: '本轮召回', pinned: '常驻注入', candidates: '候选池',
    lastRecall: '上次召回', never: '尚未召回', viewInjection: '查看注入文本', injectionText: '最近一次注入文本',
    corePacket: '核心记忆包', focusPacket: '焦点记忆包', empty: '（空）',
    nodes: '节点', edges: '关系', events: '事件',
    overviewHint: '选择一个节点查看详情，或按 Ctrl K 搜索。',
    floor: '楼层', degree: '连接', title: '名称',
    time: '时间', place: '地点', irreversible: '不可逆', open: '未结', quotes: '原文摘录',
    fields: '记录项', related: '关系', hierarchy: '层级', parent: '上级摘要', children: '下级事件', characters: '角色', locations: '地点',
    locate: '在图谱中定位', showInTimeline: '在时间线中查看', copyId: '复制编号', copied: '已复制', copyText: '复制',
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
    showMore: '显示更多', chapterLoose: '未归入摘要', items: '{0} 项',
    archived: '已归档', sortOldest: '从早到晚', sortNewest: '从晚到早',

    // Schema editor
    schemaTitle: '记忆结构', schemaIntro: '决定 AI 会记哪些类型、每类记录哪些内容。',
    schemaTypes: '记忆类型', schemaAddType: '新建类型', schemaItems: '记录项', schemaAddItem: '添加一项',
    schemaName: '名称', schemaNamePh: '例如：物品', schemaIntroLabel: '这类记忆是什么', schemaIntroPh: '一句话告诉 AI 这类记忆记录什么（可不填）',
    schemaItemName: '名称', schemaItemNamePh: '例如：身份', schemaItemHint: '说明', schemaItemHintPh: '告诉 AI 这一项该写什么',
    schemaRequired: '必须填写', schemaLocked: '这一项是事件的正文，不能删除',
    schemaBehavior: '记录方式',
    schemaAlwaysInject: '一直让 AI 看到', schemaAlwaysInjectHint: '每次回复都带上，不用等召回。适合剧情线、规则这类少而重要的内容。',
    schemaLatestOnly: '同名只保留最新', schemaLatestOnlyHint: '同一个角色或地点只留一条，新内容会覆盖旧内容。',
    schemaCompression: '自动合并成摘要', schemaCompressionHint: '条目多了以后，把几条合成一条摘要，节省篇幅。',
    schemaUsage: '当前聊天有 {0} 条', schemaNoUsage: '当前聊天还没有',
    schemaSave: '保存', schemaSaving: '保存中…', schemaReset: '恢复默认', schemaDiscard: '放弃修改',
    schemaUnsaved: '有未保存的修改', schemaSaved: '已保存', schemaUndo: '撤销', schemaUndone: '已撤销',
    schemaScopeChar: '只对「{0}」生效', schemaScopeGlobalNote: '保存后对所有角色生效',
    schemaScopeCharActive: '「{0}」正在使用单独的记忆结构', schemaUseGlobal: '改回通用结构',
    schemaConfirmTitle: '确认保存', schemaConfirmEmpty: '没有改动。', schemaConfirmOk: '保存', schemaCancel: '取消',
    schemaResetConfirm: '恢复为 Luker 默认的记忆结构？当前未保存的修改会丢失。',
    schemaUseGlobalConfirm: '让「{0}」改回使用通用记忆结构？',
    schemaDeleteType: '删除这个类型', schemaDeleteTypeConfirm: '删除「{0}」？{1}',
    schemaDeleteTypeUsage: '当前聊天有 {0} 条这类记忆，会保留但不再显示和记录。',
    schemaDeleteItem: '删除', schemaMoveUp: '上移', schemaMoveDown: '下移', schemaDrag: '拖动排序',
    schemaUnavailable: '当前版本的记忆图不支持在这里修改记忆结构，请使用原生面板。',
    schemaSaveFailed: '保存失败：{0}', schemaNoChar: '未选择角色',
    schemaLeaveConfirm: '记忆结构有未保存的修改，确定离开？',
    schemaNewType: '新类型', schemaRulesNote: '给 AI 的详细记录规则和合并规则没有放在这里，需要时请在原生面板中修改。',
};

const TYPE_LABELS = { event: '事件', character_sheet: '角色', location_state: '地点', thread: '剧情线', rule_constraint: '规则' };

const RELATION_LABELS = {
    related: '相关', involved_in: '参与', occurred_at: '发生于', mentions: '提及', evidence: '佐证', updates: '更新', advances: '推进',
    partner_of: '伴侣', family_of: '亲属', allied_with: '同盟', hostile_to: '敌对',
    mentor_of: '指导', sworn_to: '效忠', debt_owed_to: '亏欠', deceiving: '欺瞒',
    contains: '包含', semantic_contains: '摘要包含',
};

const FIELD_LABELS = {
    summary: '摘要', title: '名称', name: '名称', aliases: '别名', traits: '特征', identity: '身份', goal: '目标', inventory: '关键物品',
    language_sample: '语言风格', addressing_user: '对用户的称呼', controller: '控制者', danger: '危险', resources: '资源',
    state: '状态', status: '状态', note: '说明',
};

const DEPTH_NAMES = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

// Names coming from the user's schema (set by the app after each load).
let customTypeLabels = {};
let customFieldLabels = {};

export function setLocale() {
    return 'zh';
}

export function t(key, ...args) {
    const template = STRINGS[key] ?? key;
    return args.length ? template.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)] ?? '')) : template;
}

/** @param {{types?: Record<string,string>, columns?: Record<string, Record<string,string>>}} maps */
export function setDisplayLabels(maps = {}) {
    customTypeLabels = { ...(maps.types || {}) };
    customFieldLabels = {};
    for (const [type, columns] of Object.entries(maps.columns || {})) customFieldLabels[type] = { ...columns };
}

export function typeLabel(type) {
    return customTypeLabels[type] || TYPE_LABELS[type] || '其他';
}

export function builtinTypeLabel(type) {
    return TYPE_LABELS[type] || '';
}

export function relationLabel(type) {
    return RELATION_LABELS[type] || '相关';
}

export function hasFieldLabel(key) {
    return Object.prototype.hasOwnProperty.call(FIELD_LABELS, key);
}

/** Display name for a record item; `type` lets user-defined names win. */
export function fieldLabel(key, type = '') {
    return (type && customFieldLabels[type]?.[key]) || FIELD_LABELS[key] || key;
}

/** "一级摘要" for depth 1, etc. */
export function depthLabel(depth) {
    const n = Math.max(1, Math.floor(Number(depth) || 1));
    return `${DEPTH_NAMES[n] || n}级摘要`;
}
