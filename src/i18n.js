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
    overviewHint: '选择一个节点查看详情，或按 {mod} K 搜索。', overviewHintTouch: '点选一个节点查看详情，或点底部的「搜索」。',
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
    schemaName: '名称', schemaNamePh: '例如：物品', schemaIntroLabel: '这类记忆是什么', schemaIntroPh: '一句话说明这类记忆记什么（可不填）',
    schemaItemName: '名称', schemaItemNamePh: '例如：身份', schemaUnnamedPh: '未命名项，起个名字', schemaItemHint: '说明', schemaItemHintPh: '告诉 AI 这一项该写什么',
    schemaRequired: '必须填写', schemaRequiredShort: '必填', schemaDefaultHint: '沿用默认说明', schemaNoHint: '添加说明', schemaLocked: '这一项是事件的正文，不能删除',
    schemaBehavior: '记录方式',
    schemaAlwaysInject: '一直让 AI 看到', schemaAlwaysInjectHint: '每次回复都带上，不用等召回。适合剧情线、规则这类少而重要的内容。',
    schemaLatestOnly: '同名只保留最新', schemaLatestOnlyHint: '同一个角色或地点只留一条，新内容会覆盖旧内容。',
    schemaCompression: '自动合并成摘要', schemaCompressionHint: '条目多了以后，把几条合成一条摘要，节省篇幅。',
    schemaUsage: '当前聊天有 {0} 条', schemaNoUsage: '当前聊天还没有',
    schemaSave: '保存', schemaSaving: '保存中…', schemaReset: '恢复默认', schemaDiscard: '放弃修改',
    schemaUnsaved: '有未保存的修改', schemaSaved: '已保存', schemaUndo: '撤销', schemaUndone: '已撤销',
    schemaScopeLabel: '用于', schemaScopeAll: '所有角色', schemaScopeOnly: '仅「{0}」', schemaScopeAllOnly: '修改对所有角色生效',
    schemaScopeLeaveNote: '保存后这个角色改用通用结构',
    schemaScopeCharActive: '「{0}」正在使用单独的记忆结构', schemaUseGlobal: '改回通用结构',
    schemaConfirmTitle: '确认保存', schemaConfirmEmpty: '没有改动。', schemaConfirmOk: '保存', schemaCancel: '取消',
    filterTitle: '标签过滤', filterBtnOn: '标签过滤 · 开', filterBtnHint: '只把需要的内容交给记忆图提取和召回',
    filterIntro: '记忆图读 AI 回复时，先按这里的规则过滤一遍：删掉思维链、状态栏这类不该记的内容。聊天里显示的内容不受影响。',
    filterEnable: '启用标签过滤',
    filterScope: '注意：编排、预设助手、角色编辑助手读聊天记录时也走同一条通道，会一起被过滤。只过滤 AI 回复，不动你发的消息。',
    filterPreset: '过滤方案', filterPresetName: '方案名称', filterPresetNamePh: '给这套方案起个名字',
    filterPresetNew: '新建', filterPresetDelete: '删除', filterPresetNewName: '方案 {0}', filterUnnamed: '未命名方案',
    filterBlack: '黑名单', filterBlackNote: '删掉这些标签和里面的内容，其余保留',
    filterWhite: '白名单', filterWhiteNote: '只保留这些标签里的内容，其余全部删掉',
    filterBlackPh: '例如：think, details, !--', filterWhitePh: '例如：content, [时间]',
    filterCommon: '常用', filterBadTags: '看不懂这些写法，已忽略：{0}',
    filterWhiteTip: '正文没被标签包着（直接写在外面）时不要用白名单，否则正文会被全部删掉。先跑黑名单，再跑白名单。',
    filterWarnEmpty: '按现在的白名单，这条回复会被删光。正文可能没被标签包着，建议改用黑名单。',
    filterWarnTiny: '按现在的白名单，这条回复只剩很少一点，请看下面的预览确认没删掉正文。',
    filterDiagnose: 'AI 诊断', filterDiagnosing: 'AI 诊断中…', filterDiagnoseHint: '让 AI 看最近一条回复，判断该用黑名单还是白名单',
    filterNoReply: '当前聊天还没有 AI 回复', filterBodyBare: '正文是裸文本', filterBodyWrapped: '正文被标签包着',
    filterUseBlack: '建议用黑名单', filterUseWhite: '建议用白名单',
    filterDiagnoseDone: '已填进上面的输入框，看一下预览，没问题再点保存。',
    filterPreview: '预览', filterPreviewPick: '选一条回复', filterLatest: '最近一条（第 {0} 楼）', filterFloor: '第 {0} 楼',
    filterBefore: '过滤前', filterAfter: '过滤后（记忆图读到的）', filterChars: '{0} 字', filterAllGone: '（全部被删掉了）',
    filterSave: '保存', filterSaved: '标签过滤已保存并生效', filterSavedOff: '已保存（过滤没有启用）', filterFailed: '标签过滤出错：{0}',
    tokTitle: '注入 token',
    tokNow: '本次合计', tokFocus: '本次召回', tokCore: '常驻注入', tokHistory: '历史合计',
    tokAvg: '平均每次', tokMax: '最多一次', tokCount: '已记录', tokTimes: '{0} 次',
    tokRecent: '最近 {0} 次', tokLegendFocus: '召回', tokLegendCore: '常驻',
    tokEmpty: '还没有记录。从现在起每次生成回复都会记一条。',
    tokNote: '统计的是记忆图塞进提示词里的文字，用当前模型的分词器计算；不包括召回过程本身的请求。同一楼层重新生成只算最后一次。记录跟着这个聊天走。',
    tokNoRecall: '这个聊天还没有召回过', tokClear: '清空记录', tokCleared: '已清空',
    schemaTemplates: '套用模板', schemaTemplatesTitle: '选一个记忆结构模板',
    schemaTemplatesNote: '会替换左边的记忆类型（「事件」保持不变）。套用后还没保存，不满意可以点「放弃修改」。',
    schemaTemplateApply: '套用', schemaTemplateApplied: '已套用「{0}」，确认没问题再点保存',
    schemaImport: '导入', schemaExport: '导出', schemaImported: '已导入到编辑器，确认没问题再点保存',
    schemaExported: '已下载：{0}', schemaIoFailed: '操作失败：{0}',
    schemaImportReplace: '导入会替换编辑器里还没保存的修改，继续吗？',
    schemaResetConfirm: '恢复为 Luker 默认的记忆结构？当前未保存的修改会丢失。',
    schemaUseGlobalConfirm: '让「{0}」改回使用通用记忆结构？',
    schemaDeleteType: '删除这个类型', schemaDeleteTypeConfirm: '删除「{0}」？{1}',
    schemaDeleteTypeUsage: '当前聊天有 {0} 条这类记忆，会保留但不再显示和记录。',
    schemaDeleteItem: '删除', schemaMoveUp: '上移', schemaMoveDown: '下移', schemaDrag: '拖动排序',
    schemaUnavailable: '当前版本的记忆图不支持在这里修改记忆结构，请使用原生面板。',
    schemaSaveFailed: '保存失败：{0}', schemaNoChar: '未选择角色',
    schemaLeaveConfirm: '记忆结构有未保存的修改，确定离开？',
    edit: '修改', editField: '修改{0}', editHint: '双击修改', editHintTouch: '点按修改', editEmpty: '未填写（双击填写）', editEmptyTouch: '未填写（点按填写）', editTableTouch: '点开一条，在详情里点按内容即可修改',
    editKeys: 'Enter 保存 · Esc 取消', editKeysWrap: 'Enter 保存 · Shift+Enter 换行 · Esc 取消', editKeysMulti: '{mod}+Enter 保存 · Esc 取消', editSave: '保存',
    editSaved: '已修改', editFailed: '修改失败：{0}', editEmptyTitle: '名称不能为空',
    aiPromptTag: '给 AI 的提示', aiPromptEditing: '正在编辑给 AI 的提示',
    aiPromptItemNote: 'AI 记录这一项时会按这里写的去填', aiPromptTypeNote: 'AI 用它判断哪些内容记成这一类',
    aiOptimize: 'AI 优化', aiOptimizeHint: '让 AI 把这段提示写得更清楚（只改这里，仍需保存）', aiOptimizing: 'AI 优化中…',
    aiAutoApply: '自动应用', aiAutoApplyNote: '改动直接进编辑器，仍需点保存',
    aiReadN: 'AI 查看了 {0} 次结构', aiToolFailed: '{0}（没成功）',
    aiChangesPending: 'AI 建议了 {0} 处改动，勾选要的再应用', aiChangesTitle: '这一轮的 {0} 处改动',
    aiApplyChosen: '应用所选（{0}）', aiDiscardAll: '全部放弃', aiAppliedN: '已应用 {0} 处，还没保存',
    aiAppliedSome: '应用了 {0} / {1} 处改动', aiDiscarded: '已放弃', aiSuperseded: '已被下一轮建议取代',
    aiStale: '已过期', aiStaleHint: '你在编辑器里改过这一项，应用会覆盖你的修改',
    aiBefore: '原来', aiAfter: '现在', aiEmptyText: '（空）', aiTypesOrder: '类型顺序',
    aiTagAdded: 'AI 新增', aiTagChanged: 'AI 已改', aiTagHint: '这一项是 AI 改的，保存或放弃修改后标记会消失',
    aiMarkCount: 'AI 改了 {0} 处', aiMarkNewType: 'AI 新建',
    aiSuggestBtn: '完善这个类型', aiSuggestHint: '让 AI 补充记录项、写好给 AI 的提示、选好记录方式',
    aiSuggestTitle: 'AI 完善「{0}」', aiSuggestIntro: '想让 AI 注意什么？可以不填，AI 会按这个类型的用途自己补全。',
    aiSuggestPh: '例如：要记录截止时间和提醒方式；约定要写清双方', aiSuggestGo: '开始',
    aiSuggestBusy: 'AI 正在完善这个类型…', aiSuggestNone: 'AI 觉得这个类型已经很完整，没有建议', aiSuggestLabel: 'AI 的建议',
    aiSettings: 'AI 设置', aiSettingsIntro: '选择两个 AI 用哪个模型。选项来自 Luker 的「连接配置」和「生成预设」；没选的就跟随记忆图设置。',
    aiSettingsAssistantNote: '在右侧对话里帮你改记忆结构。', aiToolsTitle: 'AI 优化 · 完善类型',
    aiSettingsToolsNote: '改写单段「给 AI 的提示」，以及「完善这个类型」。可以选便宜、快的模型。',
    aiSameAsAssistant: '和 AI 助手用同一个',
    aiBuiltinPrompt: '使用内置优化提示词',
    aiBuiltinPromptNote: '告诉 AI 记忆系统怎么用这些内容、怎样写好提示，并让它忽略预设里的文风要求。预设（含破限）照常发送。', aiConnection: '连接配置', aiPreset: '生成预设',
    aiFollowMemory: '跟随记忆图设置（{0}）', aiCurrentApi: '当前 API', aiCurrentPreset: '当前预设', aiMissing: '已不存在',
    aiTest: '测试', aiTesting: '测试中…', aiTestOk: '可以用', aiTestFail: '失败',
    aiSettingsSave: '保存设置', aiSettingsSaved: 'AI 设置已保存',
    aiNoConnections: '还没有连接配置。可以在 Luker 的「连接配置」里新建一个，再回来选择。',
    aiTitle: 'AI 助手', aiPlaceholder: '说说想怎么改，比如「加一个物品类型」', aiSend: '发送', aiStop: '停止',
    aiHistory: '历史对话', aiNew: '新对话', aiNoHistory: '还没有历史对话', aiUntitled: '未命名对话', aiDeleteSession: '删除这段对话',
    aiEmptyTitle: '让 AI 帮你改记忆结构', aiEmptySub: 'AI 的改动会逐条列出来，勾选要的应用到左边的编辑器，检查没问题再点保存。',
    aiFoot: 'Enter 发送，Shift+Enter 换行',
    aiThinking: 'AI 正在修改…', aiFailed: '出错了：{0}', aiStopped: '已停止',
    aiTurnUndone: '这一轮已撤销', aiUndoTurn: '撤销这一轮',
    aiUndoneOne: '已撤销这一轮的修改', aiUndoneMany: '已撤销最近 {0} 轮的修改',
    aiUnsupported: '当前版本的记忆图不支持 AI 助手，请使用原生面板里的「AI 迭代」。',
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
    // Unknown keys (fields not in the schema) never show as English.
    return (type && customFieldLabels[type]?.[key]) || FIELD_LABELS[key] || (/[\u3400-\u9fff]/.test(key) ? key : '未命名项');
}

/** "一级摘要" for depth 1, etc. */
export function depthLabel(depth) {
    const n = Math.max(1, Math.floor(Number(depth) || 1));
    return `${DEPTH_NAMES[n] || n}级摘要`;
}
