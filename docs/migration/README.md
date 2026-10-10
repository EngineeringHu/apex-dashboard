# 2026-10-02 项目迁移

最新 138 个 src 文件逐一通过 SHA-256 校验；插件功能源码未改动。最新源码来自笔记库 .apex-development，旧 Windows 源码与目标 Git 工作树内容（忽略换行符）一致，旧压缩包源码亦一致。

当前源码与依赖仅在本项目；笔记库保留已部署插件和独立恢复工具。node_modules 在 WSL 通过 npm ci 安装，不含指向 Windows 的依赖链接。

原 Windows Git 有部分损坏对象和 pack（迁移前已存在）。目标 Git 本身完整，旧 stash 已恢复到 refs/archive/windows/stash，其他可恢复对象保存在 refs/archive/windows/recovered/*。无法解码的旧 Git 数据集中保存在 unreadable-legacy-git.zip，及 git-recovery.json；不作为当前构建依赖，也没有覆盖有效源码。它是旧历史的恢复材料，非第二套源码。windows-inventory.json 保留导出时各文件哈希。

已验证：npm test（含类型检查和完整构建）、13 组 test:upstream、独立恢复工具、旧 Worker 格式兼容、Git fsck。Obsidian 应用内回归结果见项目 test-output。
