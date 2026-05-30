#!/usr/bin/env bash
# 一处全切：把所有走网关的工具的 Gemini 后端切到 google 或 relay(中转站)。
# 用法: bash scripts/switch-backend.sh google | relay
# 即时生效（网关 3 秒内重读 config，无需重启）。逐工具仍可用 X-Xiaoer-Backend 头覆盖。
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CFG="$ROOT/config.json"
B="${1:-}"
[ "$B" = "google" ] || [ "$B" = "relay" ] || { echo "用法: switch-backend.sh google|relay"; exit 1; }
# 用 node 改 JSON（保格式安全）
node -e "const f='$CFG';const c=require(f);c.geminiBackend='$B';require('fs').writeFileSync(f,JSON.stringify(c,null,2)+'\n');console.log('✅ 全局后端 →',c.geminiBackend);"
