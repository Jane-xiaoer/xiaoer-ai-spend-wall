# 小耳 AI 花销墙 (xiaoer-ai-pay) 👂

一眼看清 **Claude / Codex / Gemini** 三家本月用量与花费的菜单栏仪表盘。

这是 [Xiaoer Hammerspoon Pet](https://github.com/Jane-xiaoer/xiaoer-hammerspoon-pet) 的可选组件。桌宠本体不依赖花销墙；选择安装后，桌宠新面板里的 `花` 按钮可以直接打开它。

## 它解决什么

三家 AI 分散在三个后台，AI Studio 用量视图又太粗。本工具把三家汇到菜单栏 👂 一个图标里，颜色编码（🟢够用 / 🟡过半 / 🔴逼近上限），点开看金额、额度占比、按工具拆分。

## 三家是三个计费世界（重要）

| 供应商 | 接入 | 显示的钱 |
|---|---|---|
| **Claude Code** | Max 订阅 | 按 API 价**折算**（订阅实付≠此数）+ 用量趋势 |
| **Codex** | ChatGPT 订阅 | 同上 + 5 小时窗口额度 % + 重置时间 |
| **Gemini** | 真 API key | **真实 $**（按量计费） |

## 架构

```
hs.menubar(👂)  ←—— refresh.js（点击 / 每 15min）
                      ├─ providers/claude.js  ← ccusage monthly --json
                      ├─ providers/codex.js   ← 解析 ~/.codex/sessions/**/rollout-*.jsonl
                      ├─ providers/gemini.js  ← 读 data/gemini-usage.jsonl
                      └─ providers/<新家>.js   ← 同接口 drop-in（如 Hermes）
                              ↑
                 gemini-meter/server.js（launchd 常驻 127.0.0.1:19877）
                 透传 /v1beta/* → Google（经 Clash 隧道），逐请求记 usageMetadata
```

## 用法

### 安装

如果你从桌宠安装器选择了“桌宠 + 花销墙”，安装器会自动完成以下步骤。

也可以手动安装：

```bash
git clone https://github.com/Jane-xiaoer/xiaoer-ai-spend-wall.git ~/.hammerspoon/xiaoer-ai-pay
cd ~/.hammerspoon/xiaoer-ai-pay
chmod +x scripts/install.sh
./scripts/install.sh
```

安装脚本会：

- 创建本地 `config.json` 和 `.env`，这些文件不会上传到 GitHub。
- 把可选加载入口追加到 `~/.hammerspoon/init.lua`。
- 没有 API key 时跳过 Gemini 计量代理，Claude / Codex 面板仍可使用。
- 用户填写自己的 `GEMINI_API_KEY` 后，再次运行 `scripts/install.sh` 即可启用 Gemini 计量。

**点 Dock 里的 👂「小耳花销墙」** → 弹出 HTML 富面板（右上角浮窗）。也可点菜单栏 👂。

面板三张卡：
- **Claude**（订阅折算）：当前 5 小时窗已用 + 预测本窗花费 + 今日/昨日/本周/本月
- **Codex**（订阅折算）：5 小时窗 + 本周窗 额度进度条（带重置倒计时）+ 时间格
- **Gemini**（真实）：本月真实 $ + 消费上限进度条 + 今日/昨日/本周/本月 + 按工具拆分

```bash
node refresh.js                    # 手动刷新一次，生成 data/state.json
npm test                           # 全量测试
bash scripts/install-dock-app.sh   # （重）建 Dock 👂 小程序
```

菜单栏 👂 由 `~/.hammerspoon/init.lua` dofile `menubar.lua`；打开面板时刷新当月账单。

> Dock 小程序 = `/Applications/小耳花销墙.app`（AppleScript applet），点击触发 `hs -c "xiaoerPay.panel()"`。图标用 Hammerspoon 渲染 👂 emoji + `fileicon` 设置。

## 计量代理（Gemini 真实数据来源）

- launchd 守护：`~/Library/LaunchAgents/com.xiaoer.gemini-meter.plist`（开机自起 + 崩溃重拉）
- 重启：`launchctl unload/load ~/Library/LaunchAgents/com.xiaoer.gemini-meter.plist`
- 日志：`/tmp/xiaoer-gemini-meter.log`、用量 `data/gemini-usage.jsonl`
- key 来源：项目 `.env` → `~/.shared-skills/api-registry/.env` → 环境变量
- 如需代理，在运行安装脚本前设置 `HTTPS_PROXY`；安装脚本会把它写入当前用户的 launchd 配置。

### 让一个工具走计量代理（增量覆盖）

把工具的 Gemini `API_BASE` 从 `https://generativelanguage.googleapis.com/v1beta`
改成 `http://127.0.0.1:19877/v1beta`，并在请求头加 `X-Xiaoer-Tool: <工具名>`。
已接入：**xiaoer-ask**（私有 `.env` 的 `XIAOER_METER_BASE` 开关）。

## 加一个新供应商（如 Hermes）

1. 写 `providers/hermes.js`，导出 `getHermes(period, cfg)`，返回标准对象（见 `CLAUDE.md`）。
2. `refresh.js` 的 `Promise.all` 里加一行。
3. 菜单栏自动多一行，无需改 `menubar.lua`。

## 费率手更

`lib/pricing.js` 顶部的 `GEMINI` / `CODEX` 费率表（USD / 1M tokens），Google/OpenAI 调价时改这里。
