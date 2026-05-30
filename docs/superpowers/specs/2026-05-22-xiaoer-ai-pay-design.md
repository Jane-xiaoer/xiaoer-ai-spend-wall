# 小耳 AI 花销墙 (xiaoer-ai-pay) — 设计文档

**日期**: 2026-05-22
**状态**: 已通过设计评审（Jane 2026-05-22：「整个思路应该是可以的」，观测面板出来后再迭代）
**目录**: `~/projects/xiaoer-ai-pay/`
**形态**: Hammerspoon 菜单栏 👂 仪表盘

---

## 1. 问题 / 痛点

Jane 同时在用 **Claude Code、Codex、Gemini** 三家 AI，想一眼看清「各家用了多少、对应多少钱」。现状：

- **AI Studio 的用量视图太粗**，看不出一二三（直接诱因：2026-05-22 Gemini 撞月度消费上限 → 小耳 ask 猝死）。
- 三家分散在三个后台，没有统一视图。

## 2. 一个会颠覆设计的硬事实：三家是三个计费世界

| 供应商 | 接入方式 | 有没有「按次的真钱」 | 真实可得指标 |
|---|---|---|---|
| **Claude Code** | Max 订阅（`ANTHROPIC_API_KEY` 未设，OAuth） | ❌ 包月固定 | token 用量 + **按 API 价折算的等价 $** + plan 额度 |
| **Codex** | ChatGPT 订阅（`~/.codex/auth.json` 登录 token，模型 gpt-5.5） | ❌ 包月固定 | 同上 |
| **Gemini** | 真 API key（`AIzaSy…`，30+ 工具共用） | ✅ 按量计费，真金白银 | token 用量 + **真实 $** |

**结论**：只有 Gemini 是真钱；Claude/Codex 是订阅，展示「折算 $ + 烧了多少额度」，并显式标注「订阅实付 ≠ 此数」，避免误读。

## 3. 现成基础（不重复造轮子）

- **`ccusage` v18 已装本机**：同时吃 **Claude Code + Codex** 本地会话日志（4257 个 Claude 会话 + 93 个 Codex 会话），用 LiteLLM 实时价折算 USD。命令：`ccusage monthly --json` / `ccusage codex monthly --json`。
- 参考实现：CodexBar（steipete/CodexBar，Claude+Codex 菜单栏）、ianlpaterson「一个脚本追 Claude+Codex+Gemini 配额」博客。
- **唯一要自建的是 Gemini 计量**：ccusage 不覆盖裸 API key 散用；官方也无轻量历史用量接口（`countTokens` 只预估、Cloud Monitoring 要建服务账号且滞后）。→ **本地计量代理是唯一干净路径**（设计评审已选定）。

## 4. 架构总览

```
hs.menubar(👂)  ←—— refresh.sh（点击时 / 每 15 min hs.timer）
                      ├─ providers/claude.js  ← ccusage monthly --json        （已装，白捡）
                      ├─ providers/codex.js   ← ccusage codex monthly --json  （已装，白捡）
                      ├─ providers/gemini.js  ← 读本地计量日志 → tokens×LiteLLM价 → $ + 按工具拆分
                      └─ providers/<hermes>.js ← 未来 drop-in，菜单栏自动多一行
                              ↑
                 gemini-meter/（常驻本地代理 127.0.0.1:PORT）
                 转发 /v1beta/* → Google，注入 key，逐请求记 usageMetadata+调用方 → JSONL
```

**设计原则**：供应商插件式。每个 adapter 是独立单元，对外只暴露统一接口，可单独测试。加新家 = 丢一个 adapter，不动核心。

## 5. 组件（各管一件事）

### 5.1 菜单栏 UI — `menubar.lua`
- 常驻 **👂 图标**（永远带 👂，品牌铁律）。
- 下拉每供应商一行：`Claude  本月 $折算  🟢` / `Codex …` / `Gemini  $真实  🟡`。
- 颜色编码：🟢 够用 / 🟡 过半 / 🔴 逼近上限。
- 点行 → 详情动作（开 AI Studio 链接 / 打开按工具拆分）。
- 底部：`🔄 刷新 ｜ 本月总折算 $X`。
- **依赖**：读 `state.json`；调 `refresh.sh`。

### 5.2 供应商 adapter — `providers/*.js`
- **统一接口**（输入无；输出一个对象）：
  ```json
  {
    "name": "Gemini",
    "period": "2026-05",
    "usage": { "totalTokens": 123456, "byTool": { "xiaoer-ask": 50000 } },
    "costUSD": 12.34,
    "limit": { "type": "spend_cap|plan|none", "value": 50, "pct": 0.25 },
    "color": "green|yellow|red",
    "detailAction": "open https://ai.studio/spend"
  }
  ```
