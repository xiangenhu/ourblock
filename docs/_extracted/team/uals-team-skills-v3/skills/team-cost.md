---
description: Govern LLM + cloud spend; find cost runaways
argument-hint: [audit | llm | infra | budget]
---

# Team Cost

LLM-driven learning apps fail quietly on spend, not just latency. `/team-content` mentions
"token tracking"; this makes cost a first-class, monitored signal with budgets and alerts.
Complements `/team-cache` (the biggest LLM cost lever is a cache hit) and `/team-eval`
(cheapest model that still passes the gate).

## Target: $ARGUMENTS
Options: "audit" | "llm" | "infra" | "budget"

## Workflow Phases

### Phase 1: Inventory (Parallel)
- **FinOps Analyst**: Attribute spend by service, feature, model, and (where lawful) cohort
- **Data Analyst**: Token usage per generation type; cache hit-rate vs. cost (see `/team-cache`)

### Phase 2: Optimize (Sequential)
- **Code Optimization Specialist**: Raise cache hit-rate, trim prompts, right-size models, batch

### Phase 3: Govern (Sequential)
- **FinOps Analyst**: Set budgets + alerts; wire cost SLOs into `/team-monitor`

## Cost Levers (highest leverage first)
- **Cache hits** — a served cache hit costs ~0 vs. a generation; chase hit-rate before model swaps.
- **Right-size the model** — use `/team-eval` to find the cheapest model that still passes the gate per task.
- **Prompt hygiene** — drop dead context, few-shot bloat, and redundant system text; measure tokens before/after.
- **Batch & precache** — bulk-precache predictable content off-peak (see `/team-content`).
- **Cap & degrade** — per-user/per-tenant rate + spend caps with graceful degradation, not surprise bills.
- **Egress & storage** — GCS lifecycle rules on derivable cache (see `/team-gcs`).

## Guardrails
- Every generation logs `{model, input_tokens, output_tokens, cached?, feature}` — no log, no governance.
- Budgets per environment + per feature; alert at 50/80/100% (route via `/team-monitor`).
- A model/prompt change runs `/team-eval` *and* reports Δcost — quality and cost reviewed together.

## Output Format
```
## Cost Report

### Spend Attribution (last 30d)
| Feature | Model | Calls | Cache hit % | Tokens | $ | $/active user |
|---------|-------|-------|-------------|--------|---|---------------|

### Runaways / Anomalies
- [feature] — [signal] — [suspected cause]

### Optimization Plan
| Lever | Current | Proposed | Est. saving | Quality risk (→ /team-eval) |
|-------|---------|----------|-------------|------------------------------|

### Budgets & Alerts
- [scope] — [budget] — [alert thresholds] — [destination]
```

- All model calls go through the single gateway (language + accounting centralized): `@.claude/commands/_shared/llm-gateway.md`

## Runtime (implemented)
Per-user token accounting is implemented in `@uals/skill-runtime`, not just described:
- Every call goes through the single gateway (`@.claude/commands/_shared/llm-gateway.md`), so
  **no call escapes accounting**. The gateway captures `usage` and records `{ userId, feature,
  model, prompt/completion tokens, cached }` to GCS at `usage/{date}/{userId}.json` (cache hits
  recorded as cached, ~0 cost).
- Read it: **`GET /api/admin/llm-usage?since=7d&group=user|feature|model|total`** (Admin-only), or
  `runtime` → `llm.accounting.summary({ since, groupBy })`.
- Prices are configurable via `LLM_PRICES` (USD per 1M tokens) — **prices change; keep current**.
- Use an **opaque userId**, never an email (token counts aren't PII but the identity link is — team-privacy).
