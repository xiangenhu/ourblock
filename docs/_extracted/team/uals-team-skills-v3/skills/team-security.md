---
description: Comprehensive security audit
argument-hint: [full | api | frontend | auth | dependencies | infrastructure]
---

# Team Security Audit

Execute a comprehensive security audit.

## Scope: $ARGUMENTS
Options: full | api | frontend | auth | dependencies | infrastructure

## Workflow Phases

### Phase 1: Scanning (Parallel)
- **Security Vulnerability Scanner**: OWASP Top 10, code vulnerabilities
- **Static Code Analyzer**: Security-related code patterns
- **Dependency Manager**: Package vulnerabilities, outdated deps

### Phase 2: Analysis (Sequential)
- **Security Specialist**: Deep analysis of all findings, compliance review

### Phase 3: Remediation Planning (Parallel)
- **Architect**: Architecture changes needed
- **Fullstack Developer**: Code fix recommendations

## Scope-Specific Focus

### full (default)
- All endpoints and routes
- All authentication flows
- All data handling
- All dependencies
- Infrastructure configuration

### api
- Endpoint security, input validation, rate limiting
- AuthN/AuthZ, response sanitization

### frontend
- XSS, CSRF, CSP
- Client-side data handling
- Third-party script security

### auth
- OAuth / OIDC / JWT handling
- Session management, cookie security
- Token storage and rotation

### dependencies
- Audit results, known CVEs
- Outdated packages, license compliance
- Supply chain risks

### infrastructure
- IAM and least privilege
- Secret management
- Network isolation, TLS configuration

## General Security Checklist

- [ ] AuthN/AuthZ enforced on protected routes
- [ ] Input validation at every trust boundary
- [ ] Output encoding/sanitization
- [ ] Rate limiting and abuse controls
- [ ] No secrets in source or logs
- [ ] HTTPS everywhere; HSTS enabled
- [ ] Secure cookie flags (HttpOnly, Secure, SameSite)
- [ ] CSP, X-Frame-Options, X-Content-Type-Options
- [ ] Dependency vulnerability scan green
- [ ] Privacy / data protection requirements documented

## Output Format

```
## Security Audit Report

### Executive Summary
- Overall risk level: [Critical/High/Medium/Low]
- Total vulnerabilities: [count]
- By severity: C:[n] H:[n] M:[n] L:[n]

### Critical Findings
1. **[ID]** — [Description]
   - Location: [file:line]
   - Impact: [description]
   - Remediation: [steps]
   - Priority: P0

### High / Medium / Low Severity
[Same format]

### Dependency Vulnerabilities
| Package | Current | Vulnerable | Fixed In | Severity |
|---------|---------|------------|----------|----------|

### Compliance Status
- OWASP Top 10: [status]
- [Other regulations]: [status]

### Remediation Priority
1. [High priority fix]
2. [Medium priority fix]

### Recommended Architecture Changes
- [change]

### Next Steps
1. [immediate]
2. [short-term]
3. [long-term]
```

## Agent Prompts

### Security Vulnerability Scanner
```
Scan for:
1. OWASP Top 10 vulnerabilities
2. Authentication/authorization flaws
3. Injection (SQL, XSS, command)
4. Sensitive data exposure
5. Security misconfiguration
6. Broken access control

For each finding:
- CVE/CWE reference if applicable
- Exact file:line
- Reproduction steps
- Severity (Critical/High/Medium/Low)
- Remediation recommendation
```

### Security Specialist
```
Review scanner findings and:
1. Validate each vulnerability
2. Assess exploitability
3. Verify compliance requirements
4. Prioritize remediation
5. Recommend architectural improvements
```

## Shared references
Security baseline gate: `@.claude/commands/_shared/security-baseline.md` · Minor/student-data handling: `/team-privacy`

## Project invariants
- Three-tier authz model (Admin/Educator/Learner): `@.claude/commands/_shared/roles.md` — verify deny-by-default and resource-level checks, not role-only.
