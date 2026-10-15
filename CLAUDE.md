# CLAUDE.md — Memory Lens（记忆透镜）

Luker（SillyTavern 分支，AGPL-3.0）第三方扩展：给内置 `memory-graph` 扩展做的可视化工作台。
仓库 https://github.com/xzhouzhou758/memory-lens ，用户在 Luker「扩展 → 安装扩展」粘贴该地址安装。当前版本 0.4.0。

## 用户的硬性要求（必须遵守）

1. **全中文界面**：用户能看到的文字不出现英文（快捷键名 Ctrl/K/Esc 除外）。Luker 默认 schema 里的英文 label / 说明不显示，在编辑器里显示为“沿用默认说明”。
2. **简单友好**：用户明确说过“不要整的那么复杂”。不暴露技术参数（主键、向量化、压缩阈值、提取指令等），由代码自动处理或原样保留。
3. **绝不照搬 yuzuki-Memory**（github.com/gaigai315/yuzuki-Memory，无许可证）。不复制其代码、CSS、类名、配色、图标、插画。本项目风格：石墨灰中性色、青绿强调色 `#3fd0b4`、琥珀 `#f4b740` = 本轮召回、蓝色 = 常驻注入、手写 SVG 图标、无毛玻璃渐变、无环形自我中心图。
4. 记忆内容可在数据表 / 详情栏**双击修改**（用户 2026-10 要求，取代原先的“只读”规则）；新建、删除记忆和改关系仍去原生面板。
5. 回复用户用中文。

## 命令

```bash
npm test                      # node:test，无依赖，Node ≥ 20（当前 43 个用例）
npm run preview               # http://127.0.0.1:4173/preview/index.html 示例数据
# 预览参数：?data=demo|large|empty|error  &theme=dark|light  &view=graph|timeline|table|schema  &n=800
```

预览需要 Luker 的 `public/lib/cytoscape.min.js`：`preview/serve.mjs` 会依次查找 `--cytoscape <file>`、`$LUKER_DIR`、上级 Luker 目录。找不到时图谱为空，其他视图正常。

改完代码：`npm test` + 对每个改过的 JS 跑 `node --check`；涉及界面时用无头浏览器截图检查桌面（1440×900）和手机（390×844）。

## 架构

```
index.js               入口：魔法棒菜单项 #memory_lens_wand_item，懒加载 app；globalThis.MemoryLens = {open, close}
src/app.js             外壳：状态、加载/实时刷新（400ms 防抖）、布局、快捷键、焦点陷阱、移动端抽屉
src/source-luker.js    Luker 数据源 + schema 读写（见下）
src/model.js           纯函数数据层（无 DOM）：buildModel、摘要解析、筛选、章节、搜索
src/i18n.js            全部中文文案；setDisplayLabels() 注入用户自定义的类型/字段名
src/store.js           小型状态容器，偏好存 localStorage 'memoryLens.prefs.v1'
src/graph/             cytoscape 加载、样式（读 CSS 变量）、力导向/时间轴布局（纯函数，确定性）
src/views/             graph / timeline / table 三个只读视图
src/panels/            sidebar 筛选、inspector 详情、palette 搜索、dialog
src/schema/            schema-model.js（纯函数）+ schema-view.js（记忆结构编辑器 UI）
src/edit/              edit-model.js（纯函数：可改规则、值转换）+ inline-edit.js（双击原地编辑）
src/ai/                ai-model.js（纯函数：对话循环、内置提示词）、schema-diff.js（纯函数：条目级改动 + 按需应用）、change-list.js（改动清单 UI）、ai-panel.js（AI 助手）
css/                   tokens → shell → … → schema → compact（≤860px 移动布局，最后加载）
preview/               独立预览：mock-data.js（原创虚构“雾港”故事 + 模拟 schema 读写）、serve.mjs
tests/                 model.test.mjs、schema.test.mjs、ai.test.mjs、edit.test.mjs、diff.test.mjs
```

视图接口：`{ id, el, render(), onShow?(), invalidate?(), onSelectionChange?(), destroy?() }`。schema 视图是“全宽视图”（`isFullView`），隐藏侧栏和详情栏，无聊天时也能打开。

约定：
- DOM 用 `h()`（util.js），追加子节点用 `put()`，**不要用原生 `append`**（会把 null 变成 "null" 文本）。不用 innerHTML。
- 纯模块（model.js、layout.js、i18n.js、schema-model.js、mock-data.js）不能碰 DOM，测试在 Node 里直接导入。
- CSS 全部在 `.mlens` 作用域下；z-index 2147482000（要盖过其他悬浮脚本）；全屏尺寸由 `src/viewport.js` 按 visualViewport 写成 px（iOS 上 Luker 把 body 设成 fixed，`inset:0` 会算错），CSS 只作兜底；不要给根节点加 `contain`；不用原生 checkbox（Luker 全局样式会污染），开关用 `button[role=switch]`。
- 根节点拦截 keydown 冒泡，防止 Luker 的全局快捷键（←/→ 切换回复等）触发。