- `claude.js`：解析 `ccusage monthly --json`，取本月行 → costUSD + tokens；limit.type = "plan"（折算值，标注非实付）。
- `codex.js`：解析 `ccusage codex monthly --json`，同上。
- `gemini.js`：读 `~/projects/xiaoer-ai-pay/data/gemini-usage.jsonl`，按本月聚合 + 按 `tool` 标签拆分；价格用 LiteLLM Gemini 费率；limit.type = "spend_cap"（值来自 config，用于算 pct 上色/预警）。
- **依赖**：claude/codex 依赖 `ccusage` CLI；gemini 依赖计量日志。

### 5.3 Gemini 计量代理 — `gemini-meter/`
- Node 常驻小 HTTP 服务，监听 `127.0.0.1:PORT`。
- 转发 `POST /v1beta/models/*:{generateContent,streamGenerateContent}` → `https://generativelanguage.googleapis.com`，**SSE 流式透传**。
- 从 `~/.shared-skills/api-registry/.env` 读 `GEMINI_API_KEY` 注入（工具不再各自持 key → 单一出口）。
- 逐请求/逐流末记一条 JSONL：`{ts, tool, model, promptTokens, candidatesTokens, thoughtsTokens, totalTokens, costUSD}`。
- 调用方归属：工具请求带 `X-Xiaoer-Tool: <name>` 头（或 query `?tool=`）；缺省 `unknown`。
- 接入：工具把 `API_BASE` 从 `https://generativelanguage.googleapis.com/v1beta` 改成 `http://127.0.0.1:PORT/v1beta`。**先接 xiaoer-ask + 用量大头，增量覆盖**。
- 由 launchd 守护常驻（开机自起，崩溃重拉）。

### 5.4 刷新编排 — `refresh.sh`
- 依次跑三个 adapter（容错：单个失败不拖垮整体）→ 汇总写 `data/state.json`。
- 触发：菜单栏点击 + `hs.timer` 每 15 min。

### 5.5 预警
- 刷新后任一供应商进 🔴（如 Gemini $ 达 spend cap 的 90% / Claude·Codex 逼近额度窗）→ `hs.notify` 带 👂 弹提醒。防再次「猝死」。

## 6. 数据流

```
工具 → (Gemini请求) → gemini-meter 代理 → Google
                          ↓ 记 JSONL
refresh.sh ──→ claude.js (ccusage)
           ──→ codex.js  (ccusage codex)
           ──→ gemini.js (读 JSONL 聚合)
           ──→ 写 state.json
menubar.lua ──读→ state.json ──渲染→ 👂 下拉
```

## 7. 错误处理

| 故障 | 行为 |
|---|---|
| `ccusage` 缺失/报错 | 该行显示「—」+ ⚠️，不崩整体 |
| 代理未运行 | Gemini 行显示上次已知值 + ⚠️「计量代理离线」 |
| LiteLLM 价格表拉取失败 | 用内置兜底费率（定期手更） |
| api-registry 无 key | 代理拒转发 + 菜单栏红字提示 |

## 8. 测试

- **adapter 单测**：喂 ccusage 样例 JSON / 样例 JSONL，断言输出对象字段与 costUSD 计算。
- **代理集测**：本地起代理，打一次 streamGenerateContent，断言 (a) SSE 正确透传 (b) 落了一条 JSONL 含 tool 标签。
- **端到端**：跑 refresh.sh → 校验 state.json 三行齐全；手动点菜单栏看渲染。

## 9. 关键取舍记录

- **为什么本地计量而非 Cloud Monitoring**：要「实时 + 按工具拆分 + 零 Google Cloud 配置」，只有本地代理满足；Cloud Monitoring 滞后几小时、要建服务账号、SKU→$ 折算麻烦，本质是 AI Studio 换皮。代价是增量覆盖（未接代理的工具不计），诚实标注。
- **为什么 Hammerspoon 菜单栏**：复用 Jane 现有菜单管家 / Voice / xiaoer-ask 同一套框架，零新运行时，原生 👂。
- **为什么 ccusage 直接用**：已装、社区维护、LiteLLM 实时价，Claude+Codex 白捡，没必要自己解析会话日志。

## 10. 范围边界（YAGNI）

- 不做：Web 后台、多用户、历史长期数据库（先 JSONL + 月聚合够用）、Claude/Codex 的真实账单（订阅无此数）。
- 预留不实现：Hermes adapter 接口留好，加的时候再写。

## 11. 分阶段（实施计划展开时细化）

1. ccusage 两个 adapter + state.json + 菜单栏 👂 渲染（Claude/Codex 先亮）。
2. gemini-meter 代理 + launchd + xiaoer-ask 接入 + gemini.js。
3. 预警 + 颜色阈值 config + 详情动作。
4. 观测面板实际跑起来后，按 Jane 反馈迭代 UI。
