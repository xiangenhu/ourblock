/**
 * llm/gateway.js — the ONE chokepoint for every LLM call (see _shared/llm-gateway.md).
 *
 * No feature code calls a provider directly. Everything goes through callLLM(), which
 * centralizes (1) LANGUAGE consistency, (2) provider/vendor choice, (3) timeouts, and
 * (4) lightweight token accounting to GCS.
 *
 *   callLLM({ system, user, lang, userId, feature, maxTokens, model, json }) -> string
 *
 * Vendor is chosen by LLM_VENDOR (config.requireLlm). Two request "shapes" are supported:
 *   - openai    : OpenAI-compatible /chat/completions (OpenAI, Groq, DeepSeek, Ollama, …)
 *   - anthropic : Anthropic /v1/messages
 * Adding a vendor = one entry in config.VENDORS, not a change here unless the shape is new.
 */
import config from '../config.js';
import { record } from './accounting.js';

const LANG_NAME = {
  en: 'English', zh: 'Chinese', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian',
  pt: 'Portuguese', ja: 'Japanese', ko: 'Korean', th: 'Thai', vi: 'Vietnamese', ru: 'Russian',
  hi: 'Hindi', ar: 'Arabic', he: 'Hebrew', fa: 'Persian', ur: 'Urdu',
};
function langDirective(lang) {
  if (!lang) return '';
  const name = LANG_NAME[String(lang).toLowerCase()] || 'English';
  return `Respond in ${name}. Do not switch languages mid-answer.`;
}

function withTimeout(ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, done: () => clearTimeout(t) };
}

// ── Multimodal helpers — fold an optional { base64, mediaType } image into the
//    user message in each provider's native wire format. No image → plain string.
function openAIUserContent(user, image) {
  if (!image) return String(user || '');
  return [
    ...(user ? [{ type: 'text', text: String(user) }] : []),
    { type: 'image_url', image_url: { url: `data:${image.mediaType};base64,${image.base64}` } },
  ];
}
function anthropicUserContent(user, image) {
  if (!image) return String(user || '');
  return [
    ...(user ? [{ type: 'text', text: String(user) }] : []),
    { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.base64 } },
  ];
}
function geminiParts(user, image) {
  const parts = [];
  if (user) parts.push({ text: String(user) });
  if (image) parts.push({ inlineData: { mimeType: image.mediaType, data: image.base64 } });
  return parts.length ? parts : [{ text: '' }];
}

// ── Provider shapes — the only places that touch a provider wire format ───────
async function callOpenAIShape(v, { sys, user, image, model, maxTokens, json }) {
  const r = await fetch(`${v.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${v.apiKey}` },
    signal: v.signal,
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      ...(json ? { response_format: { type: 'json_object' } } : {}),
      messages: [
        ...(sys ? [{ role: 'system', content: sys }] : []),
        { role: 'user', content: openAIUserContent(user, image) },
      ],
    }),
  });
  if (!r.ok) throw new Error(`[llm] ${v.vendor} ${r.status}: ${(await r.text().catch(() => '')).slice(0, 300)}`);
  const data = await r.json();
  return {
    answer: data?.choices?.[0]?.message?.content || '',
    usage: data.usage
      ? { prompt_tokens: data.usage.prompt_tokens, completion_tokens: data.usage.completion_tokens, total_tokens: data.usage.total_tokens }
      : {},
  };
}

async function callAnthropicShape(v, { sys, user, image, model, maxTokens }) {
  const r = await fetch(`${v.baseUrl}/v1/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': v.apiKey, 'anthropic-version': '2023-06-01' },
    signal: v.signal,
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      ...(sys ? { system: sys } : {}),
      messages: [{ role: 'user', content: anthropicUserContent(user, image) }],
    }),
  });
  if (!r.ok) throw new Error(`[llm] anthropic ${r.status}: ${(await r.text().catch(() => '')).slice(0, 300)}`);
  const data = await r.json();
  const answer = (data?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  return {
    answer,
    usage: data.usage
      ? { prompt_tokens: data.usage.input_tokens, completion_tokens: data.usage.output_tokens, total_tokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0) }
      : {},
  };
}

async function callGeminiShape(v, { sys, user, image, model, maxTokens, json }) {
  const url = `${v.baseUrl}/models/${model}:generateContent?key=${v.apiKey}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: v.signal,
    body: JSON.stringify({
      ...(sys ? { systemInstruction: { parts: [{ text: sys }] } } : {}),
      contents: [{ role: 'user', parts: geminiParts(user, image) }],
      generationConfig: { maxOutputTokens: maxTokens, ...(json ? { responseMimeType: 'application/json' } : {}) },
    }),
  });
  if (!r.ok) throw new Error(`[llm] gemini ${r.status}: ${(await r.text().catch(() => '')).slice(0, 300)}`);
  const data = await r.json();
  const answer = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  const um = data.usageMetadata || {};
  return {
    answer,
    usage: { prompt_tokens: um.promptTokenCount, completion_tokens: um.candidatesTokenCount, total_tokens: um.totalTokenCount },
  };
}

const SHAPES = { openai: callOpenAIShape, anthropic: callAnthropicShape, gemini: callGeminiShape };

/**
 * The single entry point. Returns the model's text. `json:true` asks providers that
 * support it for a JSON object (callers still parse defensively).
 */
export async function callLLM({ system, user, image, lang, userId, feature = 'general', maxTokens = 1024, model, json = false } = {}) {
  const v = config.requireLlm();
  const chosenModel = model || v.model;
  const sys = [system, langDirective(lang)].filter(Boolean).join('\n'); // language enforced centrally

  const shapeFn = SHAPES[v.shape];
  if (!shapeFn) throw new Error(`[llm] no request shape "${v.shape}" for vendor ${config.llm.vendor}`);

  const t = withTimeout(v.timeoutMs);
  try {
    const { answer, usage } = await shapeFn(
      { ...v, vendor: config.llm.vendor, signal: t.signal },
      { sys, user, image, model: chosenModel, maxTokens, json }
    );
    record({ userId, feature, vendor: config.llm.vendor, model: chosenModel, usage }).catch(() => {});
    return answer;
  } finally {
    t.done();
  }
}

export { langDirective };
export default { callLLM, langDirective };
