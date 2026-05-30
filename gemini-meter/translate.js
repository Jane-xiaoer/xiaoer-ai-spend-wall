// Gemini generateContent ↔ OpenAI chat completions 格式互译（网关用：工具说 Gemini，中转站只懂 OpenAI）

// Gemini 请求体 + model → OpenAI chat completions 请求体
export function geminiToOpenAI(g, model) {
  const messages = [];
  const sys = g.system_instruction || g.systemInstruction;
  if (sys?.parts) {
    const t = sys.parts.map((p) => p.text).filter(Boolean).join("\n");
    if (t) messages.push({ role: "system", content: t });
  }
  for (const c of g.contents || []) {
    const role = c.role === "model" ? "assistant" : "user";
    const arr = [];
    let hasImage = false;
    for (const p of c.parts || []) {
      if (p.text != null) {
        arr.push({ type: "text", text: p.text });
      } else {
        const d = p.inline_data || p.inlineData;
        if (d) { hasImage = true; arr.push({ type: "image_url", image_url: { url: `data:${d.mime_type || d.mimeType};base64,${d.data}` } }); }
      }
    }
    // 纯文本 → 字符串；含图 → OpenAI 多模态数组
    messages.push({ role, content: hasImage ? arr : arr.map((x) => x.text).join("\n") });
  }
  const gc = g.generationConfig || {};
  const out = { model, messages };
  if (gc.temperature != null) out.temperature = gc.temperature;
  if (gc.maxOutputTokens != null) out.max_tokens = gc.maxOutputTokens;
  return out;
}

// OpenAI chat completion 响应 → Gemini generateContent 响应
export function openAIToGemini(o) {
  const choice = (o.choices || [])[0] || {};
  const text = (choice.message && choice.message.content) || "";
  const u = o.usage || {};
  return {
    candidates: [{
      content: { parts: [{ text }], role: "model" },
      finishReason: String(choice.finish_reason || "stop").toUpperCase(),
      index: 0,
    }],
    usageMetadata: {
      promptTokenCount: u.prompt_tokens || 0,
      candidatesTokenCount: u.completion_tokens || 0,
      totalTokenCount: u.total_tokens || (u.prompt_tokens || 0) + (u.completion_tokens || 0),
    },
    modelVersion: o.model || "",
  };
}
