# Shared Reference: Three-Tier Role Model (Admin · Educator · Learner)

**Project invariant.** Every feature, route, object, query, and UI assumes exactly three roles.
Canonical here; pulled into security, privacy, gcs, xapi, architect, feature, ux, review,
test-e2e, ai-safety via `@.claude/commands/_shared/roles.md`. Do not invent a fourth role without an ADR.

## Roles
| Role | Scope | Sees | Can do |
|------|-------|------|--------|
| **Admin** | Tenant / platform | Aggregates across tenant; individual records **with audit + cause** | Manage users, shared framework/curriculum catalogs, system config |
| **Educator** | Own classes only | Own classes and **the learners enrolled in them** | Author/curate content, assign work, view their learners' progress |
| **Learner** | Self only | Own data, own progress, assigned content | Do assigned work; manage own profile within limits |

> Authoring note: Educator "owns the lesson" (selects, sequences, reviews) but content
> *generation* is gateway-mediated — consistent with **知课而不必制课**. The role model encodes
> *judgment authority*, not content-production monopoly.

## Authorization principles (enforce, don't assume)
- **Deny by default.** Every protected route and object checks `(role, membership/ownership)`.
- **Role is necessary, not sufficient.** Educator access to a learner requires **class membership**,
  not just the Educator role → this is *resource-level* authz, not role-only.
- **Hierarchy is by membership:** Learner ⊂ Class ⊂ Educator; Tenant ⊂ Admin. A learner in no class
  sees only self.
- **Enforce server-side.** Hiding a button is UX, not security. Authorize on the API/storage layer.
- **Admin individual-record access is logged** (who, what, why) — see `/team-privacy`.
- **Learners are often minors** → strictest data minimization and age-gating (see `/team-privacy`,
  `/team-ai-safety`).

## Authorization matrix (resource × role)
| Resource | Learner | Educator | Admin |
|----------|---------|----------|-------|
| Own profile / progress | RW (self) | R (their learners) | R (audited) |
| Other learner's data | ✗ | R (only if in their class) | R (audited) |
| Class content / assignments | R (assigned) | RW (own classes) | R |
| Framework / curriculum catalog | R (effective) | RW (own) + R (shared) | RW (shared) |
| Users & role assignment | ✗ | ✗ | RW |
| System config / secrets | ✗ | ✗ | RW |

## Mapping to the stack
- **GCS paths** (see `/team-gcs`): `users/{userId}` → self + educators of that learner's classes +
  admin; `classes/{classId}` → class members + owning educator + admin;
  `frameworks/owner/{ownerId}` → owner + admin; config/admin paths → admin only.
- **xAPI** (see `/team-xapi`): Learner queries are pinned to `agent = self`; Educator queries are
  pinned to `activity = .../class/{ownedClassId}`; Admin may query tenant-wide **and it is logged**.
  A learner must never be able to filter by another learner's `agent`.
- **Auth** (see `/team-xgh-gateway`): role **and** class memberships travel in verified server-side
  claims; never trust a client-asserted role.
- **UI/UX** (see `/team-ux`): three distinct journeys (Admin console, Educator dashboard, Learner
  experience); navigation and actions are role-derived but always re-checked server-side.

## Test obligation
`/team-test-e2e` and `/team-review` must include **negative authz tests**: a Learner cannot reach
another Learner's data; an Educator cannot reach a class they don't own; only Admin reaches config.
