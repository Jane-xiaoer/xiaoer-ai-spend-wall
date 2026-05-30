// 小耳 AI 花销墙 富面板渲染。Hammerspoon 注入 window.XIAOER_PAY_STATE 后调 render()。
const $ = (id) => document.getElementById(id);
const USD_TO_CNY = 7.2; // 本地计量是 USD 估算，面板按人民币展示
const money = (n) => "¥" + ((n || 0) * USD_TO_CNY).toFixed(2); // 入参是 USD
const cny = (n) => "¥" + (n || 0).toFixed(2); // 入参已是 CNY
const fmtNum = (n) => (n || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
const tok = (n) => {
  n = n || 0;
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n);
};
// 工具名一律英文
const TOOL_LABEL = { "小耳找到": "xiaoer-find", "智能重命名": "rename", "xiaoer-ask": "xiaoer-ask", "xiaoer-find": "xiaoer-find", "rename": "rename", "unknown": "unknown" };
const label = (t) => TOOL_LABEL[t] || t;
const barColor = (pct) => (pct >= 0.85 ? "var(--red)" : pct >= 0.5 ? "var(--yellow)" : "var(--green)");
const STATUS_TXT = { ok: "Normal", warning: "High ⚠️", exceeds: "Over your peak 🔴" };
const resetIn = (ts) => {
  if (!ts) return "";
  const ms = (typeof ts === "number" ? ts * 1000 : Date.parse(ts)) - Date.now();
  const mins = Math.max(0, Math.round(ms / 60000));
  if (mins < 60) return `resets in ${mins}m`;
  const h = Math.floor(mins / 60);
  return h < 24 ? `resets in ${h}h` : `resets in ${Math.floor(h / 24)}d`;
};

function gauge(w) {
  const p = Math.min(1, Math.max(0, w.pct || 0));
  const proj = w.projectedPct != null ? Math.min(1, w.projectedPct) : null;
  const projMark = proj != null
    ? `<span style="position:absolute;left:${(proj * 100).toFixed(1)}%;top:-2px;width:2px;height:11px;background:var(--ink);opacity:.7"></span>` : "";
  const projTxt = proj != null ? `　est. ${(proj * 100).toFixed(0)}%` : "";
  return `<div class="barlabel"><span>${w.name}</span><b>${(p * 100).toFixed(0)}%${projTxt}</b></div>
    <div class="bar" style="position:relative"><i style="width:${(p * 100).toFixed(1)}%;background:${barColor(w.pct)}"></i>${projMark}</div>
    <div class="barlabel"><span></span><span>${resetIn(w.resetsAt)}</span></div>`;
}

function timeGrid(byTime, kind) {
  if (!byTime || !byTime.month) return "";
  const fmt = (b) => (kind === "money" ? money(b.cost) : tok(b.tokens) + " tok");
  const cell = (k, b) => `<div class="cell"><div class="k">${k}</div><div class="v">${fmt(b || {})}</div></div>`;
  return `<div class="grid">
    ${cell("Today", byTime.today)}${cell("Yesterday", byTime.yesterday)}
    ${cell("Week", byTime.week)}${cell("Month", byTime.month)}
  </div>`;
}

function card(p) {
  const st = p.stats || {};
  let body = "";

  if (p.name === "Gemini") {
    const a = p.authoritative;
    if (a) {
      const when = new Date(a.updatedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
      body += `<div class="cost">${cny(a.totalCNY)}<small>real · AI Studio · ${when}</small></div>`;
      if (a.capPct != null) {
        body += gauge({ name: `Spend cap · ${a.capProject || ""}`, pct: a.capPct });
        body += `<div class="proj">NT$${fmtNum(a.capUsedNTD)} / NT$${fmtNum(a.capLimitNTD)}　resets monthly</div>`;
      }
      body += `<div class="proj">Local metered tools: ${money(p.costUSD)}</div>`;
    } else {
      body += `<div class="cost">${money(p.costUSD)}<small>metered (local only)</small></div>`;
      if (p.limit && p.limit.pct != null) body += gauge({ name: "Spend cap", pct: p.limit.pct });
    }
    body += timeGrid(st.byTime, "money");
    // 优先按项目显示「钱」(byProjectCost, USD→¥)；没有就回退到 token
    const costs = p.byProjectCost && Object.keys(p.byProjectCost).length ? p.byProjectCost : null;
    const tools = Object.entries(costs || p.byProject || p.byTool || {}).sort((a, b) => b[1] - a[1]);
    const fmtV = costs ? (n) => money(n) : (n) => tok(n) + " tok";
    if (tools.length) {
      body += `<div class="tools">${tools.map(([t, n]) => `<div class="t"><span>${label(t)}</span><span>${fmtV(n)}</span></div>`).join("")}</div>`;
    }
  } else {
    const u = p.utilization;
    if (u) {
      const pc = u.pct != null ? `${(u.pct * 100).toFixed(0)}%` : "no data";
      body += `<div class="verdict ${u.color}">${u.emoji} ${u.label}<span class="pc">${pc} · ${u.basis || ""}</span></div>`;
    }
    const win = st.current;
    if (p.name === "Claude" && win) {
      body += `<div class="proj">Current 5h window <b style="color:var(--ink)">${tok(win.used)}</b> tok` +
        (win.remainingMinutes != null ? `　resets in ${win.remainingMinutes}m` : "") + `</div>`;
    }
    for (const w of st.windows || []) body += gauge(w);
    if (p.name === "Claude" && win) {
      body += `<div class="proj">${STATUS_TXT[win.status] || ""}${win.limit ? `　baseline≈${tok(win.limit)} tok (your peak)` : ""}</div>`;
    }
    body += timeGrid(st.byTime, "tokens");
    if (!(st.windows || []).length && !win) body += `<div class="proj">No active window</div>`;
  }

  if (p.error) body += `<div class="err">⚠️ ${p.error}</div>`;

  const dot = p.name !== "Gemini" && p.utilization ? p.utilization.color : p.color;
  const cls = (p.name || "").toLowerCase();
  return `<div class="card ${cls}">
    <div class="top">
      <span class="name"><i class="dot ${dot}"></i>${p.name}</span>
      <span class="tag">${p.costNote || ""}</span>
    </div>
    ${body}
  </div>`;
}

function render() {
  const st = window.XIAOER_PAY_STATE;
  if (!st) return;
  $("upd").textContent = (st.period || "") + " · " + new Date(st.updatedAt || Date.now()).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  $("cards").innerHTML = (st.providers || []).map(card).join("");
  const gem = (st.providers || []).find((p) => p.name === "Gemini");
  $("total").textContent = gem && gem.authoritative ? cny(gem.authoritative.totalCNY) : money(gem ? gem.costUSD : 0);
}
window.xiaoerPayRender = render;

// Refresh 按钮已删（月度账单模式：数据在打开面板时由 lua 触发 compute-month 计算，
// 失败的 provider 用 data/months/<当月>.json 上次成功值占位，绝不抹零）。

render();
