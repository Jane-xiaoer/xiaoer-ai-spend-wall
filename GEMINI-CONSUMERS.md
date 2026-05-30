# Gemini 用量来源清单（方案 C 接入台账）

> 目标：把「凡是用 Gemini 的地方」都纳入花销墙监控。
> 维护：每接一个就更新「接入状态」。扫描命令见末尾，定期重扫防遗漏。
> 最近扫描：2026-05-23

## ⚠️ 两类来源，能不能上报不一样

| 类型 | 能否上报本地计量代理 | 怎么算进总量 |
|---|---|---|
| **本地工具**（Hammerspoon / 本机 CLI / 本机跑的 skill） | ✅ 能（同机，走 `/record` 或代理） | 逐请求上报 → 按工具拆分 |
| **云端 web app**（Vercel 部署） | ❌ 不能（调用在服务器，够不到 localhost） | 只能靠 Google 总额兜底 |

**完整总量的唯一可信来源 = Google AI Studio 用量页**（bb-browser 定期抓）。本地上报是「看哪个本地工具在烧」的加料，不是总量本身。

---

## 🟢 本地工具（优先接入 —— 这些能上报）

| 工具 | 名称 | 位置 | 入口/加载 | 接入状态 |
|---|---|---|---|---|
| xiaoer-ask | 小耳问问 | `~/projects/xiaoer-ask` | init.lua dofile | ✅ 已接（/record；2026-05-23 修好 /record 端点后才真正生效） |
| xiaoer-recall | 小耳找到 | `~/projects/xiaoer-recall` | init.lua dofile | ✅ 已接（config.report_usage，describe.py+ask.py 两处调用点；中文名走 body） |
| pai 伴侣 | companion AI | `~/.hammerspoon/pai/ai.lua` | init.lua require("pai") | ✅ 已接网关（X-Xiaoer-Tool: pai-companion，随全局开关） |
| pai 语音转写 | transcribe | `~/.hammerspoon/pai/helpers/transcribe_gemini.py` | 同上 | ✅ 已接网关（pai-voice，**钉死 google**，音频中转站翻不了） |
| **一键收藏** = website-capture ⭐ | 浏览器点收藏→Notion/Obsidian/弹药库 | `~/projects/website-capture` | watcher.py 常驻 + capture.py | ✅ 已接网关（tool=capture，**钉死 google**，Google Search grounding 切不了 relay）。**最大 Gemini 大户**，之前用 genai SDK 直连 Google、完全绕过网关、一分钱没计入——现已 SDK `http_options.base_url` 指网关 |
| smart-rename | 智能重命名 | `~/projects/smart-rename` | init.lua require | ✅ 已接网关（lib/analyze.py，X-Xiaoer-Tool: rename，随全局；旧 _report_usage 已删避免双计） |
| hammerspoon-ai-translator | 一键翻译 | `~/projects/hammerspoon-ai-translator` | init.lua 加载，**在用** | ✅ 已接网关（translator.lua:32，X-Xiaoer-Tool: translate，随全局） |

> ⚠️ 纠错（2026-05-26）：曾误以为「一键收藏」是 pai route `knowledge_capture_local`。**错**。Jane 说的一键收藏 = **浏览器点一下收藏、打通 Notion/Obsidian/小耳弹药库** 的 `website-capture` 项目，重度用 Gemini（capture/search/backfill/reclassify 四个脚本）。pai 那个 knowledge_capture_local 是另一回事（agent_bridge 走 OpenRouter gpt-4o-mini，不碰 Gemini）。

## 🟡 本机 skill（在 Claude Code 会话里本地跑，理论能上报，但调用方式各异，逐个看）

Art · nano-image-generator-skill · nano-ppt-generator · VideoTranscribe · lecture-clipper · last30days-skill · PromptInjection · api-armor

> 这些是 skill，频次低、各自调法不同。**第二批**再逐个接，或统一改走 api-registry 的共享 Gemini 封装（一处接、全覆盖）。

## 🔴 云端 web app（本地计量够不到 —— 只计入 Google 总额，不单独上报）

