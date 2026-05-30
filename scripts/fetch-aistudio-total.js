// 经 CDP page 级 WS 驱动已登录的 Brave（127.0.0.1:19825），打开 AI Studio 用量页抓文本。
// bb-browser monitor 连不上时的可靠后路（Node 22 自带 WebSocket）。
// 用法: node fetch-aistudio-total.js [url]
const HOST = "127.0.0.1:19825";
const URL_TARGET = process.argv[2] || "https://aistudio.google.com/usage";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // 1. 新建 tab（PUT /json/new）
  const tab = await (await fetch(`http://${HOST}/json/new?${encodeURIComponent(URL_TARGET)}`, { method: "PUT" })).json();
  const wsUrl = tab.webSocketDebuggerUrl || `ws://${HOST}/devtools/page/${tab.id}`;

  // 2. 连 page 级 WS（无 session 路由）
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  let id = 0;
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id; pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params }));
    setTimeout(() => { if (pending.has(mid)) { pending.delete(mid); reject(new Error("timeout " + method)); } }, 25000);
  });
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const r = pending.get(m.id); pending.delete(m.id); r(m.result || m.error); } };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  // 把 tab 弹到前台，避免后台节流冻结渲染器（Page.enable 卡死的元凶）
  await fetch(`http://${HOST}/json/activate/${tab.id}`).catch(() => {});
  await sleep(9000); // AI Studio 重前端 + 可能的 Google auth 跳转，等渲染

  const grab = async () => {
    const r = await send("Runtime.evaluate", {
      expression: `JSON.stringify({url:location.href,loggedIn:!!document.querySelector('img[src*=googleusercontent],a[href*=SignOut]'),text:document.body.innerText.replace(/\\n{2,}/g,'\\n').slice(0,4500)})`,
      returnByValue: true,
    });
    return r?.result?.value;
  };
  let out = await grab();
  if (!out || JSON.parse(out).text.length < 120) { await sleep(6000); out = await grab(); }

  // 关 tab，不留尾巴
  await fetch(`http://${HOST}/json/close/${tab.id}`).catch(() => {});
  ws.close();
  console.log(out || "(空)");
}
main().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
