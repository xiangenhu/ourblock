---
description: Student-data privacy & compliance (FERPA/COPPA/GDPR-K/PIPL)
argument-hint: [audit | dpia | retention | dsar | minors]
---

# Team Privacy

Protect learner data and demonstrate compliance. Education data is **special-category data
about minors** in most jurisdictions; `/team-security` covers attack surface, this covers
*lawful, minimal, accountable* handling. Not legal advice — produces an engineering-side
record that a DPO/counsel can sign off.

## Target: $ARGUMENTS
Options: "audit" | "dpia" (data-protection impact assessment) | "retention" | "dsar" (data-subject access request) | "minors"

## Workflow Phases

### Phase 1: Data Map (Parallel)
- **Privacy Compliance Officer**: Inventory every personal-data element, lawful basis, and data subject (learner / teacher / guardian)
- **Database Administrator**: Where each element is stored, who can read it, retention today
- **Security Specialist**: Encryption, access control, transfer paths (cross-border?)

### Phase 2: Assess (Sequential)
- **Privacy Compliance Officer**: Map to applicable regimes; flag gaps and high-risk processing

### Phase 3: Remediate (Sequential)
- **Fullstack Developer**: Implement minimization, consent gates, retention jobs, DSAR endpoints

## Regimes to Check (cite the one that applies to your users)
| Regime | Trigger | Hard requirements (engineering-relevant) |
|--------|---------|------------------------------------------|
| **FERPA** (US) | School "education records" | Disclosure controls; parent/eligible-student access & amendment; vendor = "school official" with use limits |
| **COPPA** (US) | Users < 13 | Verifiable parental consent before collection; data minimization; deletion on request |
| **GDPR / GDPR-K** (EU) | EU data subjects; child = <16 (member-state down to 13) | Lawful basis; DPIA for large-scale child profiling; DSAR; right to erasure; cross-border transfer mechanism |
| **UK Age-Appropriate Design Code** | UK children | Privacy-by-default; no nudging; profiling off by default |
| **PIPL** (China) | PRC data subjects (relevant for CCNU/mainland pilots) | Separate consent for minors <14 via guardian; localization; cross-border assessment |

## Privacy Principles (apply regardless of regime)
- **Collect the minimum** — every field needs a purpose; if you can't name one, don't store it.
- **Pseudonymize for analytics** — xAPI/LRS keyed on `mbox` exposes email; prefer an opaque actor ID and keep the mapping access-controlled (see `/team-xapi`).
- **Consent is explicit, logged, and revocable** — store consent version, timestamp, and basis.
- **Retention has an expiry job** — "keep forever" is a finding, not a default.
- **Deletion is real** — erasure must propagate to GCS versions, caches, LRS, and backups (see `/team-gcs`, `/team-backup`).
- **No learner PII in LLM prompts/logs** — redact before sending to the content gateway (see `/team-content`, `/team-ai-safety`).
- **Cross-border transfer is a decision, not an accident** — know where Cloud Run / GCS / the LRS physically run.

## Minors-Specific Gates
- Age band captured and enforced (drives `/team-ai-safety` age-appropriateness).
- Guardian consent flow before any collection for under-threshold ages.
- Profiling / behavioral targeting OFF by default for children.
- Free-text from minors treated as sensitive (may contain self-disclosure).

## Output Format
```
## Privacy & Compliance Report

### Data Inventory
| Element | Subject | Lawful basis | Store | Retention | Encrypted | PII in prompts/logs? |
|---------|---------|--------------|-------|-----------|-----------|----------------------|

### Applicable Regimes
- [regime] — [why it applies] — [status: met / gap]

### High-Risk Processing (DPIA)
- [processing] — [risk] — [mitigation]

### Gaps & Remediation
| Gap | Severity | Fix | Owner |
|-----|----------|-----|-------|

### DSAR / Erasure Readiness
- Access: [endpoint/process]  ·  Erasure propagation: [stores covered]  ·  Backups: [strategy]
```

## Project invariants
- Roles & data scoping: `@.claude/commands/_shared/roles.md` · GCS-only persistence & erasure reach: `@.claude/commands/_shared/storage-invariants.md`
