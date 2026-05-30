# 小耳 AI 花销墙 (xiaoer-ai-pay) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一个 Hammerspoon 菜单栏 👂 仪表盘，一眼看清 Claude / Codex / Gemini 三家本月用量与折算/真实花费。

**Architecture:** 供应商插件式。每个 provider 是独立 Node 模块，吐统一对象 `{name, period, totalTokens, costUSD, costNote, limit, byTool, color, detail}`。`refresh.js` 跑所有 provider → 写 `data/state.json`；`menubar.lua` 读 state 渲染 👂 下拉。Gemini 真实用量靠常驻本地代理 `gemini-meter/server.js` 逐请求记 JSONL。加新家（Hermes）= 丢一个 provider 模块，不动核心。

**Tech Stack:** Node.js 22 (ESM, 内置 `node:test` 测试器，零测试依赖)、Hammerspoon Lua、launchd 守护、ccusage(已装) for Claude、解析 codex rollout jsonl for Codex。

---

## File Structure

```
~/projects/xiaoer-ai-pay/
├── package.json                 # type:module, test 脚本
├── config.json                  # 端口/阈值/spend cap/codex 模型
├── lib/
│   ├── pricing.js               # 费率表 + 成本计算 (gpt-5.5 / gemini / 兜底)
│   └── color.js                 # pct/cost → green|yellow|red
├── providers/
│   ├── claude.js                # ccusage monthly --json → 标准对象
│   ├── codex.js                 # 解析 ~/.codex/sessions/**/rollout-*.jsonl
│   └── gemini.js                # 读 data/gemini-usage.jsonl
├── gemini-meter/
│   ├── server.js                # 本地代理 127.0.0.1:PORT
│   └── com.xiaoer.gemini-meter.plist
├── refresh.js                   # 跑所有 provider → data/state.json
├── menubar.lua                  # hs.menubar 👂（由 ~/.hammerspoon/init.lua dofile）
├── data/                        # gitignore：gemini-usage.jsonl, state.json
└── test/
    ├── fixtures/
    │   ├── ccusage-monthly.json
    │   └── codex-rollout.jsonl
    ├── pricing.test.js
    ├── color.test.js
    ├── claude.test.js
    ├── codex.test.js
    ├── gemini.test.js
    └── proxy.test.js
```

**标准 provider 输出接口（全程一致，后续任务都按此字段名）：**

```js
{
  name: "Claude",            // 显示名
  period: "2026-05",          // 当月
  totalTokens: 3250223773,
  costUSD: 2297.42,           // claude/codex=按API价折算; gemini=真实
  costNote: "订阅折算",        // "订阅折算" | "真实"
  limit: { type: "plan", pct: 0.04, resetsAt: 1779006790 }, // type: plan|spend_cap|none
  byTool: null,               // 仅 gemini 有: { "xiaoer-ask": 50000 }
  color: "green",             // green|yellow|red
  detail: "https://ai.studio/spend" // 点击行打开; 可 null
}
```

---

## Task 1: 项目骨架 + 测试器跑通

**Files:**
- Create: `~/projects/xiaoer-ai-pay/package.json`
- Create: `~/projects/xiaoer-ai-pay/config.json`
- Create: `~/projects/xiaoer-ai-pay/test/smoke.test.js`

- [ ] **Step 1: 写 package.json**

```json
{
  "name": "xiaoer-ai-pay",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "scripts": {
    "test": "node --test",
    "refresh": "node refresh.js",
    "meter": "node gemini-meter/server.js"
  }
}
```

- [ ] **Step 2: 写 config.json**

```json
{
  "geminiMeterPort": 19877,
  "geminiSpendCapUSD": 50,
  "codexModel": "gpt-5.5",
  "thresholds": { "yellow": 0.5, "red": 0.85 },
  "claudeDetailUrl": "https://claude.ai/settings/usage",
  "codexDetailUrl": "https://platform.openai.com/usage",
  "geminiDetailUrl": "https://ai.studio/spend"
}
```

- [ ] **Step 3: 写冒烟测试 test/smoke.test.js**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("config.json 可解析且含端口", async () => {
  const cfg = JSON.parse(await readFile(new URL("../config.json", import.meta.url)));
  assert.ok(cfg.geminiMeterPort > 0);
});
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd ~/projects/xiaoer-ai-pay && npm test`
Expected: PASS（1 test passing）

- [ ] **Step 5: 提交**

```bash
cd ~/projects/xiaoer-ai-pay && git add package.json config.json test/smoke.test.js && \
git commit -m "chore: 项目骨架 + node:test 跑通"
```

---

## Task 2: 颜色助手 lib/color.js

**Files:**
- Create: `~/projects/xiaoer-ai-pay/lib/color.js`
- Test: `~/projects/xiaoer-ai-pay/test/color.test.js`

- [ ] **Step 1: 写失败测试 test/color.test.js**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { colorFor } from "../lib/color.js";

const th = { yellow: 0.5, red: 0.85 };

test("pct 低于 yellow → green", () => assert.equal(colorFor(0.2, th), "green"));
test("pct 在 yellow 与 red 之间 → yellow", () => assert.equal(colorFor(0.6, th), "yellow"));
test("pct 超 red → red", () => assert.equal(colorFor(0.9, th), "red"));
test("pct 为 null → green（无上限信息时不报警）", () => assert.equal(colorFor(null, th), "green"));
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd ~/projects/xiaoer-ai-pay && npm test -- test/color.test.js`
Expected: FAIL（Cannot find module '../lib/color.js'）

- [ ] **Step 3: 写实现 lib/color.js**

```js
export function colorFor(pct, thresholds) {
  if (pct == null) return "green";
  if (pct >= thresholds.red) return "red";
  if (pct >= thresholds.yellow) return "yellow";
  return "green";
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd ~/projects/xiaoer-ai-pay && npm test -- test/color.test.js`
Expected: PASS（4 tests）

