# Apex Dashboard 自定义版

唯一开发目录：`/home/huyuhao/workStation/02ownWork/obsidian-plugin/apex-dashboard`。Windows 可通过 `\\wsl.localhost\Ubuntu\home\huyuhao\workStation\02ownWork\obsidian-plugin\apex-dashboard` 访问。当前版本 `2.2.1-secure.5`，保留原周计划表、模板、文件夹切换及加密功能。

在 Ubuntu / WSL 终端执行：

```bash
cd /home/huyuhao/workStation/02ownWork/obsidian-plugin/apex-dashboard
npm ci
npm run build
npm test
npm run test:upstream
```

Node.js 20+；当前已使用 Node.js 24 验证。依赖只安装在本项目的 `node_modules`，通过 `package-lock.json` 固定版本。不要把 Windows 的 node_modules 复制到 Linux。之后日常构建不需要联网。源码是 `src/`，构建目录是 `dist/`，源码与构建都不依赖任何笔记库。

在 Windows PowerShell 部署到指定笔记库（先在 WSL 构建）。部分 Windows 策略禁止直接执行 UNC 脚本，以下方式临时复制部署脚本到本地，执行完即删除，不改变执行策略：

```powershell
$project = '\\wsl.localhost\Ubuntu\home\huyuhao\workStation\02ownWork\obsidian-plugin\apex-dashboard'
$deploy = Join-Path $env:TEMP ('apex-deploy-' + [guid]::NewGuid() + '.ps1')
Copy-Item -LiteralPath (Join-Path $project 'scripts/deploy.ps1') -Destination $deploy
try { & $deploy -ProjectRoot $project -Vault 'C:\work\HuNote\OpenKeep笔记' }
finally { Remove-Item -LiteralPath $deploy }
```

部署四个插件运行文件，并更新库内独立解密/Git 检查工具；不会替换 data.json、密钥或周记。然后重载 Apex 插件。不能把 Linux node_modules 当成 Windows 开发依赖，Windows 上运行插件无需它。

工作台覆盖保存前的 Markdown 副本放在笔记库根目录 `.dashboard-backup/`。插件启动和新增副本后会清理：每个文件名最多保留最近 2 份，整个目录最多保留 5 份；其他文件不受影响。设置页的“定时备份”位于插件目录 `backups/`，使用独立的开关和保留份数。

- `src/secure/`：加密、统一密码、全局开关、转换恢复及原看板集成。
- `tools/`：独立恢复与 Git 检查工具的源文件；发行文件生成在 `dist/tools/`。
- `scripts/`：测试、诊断、部署脚本。应用内测试须使用 Windows node.exe 执行 obsidian-cli.cjs，设置 APEX_VAULT 为笔记库路径；报告输出到项目 test-output，不再写进笔记库。
- `docs/`：使用说明、方案、格式规范和迁移记录。
- `rollback/`：历史可回退版本；`test-output/`：原回归结果。两者仅留本地、不提交。
- `docs/migration/`：逐文件迁移哈希及旧 Git 恢复说明，供核对历史。

周计划表新增单元格待办事项卡片、表内任务拖拽和任务日记关联，操作与兼容说明见 [周计划待办卡片使用说明](docs/周计划待办卡片使用说明.md)。回归测试：npm run test:weekly-todo。

原生搜索与 Dataview 在关闭加密时读取普通 Markdown；开启时按分区验证密码。加密范围当前是“周记”目录直接子文件。统一密码设置后新建无需输入密码，展开仍需验证。细节见 docs/周记加密使用说明.md。

当前项目未自动提交、推送或发布。社区原版更新会覆盖定制功能，更新时应在此合并源码并重新构建。
