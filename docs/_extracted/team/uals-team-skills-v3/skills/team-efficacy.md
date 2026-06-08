---
description: Design/analyze learning-outcome efficacy studies
argument-hint: [design <study> | analyze <data> | power | review]
---

# Team Efficacy

Does the feature actually help learning? `/team-eval` measures whether the *output* is good;
this measures whether the *learner* improves. It designs and analyzes outcome studies on the
learning data you already emit via `/team-xapi`, and is the engineering-side companion to a
PERP-style pedagogical-effectiveness review. Reports statistics; does not replace IRB/ethics review.

## Target: $ARGUMENTS
Options: "design <study>" | "analyze <data>" | "power" | "review"

## Workflow Phases

### Phase 1: Design (Sequential)
- **Learning Scientist**: Hypothesis, outcome measure, design, threats to validity
- **Data Analyst**: Map outcomes to xAPI statements / LRS queries already captured

### Phase 2: Power & Instrument (Parallel)
- **Data Analyst**: Power analysis → required N; define assignment + logging
- **Feature Flag Controller**: Wire assignment (control vs treatment) via flags (see `/team-flags`)

### Phase 3: Analyze (Sequential)
- **Data Analyst**: Effect size + uncertainty; pre-registered analysis only
- **Learning Scientist**: Interpret against pedagogy; state what would change the conclusion

## Design Options (pick honestly; note the failure mode)
| Design | Strength | Typical failure mode |
|--------|----------|----------------------|
| RCT (random assignment) | Causal, cleanest | Contamination across conditions; ethics of withholding |
| Cluster-RCT (by class/school) | Fits classroom reality | Fewer effective units → underpowered; needs ICC adjustment |
| Pre/post single group | Cheap, fast | Maturation/history confounds — **cannot** claim causation |
| Quasi-experiment (matched / RD) | When randomization impossible | Selection bias; needs strong matching/covariates |
| A/B within product | Scales, continuous | Outcome ≠ learning (engagement is a proxy, not mastery) |

## Statistical Discipline (no bare claims)
- **Pre-register** hypothesis, primary outcome, and analysis before looking at outcomes.
- **Power first** — compute N for the smallest *educationally meaningful* effect, not the smallest detectable.
- **Report effect sizes with CIs** (Cohen's d, Hedges' g, or model coefficients), not just p-values.
- **One primary outcome** — secondary outcomes are exploratory and labeled as such.
- **Account for clustering** — students nested in classes/teachers violate independence; use mixed models.
- **Separate learning from engagement** — time-on-task and clicks are not mastery.
- **Pre/post alone is not causal** — say so explicitly.
- **Multiplicity** — correct when testing many outcomes/subgroups.

## Quick Power Sketch (sanity check, not a substitute for a proper analysis)
```r
# two-arm, detect d = 0.3 (a small-but-meaningful learning effect), 80% power
power.t.test(delta = 0.3, sd = 1, power = 0.80, sig.level = 0.05)
# ~175 per arm; cluster designs need this inflated by the design effect 1 + (m-1)*ICC
```

## Output Format
```
## Efficacy Study Report

### Design
- Question: [H]  ·  Outcome: [measure]  ·  Design: [type]  ·  Pre-registered: [link/no]

### Power
- Target effect: [d]  ·  Required N: [n/arm]  ·  Design effect (if cluster): [value]

### Results
| Outcome | Control | Treatment | Effect (95% CI) | p | Note |
|---------|---------|-----------|-----------------|---|------|

### Threats to Validity
- [threat] — [how addressed / residual risk]

### Interpretation
- Educational significance: [bottom line]
- What would change this conclusion: [evidence]
```
