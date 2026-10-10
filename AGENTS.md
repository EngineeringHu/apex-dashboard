# Apex Dashboard 开发约定

交流语言：中文。此目录是唯一维护的源码与依赖位置；禁止恢复笔记库内的 .apex-development 或旧 Windows 源码副本。

保留原周计划表（合并单元格、任务编辑）、文件夹工作台、模板、命名、看板样式，以及 secure.5 全部加密功能。运行源码在 src/，统一依赖在 node_modules/；请阅读 README.md 和 docs/ 中的设计及回归记录。

在 WSL 项目根目录运行 npm run build、npm test；改动相关功能时运行对应 test: 脚本。构建只写 dist/，不自动修改笔记库。PowerShell 执行 scripts/deploy.ps1 -Vault <明确路径> 部署四个运行文件和独立恢复工具，保留 data.json、pomodoro.json、密钥和所有周记。部署后校验 UTF-8、无 %TSD-Header 包装、文件哈希，再重载插件。

Windows 本机加密软件可能损坏文件，尤其从 Windows 直接读取到 WSL 时。迁移/部署须校验文本和 SHA-256，不要用损坏旧文件覆盖有效源码。不要从旧 main.js 反推代码。

真实 Obsidian 测试只使用合成测试文件与独立密码，运行后清理并校验真实笔记哈希；不可更改用户密码。已有真实 keyring 时禁止运行要求无 keyring 的 credentials 测试。应用内测试使用 scripts/obsidian-cli.cjs，把报告写到项目 test-output，不得重建笔记库中的开发目录。

保护用户正在编辑的数据；全局开关与密码轮换的恢复日志不可随意删除。旧 Apex 备份不在加密范围内。不要自动提交或推送 Git；迁移保留的 refs/archive/windows/stash 为历史暂存，不能覆盖当前源码。
