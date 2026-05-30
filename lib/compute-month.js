// 月度账单计算 + 防误抹。
// 旧 refresh.js 失败 provider 会被 catch 兜底成 {costUSD:0, error:...}，然后
// 整个 state.json 被覆盖 → 数字归零。这里改成：失败的 provider 拿 data/months/<period>.json
// 里上次成功的值占位，绝不写 0 覆盖好数据。
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getClaude } from "../providers/claude.js";
import { getCodex } from "../providers/codex.js";
import { getGemini } from "../providers/gemini.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MONTHS_DIR = join(ROOT, "data", "months");
const CONFIG = join(ROOT, "config.json");

export const monthFile = (period) => join(MONTHS_DIR, `${period}.json`);

export function currentPeriod(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export async function loadMonth(period) {
  try {
    return JSON.parse(await readFile(monthFile(period), "utf8"));
  } catch {
    return null;
  }
}

// 失败判定：provider 自己 catch 时会写 error 字段。月初真 0 不带 error，不当失败。
const failed = (p) => Boolean(p && p.error);

export function mergeWithPrevious(fresh, previous) {
  if (!previous?.providers) return fresh;
  return fresh.map((p, i) => {
    if (!failed(p)) return p;
    const prev = previous.providers[i];
    if (!prev) return p;
    const hasValue = (prev.costUSD || 0) > 0 || (prev.totalTokens || 0) > 0;
    if (!hasValue) return p;
    return {
      ...prev,
      costNote: (prev.costNote || "") + " · 上次缓存（本次取数失败）",
      _stale: { since: new Date().toISOString(), reason: p.error },
    };
  });
}

export async function computeMonth(period = currentPeriod(), { write = true } = {}) {
  const cfg = JSON.parse(await readFile(CONFIG, "utf8"));
  const previous = await loadMonth(period);
  const fresh = await Promise.all([
    getClaude(period, cfg),
    getCodex(period, cfg),
    getGemini(period, cfg),
  ]);
  const providers = mergeWithPrevious(fresh, previous);
  const state = {
    updatedAt: new Date().toISOString(),
    period,
    providers,
    totalCostUSD: Math.round(providers.reduce((s, p) => s + (p.costUSD || 0), 0) * 100) / 100,
  };
  if (write) {
    await mkdir(MONTHS_DIR, { recursive: true });
    await writeFile(monthFile(period), JSON.stringify(state, null, 2));
  }
  return state;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const period = process.argv[2] || currentPeriod();
  computeMonth(period)
    .then((s) => console.log(JSON.stringify(s, null, 2)))
    .catch((e) => { console.error(e); process.exit(1); });
}
