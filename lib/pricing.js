// USD per 1M tokens（2026-05 兜底价，可手更）
const GEMINI = {
  "gemini-2.5-flash": { in: 0.30, out: 2.50 },
  "gemini-2.5-pro":   { in: 1.25, out: 10.0 },
};
const GEMINI_FALLBACK = GEMINI["gemini-2.5-flash"];

const CODEX = {
  "gpt-5.5": { in: 1.25, cachedIn: 0.125, out: 10.0 },
};
const CODEX_FALLBACK = CODEX["gpt-5.5"];

const per = (tokens, rate) => (tokens / 1_000_000) * rate;

export function costForGemini(model, u) {
  const r = GEMINI[model] || GEMINI_FALLBACK;
  // thoughts(思考) 计入 output 价
  return per(u.promptTokens || 0, r.in) + per((u.candidatesTokens || 0) + (u.thoughtsTokens || 0), r.out);
}

export function costForCodex(model, u) {
  const r = CODEX[model] || CODEX_FALLBACK;
  const billedInput = (u.input_tokens || 0) - (u.cached_input_tokens || 0);
  return per(Math.max(0, billedInput), r.in)
       + per(u.cached_input_tokens || 0, r.cachedIn)
       + per(u.output_tokens || 0, r.out);
}