xiaoer-tools-wall · ai-video-studio · headshot · Camera-Museum · lecture-clipper-saas · wtf-was-that-site · website-capture · html-ppt-designer · p5js-poster-diary · xiaoer-x-system

> 这些跑在 Vercel/服务器。**不接本地上报**，靠 Google AI Studio 总额覆盖。

---

## ✅ 完整性双保险

1. **Google 权威总额**（最重要）：bb-browser 定期抓 AI Studio 用量页 → 100% 覆盖（本地+云端全算）。⬜ 待做
2. **本地按工具拆分**：上面🟢逐个接 `/record` 上报 → 知道哪个本地工具在烧。进行中（3/5：xiaoer-ask + 小耳找到 + 智能重命名 ✅；剩 pai / 一键翻译）

> 🔧 2026-05-23 关键修复：meter 的 `/record` 端点之前**根本不存在**，所有 /record 上报都静默 404。已补上 + 修中文 tool 名编码。这是「之前 Gemini 一直 $0」的真正原因之一。

---


## 🔌 已接入网关（2026-05-26 更新；switch-backend.sh 全局开关；日志带 backend 字段分账）

**当前全局后端 = relay（中转站，省 token）**。切换：`bash scripts/switch-backend.sh google|relay`（3s 生效，不重启）。

| 工具 | tool 标签 | 后端 | 说明 |
|---|---|---|---|
| 一键收藏 = **website-capture** | `capture` | **钉死 google** | ⭐ **最大 Gemini 大户**，用 Google Search grounding，中转站做不了 → 只计量不切。capture.py(主) + capture_with_search.py + backfill_intros.py + reclassify.py 全接（genai SDK 设 `http_options.base_url`） |
| smart-rename | `rename` | 随全局(=relay) | ✅ 实测 relay 通 |
| xiaoer-recall | `xiaoer-find` | 随全局(=relay) | |
| xiaoer-ask | `xiaoer-ask` | **钉死 google** | 2026-05-26 改：要质量+原生流式+可控 thinking（relay=gpt-5.4 双输）。重做**真流式**（curl -s -N 边收边推 + 累积 base64）；thinkingBudget=1024 平衡档。thinking 阶段 Gemini 沉默是物理下限，只能降 budget 砍等待 |
| pai 伴侣 | `pai-companion` | 随全局(=relay) | |
| 一键翻译 | `translate` | 随全局(=relay) | |
| pai 语音转写 | `pai-voice` | **钉死 google** | 音频中转站翻不了 |
| 出图 headshot/ID photo | — | 未接 | 画质要先验 relay 出图翻译 |

**日志分账（goal：Gemini 真钱 vs relay token 分开）**：每条 `gemini-usage.jsonl` 带 `backend` 字段。
- `backend:"google"` → 真实 Gemini 花销（costUSD 有效）= capture + pai-voice
- `backend:"relay"` → 中转站，**costUSD 置 0**（不污染 Gemini 真钱）；只看 token 量
- `providers/gemini.js` 输出 `backendSplit{google,relay}` + `byToolBackend{tool:google|relay|mixed}`，面板可据此分两块显示（面板视觉分组待做）

## 接入方法（本地工具统一走这套）

仿 xiaoer-ask：拿到一次 Gemini 响应的 `usageMetadata` 后，POST 给计量代理：
```
POST http://127.0.0.1:19877/record
Header: X-Xiaoer-Tool: <工具名>
Body: {"model":"gemini-2.5-flash","usage":{...usageMetadata...}}
```
（WKWebView/ATS 拦本地明文的，走 hs.http 从 Lua 侧发；普通 node/python 工具直接 POST。）

## 重扫命令（定期查有没有新增的 Gemini 消费者）
```bash
grep -rlI "generativelanguage.googleapis.com" ~/projects ~/.claude/skills ~/.shared-skills ~/.hammerspoon \
 | grep -vE "node_modules|/.git/|/backups/|xiaoer-ai-pay" \
 | sed -E "s#($HOME/(projects|.claude/skills|.shared-skills|.hammerspoon)/[^/]+).*#\1#" | sort | uniq -c | sort -rn
```
