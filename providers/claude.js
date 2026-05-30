import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { colorFor } from "../lib/color.js";
import { bucketByTime } from "../lib/timebuckets.js";
import { assess } from "../lib/utilization.js";
const pexec = promisify(execFile);

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// 本周用量 vs 历史最猛一周（自校准充分度基准）
export function weeklyUtilization(dailyRaw, now = new Date()) {
  const days = (dailyRaw.daily || []).map((d) => ({ date: d.date, tokens: d.totalTokens || 0 })).filter((d) => d.date);
  if (!days.length) return { thisWeek: 0, maxWeek: 0, pct: null };
  const thisWeek = bucketByTime(days.map((d) => ({ date: d.date, tokens: d.tokens, cost: 0 })), now).week.tokens;
  const byDate = new Map(days.map((d) => [d.date, d.tokens]));
  let maxWeek = 0;
  for (const end of byDate.keys()) {
    const floor = new Date(end + "T00:00:00"); floor.setDate(floor.getDate() - 6);
    const floorStr = ymd(floor);
    let sum = 0;
    for (const [dt, tk] of byDate) if (dt >= floorStr && dt <= end) sum += tk;
    if (sum > maxWeek) maxWeek = sum;
  }
  return { thisWeek, maxWeek, pct: maxWeek > 0 ? thisWeek / maxWeek : null };
}

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

// ccusage daily --json → 时间分桶
export function statsFromDaily(dailyRaw, now = new Date()) {
  const entries = (dailyRaw.daily || []).map((d) => ({ date: d.date, cost: d.totalCost, tokens: d.totalTokens }));
  return bucketByTime(entries, now);
}

// ccusage blocks --token-limit → 当前 5 小时窗用量计（订阅:看用量不看钱）
export function buildClaudeWindow(blocksRaw) {
  const b = (blocksRaw.blocks || []).find((x) => x.isActive && !x.isGap);
  if (!b) return null;
  const tls = b.tokenLimitStatus || {};
  const used = b.totalTokens || 0;
  const limit = tls.limit || null;
  const proj = b.projection || {};
  return {
    used,
    limit,
    pct: limit ? used / limit : null,
    projectedTokens: proj.totalTokens ?? null,
    projectedPct: limit && proj.totalTokens != null ? proj.totalTokens / limit : null,
    status: tls.status || "ok", // ok | warning | exceeds
    remainingMinutes: proj.remainingMinutes ?? null,
    resetsAt: b.endTime || null,
  };
}

// status → 颜色（用量提醒）
function colorFromStatus(s) {
  return s === "exceeds" ? "red" : s === "warning" ? "yellow" : "green";
}

// ccusage 是 node 的同级 bin（nvm 安装）。menubar/launchd 的 PATH 不含 nvm bin →
// 裸 spawn "ccusage" 会 ENOENT（这是 Claude 卡在 $0 的根因）。
// 修法：用正在跑的同一个 node（process.execPath）直接执行 ccusage 入口，绕开 PATH 和 shebang。
const CCUSAGE_BIN = join(dirname(process.execPath), "ccusage");
const HAS_SIBLING = existsSync(CCUSAGE_BIN);
async function ccusage(args) {
  const { stdout } = HAS_SIBLING
    ? await pexec(process.execPath, [CCUSAGE_BIN, ...args], { maxBuffer: 128 * 1024 * 1024 })
    : await pexec("ccusage", args, { maxBuffer: 128 * 1024 * 1024 });  // PATH 兜底
  return JSON.parse(stdout);
}

export async function getClaude(period, cfg) {
  try {
    const tl = String(cfg.claudeWindowTokenLimit || "max");
    // --offline：用 ccusage 本地缓存价格，跳过联网拉 LiteLLM 价目表。
    // 联网那步走 Clash 代理奇慢(~120s/次×3)，是花销墙"刷新转圈半天不更新"的真凶(2026-05-27 实测)。
    // 订阅制 Claude 只看"折算"用量、不看真钱，价格差一点无所谓。
    const [monthly, daily, blocks] = await Promise.all([
      ccusage(["monthly", "--json", "--offline"]),
      ccusage(["daily", "--json", "--offline"]).catch(() => ({ daily: [] })),
      ccusage(["blocks", "--active", "--token-limit", tl, "--json", "--offline"]).catch(() => ({ blocks: [] })),
    ]);
    const r = fromCcusage(monthly, period, cfg);
    const win = buildClaudeWindow(blocks);
    r.costNote = "Subscription"; // 订阅制不看钱
    r.color = win ? colorFromStatus(win.status) : "green";
    const util = weeklyUtilization(daily);
    r.utilization = { thisWeek: util.thisWeek, baseline: util.maxWeek, pct: util.pct, basis: "this week / your peak week", ...assess(util.pct) };
    r.stats = {
      byTime: statsFromDaily(daily),
      windows: win && win.pct != null
        ? [{ name: "5h", pct: win.pct, projectedPct: win.projectedPct, status: win.status, resetsAt: win.resetsAt }]
        : [],
      current: win,
    };
    return r;
  } catch (e) {
    return { name: "Claude", period, totalTokens: 0, costUSD: 0, costNote: "Subscription",
      limit: { type: "plan", pct: null, resetsAt: null }, byTool: null, color: "green",
      detail: cfg.claudeDetailUrl || null, stats: { byTime: {}, windows: [], current: null },
      error: String(e.message || e) };
  }
}
