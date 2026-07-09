/**
 * Admin review surface for translation suggestions — REFERENCE snippet.
 * ===========================================================================
 * Drop this into your admin dashboard as a tab. It is intentionally a plain
 * component you copy-and-adapt (Tailwind classes + your <I18nText> + your `api`
 * wrapper) rather than a black box, because every app's dashboard chrome differs.
 *
 * It expects an `api` with these four methods (thin wrappers over the routes in
 * i18nRoutes.js — see the kit README "Client API" section):
 *   api.getTranslationSuggestions(status?)      -> { suggestions, counts, total }
 *   api.approveTranslationSuggestion(id, note?)
 *   api.rejectTranslationSuggestion(id, note?)
 *
 * Swap `GlassCard` / `I18nText` for your own equivalents if you don't have them.
 */

import React, { useState, useEffect } from 'react';
import { api } from '../utils/api';
import { I18nText, useI18n } from './index';
// import GlassCard from '../components/GlassCard';  // or replace with a <div>

const GlassCard = ({ className = '', children }) => (
  <div className={`rounded-xl border border-white/10 bg-white/5 ${className}`}>{children}</div>
);

export default function AdminTranslationsTab() {
  const { reloadTranslations } = useI18n();
  const [suggestions, setSuggestions] = useState(null);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('pending');
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');

  const load = async (status) => {
    setLoading(true); setError('');
    try {
      const data = await api.getTranslationSuggestions(status === 'all' ? undefined : status);
      setSuggestions(data.suggestions || []); setCounts(data.counts || {});
    } catch (err) { setError(err?.message || 'Failed to load suggestions'); setSuggestions([]); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(filter); }, [filter]);

  const act = async (id, action) => {
    setBusyId(id); setError('');
    try {
      if (action === 'approve') {
        const res = await api.approveTranslationSuggestion(id);
        // Live-apply: refetch the locale so the approved string shows immediately.
        if (res?.suggestion?.lang) await reloadTranslations(res.suggestion.lang);
      } else {
        await api.rejectTranslationSuggestion(id);
      }
      await load(filter);
    } catch (err) { setError(err?.message || `Failed to ${action}`); }
    finally { setBusyId(null); }
  };

  const filters = [
    { value: 'pending', label: 'Pending' }, { value: 'approved', label: 'Approved' },
    { value: 'rejected', label: 'Rejected' }, { value: 'all', label: 'All' }
  ];
  const statusBadge = {
    pending: 'bg-yellow-500/20 text-yellow-300',
    approved: 'bg-green-500/20 text-green-300',
    rejected: 'bg-white/10 text-white/40'
  };
  const timeAgo = (iso) => {
    if (!iso) return '';
    const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
  };
  const list = suggestions || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-white"><I18nText>Translation Suggestions</I18nText></h2>
          <p className="text-white/60 text-sm">
            <I18nText>Corrections submitted from in-app Suggestion Mode. Approving writes the string to the live locale file.</I18nText>
          </p>
        </div>
        <button onClick={() => load(filter)} className="px-3 py-1.5 rounded-lg bg-white/10 text-white/80 text-sm hover:bg-white/20">
          🔄 <I18nText>Refresh</I18nText>
        </button>
      </div>

      <div className="flex gap-2 flex-wrap">
        {filters.map(f => (
          <button key={f.value} onClick={() => setFilter(f.value)}
            className={`px-3 py-1.5 rounded-lg text-sm ${filter === f.value ? 'bg-violet-500 text-white' : 'bg-white/10 text-white/70 hover:bg-white/20'}`}>
            <I18nText>{f.label}</I18nText>{counts[f.value] != null && f.value !== 'all' ? ` (${counts[f.value]})` : ''}
          </button>
        ))}
      </div>

      {error && <div className="p-3 rounded-lg bg-red-500/20 text-red-300 text-sm">{error}</div>}
      {loading && <div className="text-white/50 text-sm py-8 text-center"><I18nText>Loading…</I18nText></div>}
      {!loading && list.length === 0 && (
        <GlassCard className="p-8 text-center">
          <div className="text-4xl mb-3">🌐</div>
          <p className="text-white/60"><I18nText>No suggestions in this view.</I18nText></p>
        </GlassCard>
      )}

      {!loading && list.map(s => (
        <GlassCard key={s.id} className="p-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 text-xs">
              <span className="px-2 py-0.5 rounded bg-white/10 text-white/70 uppercase tracking-wide">{s.lang}</span>
              <span className={`px-2 py-0.5 rounded ${statusBadge[s.status] || 'bg-white/10 text-white/50'}`}>{s.status}</span>
              <span className="text-white/40">{timeAgo(s.createdAt)}</span>
              {s.submittedBy && <span className="text-white/40">· {s.submittedBy}</span>}
            </div>
            {s.status === 'pending' && (
              <div className="flex gap-2">
                <button onClick={() => act(s.id, 'approve')} disabled={busyId === s.id}
                  className="px-3 py-1 rounded-lg bg-green-500/80 text-white text-sm hover:bg-green-500 disabled:opacity-50">
                  ✓ <I18nText>Approve</I18nText>
                </button>
                <button onClick={() => act(s.id, 'reject')} disabled={busyId === s.id}
                  className="px-3 py-1 rounded-lg bg-white/10 text-white/70 text-sm hover:bg-white/20 disabled:opacity-50">
                  ✕ <I18nText>Reject</I18nText>
                </button>
              </div>
            )}
          </div>
          <div className="grid gap-3 mt-3 sm:grid-cols-3">
            <div>
              <div className="text-[0.65rem] uppercase tracking-wide text-white/40 mb-1"><I18nText>Original (English)</I18nText></div>
              <div className="text-sm text-white/80 bg-white/5 rounded p-2 whitespace-pre-wrap break-words">{s.english || '—'}</div>
            </div>
            <div>
              <div className="text-[0.65rem] uppercase tracking-wide text-white/40 mb-1"><I18nText>Current</I18nText></div>
              <div className="text-sm text-white/80 bg-white/5 rounded p-2 whitespace-pre-wrap break-words">{s.current || '—'}</div>
            </div>
            <div>
              <div className="text-[0.65rem] uppercase tracking-wide text-emerald-300/70 mb-1"><I18nText>Suggested</I18nText></div>
              <div className="text-sm text-emerald-100 bg-emerald-500/10 rounded p-2 whitespace-pre-wrap break-words">{s.suggested}</div>
            </div>
          </div>
          {s.reviewedBy && (
            <div className="text-xs text-white/40 mt-2"><I18nText>Reviewed by</I18nText> {s.reviewedBy} · {timeAgo(s.reviewedAt)}</div>
          )}
        </GlassCard>
      ))}
    </div>
  );
}
