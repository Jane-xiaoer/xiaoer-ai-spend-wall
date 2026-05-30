# CLAUDE.md — 小耳 AI 花销墙 (xiaoer-ai-pay)

改本项目前必读。

## 是什么
菜单栏 👂 仪表盘，看 Claude/Codex/Gemini 三家本月用量+花费。供应商插件式。

## 形态（v2）
Dock 👂 小程序 `/Applications/小耳花销墙.app` 点击 → `hs -c "xiaoerPay.panel()"` → hs.webview 富面板（`panel/index.html`+`panel.js`）。也可点菜单栏 👂。**无快捷键**（Jane 明确不要）。重建 app：`scripts/install-dock-app.sh`。

## provider 统一输出接口（改/加 provider 必须照此字段名）
```js
{
  name, period,                    // "Claude" / "2026-05"
  totalTokens, costUSD, costNote,  // costNote: "订阅折算" | "真实"
  limit: { type, pct, resetsAt },  // type: "plan"|"spend_cap"|"none"; pct: 0~1 或 null
  byTool,                          // 仅 gemini: {tool: tokens}; 否则 null
  color, detail,                   // color 由 lib/color.js; detail=URL 或 null
  stats: {                         // ← v2 富数据，panel.js 读这个
    byTime: { today, yesterday, week, month },  // 各 {cost, tokens}（lib/timebuckets.js）
    windows: [ {name, pct, resetsAt} ],         // codex: 5h+周窗；其它[]
    current: { cost, projectedCost, remainingMinutes, endTime } | null,  // claude 当前块
  },
  error?,
}
```

## 数据来源（各 provider 怎么拿）
- **claude.js** → `ccusage monthly/daily/blocks --json **--offline**`（已装 v18）。取 `monthly[].month === period` 行的 `totalCost/totalTokens`。
  - 🔴 **必须带 `--offline`**：不带的话 ccusage 每次联网拉 LiteLLM 价目表，走 Clash 代理 ~120s/次 ×3 命令 ≈ 160s → 面板转圈半天不更新（2026-05-27 实测：加 --offline 后 119s→2.9s，整个 refresh 160s→5s）。订阅制只看折算用量，缓存价格够用。
- **codex.js** → 解析 `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`。**必须流式逐行读**（文件可达 760MB，超 V8 字符串上限，整读会 `Invalid string length`）。每会话取最后一条 `payload.type==="token_count"` 的 `info.total_token_usage`（会话内累计）；月聚合=各会话求和；`rate_limits.primary.{used_percent,resets_at}` → 额度%与重置。
- **gemini.js** → 读 `data/gemini-usage.jsonl`（计量代理产出），按 `period` 过滤聚合，`spend_cap` 占比 = costUSD / `config.geminiSpendCapUSD`。
  - **按项目归并**：`byTool`（原始标签，分账/测试依赖它，**别动**）之外另出 `byProject`——`canonTool()` 按 `PROJECT_RULES` 把原始标签合并成项目（🔍小耳找到/🔖收藏/💬问问/🏷️重命名/🌐翻译/🎙️PAI），所有 *-test/bench/harden/debug 折进「🧪 测试·其他」。**面板(panel.js)渲染 `byProject`**。加新工具映射/改图标 → 改 `PROJECT_RULES` 一行正则即可。

## 关键常量
- 代理端口：`config.json` 的 `geminiMeterPort = 19877`
- launchd label：`com.xiaoer.gemini-meter`
- 费率表：`lib/pricing.js`（USD/1M tokens，调价改这里）
- node 绝对路径（plist/menubar 用）：`$(command -v node)`

## 计量代理坑
- launchd **不继承 shell env** → `HTTPS_PROXY` 必须写进 plist（本机 Gemini 走 Clash 7890）
- 代理零依赖手写 HTTP CONNECT 隧道（undici 不可 import）；`NO_PROXY` 含 127.0.0.1 别让本地回环走代理
- 改 server.js 后：`launchctl unload && load` 重启守护

## 改 menubar.lua 后
`hs -c "hs.reload()"`（reload 会断 IPC，命令返回非零正常）。

## 已接入计量的工具
- **xiaoer-ask**：私有 `.env` 的 `XIAOER_METER_BASE` 开关，lua 注入 `window.XIAOER_METER_BASE`，公开默认官方直连。

## 测试
`npm test`（node:test 内置，零依赖）。纯函数全覆盖；代理/真实数据走手动联调。
