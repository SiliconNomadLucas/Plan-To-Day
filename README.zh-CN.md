# Plan to Day（中文）

[English README](README.md)

一个面向 Obsidian 的本地任务管理插件，提供接近 Microsoft To Do 的任务、列表、我的一天、计划和复盘体验。

插件以 Vault 本地数据为核心，不依赖云端服务，支持桌面端和移动端。

## Overview (English)

Plan to Day is a local-first task and goal planner. Break life goals into yearly, quarterly, monthly, and weekly plans, then turn weekly goals into actionable tasks for My Day. Organize tasks in lists, schedule and repeat them, and review progress over time.

Your tasks and backups stay in your vault (by default in the `todo/` folder). The task suggestions use local rules and do not require an account, API key, or network connection. To install manually, place `main.js`, `manifest.json`, and `styles.css` in `.obsidian/plugins/plan-to-day/` and enable the plugin in Community plugins.

## 功能概览

### 任务管理

- 创建、编辑、完成、删除和恢复任务
- 重要程度、开始时间、截止时间、提醒和重复任务
- 备注、标签、优先级、子任务和关联文件
- 任务可移动到不同列表、计划周期或“我的一天”
- 支持软删除回收站，避免误删后无法恢复

### 我的视图

- **我的一天**：按日期管理当天任务，支持全天、早上、中午、下午和晚上分组
- **所有任务**：查看未归入自定义列表的任务
- **我的日程**：日、周、月视图，支持时间轴、拖拽调整时间和点击空白创建任务
- **四象限**：按重要/紧急程度聚合任务
- **复盘统计**：查看日、周、月、年维度的完成情况、趋势和分类分布

### 计划管理

- 人生计划、年度计划、季度计划、月度计划和周计划
- 计划目标支持父子关系和周期拆分
- 年度/月度计划支持卡片视图和列表视图
- 计划卡片显示完成、进行中、搁置、放弃和逾期状态
- 搁置或放弃的目标可以恢复为进行中
- 顶部操作区和统计卡片固定显示，下方内容独立滚动

### 状态管理

任务和目标支持以下状态：

- `active`：进行中
- `shelved`：搁置
- `abandoned`：放弃
- `isCompleted`：完成状态，与上述生命周期状态分开保存

桌面端可以使用右键菜单，移动端可以使用长按底部操作菜单。列表支持按状态筛选，统计视图也会分别显示进行中、搁置、放弃和逾期数量。

### 移动端侧栏

移动端使用 Obsidian 工作区右侧侧栏承载：

- 普通任务详情
- 年度、季度、月度和周目标详情
- 待办事项推荐候选
- 日程摘要

在“我的日程”中：

- 日视图侧栏显示当前日期待办
- 周视图侧栏显示当前 ISO 周目标
- 月视图侧栏显示当前月份目标

点击摘要项目会关闭详情栏，并跳转到主任务区域定位和高亮对应任务或目标。

## 待办事项推荐

待办事项推荐采用**本地规则**，不联网，也不需要 API Key。

目前支持：

- 仅在“我的一天”生成日待办候选，可将本周目标转为关联的普通日任务
- 根据重要程度、截止日期、父任务、标签和列表进行排序
- 按计划强度计算每日可用容量
- 对长任务进行拆分，避免把超长任务放进单个时间段
- 对重复或高度相似任务进行拦截
- 先在推荐侧栏中预览，用户点击 `+` 后才保存

当前推荐是可解释的本地规则实现，不等同于远程大语言模型。

## 安装

### 手动安装

1. 下载或构建以下文件：
   - `main.js`
   - `manifest.json`
   - `styles.css`
2. 在 Vault 中创建目录：

   `.obsidian/plugins/plan-to-day/`

3. 将上述文件复制到该目录。
4. 在 Obsidian 的“第三方插件”设置中启用 **Plan to Day**。

### 从旧版插件切换

如果当前库曾安装 `obsidian-todo`，先在“第三方插件”中停用旧插件，再启用 **Plan to Day**，不要同时运行两个插件。首次启动时，新插件仅在自身尚无设置的情况下从旧插件的 `data.json` 复制设置；旧文件不会被删除。任务、列表和备份仍保留在原 Vault 数据目录（默认 `todo/`）。确认设置和任务正常后，再决定是否移除旧插件目录。

### 从源码构建

```bash
npm install
npm run build
```

构建完成后，生成的 `main.js`、`styles.css` 和 `manifest.json` 位于项目根目录。

## 开发

开发模式：

```bash
npm run dev
```

生产构建：

```bash
npm run build
```

项目主要目录：

```text
src/
├── models/       # 任务、列表、标签等数据模型
├── services/     # 存储、任务、统计、推荐服务
├── views/        # 主视图、导航栏、详情栏、推荐侧栏
├── ui/           # 弹窗和选择器
└── utils/        # 日期、周期、重复任务和排序工具
```

## 发布与维护

提交 PR 或推送到 `main` 时，CI 会执行完整构建和测试，并检查 `package.json`、锁文件、插件清单及版本兼容记录是否一致。

发布流程：

1. 执行 `npm run version -- <next-version>`，传入高于当前版本的 `major.minor.patch` 版本号。
2. 提交版本变更并推送与清单版本完全一致的标签（不带 `v`）。
3. CI 通过后会自动创建 GitHub Release，并附上 `main.js`、`manifest.json` 和 `styles.css`。

本地可用 `npm run release:check` 完整预演发布门禁。该命令不创建标签或发布版本。

## 数据存储

任务数据存储在当前 Vault 的 `todo/` 目录中：

- `database.json`：任务和目标数据
- `lists.json`：自定义列表配置
- `tags.json`：标签配置
- `groups.json`：列表分组配置
- `backups/`：自动数据库备份；每日首次修改前保留快照，最多保留最近 30 天

`database.json` 中包含任务数据的 `schemaVersion`。没有版本号的旧数据库会在加载时按迁移步骤升级并写回；如果数据库版本比当前插件更新，插件会停止加载该数据，不会尝试降级或覆盖。

数据默认保存在本地，不会自动上传到第三方服务。

## 兼容性

- Obsidian `1.7.2` 或更高版本
- 支持桌面端
- 支持移动端
- 中文和英文界面
- 兼容深色和浅色主题，主要使用 Obsidian CSS 变量

## 当前限制

- 待办事项推荐目前采用本地规则，不是远程大模型生成
- 远程 AI provider、API Key 配置和网络隐私设置尚未开放
- 移动端部分复杂交互仍需要在真实设备上持续回归验证
- 暂未提供自动化端到端测试套件

## 项目状态

当前开发版本：`0.1.3`（尚未发布）

核心任务管理、计划视图、日程视图、复盘统计、回收站、重复任务、移动端侧栏和本地待办事项推荐已经实现，项目仍处于持续完善阶段。

## 许可证

本项目使用 [MIT License](LICENSE)。

## 作者

[SiliconNomadLucas](https://github.com/SiliconNomadLucas)

项目仓库：[Plan to Day](https://github.com/SiliconNomadLucas/Plan-To-Day)