## 与 Luker / memory-graph 的对接（最易出问题的地方）

验证基于 Luker 2.8.0（commit 2f625c1）。memory-graph 源码在 Luker 的 `public/scripts/extensions/memory-graph/`（main.js 约 1.6 万行）。

- 公开 API：`Luker.getContext().getExtensionApi('memory-graph')`，用到 `getSchemaScopeInfo`、`persistCharacterSchemaOverride`、`removeCharacterSchemaOverride`、`getCurrentInjection`、`getLastRecallProjection`、`onStoreCommit`、`onInjectionChanged`。
- 公开 API 没有“列出全部节点”，所以**按 URL 动态导入内部模块**：`/scripts/extensions/memory-graph/main.js`（`ensureStoreSyncedWithChat`、`getSettings`、`normalizeNodeTypeSchema`、`getDefaultNodeTypeSchema`）和 `read-api.js`（`getMemoryGraphReadApi`）。浏览器按 URL 缓存模块，拿到的是 Luker 已加载的同一实例。路径变了会报 `SourceError('api')`，界面显示提示而不崩溃。
- schema 写入（source-luker.js `createSchemaAccess`）：
  - 全局：`settings.nodeTypeSchema = normalizeNodeTypeSchema(types)` 后 `ctx.saveSettings()`；若当前角色有单独结构则先移除它（否则全局修改被遮盖）。
  - 角色：`persistCharacterSchemaOverride(ctx, avatar, schema)`。
  - 用户自定义的字段显示名存在 `extensionSettings.memory_lens.columnLabels[typeId][columnKey]`（memory-graph 的 normalize 会丢弃未知键，所以不能存进 schema）。
  - `write()` 返回旧状态快照，`restore()` 用于撤销。
- **schema 写入从未在真实 Luker 中测试过**，只在 mock 上测过。这是当前最大的风险，接手后优先验证。

### memory-graph 数据的坑（已处理，改动时别回退）

- `setNodeSummary()` 会把摘要里所有空白（含换行）压成一个空格 → `restoreSummaryLayout()` 重新切分 时间/地点/不可逆/未结/原文摘录。
- 事件标题是自动生成的 “Summary 3” / “Event Summary L1 #2” → `isPlaceholderTitle()` 识别后改用正文第一句。
- 同一关系常存成正反两条边（A→B + B→A）→ buildModel 合并为一条无向边。
- 内部边 `contains`/`semantic_contains`、诊断边 `recall*`、自环都会被过滤。
- 事件的 `summary` 字段锁定为必填且不可删；`event` 类型不可删除。
- 改记录项的内部名（column key）会让旧数据对不上，所以 key 永不改名；新建项自动生成 `custom_N`，界面只显示中文名。

## 记忆结构编辑器的设计决定

- 顶部只有一行细栏：「用于：所有角色 | 仅某角色」分段按钮 + 保存。
- 一行一个记录项：拖动 / 名称 / 说明预览（点开才编辑）/ 必填 / 删除；键盘在拖动柄上用 ↑↓ 排序。三个开关：一直让 AI 看到（alwaysInject）、同名只保留最新（latestOnly）、自动合并成摘要（compression.mode，只在 event 或已开启时显示）。
- 不暴露、原样保留：`extractionInstructions`、`compression.summarizeInstruction`、压缩数值、`keywords`、`ragPerTypeK`、`tableName`、`level` 等。
- 主键：latestOnly 开启且无主键时自动选 title/name/aliases；新建项默认加入向量检索列。
- 字段显示名优先级：用户命名 > 内置翻译表 > 说明的第一个中文短语（≤12 字）> 说明开头截取的中文 > 「未命名项」。**界面上永远不显示英文 key**（i18n `fieldLabel` 同样兜底）。未命名的旧项在编辑器里名称框留空、占位提示起名，不阻止保存；新建项必须起名。
- 记录项说明和类型简介都标「给 AI 的提示」（它们就是发给提取 AI 的提示词）。
- 保存前弹窗列出中文改动摘要（`describeChanges`），保存后 12 秒内可撤销。
- 允许类型重名（用户的自定义“剧情线”和内置 thread 都叫“剧情线”）。

## AI 功能（都只在记忆结构页）

