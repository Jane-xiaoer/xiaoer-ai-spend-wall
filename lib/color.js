export function colorFor(pct, thresholds) {
  // pct=null → green：没限额数据时不报警（订阅制 Claude 没 spend cap）
  if (pct == null) return "green";
  if (pct >= thresholds.red) return "red";
  if (pct >= thresholds.yellow) return "yellow";
  return "green";
}
