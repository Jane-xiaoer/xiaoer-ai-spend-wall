import { readdir, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { homedir } from "node:os";
import { colorFor } from "../lib/color.js";
import { costForCodex } from "../lib/pricing.js";
import { bucketByTime } from "../lib/timebuckets.js";
import { assess } from "../lib/utilization.js";

const SESSIONS_DIR = join(homedir(), ".codex", "sessions");

// 解析单个 rollout 文件：返回最后一条 token_count 的累计用量 + 最新 rate
// 流式逐行读：会话文件可达数百 MB，超 V8 字符串上限，不能整读
export async function sessionTotals(file) {
  let last = null;
  const rl = createInterface({ input: createReadStream(file, "utf8"), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.includes("token_count")) continue;
    let obj; try { obj = JSON.parse(line); } catch { continue; }
    if (obj?.payload?.type === "token_count") last = obj;
  }
  if (!last) return null;
  const info = last.payload.info || {};
  const rlim = last.payload.rate_limits || {};
  const pct = (w) => (w && w.used_percent != null ? w.used_percent / 100 : null);
  return {
    usage: info.total_token_usage || {},
    ratePct: pct(rlim.primary),
    resetsAt: rlim.primary?.resets_at ?? null,
    weekPct: pct(rlim.secondary),
    weekResetsAt: rlim.secondary?.resets_at ?? null,
  };
}

// 从路径取日期：.../sessions/2026/05/23/rollout-...jsonl → "2026-05-23"
export function dayFromFile(file) {
  const m = file.match(/sessions\/(\d{4})\/(\d{2})\/(\d{2})\//);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

// 列出某月（YYYY-MM）目录下的 rollout 文件
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

function prevMonth(period) {
  const [y, m] = period.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

export function aggregate(sessions, period, cfg, now = new Date()) {
  const sum = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  for (const s of sessions) {
    if (!s.day || !s.day.startsWith(period)) continue; // 月总量只算当月
    const u = s.usage || {};
    sum.input_tokens += u.input_tokens || 0;
    sum.cached_input_tokens += u.cached_input_tokens || 0;
    sum.output_tokens += u.output_tokens || 0;
    sum.total_tokens += u.total_tokens || 0;
  }
  const latest = [...sessions].sort((a, b) => (b.mtime || 0) - (a.mtime || 0))[0];
  const pct = latest?.ratePct ?? null;
  const byTime = bucketByTime(
    sessions.map((s) => ({ date: s.day, cost: costForCodex(cfg.codexModel, s.usage || {}), tokens: (s.usage || {}).total_tokens || 0 })),
    now,
  );
  const windows = [];
  if (latest?.ratePct != null) windows.push({ name: "5h", pct: latest.ratePct, resetsAt: latest.resetsAt });
  if (latest?.weekPct != null) windows.push({ name: "Week", pct: latest.weekPct, resetsAt: latest.weekResetsAt });
  const weekPct = latest?.weekPct ?? null; // 对真实套餐周额度
  return {
    name: "Codex",
    period,
    totalTokens: sum.total_tokens,
    costUSD: Math.round(costForCodex(cfg.codexModel, sum) * 100) / 100,
    costNote: "Subscription",
    limit: { type: "plan", pct, resetsAt: latest?.resetsAt ?? null },
    byTool: null,
    color: colorFor(pct, cfg.thresholds),
    detail: cfg.codexDetailUrl || null,
    utilization: { thisWeek: byTime.week.tokens, pct: weekPct, basis: "this week / plan quota", ...assess(weekPct) },
    stats: { byTime, windows, current: null },
  };
}

export async function getCodex(period, cfg) {
  try {
    // 当月 + 上月（让本周/昨天在月初也算得准）
    const files = [...await listMonthFiles(period), ...await listMonthFiles(prevMonth(period))];
    const sessions = [];
    for (const f of files) {
      const t = await sessionTotals(f);
      if (!t) continue;
      const st = await stat(f);
      sessions.push({ ...t, mtime: st.mtimeMs, day: dayFromFile(f) });
    }
    return aggregate(sessions, period, cfg);
  } catch (e) {
    return { name: "Codex", period, totalTokens: 0, costUSD: 0, costNote: "Subscription",
      limit: { type: "plan", pct: null, resetsAt: null }, byTool: null, color: "green",
      detail: cfg.codexDetailUrl || null, stats: { byTime: {}, windows: [], current: null },
      error: String(e.message || e) };
  }
}
