# Shared Reference: Security Baseline Checklist

Canonical baseline. `/team-security` owns the deep audit; `/team-review`, `/team-feature`,
`/team-xgh-gateway` reference this via `@.claude/commands/_shared/security-baseline.md` for the quick gate.

- [ ] AuthN/AuthZ enforced on protected routes
- [ ] Input validation at every trust boundary; output encoding/sanitization
- [ ] Rate limiting and abuse controls
- [ ] No secrets in source or logs; loaded from a secret manager
- [ ] HTTPS everywhere; HSTS; secure cookies (HttpOnly, Secure, SameSite)
- [ ] CSP, X-Frame-Options, X-Content-Type-Options
- [ ] Dependency vulnerability scan green
- [ ] Tokens never in URL fragments, localStorage, or logs
- [ ] Privacy / minor-data requirements handled — defer to `/team-privacy`
