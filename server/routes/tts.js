/**
 * routes/tts.js — optional read-aloud for help replies (see _shared/CONTEXT_HELP.md §5.3, §11.4).
 *
 *   POST /api/tts   public — returns audio/mpeg; GCS-cached under `cache/tts/`.
 *
 * Notes for this app:
 *   - Persistence is GCS only (store/gcs.js getBuffer/putBuffer). Cache is the cost lever:
 *     a hit short-circuits the upstream call (~10× faster, free).
 *   - TTS is *audio*, not a text/chat completion, so it does not go through the text LLM gateway
 *     (which is text-only). It is the one provider call outside that gateway, guarded by the cache
 *     + a per-IP rate limit + input caps. Credentials come from the central config, not ad-hoc env.
 *   - 415 for languages without voice coverage, so the client can trust meta.tts === false and
 *     hide the chip without burning a miss + a failed upstream call.
 */
import express from 'express';
import crypto from 'crypto';
import store from '../store/gcs.js';
import config from '../config.js';
import { rateLimiter } from '../help/util.js';

const router = express.Router();

const TTS_MAX_CHARS = 2500;
const TTS_DEFAULT_VOICE = 'alloy';
const TTS_DEFAULT_MODEL = 'gpt-4o-mini-tts';
const TTS_SUPPORTS_INSTRUCTIONS = (m) => /^gpt-4o/i.test(m || '');

// Languages without TTS voice coverage. Extend per your provider.
const TTS_UNSUPPORTED_LANGS = new Set(['my', 'km', 'lo', 'bn', 'te', 'si', 'mn']);

function ttsCacheKey({ model, voice, lang, instructions, text }) {
  const norm = [String(model || ''), String(voice || ''), String(lang || ''),
                String(instructions || ''), String(text || '')].join('');
  return crypto.createHash('sha1').update(norm).digest('hex').slice(0, 40);
}

router.post('/tts', rateLimiter({ windowMs: 60_000, max: 30 }), async (req, res) => {
  try {
    const b = req.body || {};
    const text = (typeof b.text === 'string' ? b.text : '')
      .replace(/\s+/g, ' ').trim().slice(0, TTS_MAX_CHARS);
    if (!text) return res.status(400).json({ error: 'text required' });
    const voice = (typeof b.voice === 'string' && b.voice.trim()) ? b.voice.trim().slice(0, 32) : TTS_DEFAULT_VOICE;
    const model = (typeof b.model === 'string' && b.model.trim()) ? b.model.trim().slice(0, 64) : TTS_DEFAULT_MODEL;

    const lang = typeof b.lang === 'string' ? b.lang : '';
    if (TTS_UNSUPPORTED_LANGS.has(lang.toLowerCase())) {
      return res.status(415).json({ error: 'tts not supported for this language', lang });
    }
    const instructions = (typeof b.instructions === 'string' ? b.instructions.trim() : '').slice(0, 500);
    const effectiveInstr = TTS_SUPPORTS_INSTRUCTIONS(model) ? instructions : '';

    const key = ttsCacheKey({ model, voice, lang, instructions: effectiveInstr, text });
    res.set('X-TTS-Cache-Key', key);

    // Try the GCS cache first.
    try {
      const cached = await store.getBuffer(`cache/tts/${key}.mp3`);
      if (cached && cached.length) {
        res.set('Content-Type', 'audio/mpeg');
        res.set('Cache-Control', 'no-store');
        res.set('X-TTS-Cache', 'hit');
        return res.send(cached);
      }
    } catch (e) { console.warn('[tts] cache read', e.message); }

    const openai = config.llm.vendors.openai;
    if (!openai?.apiKey) {
      return res.status(503).json({ error: 'OpenAI key is not configured for TTS' });
    }
    const payload = { model, voice, input: text, response_format: 'mp3' };
    if (effectiveInstr) payload.instructions = effectiveInstr;

    const upstream = await fetch(`${openai.baseUrl}/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openai.apiKey}` },
      body: JSON.stringify(payload),
    });
    if (!upstream.ok) {
      const err = await upstream.text().catch(() => '');
      return res.status(502).json({ error: 'tts upstream failed', detail: err.slice(0, 300) });
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.set('Content-Type', 'audio/mpeg');
    res.set('Cache-Control', 'no-store');
    res.set('X-TTS-Cache', 'miss');
    res.send(buf);

    // Persist fire-and-forget (audio bytes + a JSON sidecar) to GCS.
    Promise.all([
      store.putBuffer(`cache/tts/${key}.mp3`, buf, 'audio/mpeg'),
      store.putBuffer(`cache/tts/${key}.json`,
        Buffer.from(JSON.stringify({ key, model, voice, lang, instructions: effectiveInstr,
          text, bytes: buf.length, createdAt: new Date().toISOString() })),
        'application/json; charset=utf-8'),
    ]).catch((e) => console.warn('[tts] persist failed', e.message));
  } catch (e) {
    console.error('[tts]', e);
    res.status(500).json({ error: e.message });
  }
});

export default router;