- [ ] **Step 5: 提交**

```bash
cd ~/projects/xiaoer-ai-pay && git add lib/color.js test/color.test.js && \
git commit -m "feat: 颜色阈值助手 colorFor"
```

---

## Task 3: 费率与成本计算 lib/pricing.js

价格单位 = USD / 1 token（= 每百万价 ÷ 1e6）。Claude 不用此模块（ccusage 已给 totalCost）；Codex(gpt-5.5) 与 Gemini 用。费率为 2026-05 兜底值，可后续手更。

**Files:**
- Create: `~/projects/xiaoer-ai-pay/lib/pricing.js`
- Test: `~/projects/xiaoer-ai-pay/test/pricing.test.js`

- [ ] **Step 1: 写失败测试 test/pricing.test.js**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { costForGemini, costForCodex } from "../lib/pricing.js";

test("gemini-2.5-flash 成本：1M 输入 + 1M 输出", () => {
  // gemini-2.5-flash 兜底价: in $0.30/M, out $2.50/M
  const c = costForGemini("gemini-2.5-flash", { promptTokens: 1_000_000, candidatesTokens: 1_000_000, thoughtsTokens: 0 });
  assert.ok(Math.abs(c - (0.30 + 2.50)) < 1e-6);
});

test("gemini 未知模型 → 用 flash 兜底，不抛错", () => {
  const c = costForGemini("gemini-unknown-x", { promptTokens: 1_000_000, candidatesTokens: 0, thoughtsTokens: 0 });
  assert.ok(Math.abs(c - 0.30) < 1e-6);
});

