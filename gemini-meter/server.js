import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { appendFile, readFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { costForGemini } from "../lib/pricing.js";
import { geminiToOpenAI, openAIToGemini } from "./translate.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOG = join(ROOT, "data", "gemini-usage.jsonl");
const UPSTREAM = "generativelanguage.googleapis.com";

// —— 纯函数（被测试覆盖）——
export function extractUsage(body) {
  // 非流式：整个响应就是一个 JSON（Google 还会美化成多行）→ 先整体解析
  try { const o = JSON.parse(body); if (o.usageMetadata) return o.usageMetadata; } catch { /* not whole-json */ }
  // 流式 SSE：逐行 data: 找最后一个 usageMetadata
  let usage = null;
  for (const line of body.split("\n")) {
    const s = line.startsWith("data:") ? line.slice(5).trim() : line.trim();
    if (!s || s === "[DONE]") continue;
    try { const o = JSON.parse(s); if (o.usageMetadata) usage = o.usageMetadata; } catch { /* skip */ }
  }
  return usage;
}

export function buildLogLine(u, model, tool, backend = "google") {
  const norm = {
    promptTokens: u.promptTokenCount || 0,
    candidatesTokens: u.candidatesTokenCount || 0,
    thoughtsTokens: u.thoughtsTokenCount || 0,
    totalTokens: u.totalTokenCount || 0,
  };
  return {
    ts: new Date().toISOString(),
    tool: tool || "unknown",
    backend,                              // google=真实 Gemini 花销；relay=中转站（costUSD 仅 token 量参考，非 Gemini 真钱）
    model: model || "gemini-2.5-flash",
    ...norm,
    // 仅 google 后端才是真实 Gemini 花费；relay 走中转站，costUSD 置 0（避免污染 Gemini 真钱统计）
    costUSD: backend === "relay" ? 0 : costForGemini(model || "gemini-2.5-flash", norm),
  };
}

// —— key 读取：项目 .env → api-registry → 环境变量 ——
async function readKey() {
  const candidates = [join(ROOT, ".env"), join(homedir(), ".shared-skills/api-registry/.env")];
  for (const p of candidates) {
    try {
      const m = (await readFile(p, "utf8")).match(/^\s*GEMINI_API_KEY\s*=\s*(.+)$/m);
      if (m) return m[1].trim();
    } catch { /* next */ }
  }
  return process.env.GEMINI_API_KEY || null;
}

function modelFromPath(path) {
  const m = path.match(/models\/([^:]+):/);
  return m ? m[1] : "gemini-2.5-flash";
}

async function logUsage(body, model, tool, backend = "google") {
  const u = extractUsage(body);
  if (!u) return;
  await mkdir(dirname(LOG), { recursive: true });
  await appendFile(LOG, JSON.stringify(buildLogLine(u, model, tool, backend)) + "\n");
}

function proxyUrl() {
  return process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || null;
}

// 通过 HTTP 代理建 CONNECT 隧道到指定 host，回调拿到已就绪的 TLS socket（供 https.request 复用）
function tunnelCreateConnection(proxy, host) {
  return (opts, cb) => {
    const p = new URL(proxy);
    const sock = net.connect(Number(p.port), p.hostname, () => {
      sock.write(`CONNECT ${host}:443 HTTP/1.1\r\nHost: ${host}:443\r\n\r\n`);
    });
    let buf = "";
    const onData = (chunk) => {
      buf += chunk.toString("latin1");
      if (!buf.includes("\r\n\r\n")) return;
      sock.removeListener("data", onData);
      if (/^HTTP\/1\.[01] 200/.test(buf)) {
        const tlsSock = tls.connect({ socket: sock, servername: host }, () => cb(null, tlsSock));
        tlsSock.on("error", cb);
      } else {
        cb(new Error("proxy CONNECT failed: " + buf.split("\r\n")[0]));
      }
    };
    sock.on("data", onData);
    sock.on("error", cb);
  };
}

// 全局后端开关：读 config.json 的 geminiBackend（缓存 3s，改一处即全切，不用重启）
let _backendCache = { val: "google", at: 0 };
async function backendDefault() {
  if (Date.now() - _backendCache.at < 3000) return _backendCache.val;
  try {
    const cfg = JSON.parse(await readFile(join(ROOT, "config.json"), "utf8"));
    _backendCache = { val: (cfg.geminiBackend || "google").toLowerCase(), at: Date.now() };
  } catch { _backendCache = { val: "google", at: Date.now() }; }
  return _backendCache.val;
}

// —— 中转站（OpenAI 格式）——
async function readRelay() {
  try {
    const env = await readFile(join(ROOT, ".env"), "utf8");
    const base = env.match(/^\s*RELAY_BASE_URL\s*=\s*(.+)$/m);
    const key = env.match(/^\s*RELAY_KEY\s*=\s*(.+)$/m);
    if (base && key) return { baseUrl: base[1].trim(), key: key[1].trim() };
  } catch { /* none */ }
  return null;
}

// POST OpenAI chat completions 到中转站，返回解析后的 JSON
function relayChat(relay, openaiBody, proxy) {
  return new Promise((resolve, reject) => {
    const u = new URL(relay.baseUrl);
    const data = Buffer.from(JSON.stringify(openaiBody));
    const opts = {
      hostname: u.hostname, port: 443, path: "/v1/chat/completions", method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${relay.key}`, "content-length": data.length },
    };
    if (proxy) opts.createConnection = tunnelCreateConnection(proxy, u.hostname);
    const r = https.request(opts, (res) => {
      const cs = [];
      res.on("data", (c) => cs.push(c));
      res.on("end", () => {
        const txt = Buffer.concat(cs).toString("utf8");
        if (res.statusCode >= 400) return reject(new Error(`relay ${res.statusCode}: ${txt.slice(0, 200)}`));
        try { resolve(JSON.parse(txt)); } catch (e) { reject(new Error("relay bad json: " + txt.slice(0, 150))); }
      });
    });
    r.on("error", reject);
    r.end(data);
  });
}

// —— 服务器 ——
export function createServer(key, proxy = proxyUrl(), relay = null) {
  return http.createServer(async (req, res) => {
    const tool = req.headers["x-xiaoer-tool"] || "unknown";
    // 后端：逐工具 header 覆盖 > 全局 config.geminiBackend > google
    const backend = (req.headers["x-xiaoer-backend"] || "").toLowerCase() || await backendDefault();

    // —— /record：客户端直连 Google（如 WKWebView 因 ATS 拦本地明文代理 /
    //    python/node 工具不想改走代理），只把 usageMetadata 回报来记账，不转发 ——
    if (req.method === "POST" && req.url.split("?")[0] === "/record") {
      const bufs = [];
      req.on("data", (c) => bufs.push(c));
      req.on("end", async () => {
        try {
          const { model, usage, tool: bodyTool } = JSON.parse(Buffer.concat(bufs).toString("utf8"));
          if (usage) {
            await mkdir(dirname(LOG), { recursive: true });
            // tool 优先取 body（UTF-8 安全，支持中文名）；header 仅 ASCII 兜底
            await appendFile(LOG, JSON.stringify(buildLogLine(usage, model, bodyTool || tool, backend)) + "\n");
          }
          res.writeHead(200, { "content-type": "application/json" });
          res.end('{"ok":true}');
        } catch (e) {
          res.writeHead(400); res.end(String(e.message));
        }
      });
      return;
    }

    const model = modelFromPath(req.url);

    // —— 网关：走中转站（OpenAI 格式）。generateContent + streamGenerateContent 都接；
    //    中转站只做非流式，流式请求把结果包成单条 SSE 返回（客户端 asyncPost 本就缓冲整包，无实时损失）——
    if (backend === "relay" && relay && req.method === "POST" && /:(stream)?[gG]enerateContent/.test(req.url)) {
      const isStream = /streamGenerateContent/.test(req.url);
      const bufs = [];
      req.on("data", (c) => bufs.push(c));
      req.on("end", async () => {
        try {
          const gBody = JSON.parse(Buffer.concat(bufs).toString("utf8") || "{}");
          const oResp = await relayChat(relay, geminiToOpenAI(gBody, model), proxy);
          const gResp = openAIToGemini(oResp);
          if (gResp.usageMetadata) {
            await mkdir(dirname(LOG), { recursive: true });
            await appendFile(LOG, JSON.stringify(buildLogLine(gResp.usageMetadata, model, tool, "relay")) + "\n");
          }
          if (isStream) {
            res.writeHead(200, { "content-type": "text/event-stream" });
            res.end("data: " + JSON.stringify(gResp) + "\n\n");
          } else {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify(gResp));
          }
        } catch (e) {
          res.writeHead(502, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { message: String(e.message || e) } }));
        }
      });
      return;
    }

    // 去掉工具自带的 ?key=（网关统一注入自己的 key，避免双 key 被 Google 拒）
    const cleanUrl = req.url.replace(/([?&])key=[^&]*/g, "$1").replace(/[?&]+$/, "");
    const sep = cleanUrl.includes("?") ? "&" : "?";
    const upstreamPath = `${cleanUrl}${sep}key=${key}`;
    // 缓冲请求体：重试要重发（capture 的截图也就 ~270KB，缓冲无压力）。
    const reqChunks = [];
    req.on("data", (c) => reqChunks.push(c));
    req.on("end", () => {
      const reqBody = Buffer.concat(reqChunks);
      // 加固：连接错 / Google 5xx 瞬时抖动（如 502 Bad Gateway）自动重试，避免白丢一次请求。
      // 只在「还没往客户端写任何响应字节」时重试 → 不破坏流式（状态码在首字节前到）。
      const MAX_TRIES = 3;
      let attempt = 0;
      const tryForward = () => {
        const opts = { hostname: UPSTREAM, port: 443, path: upstreamPath, method: req.method, headers: { "content-type": "application/json" } };
        if (proxy) opts.createConnection = tunnelCreateConnection(proxy, UPSTREAM);
        const chunks = [];
        const preq = https.request(opts, (pres) => {
          if (pres.statusCode >= 500) {
            // [5XX-DIAG] 上游(Clash→Google)真的回了 5xx —— 锅在 Google/Clash,不是网关本地
            console.error(`[5XX-DIAG ${new Date().toISOString()}] 上游返回 ${pres.statusCode} | tool=${tool} attempt=${attempt + 1}/${MAX_TRIES} url=${req.url.split("?")[0]}`);
          }
          if (pres.statusCode >= 500 && attempt < MAX_TRIES - 1) {
            pres.resume();                       // 丢弃这次 5xx 响应体
            attempt++;
            setTimeout(tryForward, 400 * attempt); // 退避 0.4s / 0.8s
            return;
          }
          res.writeHead(pres.statusCode, pres.headers);
          pres.on("data", (c) => { chunks.push(c); res.write(c); });
          pres.on("end", () => {
            res.end();
            logUsage(Buffer.concat(chunks).toString("utf8"), model, tool, "google").catch(() => {});
          });
        });
        preq.on("error", (e) => {
          // [5XX-DIAG] 网关↔Clash 的手写 CONNECT 隧道/连接本身出错 —— 锅在网关本地转发
          console.error(`[5XX-DIAG ${new Date().toISOString()}] 网关隧道/连接错误: ${e.code || ""} ${e.message} | tool=${tool} attempt=${attempt + 1}/${MAX_TRIES} url=${req.url.split("?")[0]}`);
          if (attempt < MAX_TRIES - 1) { attempt++; setTimeout(tryForward, 400 * attempt); return; }
          if (!res.headersSent) { res.writeHead(502); res.end(String(e.message)); }
        });
        preq.end(reqBody);
      };
      tryForward();
    });
  });
}

// —— 入口 ——
if (import.meta.url === `file://${process.argv[1]}`) {
  const cfg = JSON.parse(await readFile(join(ROOT, "config.json"), "utf8"));
  const key = await readKey();
  if (!key) { console.error("[gemini-meter] 找不到 GEMINI_API_KEY"); process.exit(1); }
  const proxy = proxyUrl();
  const relay = await readRelay();
  createServer(key, proxy, relay).listen(cfg.geminiMeterPort, "127.0.0.1", () =>
    console.log(`[gemini-meter] listening 127.0.0.1:${cfg.geminiMeterPort}${proxy ? " (via proxy " + proxy + ")" : ""}${relay ? " (relay ready)" : ""}`));
}
