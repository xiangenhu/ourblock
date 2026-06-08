---
description: Instrument/query xAPI learning analytics
argument-hint: [instrument <feat> | query <goal> | audit | verb-taxonomy | performance]
---

# Team xAPI

Design, instrument, and query xAPI (Experience API / TinCan) learning analytics.

## Target: $ARGUMENTS
Options: "instrument <feature>" | "query <goal>" | "audit" | "verb-taxonomy" | "performance"

## Workflow Phases

### Phase 1: Plan (Parallel)
- **Data Analyst**: Define what learning events to capture and what questions to answer
- **Architect**: Statement builder placement, shared module, LRS client wiring

### Phase 2: Instrument / Query (Sequential)
- **Fullstack Developer**: Wire statement emission or query endpoints through the shared client
- **APM Integration**: Add tracing around LRS writes/reads

### Phase 3: Validate (Sequential)
- **QA Testing**: Sample-check statements in the LRS, verify structure and analytics queries

## Statement Structure (Standard)

```json
{
  "actor":  { "mbox": "mailto:user@example.com", "objectType": "Agent", "name": "..." },
  "verb":   { "id": "http://adlnet.gov/expapi/verbs/answered", "display": {"en-US": "answered"} },
  "object": {
    "id": "https://app.example.com/assessment/{id}/question/{qid}",
    "objectType": "Activity",
    "definition": {
      "name": {"en-US": "..."},
      "type": "http://adlnet.gov/expapi/activities/cmi.interaction",
      "interactionType": "choice"
    }
  },
  "result":  { "success": true, "score": {"scaled": 0.83, "raw": 5, "max": 6} },
  "context": {
    "contextActivities": {
      "parent":   [{"id": "https://app.example.com/class/{classId}"}],
      "grouping": [{"id": "https://app.example.com/framework/{frameworkId}"}],
      "category": [{"id": "https://app.example.com/competency/{compId}"}]
    },
    "extensions": { "https://app.example.com/extensions/...": "..." }
  },
  "timestamp": "2026-01-15T12:34:56.000Z"
}
```

## Verb Taxonomy (Standard)

**Assessment & learning**: `answered`, `completed`, `attempted`, `achieved`, `mastered`
**Interaction & exploration**: `explored`, `interacted`, `viewed`, `experienced`
**System & management**: `initialized`, `generated`, `logged-in`, `logged-out`, `requested`

🚨 **NO FALLBACK**: If a verb isn't in the taxonomy, throw — don't invent one. Semantic pollution makes analytics unusable later.

## 🚨 GOLDEN RULE: Targeted Queries Only

An LRS may hold millions of statements. NEVER fetch them all.

✅ **CORRECT**:
```javascript
const result = await xapiClient.getStatements({
  agent: { mbox: `mailto:${userEmail}`, objectType: 'Agent' },
  verb: 'http://adlnet.gov/expapi/verbs/answered',
  activity: `https://app.example.com/class/${classId}`,
  related_activities: true
});
```

❌ **WRONG**:
```javascript
const statements = await xapiClient.getAllStatements({ limit: 1000 }); // crashes the system
```

Every query MUST include at least one of: **agent**, **verb**, **activity** (preferably all three for hot paths).

## Quick-Reference Query Patterns

| Goal | Filter |
|------|--------|
| User's assessment answers | `agent=mailto:...` + `verb=.../answered` + `activity=.../class/{id}` |
| All mastered competencies | `agent=mailto:...` + `verb=.../mastered` |
| SATA questions | `object.id contains '/sata'` |
| Per-competency | `context.contextActivities.category.id = '.../competency/{id}'` |
| Cohort activity | `activity=.../class/{id}` + time bounds |

## Required Configuration

| Env Var | Purpose |
|---------|---------|
| `LRS_ENDPOINT` | LRS xAPI endpoint URL |
| `LRS_USERNAME` | Basic auth username |
| `LRS_PASSWORD` | Basic auth password |

## Output Format

```
## xAPI Report

### Instrumentation Added
- [feature] — [verb] — [statement shape]

### Query Performance
| Query | Filters | Statements Returned | Latency |
|-------|---------|---------------------|---------|

### Violations Found
- [file:line] — Direct LRS call bypassing shared builder
- [file:line] — Uses `getAllStatements()` — replace with targeted query
- [file:line] — Invents verb outside taxonomy

### Recommendations
1. [item]
```

## Project invariants
- Query scoping by role (learner=self, educator=own classes, admin=audited): `@.claude/commands/_shared/roles.md` · Storage: `@.claude/commands/_shared/storage-invariants.md`
