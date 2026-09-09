#!/usr/bin/env bash
# 将构建产物拷到 Obsidian Vault 的 Apex Dashboard 插件目录
# 用法：npm run build && ./deploy-to-vault.sh

VAULT_PLUGIN="/c/work/HuNote/OpenKeep笔记/.obsidian/plugins/apex-dashboard"

cp main.js styles.css "$VAULT_PLUGIN/"
echo "已部署到：$VAULT_PLUGIN"
echo "请在 Obsidian 中执行：Ctrl+P → 重新加载应用"
