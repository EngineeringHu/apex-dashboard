# Apex Dashboard 二次开发笔记（AI 上下文文档）

> 用途：供后续 AI 会话快速理解本项目的二次开发内容。最后更新：2026-09-17。交流语言：中文。
> 项目目标：在 Obsidian 中实现史蒂芬·柯维《高效能人士的七个习惯》**第四代时间管理周计划看板**（对应书中"表5-2"：角色→目标、周计划网格表、本周要务、每日安排、不断更新），基于开源插件 Apex Dashboard 定制。

## 1. 关键路径

| 角色 | 路径 |
|---|---|
| Obsidian Vault | `C:\work\HuNote\OpenKeep笔记` |
| 插件源码（TypeScript + esbuild） | `C:\work\apex-dashboard-src`（fork 自 github.com/PandoraReads/apex-dashboard） |
| 干净构建目录 | `C:\work\apex-dashboard-build`（内含 node_modules → 源码库的 NTFS junction） |
| 部署目标 | `<vault>\.obsidian\plugins\apex-dashboard\`（main.js、styles.css、data.json） |

**Git 状态**：自定义工作在 `main` 分支，领先 upstream/main（`672a943` 周计划表、`fc32109` 移除日历联动），后续改动未提交、以工作区为准。⚠️ 曾因 detached HEAD 构建出上游版本导致功能丢失——构建前先 `git status` 确认在 `main` 分支。

## 2. 已实现的自定义功能

### 2.1 表格分区（table section）
- frontmatter `columns` 支持 `type: table`，表格原文存于 `column.tableContent`（`src/parser.ts`）
- **合并语法**：单元格 `>` = 向左合并（colspan）；`^` = 向上合并（rowspan）
- `src/renderer.ts`：`parseTableSectionRows` → `buildMergedTableGrid` 渲染，`serializeMergedGrid` 回写
- 增删行列且保持表头合并（dense-grid 模型）：`gridToDenseRows` / `serializeDenseRows` / `addTableRowAt` / `deleteTableRowAt` / `insertTableColumnAt` / `deleteTableColumnAt`
- 点击单元格直接在格内编辑（textarea，支持换行）

### 2.2 表格任务模式
- 判定条件：`r > 1 && cell.col >= 2 && cell.cs === 1`（renderer.ts）
- 覆盖"目标"、"本周要务"列及日程普通格：勾选、悬停删除按钮、悬停/聚焦显示添加输入框、**双击任务文本编辑**
- 任务以 `- [ ] xxx` 列表序列化（`parseTasks` / `serializeTasks`）
- 历史修复：外层 td 点击需跳过 `.apex-table-cell--tasks`，否则任务格会退化为普通 Markdown 编辑

### 2.3 周记文件夹模式（动态加载多个 md）
- 设置 `workspaceFolder`（默认 `周记`）：横幅左上角以**下拉框**列出该文件夹全部 md + 旧注册工作台，替代数字按钮
- 切换校验放宽至文件夹内文件；切换时并入 `workspaceFiles` 注册表（保证重命名/删除跟随）
- vault `create`/`rename`/`delete` 事件刷新下拉框（create 监听注册在 `onLayoutReady` 内，避免启动期事件风暴）
- ＋按钮：在文件夹内新建周计划（文件夹不存在自动创建）；命名提示"第N周"，重名加 `-2` 后缀
- 核心函数（main.ts）：`workspaceFolder()` / `folderWorkspaceFiles()` / `isFolderWorkspace()` / `getWorkspaceChoices()` / `refreshFolderModeSwitcher()`；纯函数（workspace-registry.ts）：`normalizeWorkspaceFolder` / `isUnderWorkspaceFolder` / `workspaceFileBaseName` / `sanitizeWorkspaceFileBase` / `nextFolderWorkspacePath`
- 删除当前周记文件时，优先回退到文件夹内其他文件
- 其他历史小改动：每周安排列居中显示等

### 2.4 新建看板模板文件（可配置）
- 设置 `workspaceTemplateFile`（当前 `模板/周计划模板`，种子文件已创建）：＋按钮新建时**实时读取**该文件内容作为新看板初始内容
- 缺失/留空 → Notice 提示 + 回退内置 `generateEmptyWeeklyMarkdown()`（parser.ts 硬编码空白周计划，含角色骨架/表头/四维磨刀，数据全空）
- 模板文件被排除出下拉框扫描（即使放在周记文件夹内也不会被当成一周）
- 设置入口：设置 → 多工作台 → "新建看板模板文件"（Enter/blur 提交的文本框，路径规则同工作台路径：库内相对、不带 .md）

### 2.5 已移除的功能
- 上游"日历点击切换工作台"联动已删除
- 保留：直接打开带 `dashboard: true` 且已注册/在周记文件夹内的 md，会自动渲染为工作台（main.ts `file-open` 监听 + `renderWorkspaceInLeaf`）——**用户对此行为有疑问，去留待定**（见 §5）

## 3. 数据文件现状

- `dashboard.md`：主工作台（完整周计划数据）
- `周记/第1周.md`：第一份周记（内置模板创建）
- `模板/周计划模板.md`：新建看板模板种子（= 内置空白周计划，可自由编辑，每次新建实时读取）
- vault 根 `2.md` / `3.md`：早期测试工作台（注册表遗留，可清理）
- data.json 关键键：`dashboardFile`、`workspaceFiles[]`、`workspaceNames[]`、`workspaceFolder: "周记"`、`workspaceTemplateFile: "模板/周计划模板"`
- 周计划表 markdown 结构示例（`^` 使"本周要务"整列合并为一个大任务格）：

```markdown
| **周 计 划** | > | > |  | 星期日 | 星期一 | ... | 星期六 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 角色 | ➤ | 目标 | 本周要务 | **本日要务** | > | ... | > |
| 个体：个人 | ➤ |  |  |  |  | ... |  |
| 伴侣 | ➤ |  | ^ |  |  | ... |  |
```

## 4. 构建与部署流程（必读）

```bash
# 1. 编辑 C:\work\apex-dashboard-src 下源码
# 2. 同步到干净构建目录（Git Bash 中 robocopy 参数用双斜杠 //）
robocopy "C:\work\apex-dashboard-src" "C:\work\apex-dashboard-build" //E //XD node_modules .git //R:0 //W:0 //NFL //NDL
# 3. 构建（= tsc -noEmit -skipLibCheck && node esbuild.config.mjs production）
cd /c/work/apex-dashboard-build && npm run build
# 4. 用 PowerShell 部署（勿用 cp/robocopy 直接部署，原因见下）
powershell -Command "Copy-Item 'C:\work\apex-dashboard-build\main.js' 'C:\work\HuNote\OpenKeep笔记\.obsidian\plugins\apex-dashboard\main.js' -Force"
# styles.css 有改动时同样部署
```
- 部署后需**重启 Obsidian 或重载插件**才生效

### ⚠️ 环境坑（多次踩过，务必遵守）
1. **TSD 文件损坏**：本机加密软件会给某些工具写过的文件套 `%TSD-Header-###%` 二进制壳（`file` 命令显示 `data`）。tsc 能拦住 .ts 损坏（TS1490 报错），但 **styles.css 不经过构建管线，损坏会静默部署 → 整个看板排版崩坏**（已发生过两次）。
   - 对策：**每次写完文件用 `file` 验证是否仍为文本**；修复流程 = `git show HEAD:文件` 提取干净基线 → 重新应用改动 → PowerShell Copy-Item 部署（PowerShell 写入实测安全）。
