// 用 bb-browser 抓 AI Studio 各付费项目的真实花费(NT$)+ 支出上限，写进 data/aistudio-spend.json。
// 这是「权威总额」来源（含云端 app，本地计量覆盖不到的也算）。慢（每项目开页~10s），单独/定时跑，不进 refresh.js 快路径。
// 用法: node scripts/fetch-aistudio-spend.js
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const cfg = JSON.parse(readFileSync(join(ROOT, "config.json"), "utf8"));
const OUT = join(ROOT, "data", "aistudio-spend.json");
const env = { ...process.env };
delete env.SSL_CERT_FILE; // macOS 怪癖

const bb = (args) => execSync(`bb-browser ${args}`, { env, timeout: 60000, encoding: "utf8" });
const sleep = (s) => execSync(`sleep ${s}`);

// "3.82K"/"1.2M"/"4,220.38" → number
function num(s) {
  if (!s) return 0;
  const m = String(s).replace(/[, ]/g, "").match(/([\d.]+)([KkMm]?)/);
  if (!m) return 0;
  let n = parseFloat(m[1]);
  if (/[Kk]/.test(m[2])) n *= 1e3;
  if (/[Mm]/.test(m[2])) n *= 1e6;
  return n;
}

function parse(text) {
  // 上限: NT$用了 / NT$上限
  const cap = text.match(/NT\$([\d,.]+)\s*\/\s*NT\$([\d,.]+)/);
  // 总费用: "您的总费用(日期)" 之后第一个 $数字 = 费用值（账户币种=NT$，页面用 $ 泛指）
  const seg = text.split("您的总费用")[1] || "";
  const totalM = seg.match(/\$\s*([\d.,]+[KkMm]?)/);
  return {
    totalNTD: totalM ? num(totalM[1]) : null,
    capUsedNTD: cap ? num(cap[1]) : null,
    capLimitNTD: cap ? num(cap[2]) : null,
  };
}

const projects = [];
for (const p of cfg.aistudioProjects || []) {
  try {
    bb(`open "https://aistudio.google.com/spend?project=${p.id}"`);
    sleep(11);
    const text = bb(`eval "document.body.innerText"`);
    const d = parse(text);
    projects.push({ ...p, ...d });
    console.error(`✓ ${p.name}: 总费用 NT$${d.totalNTD} | 上限 NT$${d.capUsedNTD}/${d.capLimitNTD}`);
  } catch (e) {
    projects.push({ ...p, error: String(e.message || e).slice(0, 80) });
    console.error(`✗ ${p.name}: ${e.message}`);
  }
}
try { bb("close"); } catch {}

const rate = cfg.ntdToCny || 0.227;
const totalNTD = projects.reduce((s, p) => s + (p.totalNTD || 0), 0);
const allFailed = projects.length > 0 && projects.every((p) => p.error);
const out = {
  updatedAt: new Date().toISOString(),
  rate,
  totalNTD,
  totalCNY: Math.round(totalNTD * rate * 100) / 100,
  projects,
};
mkdirSync(dirname(OUT), { recursive: true });
// 防误抹：所有 projects 都 error（bb-browser 整体挂了）就别覆盖好数据。
// 这是 2026-05-27 18:02 那次"把 NT$4310.9 抹成 NT$0"事故的根因修复——
// 当年 panel 'This month ¥0' 也是这条道路造成的。
// 部分成功仍然写入（合理：某些项目恰好为 0 或个别页面渲染失败）。
if (allFailed && existsSync(OUT)) {
  console.error(`\n⚠ 所有 ${projects.length} 个项目都失败，跳过写入 ${OUT}（保留上次好数据）`);
} else {
  writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.error(`\n写入 ${OUT}: 总额 NT$${totalNTD} ≈ ¥${out.totalCNY}`);
}

// ── 历史 + 报警（2026-05-27 加：花销墙盯 Google 真实总额，超 NT$1500 / 单次跳涨弹通知）──
// 来历见 ~/.claude/memories/feedback_gemini_bill_spike_diagnosis.md（5/22 全量 enrich 暴涨没人知道）。
const HIST = join(ROOT, "data", "aistudio-spend-history.jsonl");
let prevTotal = null;
try {
  if (existsSync(HIST)) {
    const lines = readFileSync(HIST, "utf8").trim().split("\n").filter(Boolean);
    if (lines.length) prevTotal = JSON.parse(lines[lines.length - 1]).totalNTD ?? null;
  }
} catch {}
try {
  appendFileSync(HIST, JSON.stringify({
    ts: out.updatedAt, totalNTD,
    byProject: Object.fromEntries(projects.map((p) => [p.name, p.totalNTD || 0])),
  }) + "\n");
} catch {}

const ALERT_NTD = cfg.geminiRealAlertNTD || 1500;
const JUMP_NTD = cfg.geminiRealDailyJumpNTD || 500;
const top = projects.reduce((a, b) => ((b.totalNTD || 0) > (a.totalNTD || 0) ? b : a), { totalNTD: 0 });
const jump = prevTotal != null ? totalNTD - prevTotal : null;
const reasons = [];
if (totalNTD > ALERT_NTD) reasons.push(`本月已 NT$${Math.round(totalNTD)} > 阈值 NT$${ALERT_NTD}`);
if (jump != null && jump > JUMP_NTD) reasons.push(`较上次 +NT$${Math.round(jump)}`);
if (reasons.length) {
  const msg = `${reasons.join("；")}。大头：${top.name} NT$${Math.round(top.totalNTD || 0)}`;
  console.error(`⚠ 报警：${msg}`);
  try {
    const esc = (s) => String(s).replace(/["\\]/g, "\\$&");
    execSync(
      `osascript -e 'display notification "${esc(msg)}" with title "👂 Gemini 真实花费预警" sound name "Glass"'`,
      { env, timeout: 8000 }
    );
  } catch (e) {
    console.error("通知发送失败:", e.message);
  }
}
