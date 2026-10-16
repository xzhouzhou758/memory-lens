// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Ready-made memory structures. A template replaces the editor's type list
// (unsaved until 保存). The 事件 type is always kept as it is: memory-graph
// relies on it. Built-in ids (character_sheet / location_state / thread)
// reuse Luker's own default spec, so its tuned rules come along.

const col = (key, label, hint) => ({ key, label, hint });

/** A type the template defines itself. */
function custom(id, label, intro, columns, { always = false, latest = true, required = ['title'], keywords = [] } = {}) {
    return { id, label, intro, columns, always, latest, required, keywords };
}

export const TEMPLATES = [
    {
        id: 'simple',
        name: '精简',
        note: '只记事件、角色和剧情线。条目少、省钱，适合便宜的模型。',
        types: ['character_sheet', 'thread'],
    },
    {
        id: 'romance',
        name: '恋爱日常',
        note: '重点记两人的关系变化、约定和值得纪念的时刻。',
        types: [
            'character_sheet',
            custom('relationship', '关系', '两个角色之间长期的关系状态。只在关系真的变了时更新。', [
                col('title', '双方', '关系双方的名字，用「A × B」的格式'),
                col('stage', '关系阶段', '现在处在什么阶段，例如：初识、暧昧、交往中、冷战'),
                col('feeling', '彼此感受', '双方现在对对方的真实态度，一两句话'),
                col('promise', '约定', '两人之间还没兑现的约定或承诺，没有就留空'),
            ], { always: true, required: ['title', 'stage'], keywords: ['关系', '感情', '约定', '告白'] }),
            custom('moment', '纪念时刻', '值得以后提起的重要瞬间：第一次、告白、礼物、争吵与和好。普通日常不记。', [
                col('title', '名称', '简短的名字，例如：第一次约会'),
                col('when', '时间', '故事里的时间，例如：第三天傍晚'),
                col('detail', '经过', '发生了什么、谁说了什么关键的话，不超过 80 字'),
                col('meaning', '意义', '这件事对两人关系的影响'),
            ], { latest: false, keywords: ['纪念', '第一次', '礼物', '回忆'] }),
            'location_state',
        ],
    },
    {
        id: 'adventure',
        name: '冒险奇幻',
        note: '记任务进度、重要物品和各方势力，适合跑团和长篇冒险。',
        types: [
            'character_sheet',
            'location_state',
            custom('quest', '任务', '有明确目标、会持续几轮以上的任务或委托。', [
                col('title', '任务名', '简短的任务名，不超过 10 个字'),
                col('status', '状态', '只能写：进行中 / 已完成 / 已失败 / 已放弃'),
                col('goal', '目标', '要达成什么，谁委托的'),
                col('progress', '进度', '现在做到哪一步、下一步该做什么'),
                col('reward', '报酬', '答应给的报酬，没有就留空'),
            ], { always: true, required: ['title', 'status', 'goal'], keywords: ['任务', '委托', '目标'] }),
            custom('item', '物品', '对剧情有影响的重要物品：钥匙、信物、神器、关键道具。普通消耗品不记。', [
                col('title', '名称', '物品的正式名称'),
                col('owner', '持有人', '现在在谁手里，丢失了就写「下落不明」'),
                col('effect', '作用', '它能做什么、有什么限制'),
                col('state', '状态', '完好、损坏、已用掉等'),
            ], { keywords: ['物品', '道具', '装备', '神器'] }),
            custom('faction', '势力', '组织、国家、门派、公会等团体。', [
                col('title', '名称', '势力的正式名称'),
                col('leader', '首领', '现在由谁领导'),
                col('stance', '立场', '对主角一方是友好、中立还是敌对，以及原因'),
                col('note', '要点', '规模、据点、目的等长期不变的信息，不超过 60 字'),
            ], { keywords: ['势力', '组织', '阵营', '国家'] }),
        ],
    },
    {
        id: 'mystery',
        name: '悬疑推理',
        note: '记线索和未解的疑点，方便 AI 前后对得上、不乱给答案。',
        types: [
            'character_sheet',
            'location_state',
            custom('clue', '线索', '调查中发现的具体证据或证词。', [
                col('title', '名称', '简短的名字，例如：带血的手帕'),
                col('found', '发现经过', '在哪里、被谁、什么时候发现的'),
                col('content', '内容', '线索本身显示了什么，只写事实不写推测'),
                col('points_to', '指向', '目前看来和哪个人或哪个疑点有关'),
            ], { required: ['title', 'content'], keywords: ['线索', '证据', '证词'] }),
            custom('question', '疑点', '还没解开的谜题。解开后把状态改成「已解开」并写明答案。', [
                col('title', '问题', '用一句问句写，例如：凶手是怎么离开密室的'),
                col('status', '状态', '只能写：未解开 / 已解开'),
                col('known', '已知', '目前掌握的相关事实'),
                col('suspects', '嫌疑', '可能的答案或嫌疑人'),
            ], { always: true, required: ['title', 'status'], keywords: ['谜题', '疑点', '真相', '嫌疑'] }),
        ],
    },
    {
        id: 'life',
        name: '生活养成',
        note: '记日程、待办和身上的东西，适合日常、经营和养成类故事。',
        types: [
            'character_sheet',
            custom('status', '状态', '角色当前会变化的状态：体力、心情、金钱、技能等级等。', [
                col('title', '角色', '这是谁的状态，只写名字'),
                col('condition', '身体与心情', '现在的体力、健康和心情'),
                col('money', '金钱', '手头的钱，写具体数字'),
                col('skills', '技能', '学会的技能和熟练程度'),
            ], { always: true, keywords: ['状态', '体力', '心情', '金钱'] }),
            custom('todo', '待办', '答应要做、或计划要做的事。', [
                col('title', '事项', '要做的事，一句话'),
                col('status', '状态', '只能写：待办 / 已完成 / 已取消'),
                col('due', '时间', '什么时候要做，没有就留空'),
                col('note', '备注', '和谁有关、需要准备什么'),
            ], { always: true, required: ['title', 'status'], keywords: ['待办', '计划', '约好', '日程'] }),
            custom('belonging', '物品', '角色拥有或得到的东西。', [
                col('title', '名称', '物品名称'),
                col('owner', '主人', '属于谁'),
                col('count', '数量', '有几个'),
                col('note', '说明', '来历或用途，一句话'),
            ], { keywords: ['物品', '礼物', '买', '得到'] }),
            'location_state',
        ],
    },
];