2. **Git Bash**：robocopy/mklink 参数需 `//` 前缀；bash heredoc 中 `\\` 会被吃成 `\`（脚本里避免反斜杠转义，必要时用 python `chr()` 码点构造）；中文经 heredoc 传输正常，但控制台打印中文会显示乱码（不代表内容损坏）。
3. **esbuild 产物为 ASCII**：main.js 中中文全部转成 `\uXXXX` 转义，直接 grep 中文原文搜不到；需检索转义形式（可用 python `chr()` 拼串验证）。
4. 编辑工具编辑后偶发文件被环境改动（行尾/mtime 变化），依赖上下文的编辑前先重读文件相关段落。

## 5. 待决事项 / 已知行为

- **点击周记 md 自动变工作台**：由 main.ts `file-open` 监听触发（`frontmatter?.dashboard && (workspaceFiles.includes || isFolderWorkspace)`）。用户已询问原因，方案待定：① 去掉文件夹内文件的自动转换（周记只能从横幅下拉切换）② 保留现状 ③ 不改代码——删除某个文件 frontmatter 里的 `dashboard: true` 即可单独关闭该文件的自动转换（已验证全代码库仅此一处使用该标记）
- 切换过的周记文件会累积进 `workspaceFiles` 注册表（data.json 变长属预期行为）
- 模板文件每次新建时实时读取；已创建的周文件不受模板后续修改影响
- 「下一个/上一个工作台」命令在文件夹模式下按下拉列表顺序循环

## 6. 上游架构速览（改动涉及的部分）

- 视图与同步：`view.ts` DashboardView + SyncEngine 按当前工作台文件读写；`switchWorkspace` → `runWorkspaceOp`（串行队列）→ `repointAllViews`
- 设置流：`loadSettings`（DEFAULT_SETTINGS 展开 + `migrateWorkspaces` 校验注册表）→ `saveData`；新增设置键需同时改 `types.ts` 的 interface 与 DEFAULT_SETTINGS
- 横幅每次渲染都会重建 workspace switcher（view.ts 中调用 `renderWorkspaceSwitcher`）
- i18n：`src/i18n.ts` 内 en/zh 两个字典，键名 `settings.*` / `workspace.*`
