# CLAUDE.md — Memory Lens（记忆透镜）

Luker（SillyTavern 分支，AGPL-3.0）第三方扩展：给内置 `memory-graph` 扩展做的可视化工作台。
仓库 https://github.com/xzhouzhou758/memory-lens ，用户在 Luker「扩展 → 安装扩展」粘贴该地址安装。当前版本 0.2.0。

## 用户的硬性要求（必须遵守）

1. **全中文界面**：用户能看到的文字不出现英文（快捷键名 Ctrl/K/Esc 除外）。Luker 默认 schema 里的英文 label / 说明不显示，在编辑器里显示为“沿用默认说明”。
2. **简单友好**：用户明确说过“不要整的那么复杂”。不暴露技术参数（主键、向量化、压缩阈值、提取指令等），由代码自动处理或原样保留。
3. **绝不照搬 yuzuki-Memory**（github.com/gaigai315/yuzuki-Memory，无许可证）。不复制其代码、CSS、类名、配色、图标、插画。本项目风格：石墨灰中性色、青绿强调色 `#3fd0b4`、琥珀 `#f4b740` = 本轮召回、蓝色 = 常驻注入、手写 SVG 图标、无毛玻璃渐变、无环形自我中心图。
4. 记忆**内容**只读（编辑跳原生面板）；只有**记忆结构（schema）**可在本扩展中编辑。
5. 回复用户用中文。

## 命令

```bash
npm test                      # node:test，无依赖，Node ≥ 20（当前 28 个用例）
npm run preview               # http://127.0.0.1:4173/preview/index.html 示例数据
# 预览参数：?data=demo|large|empty|error  &theme=dark|light  &n=800
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
css/                   tokens → shell → … → schema → compact（≤860px 移动布局，最后加载）
preview/               独立预览：mock-data.js（原创虚构“雾港”故事 + 模拟 schema 读写）、serve.mjs
tests/                 model.test.mjs、schema.test.mjs
```

视图接口：`{ id, el, render(), onShow?(), invalidate?(), onSelectionChange?(), destroy?() }`。schema 视图是“全宽视图”（`isFullView`），隐藏侧栏和详情栏，无聊天时也能打开。

约定：
- DOM 用 `h()`（util.js），追加子节点用 `put()`，**不要用原生 `append`**（会把 null 变成 "null" 文本）。不用 innerHTML。
- 纯模块（model.js、layout.js、i18n.js、schema-model.js、mock-data.js）不能碰 DOM，测试在 Node 里直接导入。
- CSS 全部在 `.mlens` 作用域下；z-index 30500；不用原生 checkbox（Luker 全局样式会污染），开关用 `button[role=switch]`。
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

- 一行一个记录项：名称 / 说明 / 必须填写 / 排序（拖动或上下按钮）/ 删除。三个开关：一直让 AI 看到（alwaysInject）、同名只保留最新（latestOnly）、自动合并成摘要（compression.mode，只在 event 或已开启时显示）。
- 不暴露、原样保留：`extractionInstructions`、`compression.summarizeInstruction`、压缩数值、`keywords`、`ragPerTypeK`、`tableName`、`level` 等。
- 主键：latestOnly 开启且无主键时自动选 title/name/aliases；新建项默认加入向量检索列。
- 字段显示名优先级：用户命名 > 内置翻译表 > 说明的第一个中文短语（≤12 字）> key。
- 保存前弹窗列出中文改动摘要（`describeChanges`），保存后 12 秒内可撤销。
- 允许类型重名（用户的自定义“剧情线”和内置 thread 都叫“剧情线”）。

## 待办 / 可能的下一步

1. 在真实 Luker 中验证 schema 保存（全局 + 角色），确认原生面板显示一致、撤销有效。
2. 用户可能想要：长指令（记录规则/合并规则）的编辑——之前讨论过放到“高级”里，带“恢复默认”，暂未做。
3. 未在 Safari / iOS 真机测试。

## 发布

- `git push` 到 `main`；manifest 开了 `auto_update`，改 `manifest.json` 和 `package.json` 的 version 后 Luker 会提示更新。
- 提交作者：`xzhouzhou758 <52977053+xzhouzhou758@users.noreply.github.com>`。不要修改全局 git 配置。
- **不要把 token 写进仓库、.git/config 或远程 URL**。之前的 token 已在聊天中泄露，应已撤销；需要推送时让用户提供新的细粒度 token（仅本仓库、仅内容写入），或让用户自己推送。
- 许可证 AGPL-3.0-or-later（运行时导入 Luker 的 AGPL 模块）。
