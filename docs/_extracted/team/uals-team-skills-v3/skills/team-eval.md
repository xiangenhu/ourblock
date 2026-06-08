---
description: Build/run LLM-output evaluation & regression gates
argument-hint: [build <task> | run | regress | drift]
---

# Team Eval

Turn "sample-check output quality" (the hand-wave in `/team-content`) into a real, repeatable
evaluation. This is the measurement backbone for any LLM-driven feature: golden sets, rubric
scoring, and a regression gate so a prompt/model swap can't silently degrade learning content.
Pairs with `/team-ai-safety` (behavior/safety) and `/team-content` (generation).

## Target: $ARGUMENTS
Options: "build <task>" | "run" | "regress" | "drift"

## Workflow Phases

### Phase 1: Specify (Sequential)
- **Data Analyst**: Define the task, success criteria, and a stratified golden set with expected outputs/rubrics

### Phase 2: Score (Parallel)
- **Eval Engineer**: Run candidates; apply scorers (exact-match / rubric / model-graded)
- **Learning Scientist**: Author/validate the pedagogical rubric (is this a *good lesson*, not just a fluent one)

### Phase 3: Gate (Sequential)
- **Eval Engineer**: Compare to baseline; pass/fail the regression gate; log scores over time

## Evaluation Method (choose per task)
| Method | Use when | Caution |
|--------|----------|---------|
| Exact / structural match | JSON schema, hashes, deterministic format | Brittle for free text |
| Reference-based (BLEU/ROUGE/embedding sim) | Paraphrase-tolerant similarity | Weak proxy for quality |
| **Rubric / LLM-as-judge** | Open-ended instructional quality | Validate judge vs. human on a subset; judges drift and are biased to length/style |
| Human rating | High-stakes / new rubric calibration | Expensive; use to anchor the judge |

## Principles (don't fool yourself)
- **Golden set is stratified and frozen** — cover topics, languages, difficulty, edge cases; version it.
- **Validate the judge** — report judge–human agreement (e.g., Cohen's κ) before trusting model-graded scores.
- **Separate quality from safety from cost** — measure each; a fluent answer can be unsafe or expensive.
- **Score the schema too** — for EMT/SATA/stim JSON, validate against the schema as part of eval (see `/team-content`).
- **Regression gate is mandatory in CI** — any prompt/model/temperature change runs the eval; block on drop beyond tolerance.
- **Log every run** — model, prompt version, date, scores — so drift is visible over time, not discovered in production.

## Minimal Runnable Shape
```python
# pseudo-harness; wire to your gateway, not a provider directly
for case in golden_set:                      # stratified, versioned
    out = generate(case.input, prompt_v="2025-05-30")
    scores = {
        "schema_ok": validate_schema(out),    # structural
        "rubric":    judge(out, case.rubric),  # 0..1, judge validated vs humans
        "tokens":    out.usage.total,          # cost signal -> /team-cost
    }
    log(case.id, prompt_v, scores)
assert mean(rubric) >= baseline - TOLERANCE   # the gate
```

## Output Format
```
## Eval Report

### Task & Set
- Task: [desc]  ·  Golden set: [N cases, version]  ·  Strata: [topics/langs/difficulty]

### Scores (Candidate vs Baseline)
| Metric | Baseline | Candidate | Δ | Gate |
|--------|----------|-----------|---|------|

### Judge Validation
- Judge–human agreement: [κ / %]  on  [M] cases

### Failures (Worst Cases)
- [case id] — [score] — [why]

### Decision
- [ ] PASS  [ ] FAIL — [reason]  ·  Cost/run: [tokens / $] (→ /team-cost)
```

- All model calls go through the single gateway (language + accounting centralized): `@.claude/commands/_shared/llm-gateway.md`
