/**
 * Translation Suggestion Mode — PORTABLE runtime (framework: React)
 * ===========================================================================
 * A teacher/admin tool for correcting bad translations in place, built on the
 * hash pattern: every string renders as <span data-i18n="{hash}">…</span>, and
 * that {hash} is the shared key across the source locale and every translation.
 * From any element we therefore recover the Original (source) text, the Current
 * translation, and the identity to file a correction — with zero bookkeeping.
 *
 * PORTABILITY: this component is decoupled from any specific app. It takes the
 * host's decisions as props instead of importing them:
 *   • canUse         — boolean: is the current viewer allowed to suggest?
 *                      (host computes this from its own roles: teacher/admin/etc.)
 *   • getAuthHeaders — () => object of headers to attach to the submit request
 *                      (e.g. { Authorization: `Bearer ${token}` }). Optional.
 *   • apiBase        — request prefix (default '/server'); posts to
 *                      `${apiBase}/i18n/suggestions`.
 * It reads translation data from the co-located I18nContext (useI18n) and only
 * activates when the display language differs from the source language ('en').
 *
 * See the kit README for the full integration contract.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useI18n } from './I18nContext';
import { I18nText } from './I18nText';
import './SuggestionMode.css';

const SOURCE_LANG = 'en'; // the language English text is authored in

export default function SuggestionMode({
  canUse = false,
  apiBase = '/server',
  getAuthHeaders
}) {
  const { language, translations, supportedLanguages } = useI18n();

  const [enabled, setEnabled] = useState(false);
  const [modal, setModal] = useState(null); // { hash, english, current }
  const [suggested, setSuggested] = useState('');
  const [status, setStatus] = useState('idle'); // idle | saving | ok | err
  const [errMsg, setErrMsg] = useState('');
  const [aiAlts, setAiAlts] = useState([]);     // AI-proposed alternative translations
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [allowAny, setAllowAny] = useState(false); // server debugging mode → any user may suggest

  // In debugging mode (I18N_SUGGEST_MODE=debugging) the server opens suggesting
  // to everyone — including guests. Fetch that flag once.
  useEffect(() => {
    let alive = true;
    fetch(`${apiBase}/i18n/suggest-config`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(cfg => { if (alive && cfg) setAllowAny(!!cfg.allowAny); })
      .catch(() => { /* default: caller's canUse only */ });
    return () => { alive = false; };
  }, [apiBase]);

  // Active for permitted users (host's `canUse`) OR anyone in debugging mode,
  // and only when NOT viewing the source language.
  const active = (canUse || allowAny) && language !== SOURCE_LANG;

  // Global capture-phase click delegation while the mode is on.
  useEffect(() => {
    if (!enabled || !active) return;

    const onClick = (e) => {
      // Never treat the tool's own chrome (toggle + modal) as a target.
      if (e.target.closest('[data-suggest-ui]')) return;

      const el = e.target.closest('[data-i18n]');
      if (!el) return;
      const hash = el.getAttribute('data-i18n');
      if (!hash || !/^[a-f0-9]{16}$/.test(hash)) return;

      e.preventDefault();
      e.stopPropagation();

      const displayed = (el.textContent || '').trim();
      const english = translations[SOURCE_LANG]?.[hash] || displayed;
      const current = translations[language]?.[hash] || displayed;

      setModal({ hash, english, current });
      setSuggested(current);
      setStatus('idle');
      setErrMsg('');
      setAiAlts([]);
      setAiError('');
    };

    document.addEventListener('click', onClick, true); // capture phase
    document.body.classList.add('i18n-suggest-active');
    return () => {
      document.removeEventListener('click', onClick, true);
      document.body.classList.remove('i18n-suggest-active');
    };
  }, [enabled, active, language, translations]);

  // Auto-disable if the viewer switches back to the source language.
  useEffect(() => {
    if (!active && enabled) {
      setEnabled(false);
      setModal(null);
    }
  }, [active, enabled]);

  const closeModal = useCallback(() => {
    setModal(null);
    setSuggested('');
    setStatus('idle');
    setErrMsg('');
    setAiAlts([]);
    setAiError('');
  }, []);

  // Ask the LLM for a few alternative translations of this string.
  const askAi = useCallback(async () => {
    if (!modal || aiLoading) return;
    setAiLoading(true);
    setAiError('');
    try {
      const headers = { 'Content-Type': 'application/json', ...(getAuthHeaders?.() || {}) };
      const res = await fetch(`${apiBase}/i18n/suggest-alternatives`, {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({ english: modal.english, current: modal.current, lang: language })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      const list = Array.isArray(data.alternatives) ? data.alternatives : [];
      setAiAlts(list);
      if (!list.length) setAiError('No suggestions returned');
    } catch (err) {
      setAiError(err?.message || 'AI suggestion failed');
    } finally {
      setAiLoading(false);
    }
  }, [modal, language, aiLoading, apiBase, getAuthHeaders]);

  const submit = useCallback(async () => {
    if (!modal || !suggested.trim() || status === 'saving') return;
    setStatus('saving');
    setErrMsg('');
    try {
      const headers = { 'Content-Type': 'application/json', ...(getAuthHeaders?.() || {}) };
      const res = await fetch(`${apiBase}/i18n/suggestions`, {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({
          hash: modal.hash,
          lang: language,
          english: modal.english,
          current: modal.current,
          suggested: suggested.trim()
        })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      setStatus('ok');
      setTimeout(closeModal, 1200);
    } catch (err) {
      setStatus('err');
      setErrMsg(err?.message || 'Failed to submit suggestion');
    }
  }, [modal, suggested, language, status, apiBase, getAuthHeaders, closeModal]);

  if (!active) return null;

  const langName = supportedLanguages?.[language]?.name || language;
  const langDir = supportedLanguages?.[language]?.dir || 'ltr';
  const unchanged = modal && suggested.trim() === (modal.current || '').trim();

  return (
    <div data-suggest-ui>
      <button
        type="button"
        className={`i18n-suggest-toggle${enabled ? ' is-active' : ''}`}
        onClick={() => setEnabled((v) => !v)}
        title="Toggle translation suggestion mode"
      >
        <span aria-hidden="true">💬</span>
        {enabled
          ? <I18nText>Suggesting — click a phrase</I18nText>
          : <I18nText>Suggest a translation fix</I18nText>}
      </button>

      {modal && (
        <div className="i18n-suggest-overlay" onClick={closeModal}>
          <div className="i18n-suggest-modal" onClick={(e) => e.stopPropagation()}>
            <h2><I18nText>Language Suggestion</I18nText></h2>
            <div className="i18n-suggest-lang">
              <I18nText>Language</I18nText>: {langName} ({language})
            </div>

            <div className="i18n-suggest-field">
              <label><I18nText>Original (English)</I18nText></label>
              <div className="i18n-suggest-readonly">{modal.english}</div>
            </div>

            <div className="i18n-suggest-field">
              <label><I18nText>Current translation</I18nText></label>
              <div className="i18n-suggest-readonly">{modal.current}</div>
            </div>

            <div className="i18n-suggest-field">
              <label><I18nText>Your suggested translation</I18nText></label>
              <textarea
                className="i18n-suggest-textarea"
                value={suggested}
                onChange={(e) => setSuggested(e.target.value)}
                dir={langDir}
                autoFocus
              />
              <div className="i18n-suggest-ai">
                <button type="button" className="i18n-suggest-ai-btn" onClick={askAi} disabled={aiLoading}>
                  ✨ {aiLoading ? <I18nText>Thinking…</I18nText> : <I18nText>Suggest with AI</I18nText>}
                </button>
                {aiError && <span className="i18n-suggest-msg err">{aiError}</span>}
              </div>
              {aiAlts.length > 0 && (
                <div className="i18n-suggest-alts">
                  <div className="i18n-suggest-alts-hint">
                    <I18nText>Click to use, then edit if needed:</I18nText>
                  </div>
                  {aiAlts.map((a, i) => (
                    <button
                      type="button"
                      key={i}
                      className={`i18n-suggest-alt${suggested.trim() === String(a).trim() ? ' is-selected' : ''}`}
                      onClick={() => setSuggested(a)}
                      dir={langDir}
                    >
                      {a}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {status === 'ok' && (
              <div className="i18n-suggest-msg ok">
                <I18nText>Thanks! Your suggestion was sent for review.</I18nText>
              </div>
            )}
            {status === 'err' && (
              <div className="i18n-suggest-msg err">{errMsg}</div>
            )}

            <div className="i18n-suggest-actions">
              <button type="button" className="i18n-suggest-btn secondary" onClick={closeModal}>
                <I18nText>Cancel</I18nText>
              </button>
              <button
                type="button"
                className="i18n-suggest-btn primary"
                onClick={submit}
                disabled={!suggested.trim() || unchanged || status === 'saving' || status === 'ok'}
              >
                {status === 'saving'
                  ? <I18nText>Sending…</I18nText>
                  : <I18nText>Submit suggestion</I18nText>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
