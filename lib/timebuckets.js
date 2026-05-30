// 把带日期的条目分桶为 today / yesterday / week(近7天) / month(本月)
// entries: [{ date: "YYYY-MM-DD", cost, tokens }]；now: Date（可注入便于测试）
function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function bucketByTime(entries, now = new Date()) {
  const todayStr = ymd(now);
  const yd = new Date(now); yd.setDate(yd.getDate() - 1);
  const yesterdayStr = ymd(yd);
  const weekFloor = new Date(now); weekFloor.setDate(weekFloor.getDate() - 6);
  const weekFloorStr = ymd(weekFloor);
  const monthStr = todayStr.slice(0, 7);

  const z = () => ({ cost: 0, tokens: 0 });
  const out = { today: z(), yesterday: z(), week: z(), month: z() };
  const add = (b, e) => { b.cost += e.cost || 0; b.tokens += e.tokens || 0; };

  for (const e of entries) {
    if (!e.date) continue;
    if (e.date === todayStr) add(out.today, e);
    if (e.date === yesterdayStr) add(out.yesterday, e);
    if (e.date >= weekFloorStr && e.date <= todayStr) add(out.week, e);
    if (e.date.startsWith(monthStr)) add(out.month, e);
  }
  for (const k of Object.keys(out)) out[k].cost = Math.round(out[k].cost * 100) / 100;
  return out;
}
