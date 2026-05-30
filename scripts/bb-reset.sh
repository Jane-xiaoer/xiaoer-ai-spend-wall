#!/usr/bin/env bash
# bb-browser 僵死急救：CDP 命令通道卡死（open/eval 一直超时但 status 说"运行中"）时用。
# 彻底冷重启：杀光 Brave + bb-browser → 清 monitor → 冷启验活。
# 登录态在 Brave 磁盘 profile 里，杀进程不会登出，冷启后照样登录。
set -u
echo "→ 杀 bb-browser + Brave …"
pkill -9 -f "bb-browser" 2>/dev/null
pkill -9 -f "Brave Browser.app" 2>/dev/null
sleep 3
rm -f ~/.bb-browser/monitor.* 2>/dev/null
echo "→ 冷启验活 (example.com) …"
unset SSL_CERT_FILE
if bb-browser open "https://example.com" >/dev/null 2>&1; then
  title=$(bb-browser eval "document.title" 2>/dev/null)
  bb-browser close >/dev/null 2>&1
  echo "✅ bb-browser 已恢复（验活: $title）"
else
  echo "❌ 冷启仍失败，检查：1) playwright 有没有又被配去抢 Brave  2) ~/.bb-browser/browser/cdp-port"
  exit 1
fi
