'use strict';
/**
 * help/assist.js — in-place "work surface" assistance (learning-ux P3).
 * Any view where a learner produces or judges work (write/critique/revise/evaluate/plan) routes
 * here. Distinct from contextual help (/help/ask, "what is this?"): this acts ON the artifact.
 *
 * Hard guarantees:
 *   - Routes through the single gateway (never a provider).             [llm-gateway invariant]
 *   - SCAFFOLDS, does not do the work: suggests, explains, prompts —     [team-ai-safety]
 *     never returns finished work the learner can paste as their own.
 *   - Personalized artifacts are NOT pool-cached (each is unique/PII).   [team-privacy / cache]
 *
 *   POST /api/assist  { mode, artifact, instruction?, lang? }  (auth required; learner-facing)
 *   mode ∈ critique | revise-suggestions | explain | hint | check
 */
const express = require('express');
const { callLLM } = require('../llm/gateway');

const MODES = {
  critique:            'Give constructive critique of the learner\'s work: 2–4 specific observations, each with a why. Do NOT rewrite it for them.',
  'revise-suggestions':'Suggest concrete revisions as guidance (what to change and why). Offer at most one short illustrative fragment; do NOT produce the full revised work.',
  explain:             'Explain the highlighted item or the feedback already given, in plain language.',
  hint:                'Give ONE next-step hint that moves the learner forward without giving the answer.',
  check:              'Point out what may be missing or weak, as questions the learner should consider. Do NOT supply the answers.',
};
const ARTIFACT_CAP = 8000;

function router() {
  const r = express.Router();
  r.post('/assist', async (req, res) => {
    try {
      const u = req.user;
      if (!u || !u.id) return res.status(401).json({ error: 'authentication required' });
      const b = req.body || {};
      const mode = MODES[b.mode] ? b.mode : 'hint';
      const artifact = String(b.artifact || '').slice(0, ARTIFACT_CAP);
      if (!artifact.trim()) return res.status(400).json({ error: 'artifact required' });
      const instruction = String(b.instruction || '').slice(0, 500);
      const lang = b.lang;

      const system = [
        'You are an in-place learning assistant inside a learning app.',
        'You SCAFFOLD learning — you are a coach, not a ghost-writer.',
        'Never produce finished work the learner could submit as their own.',
        'Be specific and brief. Prefer questions and pointers over answers.',
        // PRIVACY: caller must redact PII before sending; do not echo personal identifiers.
        `Task: ${MODES[mode]}`,
      ].join('\n');
      const user = [instruction ? `Learner instruction: ${instruction}` : '',
                    'Learner\'s work:', '"""', artifact, '"""'].filter(Boolean).join('\n');

      // feature tag drives cost attribution; cache:false because artifacts are personal/unique.
      const answer = (await callLLM({ system, user, lang, userId: u.id, feature: `assist:${mode}`, cache: false }) || '').trim();
      res.json({ mode, answer });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  return r;
}
module.exports = router;