/** Converts a template's own type into a memory-graph spec. */
function toSpec(def) {
    const keys = def.columns.map(c => c.key);
    return {
        id: def.id,
        label: def.label,
        tableName: `${def.id}_table`,
        tableColumns: keys,
        embeddingColumns: keys.slice(),
        level: 'semantic',
        extractHint: def.intro,
        extractionInstructions: '',
        extractEveryN: 1,
        keywords: def.keywords.slice(),
        columnHints: Object.fromEntries(def.columns.map(c => [c.key, c.hint])),
        requiredColumns: def.required.filter(k => keys.includes(k)),
        forceUpdate: false,
        editable: true,
        alwaysInject: def.always,
        latestOnly: def.latest,
        primaryKeyColumns: def.latest && keys.includes('title') ? ['title'] : [],
        compression: { mode: 'none', threshold: 6, fanIn: 3, maxDepth: 6, keepRecentLeaves: 0, summarizeInstruction: '' },
    };
}

/**
 * The type list a template produces.
 * @param {object} template one of TEMPLATES
 * @param {object[]} current specs now in the editor (its 事件 is kept)
 * @param {object[]} defaults Luker's default specs
 * @returns {{ types: object[], labels: object }} labels: column names to show
 */
export function buildTemplate(template, current = [], defaults = []) {
    const byId = (specs, id) => (specs || []).find(s => String(s?.id) === id);
    const clone = (v) => JSON.parse(JSON.stringify(v));
    const types = [];
    const labels = {};
    const event = byId(current, 'event') || byId(defaults, 'event');
    if (event) types.push(clone(event));
    for (const entry of template.types) {
        if (typeof entry === 'string') {
            const spec = byId(defaults, entry) || byId(current, entry);
            if (spec) types.push(clone(spec));
            continue;
        }
        types.push(toSpec(entry));
        labels[entry.id] = Object.fromEntries(entry.columns.map(c => [c.key, c.label]));
    }
    return { types, labels };
}

/** Names of the types a template contains, for the picker. */
export function templateTypeNames(template, nameOf) {
    return ['event', ...template.types].map(entry => (typeof entry === 'string' ? nameOf(entry) : entry.label));
}
