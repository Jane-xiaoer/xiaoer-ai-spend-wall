// 订阅充分度判定：pct = 本周用量 / 容量基准（0~1+）
// 订阅是固定费 → 用太少=浪费订阅费，用太满=快限流。一条光谱给判定。
export function assess(pct) {
  if (pct == null) return { key: "unknown", label: "Not enough data", emoji: "·", color: "idle" };
  if (pct < 0.15) return { key: "idle", label: "Underused · idle plan", emoji: "💤", color: "idle" };
  if (pct < 0.45) return { key: "low", label: "Low · room to use more", emoji: "🌱", color: "idle" };
  if (pct < 0.80) return { key: "good", label: "Well utilized", emoji: "✅", color: "green" };
  if (pct < 1.00) return { key: "high", label: "Heavy · near limit", emoji: "🔥", color: "yellow" };
  return { key: "over", label: "At / over limit", emoji: "⚠️", color: "red" };
}