test("codex gpt-5.5 成本：input + output（cached 单独价）", () => {
  // gpt-5.5 兜底价: in $1.25/M, cachedIn $0.125/M, out $10/M
  const c = costForCodex("gpt-5.5", { input_tokens: 1_000_000, cached_input_tokens: 0, output_tokens: 1_000_000 });
  assert.ok(Math.abs(c - (1.25 + 10)) < 1e-6);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd ~/projects/xiaoer-ai-pay && npm test -- test/pricing.test.js`
Expected: FAIL（Cannot find module）

- [ ] **Step 3: 写实现 lib/pricing.js**

```js
// USD per 1M tokens（2026-05 兜底价，可手更）
const GEMINI = {
  "gemini-2.5-flash": { in: 0.30, out: 2.50 },
  "gemini-2.5-pro":   { in: 1.25, out: 10.0 },
};
const GEMINI_FALLBACK = GEMINI["gemini-2.5-flash"];

const CODEX = {
  "gpt-5.5": { in: 1.25, cachedIn: 0.125, out: 10.0 },
};
const CODEX_FALLBACK = CODEX["gpt-5.5"];

const per = (tokens, rate) => (tokens / 1_000_000) * rate;

export function costForGemini(model, u) {
  const r = GEMINI[model] || GEMINI_FALLBACK;
  // thoughts(思考) 计入 output 价
  return per(u.promptTokens || 0, r.in) + per((u.candidatesTokens || 0) + (u.thoughtsTokens || 0), r.out);
}

export function costForCodex(model, u) {
  const r = CODEX[model] || CODEX_FALLBACK;
  const billedInput = (u.input_tokens || 0) - (u.cached_input_tokens || 0);
  return per(Math.max(0, billedInput), r.in)
       + per(u.cached_input_tokens || 0, r.cachedIn)
       + per(u.output_tokens || 0, r.out);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd ~/projects/xiaoer-ai-pay && npm test -- test/pricing.test.js`
Expected: PASS（3 tests）

- [ ] **Step 5: 提交**

```bash
cd ~/projects/xiaoer-ai-pay && git add lib/pricing.js test/pricing.test.js && \
git commit -m "feat: Gemini/Codex 成本计算（兜底费率）"
```

---

## Task 4: Claude provider（解析 ccusage）

ccusage `monthly --json` 真实结构（已 captured）：
```json
{ "monthly": [ { "month": "2026-05", "totalTokens": 3250223773, "totalCost": 2297.42, "modelsUsed": [...] } ], "totals": {...} }
```
provider 接收「已解析的 ccusage 对象」（注入式，便于测试），取当月行 → 标准对象。

**Files:**
- Create: `~/projects/xiaoer-ai-pay/providers/claude.js`
- Create: `~/projects/xiaoer-ai-pay/test/fixtures/ccusage-monthly.json`
- Test: `~/projects/xiaoer-ai-pay/test/claude.test.js`

- [ ] **Step 1: 造 fixture（真实截取） test/fixtures/ccusage-monthly.json**

```json
{
  "monthly": [
    { "month": "2026-04", "totalTokens": 1053800000, "totalCost": 741.77, "modelsUsed": ["claude-opus-4-7"] },
    { "month": "2026-05", "totalTokens": 3250223773, "totalCost": 2297.42, "modelsUsed": ["claude-opus-4-7","claude-sonnet-4-6"] }
  ],
  "totals": { "totalCost": 3099.15 }
}
```

- [ ] **Step 2: 写失败测试 test/claude.test.js**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fromCcusage } from "../providers/claude.js";

test("取当月行并映射为标准对象", async () => {
  const raw = JSON.parse(await readFile(new URL("./fixtures/ccusage-monthly.json", import.meta.url)));
  const cfg = { thresholds: { yellow: 0.5, red: 0.85 }, claudeDetailUrl: "https://x" };
  const r = fromCcusage(raw, "2026-05", cfg);
  assert.equal(r.name, "Claude");
  assert.equal(r.period, "2026-05");
  assert.equal(r.totalTokens, 3250223773);
  assert.ok(Math.abs(r.costUSD - 2297.42) < 0.01);
  assert.equal(r.costNote, "订阅折算");
  assert.equal(r.limit.type, "plan");
  assert.equal(r.color, "green"); // plan 无 pct → green
  assert.equal(r.detail, "https://x");
});

test("当月无数据 → 0 且不抛错", async () => {
  const r = fromCcusage({ monthly: [] }, "2026-05", { thresholds: { yellow: 0.5, red: 0.85 } });
  assert.equal(r.totalTokens, 0);
  assert.equal(r.costUSD, 0);
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `cd ~/projects/xiaoer-ai-pay && npm test -- test/claude.test.js`
Expected: FAIL（Cannot find module '../providers/claude.js'）

- [ ] **Step 4: 写实现 providers/claude.js**

```js
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { colorFor } from "../lib/color.js";
const pexec = promisify(execFile);

export function fromCcusage(raw, period, cfg) {
  const row = (raw.monthly || []).find((m) => m.month === period) || {};
  return {
    name: "Claude",
    period,
    totalTokens: row.totalTokens || 0,
    costUSD: Math.round((row.totalCost || 0) * 100) / 100,
    costNote: "订阅折算",
    limit: { type: "plan", pct: null, resetsAt: null },
    byTool: null,
    color: colorFor(null, cfg.thresholds),
    detail: cfg.claudeDetailUrl || null,
  };
}

export async function getClaude(period, cfg) {
  try {
    const { stdout } = await pexec("ccusage", ["monthly", "--json"], { maxBuffer: 64 * 1024 * 1024 });
    return fromCcusage(JSON.parse(stdout), period, cfg);
  } catch (e) {
    return { name: "Claude", period, totalTokens: 0, costUSD: 0, costNote: "订阅折算",
      limit: { type: "plan", pct: null, resetsAt: null }, byTool: null, color: "green",
      detail: cfg.claudeDetailUrl || null, error: String(e.message || e) };
  }
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd ~/projects/xiaoer-ai-pay && npm test -- test/claude.test.js`
Expected: PASS（2 tests）

- [ ] **Step 6: 真实联调（手动）**

Run: `cd ~/projects/xiaoer-ai-pay && node -e "import('./providers/claude.js').then(m=>m.getClaude('2026-05',JSON.parse(require('fs').readFileSync('config.json'))).then(r=>console.log(r)))"`
Expected: 打印含真实 totalTokens / costUSD 的 Claude 对象

- [ ] **Step 7: 提交**

```bash
cd ~/projects/xiaoer-ai-pay && git add providers/claude.js test/claude.test.js test/fixtures/ccusage-monthly.json && \
git commit -m "feat: Claude provider（解析 ccusage monthly --json）"
```

---

## Task 5: Codex provider（解析 rollout jsonl）

Codex 会话日志在 `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`。每行 `event_msg` 中 `payload.type==="token_count"` 的 `payload.info.total_token_usage` 是**会话内累计**（取该会话最后一条即会话总量），`payload.rate_limits.primary` 给 `{used_percent, resets_at}`。月聚合 = 当月每个 session 的最后 total_token_usage 求和。

真实结构（已 captured）：
```json
{"timestamp":"2026-05-17T04:46:57Z","type":"event_msg","payload":{"type":"token_count",
 "info":{"total_token_usage":{"input_tokens":4303816,"cached_input_tokens":3682304,"output_tokens":25232,"reasoning_output_tokens":8540,"total_tokens":4329048}},
 "rate_limits":{"primary":{"used_percent":4.0,"window_minutes":300,"resets_at":1779006790}}}}
```

**Files:**
- Create: `~/projects/xiaoer-ai-pay/providers/codex.js`
- Create: `~/projects/xiaoer-ai-pay/test/fixtures/codex-rollout.jsonl`
- Test: `~/projects/xiaoer-ai-pay/test/codex.test.js`

- [ ] **Step 1: 造 fixture test/fixtures/codex-rollout.jsonl（两条 token_count，取最后一条为会话总量）**

```
{"timestamp":"2026-05-17T03:00:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1000,"cached_input_tokens":0,"output_tokens":500,"reasoning_output_tokens":0,"total_tokens":1500}},"rate_limits":{"primary":{"used_percent":2.0,"window_minutes":300,"resets_at":1779000000}}}}
{"timestamp":"2026-05-17T04:46:57Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":2000,"cached_input_tokens":1000,"output_tokens":800,"reasoning_output_tokens":200,"total_tokens":4000}},"rate_limits":{"primary":{"used_percent":4.0,"window_minutes":300,"resets_at":1779006790}}}}
```

- [ ] **Step 2: 写失败测试 test/codex.test.js**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { sessionTotals, aggregate } from "../providers/codex.js";

const FIXTURE = new URL("./fixtures/codex-rollout.jsonl", import.meta.url).pathname;

test("sessionTotals 取会话最后一条 token_count + rate_limit", async () => {
  const s = await sessionTotals(FIXTURE);
  assert.equal(s.usage.total_tokens, 4000);
  assert.equal(s.usage.input_tokens, 2000);
  assert.equal(s.usage.cached_input_tokens, 1000);
  assert.equal(s.ratePct, 0.04); // used_percent 4.0 → 0.04
  assert.equal(s.resetsAt, 1779006790);
});

test("aggregate 汇总多个会话 totals + 取最新 rate", () => {
  const sessions = [
    { usage: { input_tokens: 2000, cached_input_tokens: 1000, output_tokens: 800, total_tokens: 4000 }, ratePct: 0.04, resetsAt: 1779006790, mtime: 200 },
    { usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 50, total_tokens: 150 }, ratePct: 0.01, resetsAt: 1778000000, mtime: 100 },
  ];
  const cfg = { thresholds: { yellow: 0.5, red: 0.85 }, codexModel: "gpt-5.5", codexDetailUrl: "https://c" };
  const r = aggregate(sessions, "2026-05", cfg);
  assert.equal(r.name, "Codex");
  assert.equal(r.totalTokens, 4150);
  assert.equal(r.limit.type, "plan");
  assert.equal(r.limit.pct, 0.04);          // 取 mtime 最新会话
  assert.equal(r.limit.resetsAt, 1779006790);
  assert.equal(r.costNote, "订阅折算");
  assert.ok(r.costUSD > 0);
  assert.equal(r.color, "green");
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `cd ~/projects/xiaoer-ai-pay && npm test -- test/codex.test.js`
Expected: FAIL（Cannot find module）

- [ ] **Step 4: 写实现 providers/codex.js**

```js
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { colorFor } from "../lib/color.js";
import { costForCodex } from "../lib/pricing.js";

const SESSIONS_DIR = join(homedir(), ".codex", "sessions");

// 解析单个 rollout 文件：返回最后一条 token_count 的累计用量 + 最新 rate
export async function sessionTotals(file) {
  const text = await readFile(file, "utf8");
  let last = null;
  for (const line of text.split("\n")) {
    if (!line.includes("token_count")) continue;
    let obj; try { obj = JSON.parse(line); } catch { continue; }
    if (obj?.payload?.type === "token_count") last = obj;
  }
  if (!last) return null;
  const info = last.payload.info || {};
  const rate = last.payload.rate_limits?.primary || {};
  return {
    usage: info.total_token_usage || {},
    ratePct: rate.used_percent != null ? rate.used_percent / 100 : null,
    resetsAt: rate.resets_at ?? null,
  };
}

// 列出当月（YYYY-MM）的 rollout 文件
async function listMonthFiles(period) {
  const [y, m] = period.split("-");
  const dir = join(SESSIONS_DIR, y, m);
  const out = [];
  let days;
  try { days = await readdir(dir); } catch { return out; }
  for (const d of days) {
    let files;
    try { files = await readdir(join(dir, d)); } catch { continue; }
    for (const f of files) if (f.startsWith("rollout-") && f.endsWith(".jsonl")) out.push(join(dir, d, f));
  }
  return out;
}

export function aggregate(sessions, period, cfg) {
  const sum = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  for (const s of sessions) {
    const u = s.usage || {};
    sum.input_tokens += u.input_tokens || 0;
    sum.cached_input_tokens += u.cached_input_tokens || 0;
    sum.output_tokens += u.output_tokens || 0;
    sum.total_tokens += u.total_tokens || 0;
  }
  const latest = [...sessions].sort((a, b) => (b.mtime || 0) - (a.mtime || 0))[0];
  const pct = latest?.ratePct ?? null;
  return {
    name: "Codex",
    period,
    totalTokens: sum.total_tokens,
    costUSD: Math.round(costForCodex(cfg.codexModel, sum) * 100) / 100,
    costNote: "订阅折算",
    limit: { type: "plan", pct, resetsAt: latest?.resetsAt ?? null },
    byTool: null,
    color: colorFor(pct, cfg.thresholds),
    detail: cfg.codexDetailUrl || null,
  };
}

export async function getCodex(period, cfg) {
  try {
    const files = await listMonthFiles(period);
    const sessions = [];
    for (const f of files) {
      const t = await sessionTotals(f);
      if (!t) continue;
      const st = await stat(f);
      sessions.push({ ...t, mtime: st.mtimeMs });
    }
    return aggregate(sessions, period, cfg);
  } catch (e) {
    return { name: "Codex", period, totalTokens: 0, costUSD: 0, costNote: "订阅折算",
      limit: { type: "plan", pct: null, resetsAt: null }, byTool: null, color: "green",
      detail: cfg.codexDetailUrl || null, error: String(e.message || e) };
  }
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd ~/projects/xiaoer-ai-pay && npm test -- test/codex.test.js`
Expected: PASS（2 tests）

- [ ] **Step 6: 真实联调（手动）**

Run: `cd ~/projects/xiaoer-ai-pay && node -e "import('./providers/codex.js').then(m=>m.getCodex('2026-05',JSON.parse(require('fs').readFileSync('config.json'))).then(r=>console.log(r)))"`
Expected: 打印含真实 totalTokens / pct 的 Codex 对象

- [ ] **Step 7: 提交**

```bash
cd ~/projects/xiaoer-ai-pay && git add providers/codex.js test/codex.test.js test/fixtures/codex-rollout.jsonl && \
git commit -m "feat: Codex provider（解析 rollout jsonl + rate limit）"
```

---

## Task 6: Gemini provider（读计量日志）

读 `data/gemini-usage.jsonl`（由 Task 7 的代理产出），每行：
```json
{"ts":"2026-05-22T10:00:00Z","tool":"xiaoer-ask","model":"gemini-2.5-flash","promptTokens":100,"candidatesTokens":50,"thoughtsTokens":20,"totalTokens":170,"costUSD":0.0002}
```
按当月聚合：总 token、总 $（真实）、按 tool 拆分；上限 pct = 月 $ / `geminiSpendCapUSD`。

**Files:**
- Create: `~/projects/xiaoer-ai-pay/providers/gemini.js`
- Test: `~/projects/xiaoer-ai-pay/test/gemini.test.js`

- [ ] **Step 1: 写失败测试 test/gemini.test.js**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateLines } from "../providers/gemini.js";

test("按当月聚合 + 按工具拆分 + spend cap 占比", () => {
  const lines = [
    { ts: "2026-05-01T00:00:00Z", tool: "xiaoer-ask", totalTokens: 100, costUSD: 10 },
    { ts: "2026-05-02T00:00:00Z", tool: "rewind", totalTokens: 50, costUSD: 5 },
    { ts: "2026-04-30T00:00:00Z", tool: "xiaoer-ask", totalTokens: 999, costUSD: 99 }, // 上月，排除
  ];
  const cfg = { thresholds: { yellow: 0.5, red: 0.85 }, geminiSpendCapUSD: 50, geminiDetailUrl: "https://g" };
  const r = aggregateLines(lines, "2026-05", cfg);
  assert.equal(r.name, "Gemini");
  assert.equal(r.totalTokens, 150);
  assert.equal(r.costUSD, 15);
  assert.equal(r.costNote, "真实");
  assert.deepEqual(r.byTool, { "xiaoer-ask": 100, "rewind": 50 });
  assert.equal(r.limit.type, "spend_cap");
  assert.equal(r.limit.pct, 0.3);     // 15/50
  assert.equal(r.color, "green");
  assert.equal(r.detail, "https://g");
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd ~/projects/xiaoer-ai-pay && npm test -- test/gemini.test.js`
Expected: FAIL（Cannot find module）

- [ ] **Step 3: 写实现 providers/gemini.js**

```js
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { colorFor } from "../lib/color.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOG = join(ROOT, "data", "gemini-usage.jsonl");

export function aggregateLines(lines, period, cfg) {
  let totalTokens = 0, costUSD = 0;
  const byTool = {};
  for (const l of lines) {
    if (!l.ts || !l.ts.startsWith(period)) continue;
    totalTokens += l.totalTokens || 0;
    costUSD += l.costUSD || 0;
    const t = l.tool || "unknown";
    byTool[t] = (byTool[t] || 0) + (l.totalTokens || 0);
  }
  costUSD = Math.round(costUSD * 100) / 100;
  const cap = cfg.geminiSpendCapUSD || 0;
  const pct = cap > 0 ? Math.round((costUSD / cap) * 100) / 100 : null;
  return {
    name: "Gemini",
    period,
    totalTokens,
    costUSD,
    costNote: "真实",
    limit: { type: "spend_cap", pct, resetsAt: null },
    byTool,
    color: colorFor(pct, cfg.thresholds),
    detail: cfg.geminiDetailUrl || null,
  };
}

export async function getGemini(period, cfg) {
  let lines = [];
  try {
    const text = await readFile(LOG, "utf8");
    lines = text.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { /* 日志不存在=代理还没记过，返回空 */ }
  const r = aggregateLines(lines, period, cfg);
  if (lines.length === 0) r.error = "计量代理暂无数据";
  return r;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd ~/projects/xiaoer-ai-pay && npm test -- test/gemini.test.js`
Expected: PASS（1 test）

- [ ] **Step 5: 提交**

```bash
cd ~/projects/xiaoer-ai-pay && git add providers/gemini.js test/gemini.test.js && \
git commit -m "feat: Gemini provider（读计量日志按工具聚合）"
```

---

## Task 7: Gemini 计量代理 gemini-meter/server.js

本地代理：监听 `127.0.0.1:<port>`，把 `/v1beta/*` 透传到 `https://generativelanguage.googleapis.com`，注入 key（从 api-registry 读），SSE 流式转发，逐请求把 usageMetadata 追加到 `data/gemini-usage.jsonl`，调用方来自 `X-Xiaoer-Tool` 头。

**Files:**
- Create: `~/projects/xiaoer-ai-pay/gemini-meter/server.js`
- Test: `~/projects/xiaoer-ai-pay/test/proxy.test.js`

- [ ] **Step 1: 写失败测试 test/proxy.test.js（测纯函数：从 SSE 文本抽 usageMetadata + 组日志行）**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractUsage, buildLogLine } from "../gemini-meter/server.js";

const SSE = `data: {"candidates":[{"content":{"parts":[{"text":"hi"}]}}]}

data: {"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":5,"thoughtsTokenCount":2,"totalTokenCount":17},"modelVersion":"gemini-2.5-flash"}

`;

test("extractUsage 从 SSE 抽最后的 usageMetadata", () => {
  const u = extractUsage(SSE);
  assert.equal(u.promptTokenCount, 10);
  assert.equal(u.candidatesTokenCount, 5);
  assert.equal(u.thoughtsTokenCount, 2);
  assert.equal(u.totalTokenCount, 17);
});

test("buildLogLine 组装含 tool/model/cost 的日志对象", () => {
  const u = { promptTokenCount: 1_000_000, candidatesTokenCount: 0, thoughtsTokenCount: 0, totalTokenCount: 1_000_000 };
  const line = buildLogLine(u, "gemini-2.5-flash", "xiaoer-ask");
  assert.equal(line.tool, "xiaoer-ask");
  assert.equal(line.model, "gemini-2.5-flash");
  assert.equal(line.promptTokens, 1_000_000);
  assert.equal(line.totalTokens, 1_000_000);
  assert.ok(Math.abs(line.costUSD - 0.30) < 1e-6); // flash in 价
  assert.ok(line.ts);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd ~/projects/xiaoer-ai-pay && npm test -- test/proxy.test.js`
Expected: FAIL（Cannot find module）

- [ ] **Step 3: 写实现 gemini-meter/server.js**

```js
import http from "node:http";
import https from "node:https";
import { appendFile, readFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { costForGemini } from "../lib/pricing.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOG = join(ROOT, "data", "gemini-usage.jsonl");
const UPSTREAM = "generativelanguage.googleapis.com";

// —— 纯函数（被测试覆盖）——
export function extractUsage(body) {
  let usage = null;
  for (const line of body.split("\n")) {
    const s = line.startsWith("data:") ? line.slice(5).trim() : line.trim();
    if (!s || s === "[DONE]") continue;
    try { const o = JSON.parse(s); if (o.usageMetadata) usage = o.usageMetadata; } catch { /* skip */ }
  }
  return usage;
}

export function buildLogLine(u, model, tool) {
  const norm = {
    promptTokens: u.promptTokenCount || 0,
    candidatesTokens: u.candidatesTokenCount || 0,
    thoughtsTokens: u.thoughtsTokenCount || 0,
    totalTokens: u.totalTokenCount || 0,
  };
  return {
    ts: new Date().toISOString(),
    tool: tool || "unknown",
    model: model || "gemini-2.5-flash",
    ...norm,
    costUSD: costForGemini(model || "gemini-2.5-flash", norm),
  };
}

// —— key 读取：项目 .env → api-registry → 环境变量 ——
async function readKey() {
  const candidates = [join(ROOT, ".env"), join(homedir(), ".shared-skills/api-registry/.env")];
  for (const p of candidates) {
    try {
      const m = (await readFile(p, "utf8")).match(/^\s*GEMINI_API_KEY\s*=\s*(.+)$/m);
      if (m) return m[1].trim();
    } catch { /* next */ }
  }
  return process.env.GEMINI_API_KEY || null;
}

function modelFromPath(path) {
  const m = path.match(/models\/([^:]+):/);
  return m ? m[1] : "gemini-2.5-flash";
}

async function logUsage(body, model, tool) {
  const u = extractUsage(body);
  if (!u) return;
  await mkdir(dirname(LOG), { recursive: true });
  await appendFile(LOG, JSON.stringify(buildLogLine(u, model, tool)) + "\n");
}

// —— 服务器 ——
export function createServer(key) {
  return http.createServer((req, res) => {
    const tool = req.headers["x-xiaoer-tool"] || "unknown";
    const model = modelFromPath(req.url);
    const sep = req.url.includes("?") ? "&" : "?";
    const upstreamPath = `${req.url}${sep}key=${key}`;
    const chunks = [];
    const preq = https.request(
      { hostname: UPSTREAM, path: upstreamPath, method: req.method, headers: { "content-type": "application/json" } },
      (pres) => {
        res.writeHead(pres.statusCode, pres.headers);
        pres.on("data", (c) => { chunks.push(c); res.write(c); });
        pres.on("end", () => {
          res.end();
          logUsage(Buffer.concat(chunks).toString("utf8"), model, tool).catch(() => {});
        });
      }
    );
    preq.on("error", (e) => { res.writeHead(502); res.end(String(e.message)); });
    req.pipe(preq);
  });
}

// —— 入口 ——
if (import.meta.url === `file://${process.argv[1]}`) {
  const cfg = JSON.parse(await readFile(join(ROOT, "config.json"), "utf8"));
  const key = await readKey();
  if (!key) { console.error("[gemini-meter] 找不到 GEMINI_API_KEY"); process.exit(1); }
  createServer(key).listen(cfg.geminiMeterPort, "127.0.0.1", () =>
    console.log(`[gemini-meter] listening 127.0.0.1:${cfg.geminiMeterPort}`));
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd ~/projects/xiaoer-ai-pay && npm test -- test/proxy.test.js`
Expected: PASS（2 tests）

- [ ] **Step 5: 真实联调（手动，验证透传 + 落日志）**

```bash
cd ~/projects/xiaoer-ai-pay && unset SSL_CERT_FILE && node gemini-meter/server.js &
sleep 1
curl -s -N -H 'Content-Type: application/json' -H 'X-Xiaoer-Tool: manual-test' \
  "http://127.0.0.1:19877/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse" \
  -d '{"contents":[{"parts":[{"text":"say hi"}]}]}' | head -2
sleep 1; echo "--- 日志末行 ---"; tail -1 data/gemini-usage.jsonl
kill %1
```
Expected: 看到 SSE `data:` 流；`data/gemini-usage.jsonl` 末行含 `"tool":"manual-test"` 与 costUSD

- [ ] **Step 6: 提交**

```bash
cd ~/projects/xiaoer-ai-pay && git add gemini-meter/server.js test/proxy.test.js && \
git commit -m "feat: Gemini 计量代理（SSE 透传 + 逐请求记 usageMetadata）"
```

---

## Task 8: launchd 守护代理常驻

**Files:**
- Create: `~/projects/xiaoer-ai-pay/gemini-meter/com.xiaoer.gemini-meter.plist`

- [ ] **Step 1: 写 plist（绝对路径，开机自起 + 崩溃重拉）**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.xiaoer.gemini-meter</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(command -v node)</string>
    <string>~/.hammerspoon/xiaoer-ai-pay/gemini-meter/server.js</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/xiaoer-gemini-meter.log</string>
  <key>StandardErrorPath</key><string>/tmp/xiaoer-gemini-meter.err</string>
  <key>EnvironmentVariables</key>
  <dict><key>SSL_CERT_FILE</key><string></string></dict>
</dict>
</plist>
```

- [ ] **Step 2: 安装并启动**

```bash
cp ~/projects/xiaoer-ai-pay/gemini-meter/com.xiaoer.gemini-meter.plist ~/Library/LaunchAgents/
launchctl unload ~/Library/LaunchAgents/com.xiaoer.gemini-meter.plist 2>/dev/null
launchctl load ~/Library/LaunchAgents/com.xiaoer.gemini-meter.plist
sleep 1
```

- [ ] **Step 3: 验证常驻**

Run: `curl -s -o /dev/null -w "%{http_code}\n" -X POST "http://127.0.0.1:19877/v1beta/models/gemini-2.5-flash:generateContent" -H 'Content-Type: application/json' -H 'X-Xiaoer-Tool: healthcheck' -d '{"contents":[{"parts":[{"text":"hi"}]}]}'`
Expected: `200`

- [ ] **Step 4: 提交**

```bash
cd ~/projects/xiaoer-ai-pay && git add gemini-meter/com.xiaoer.gemini-meter.plist && \
git commit -m "feat: launchd 守护 gemini-meter 常驻"
```

---

## Task 9: 刷新编排 refresh.js

跑三个 provider → 写 `data/state.json`。单个 provider 抛错不拖垮整体（已各自 try/catch 返回兜底对象）。

**Files:**
- Create: `~/projects/xiaoer-ai-pay/refresh.js`

- [ ] **Step 1: 写实现 refresh.js**

```js
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getClaude } from "./providers/claude.js";
import { getCodex } from "./providers/codex.js";
import { getGemini } from "./providers/gemini.js";

const ROOT = dirname(fileURLToPath(import.meta.url));
const STATE = join(ROOT, "data", "state.json");

function currentPeriod() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export async function refresh() {
  const cfg = JSON.parse(await readFile(join(ROOT, "config.json"), "utf8"));
  const period = currentPeriod();
  const providers = await Promise.all([
    getClaude(period, cfg),
    getCodex(period, cfg),
    getGemini(period, cfg),
  ]);
  const state = {
    updatedAt: new Date().toISOString(),
    period,
    providers,
    totalCostUSD: Math.round(providers.reduce((s, p) => s + (p.costUSD || 0), 0) * 100) / 100,
  };
  await mkdir(dirname(STATE), { recursive: true });
  await writeFile(STATE, JSON.stringify(state, null, 2));
  return state;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  refresh().then((s) => console.log(JSON.stringify(s, null, 2))).catch((e) => { console.error(e); process.exit(1); });
}
```

- [ ] **Step 2: 真实联调（手动）**

Run: `cd ~/projects/xiaoer-ai-pay && node refresh.js`
Expected: 打印含 3 个 provider 的 state；`data/state.json` 生成，Claude/Codex 有真实数字，Gemini 视代理是否记过

- [ ] **Step 3: 提交**

```bash
cd ~/projects/xiaoer-ai-pay && git add refresh.js && \
git commit -m "feat: refresh 编排三 provider 写 state.json"
```

---

## Task 10: 菜单栏 👂 menubar.lua

读 `data/state.json` 渲染 hs.menubar；点击刷新（调 `node refresh.js`）；点行打开 detail；🔴 弹 hs.notify。

**Files:**
- Create: `~/projects/xiaoer-ai-pay/menubar.lua`
- Modify: `~/.hammerspoon/init.lua`（末尾 dofile 接入）

- [ ] **Step 1: 写实现 menubar.lua**

```lua
-- 小耳 AI 花销墙 👂  菜单栏仪表盘
local M = {}
local PROJECT_DIR = "~/.hammerspoon/xiaoer-ai-pay"
local STATE = PROJECT_DIR .. "/data/state.json"
local NODE = "$(command -v node)"

local DOT = { green = "🟢", yellow = "🟡", red = "🔴" }
xiaoerPay = M
M.bar = M.bar or hs.menubar.new()

local function readState()
  local f = io.open(STATE, "r"); if not f then return nil end
  local c = f:read("*a"); f:close()
  local ok, t = pcall(hs.json.decode, c)
  return ok and t or nil
end

local function buildMenu()
  local st = readState()
  if not st then return { { title = "👂 暂无数据，点刷新", fn = function() M.refresh() end } } end
  local items = {}
  for _, p in ipairs(st.providers or {}) do
    local cost = string.format("$%.2f", p.costUSD or 0)
    local note = p.costNote == "真实" and "" or "(折算)"
    local title = string.format("%s  %s  %s %s", DOT[p.color] or "⚪", p.name, cost, note)
    local sub = {}
    if p.limit and p.limit.pct then
      table.insert(sub, { title = string.format("额度已用 %.0f%%", p.limit.pct * 100), disabled = true })
    end
    if p.byTool then
      for tool, tok in pairs(p.byTool) do
        table.insert(sub, { title = string.format("  %s: %s tok", tool, tok), disabled = true })
      end
    end
    if p.error then table.insert(sub, { title = "⚠️ " .. p.error, disabled = true }) end
    if p.detail then table.insert(sub, { title = "🔗 打开后台", fn = function() hs.execute("open '" .. p.detail .. "'") end }) end
    table.insert(items, { title = title, menu = #sub > 0 and sub or nil })
  end
  table.insert(items, { title = "-" })
  table.insert(items, { title = string.format("本月总折算 $%.2f", st.totalCostUSD or 0), disabled = true })
  table.insert(items, { title = "更新于 " .. (st.updatedAt or "?"), disabled = true })
  table.insert(items, { title = "🔄 刷新", fn = function() M.refresh() end })
  return items
end

function M.render()
  if not M.bar then return end
  M.bar:setTitle("👂")
  M.bar:setMenu(buildMenu())
  -- 🔴 预警
  local st = readState()
  if st then
    for _, p in ipairs(st.providers or {}) do
      if p.color == "red" then
        hs.notify.new({ title = "👂 花销墙预警", informativeText = p.name .. " 逼近上限！" }):send()
      end
    end
  end
end

function M.refresh()
  hs.task.new(NODE, function() M.render() end, { PROJECT_DIR .. "/refresh.js" }):start()
end

M.render()
M.timer = M.timer or hs.timer.doEvery(900, function() M.refresh() end) -- 15 min
return M
```

- [ ] **Step 2: 接入 ~/.hammerspoon/init.lua（末尾追加）**

```lua
-- 小耳 AI 花销墙 👂
local payOk, payErr = pcall(dofile, "~/.hammerspoon/xiaoer-ai-pay/menubar.lua")
if not payOk then print("xiaoer-ai-pay load failed: " .. tostring(payErr)) end
```

- [ ] **Step 3: 重载并验证**

Run: `node ~/projects/xiaoer-ai-pay/refresh.js >/dev/null 2>&1; /opt/homebrew/bin/hs -c "hs.reload()"; sleep 2; /opt/homebrew/bin/hs -c "tostring(xiaoerPay)"`
Expected: 打印 `table: ...`；菜单栏出现 👂 图标，点开看到三行带颜色与金额

- [ ] **Step 4: 提交**

```bash
cd ~/projects/xiaoer-ai-pay && git add menubar.lua && \
git commit -m "feat: 菜单栏 👂 仪表盘（三 provider + 预警 + 15min 自刷）"
```

---

## Task 11: 接入 xiaoer-ask 走计量代理（首个真实数据源）

让 xiaoer-ask 的 Gemini 请求走代理，花销墙 Gemini 行开始有真实数据。

**Files:**
- Modify: `~/projects/xiaoer-ask/webview/app.js`（`API_BASE` 常量）

- [ ] **Step 1: 读现状确认行号**

Run: `grep -n "API_BASE\|streamGenerateContent\|X-Xiaoer-Tool\|headers" ~/projects/xiaoer-ask/webview/app.js | head`
Expected: 看到 `const API_BASE = "https://generativelanguage.googleapis.com/v1beta";`（约 line 5）和 fetch 调用

- [ ] **Step 2: 改 API_BASE 指向代理**

把 `webview/app.js` 中
```js
const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
```
改为
```js
const API_BASE = "http://127.0.0.1:19877/v1beta";
```
并在 fetch 的 headers 里加上工具标签（找到 `streamGenerateContent` 的 `fetch(url, { ... headers: {...} })`，在 headers 对象加一行）：
```js
"X-Xiaoer-Tool": "xiaoer-ask",
```
注意：代理已注入 key，URL 里的 `?key=` 可保留（代理会再补一个，Google 取其一）或去掉，保留不影响。

- [ ] **Step 3: 真实验证（端到端）**

```bash
# 确保代理在跑
curl -s -o /dev/null -w "meter:%{http_code}\n" -X POST "http://127.0.0.1:19877/v1beta/models/gemini-2.5-flash:generateContent" -H 'Content-Type: application/json' -H 'X-Xiaoer-Tool: xiaoer-ask' -d '{"contents":[{"parts":[{"text":"hi"}]}]}'
```
然后按 Option+A 唤起 xiaoer-ask 提问一次，再：
```bash
tail -2 ~/projects/xiaoer-ai-pay/data/gemini-usage.jsonl   # 应含 "tool":"xiaoer-ask"
node ~/projects/xiaoer-ai-pay/refresh.js | grep -A3 Gemini  # Gemini 行有真实 $
```
Expected: 日志出现 xiaoer-ask 记录；花销墙 Gemini 有数

- [ ] **Step 4: 提交（在 xiaoer-ask 仓库）**

```bash
cd ~/projects/xiaoer-ask && git add webview/app.js && \
git commit -m "feat: Gemini 请求走本地计量代理（xiaoer-ai-pay 花销墙）"
```

---

## Task 12: 收尾 — README + 全量测试 + 记忆

**Files:**
- Create: `~/projects/xiaoer-ai-pay/README.md`
- Create: `~/projects/xiaoer-ai-pay/CLAUDE.md`

- [ ] **Step 1: 全量测试绿**

Run: `cd ~/projects/xiaoer-ai-pay && npm test`
Expected: 全部 PASS

- [ ] **Step 2: 写 README.md**（含：用途、架构图、`node refresh.js`、launchd 管理、如何接新工具走代理、如何加新 provider/Hermes）

- [ ] **Step 3: 写 CLAUDE.md**（改本项目前必读：provider 接口字段、代理端口、launchd label、接入工具清单、费率手更位置 `lib/pricing.js`）

- [ ] **Step 4: 提交**

```bash
cd ~/projects/xiaoer-ai-pay && git add README.md CLAUDE.md && \
git commit -m "docs: README + CLAUDE.md"
```

- [ ] **Step 5: 写记忆指针**（`~/.claude/projects/-Users-jane/memory/project_xiaoer_ai_pay.md` + MEMORY.md 一行），记录：菜单栏 👂、三 provider 来源、Gemini 走代理增量覆盖、加 Hermes 方式。

---

## Self-Review

**Spec coverage**（逐条对 spec §5 组件）：
- §5.1 菜单栏 UI → Task 10 ✅
- §5.2 三 adapter + 统一接口 → Task 4/5/6 ✅（接口字段全程一致：name/period/totalTokens/costUSD/costNote/limit/byTool/color/detail）
- §5.3 Gemini 代理 + launchd + X-Xiaoer-Tool + 增量接入 → Task 7/8/11 ✅
- §5.4 刷新编排 state.json + 15min → Task 9 + Task 10 timer ✅
- §5.5 预警 hs.notify → Task 10 M.render 🔴 分支 ✅
- §6 数据流 / §7 错误处理（各 provider try/catch 兜底、代理离线显示 error）✅
- §8 测试（adapter 单测 + 代理纯函数测 + 端到端手动）✅
- 插件式/Hermes 预留 → provider 同接口 + Task 12 README 说明 ✅
- 👂 永远在 → Task 10 setTitle("👂") + 预警 notify 标题带 👂 ✅

**Placeholder scan**: 无 TBD/TODO；所有代码步骤含完整代码；命令含预期输出。Task 12 Step 2/3/5 是文档/记忆撰写，内容要点已列明（非代码步骤，可接受）。

**Type consistency**: provider 输出字段在 Task 4/5/6 与 Task 9(refresh 求和 costUSD)、Task 10(menubar 读 color/costUSD/costNote/limit.pct/byTool/detail) 全对齐；`colorFor(pct, thresholds)` 签名 Task 2 定义、Task 4/5/6 调用一致；`costForGemini(model, {promptTokens,candidatesTokens,thoughtsTokens})` 与 `costForCodex(model, {input_tokens,cached_input_tokens,output_tokens})` 在 Task 3 定义、Task 7/5 调用一致；`extractUsage`/`buildLogLine` Task 7 定义并自测。

无缺口。
