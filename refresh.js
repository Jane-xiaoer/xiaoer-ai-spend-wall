// 薄壳：保留 `npm run refresh` 入口（命令行手动归档 / launchd 月底滚档）。
// 真实逻辑在 lib/compute-month.js，那里有"失败 provider 用上次缓存"的防误抹保护。
// 历史包袱：旧 menubar.lua/panel 通过 IPC 调本文件触发"实时刷新"——已废，
// 别再加 Refresh 按钮/定时器（参见 CLAUDE.md）。
import { computeMonth, currentPeriod } from "./lib/compute-month.js";

export { computeMonth as refresh, currentPeriod };

if (import.meta.url === `file://${process.argv[1]}`) {
  const period = process.argv[2] || currentPeriod();
  computeMonth(period)
    .then((s) => console.log(JSON.stringify(s, null, 2)))
    .catch((e) => { console.error(e); process.exit(1); });
}
