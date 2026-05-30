import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { colorFor } from "../lib/color.js";
import { bucketByTime } from "../lib/timebuckets.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOG = join(ROOT, "data", "gemini-usage.jsonl");

// 工具原始标签 → 项目归并（面板按项目展示；开发/测试标签全折进"🧪 测试·其他"，不污染真实项目）。
// 2026-05-27 加：原 byTool 太细（speedtest/capture-test/harden-* 一堆噪音），且「小耳找到」与
// 「xiaoer-find」两个标签重复显示。byProject 把它们按项目合并。
const PROJECT_RULES = [
  [/^(xiaoer-?find|小耳找到|xiaoer-?recall)$/i, "🔍 小耳找到 (find)"],
  [/^(xiaoer-?ask|小耳问问)$/i, "💬 小耳问问 (ask)"],
  [/^(capture|website-?capture|一键收藏|xiaoer-?save)$/i, "🔖 小耳收藏 (save)"],
  [/^(rename|smart-?rename|智能重命名)$/i, "🏷️ 小耳重命名 (rename)"],
  [/^(translate|一键翻译)$/i, "🌐 小耳翻译 (translate)"],
  [/^(pai-?voice|pai-?companion|pai)$/i, "🎙️ PAI 语音/伴侣"],
];
export function canonTool(raw) {
  const t = String(raw || "unknown").trim();
  if (/test$|bench|harden|debug|gateway|diag|^sw-|parse|thought|qual|speed|^unknown$|^legacy$/i.test(t)) return "🧪 测试·其他";
  for (const [re, name] of PROJECT_RULES) if (re.test(t)) return name;
  return t; // 没规则的真实工具保留原名
}

export function aggregateLines(lines, period, cfg, now = new Date()) {
  let totalTokens = 0, costUSD = 0;
  const byTool = {};
  const byToolCost = {};   // {tool: costUSD}（relay 行 costUSD=0 → 中转站项目自然为 ¥0）
  // 按后端分账：google=真实 Gemini 花销($)；relay=中转站 token 用量（省钱目标，非 Gemini 真钱）
  const backendSplit = { google: { tokens: 0, costUSD: 0 }, relay: { tokens: 0, costUSD: 0 } };
  const byToolBackend = {};   // {tool: "google"|"relay"|"mixed"}
  for (const l of lines) {
    if (!l.ts || !l.ts.startsWith(period)) continue;
    totalTokens += l.totalTokens || 0;
    costUSD += l.costUSD || 0;
    const t = l.tool || "unknown";
    byTool[t] = (byTool[t] || 0) + (l.totalTokens || 0);
    byToolCost[t] = (byToolCost[t] || 0) + (l.costUSD || 0);
    const be = l.backend === "relay" ? "relay" : "google";   // 老数据无 backend → 当 google
    backendSplit[be].tokens += l.totalTokens || 0;
    backendSplit[be].costUSD += l.costUSD || 0;
    byToolBackend[t] = byToolBackend[t] == null ? be : (byToolBackend[t] === be ? be : "mixed");
  }
  costUSD = Math.round(costUSD * 100) / 100;
  backendSplit.google.costUSD = Math.round(backendSplit.google.costUSD * 100) / 100;
  backendSplit.relay.costUSD = Math.round(backendSplit.relay.costUSD * 100) / 100;
  // 按项目归并（面板展示用；byTool 保持原样不动，免得破坏既有断言/分账）
  const byProject = {};       // 项目 → tokens
  const byProjectCost = {};   // 项目 → 真实花费 USD（panel 显示 ¥；各行加起来 = 本月 Gemini 真钱）
  for (const [t, n] of Object.entries(byTool)) {
    const p = canonTool(t);
    byProject[p] = (byProject[p] || 0) + n;
    byProjectCost[p] = Math.round(((byProjectCost[p] || 0) + (byToolCost[t] || 0)) * 1000) / 1000;
  }
  const cap = cfg.geminiSpendCapUSD || 0;
  const pct = cap > 0 ? Math.round((costUSD / cap) * 100) / 100 : null;
  const byTime = bucketByTime(
    lines.map((l) => ({ date: (l.ts || "").slice(0, 10), cost: l.costUSD || 0, tokens: l.totalTokens || 0 })),
    now,
  );
  return {
    name: "Gemini",
    period,
    totalTokens,
    costUSD,
    costNote: "Metered",
    limit: { type: "spend_cap", pct, resetsAt: null },
    byTool,
    byProject,
    byProjectCost,
    backendSplit,
    byToolBackend,
    color: colorFor(pct, cfg.thresholds),
    detail: cfg.geminiDetailUrl || null,
    stats: { byTime, windows: [], current: null },
  };
}

// 读 AI Studio 权威总额缓存（scripts/fetch-aistudio-spend.js 产出）
async function readAuthoritative() {
  try {
    const a = JSON.parse(await readFile(join(ROOT, "data", "aistudio-spend.json"), "utf8"));
    // 取「上限占比最高」的项目作预警依据（= 最接近撞顶的那个）
    let capPct = null, capUsed = null, capLimit = null, capProj = null;
    for (const p of a.projects || []) {
      if (p.capLimitNTD > 0 && p.capUsedNTD != null) {
        const pc = p.capUsedNTD / p.capLimitNTD;
        if (capPct == null || pc > capPct) { capPct = pc; capUsed = p.capUsedNTD; capLimit = p.capLimitNTD; capProj = p.name; }
      }
    }
    return { totalNTD: a.totalNTD, totalCNY: a.totalCNY, updatedAt: a.updatedAt,
      capPct, capUsedNTD: capUsed, capLimitNTD: capLimit, capProject: capProj,
      projects: a.projects };
  } catch { return null; }
}

export async function getGemini(period, cfg) {
  let lines = [];
  try {
    const text = await readFile(LOG, "utf8");
    lines = text.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { /* 日志不存在=代理还没记过，返回空 */ }
  const r = aggregateLines(lines, period, cfg);
  if (lines.length === 0) r.error = "计量代理暂无数据";

  // 权威总额（AI Studio 真实账单）→ 当主数字 + 用真实上限算预警色
  const auth = await readAuthoritative();
  if (auth) {
    r.authoritative = auth;
    const pct = auth.capPct != null ? Math.round(auth.capPct * 100) / 100 : null;
    r.limit = { type: "spend_cap", pct, resetsAt: null };
    r.color = colorFor(pct, cfg.thresholds);
  }
  return r;
}