- **AI 设置**（助手栏齿轮）：两组「连接配置 + 生成预设」，选项来自 Luker 连接管理器（`connection-manager/profile-resolver.js` `getChatCompletionConnectionProfiles`）和 `ctx.getPresetManager('openai').getAllPresets()`。存 `extensionSettings.memory_lens.ai = { assistant:{api,preset}, tools:{same,api,preset} }`；空 = 跟随 memory-graph 的 `requestApiPresetName/requestLlmPresetName`。每组可「测试」。
- **AI 助手**：流程自己串（原生工作室的循环在闭包里没导出）。复用 `schema-iteration/tools.js`（`buildToolCatalog`、`normalizeToolCallToEdit` 沙盒）、`read-fields-dispatcher.js`、`system-prompt.js`、`iteration-library/runner.js` 的 `requestToolCallsWithRetry`。AI 在**自己的副本**上改；一轮结束用 `diffSchemas(编辑器, AI副本)` 得到条目级改动（新增/删除记录项、提示改动带原文对比高亮、改名、必填、开关、顺序、新建/删除类型），不出现代码或 key。
  - 「自动应用」勾选框（localStorage `memoryLens.aiAutoApply`，默认关）：关 = 逐条勾选「应用所选」；开 = 直接应用。应用只进草稿，仍需「保存」。每轮可「撤销这一轮」（连带之后的轮次）。部分应用 / 放弃会写回 tool_result，让 AI 下一轮知道。
  - 用户手改过的条目（`handEdits`）在待应用清单里标「已过期」不可勾。编辑器里 AI 改过的项标「AI 新增 / AI 已改」，类型列表显示「AI 改了 N 处」；保存、放弃修改、重新加载后清除。点改动行 → 编辑器跳到该项并闪一下。
  - 读结构的工具调用合并成一行「AI 查看了 N 次结构」。不提供 reset_to_blank/global 控制工具、不接世界书工具。会话存 `memory_lens.aiSessions[scopeKey]`，最多 12 条。
- **完善这个类型**（类型标题旁）：可选一句要求 → `source.ai.suggestType` 让 AI 调一次 `mg_schema_set_node_type`，沙盒得到整份新结构 → 同样的改动清单勾选应用。
- **AI 优化**（每块「给 AI 的提示」上）：`source.ai.rewrite({kind:'columnHint'|'typeIntro'})`，单个 `submit_text` 工具取回文字，填回输入框。数据表 / 详情栏的双击编辑**没有** AI 按钮（用户明确只要结构页有）。
- 内置提示词在 ai-model.js：`SCHEMA_PRIMER` 说明 memory-graph 怎么用 extractHint / columnHints / required / alwaysInject / latestOnly+主键 / compression；`suggestSystemPrompt` 要求保留所有已有 key、新 key 用 snake_case、全中文。
- **未在真实 Luker + 真实模型上测过**，只在 preview 的 `createMockAiAccess` 上测过。

## 双击修改记忆内容

- 交互：`src/edit/inline-edit.js` 的 `editable(el, {app, node, key, value})`；key '' = 节点标题。原格子显示超过一行就用同宽的自增高 textarea（按实际显示判断，不按字数）；表格单元格保留 td 本身只换内容。Enter 保存、Shift+Enter 换行；有分段的内容（事件正文、含换行）才用 Ctrl/⌘+Enter；光标放末尾不全选；Esc 取消；点别处保存。保存后底部提示可撤销（10 秒）。编辑中实时刷新会推迟。
- 规则（`edit-model.js`）：自动合并摘要（rollup）、已归档不可改；事件标题自动生成不可改（改正文）。数组字段用「、」拆合，保持原类型。
- 写入（source-luker.js `createEditAccess`）：照 memory-graph 图谱迭代工作室的手动编辑路径——`ensureStoreSyncedWithChat` → 副本上 `getMemoryGraphWriteApi(..., {useInFlightAnchor:false, preserveSeqOnEdit:true}).editNode` → `commitGraphUiMutation` → `syncGraphVectorsAfterMutation`。内部函数不在时退回公开的 `openSession(ctx).editNode`（会推进 seqTo）。
- **未在真实 Luker 中测过**，只在 preview 的 mock 上测过。

## 待办 / 可能的下一步

1. 在真实 Luker 中验证 schema 保存（全局 + 角色），确认原生面板显示一致、撤销有效。
2. 用户可能想要：长指令（记录规则/合并规则）的编辑——之前讨论过放到“高级”里，带“恢复默认”，暂未做。
3. 未在 Safari / iOS 真机测试。

## 发布

- `git push` 到 `main`；manifest 开了 `auto_update`，改 `manifest.json` 和 `package.json` 的 version 后 Luker 会提示更新。
- 提交作者：`xzhouzhou758 <52977053+xzhouzhou758@users.noreply.github.com>`。不要修改全局 git 配置。
- **不要把 token 写进仓库、.git/config 或远程 URL**。之前的 token 已在聊天中泄露，应已撤销；需要推送时让用户提供新的细粒度 token（仅本仓库、仅内容写入），或让用户自己推送。
- 许可证 AGPL-3.0-or-later（运行时导入 Luker 的 AGPL 模块）。
