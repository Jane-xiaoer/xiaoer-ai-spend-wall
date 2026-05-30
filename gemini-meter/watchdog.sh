#!/bin/bash
# gemini-meter 自愈 watchdog —— 探测 19877，挂了就重新 bootstrap 拉起。
# 由 com.xiaoer.gemini-meter-watchdog（StartInterval=120s）周期调用。
# 背景：plist 自带 KeepAlive 只能在进程崩溃时重启，挡不住整个服务被
# launchctl bootout 卸载的情况（2026-05-23 小耳问问就栽在这）。
set -u
LABEL="com.xiaoer.gemini-meter"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node || true)"
if [[ -n "${NODE}" ]]; then
  PORT="$("${NODE}" -p "require('${PROJECT_DIR}/config.json').geminiMeterPort || 19877" 2>/dev/null || echo 19877)"
else
  PORT=19877
fi
TS() { date '+%Y-%m-%d %H:%M:%S'; }

# 端口已在监听 → 健康，直接退出
if /usr/sbin/lsof -nP -iTCP:${PORT} -sTCP:LISTEN >/dev/null 2>&1; then
  exit 0
fi

echo "[$(TS)] 19877 down → re-bootstrapping ${LABEL}"
/bin/launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null
/bin/launchctl bootstrap "gui/$(id -u)" "${PLIST}" 2>&1
sleep 2
if /usr/sbin/lsof -nP -iTCP:${PORT} -sTCP:LISTEN >/dev/null 2>&1; then
  echo "[$(TS)] 恢复成功"
else
  echo "[$(TS)] 重启后仍未监听，需人工排查"
fi
