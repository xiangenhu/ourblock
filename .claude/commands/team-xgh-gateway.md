---
description: OAuth + SMTP via the oauth.xiangenhu.info gateway
argument-hint: [oauth | smtp | user-auth | audit | health-check]
---

# Team XGH Gateway

Integrate OAuth + SMTP via the `oauth.xiangenhu.info` gateway.

## Target: $ARGUMENTS
Options: "oauth" | "smtp" | "user-auth" | "audit" | "health-check"

## Workflow Phases

### Phase 1: Plan (Sequential)
- **Architect**: Where OAuth/SMTP integration lives; token storage; callback URL

### Phase 2: Implement (Parallel)
- **Fullstack Developer**: Wire login redirect, callback handler, token verification
- **Security Specialist**: Token storage, CSRF protection, callback URL allowlist

### Phase 3: Validate (Sequential)
- **QA Testing**: End-to-end login + email-send smoke tests
- **Security Specialist**: Verify token never leaks to logs / localStorage / URL fragments

## Gateway Overview

- **Base URL**: `https://oauth.xiangenhu.info`
- **Demo**: `https://oauth.xiangenhu.info/oauth-demo.html`
- **Docs**: `https://oauth.xiangenhu.info/instruction`
- **Health**: `https://oauth.xiangenhu.info/health` (and `/health/detailed`)
- **Auth scheme**: Bearer token in `Authorization` header

## OAuth Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/auth/{provider}/login` | Start OAuth login — providers: `google`, `microsoft`, `github` |
| GET | `/auth/{provider}/callback` | Callback (handled by gateway) |
| GET | `/auth/userinfo` | Get user profile (Bearer required) |
| GET | `/auth/email` | Verified email only (Bearer required) |
| POST | `/auth/token` | Exchange gateway token → provider access token |
| POST | `/auth/refresh` | Refresh expired provider tokens |
| DELETE | `/auth/logout` | Revoke + logout |

### Login Flow

```javascript
// 1. Redirect to gateway
window.location.href =
  'https://oauth.xiangenhu.info/auth/google/login?redirect_uri=' +
  encodeURIComponent('https://yoursite.com/dashboard');

// 2. On return, extract token from query
const token = new URLSearchParams(window.location.search).get('token');

// 3. Fetch user profile
const res = await fetch('https://oauth.xiangenhu.info/auth/userinfo', {
  headers: { 'Authorization': `Bearer ${token}` }
});
const { user } = await res.json(); // { email, name, picture, provider }
```

### Exchanging for Provider Token (for Google APIs, etc.)

```json
POST /auth/token
{
  "gatewayToken": "<gateway-jwt>",
  "provider": "google",
  "scope": ["https://www.googleapis.com/auth/userinfo.profile"]
}
→ { "access_token": "..." }
```

## Email / SMTP Endpoints

### User Registration & Auth (Email+Password)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/user/register` | Register (sends 6-digit code) |
| POST | `/user/verify` | Verify code → returns JWT |
| POST | `/user/resend-code` | Resend verification code |
| POST | `/user/login` | Email+password login → JWT |
| POST | `/user/forgot-password` | Send reset code |
| POST | `/user/reset-password` | Use reset code to set new password |
| POST | `/user/change-password` | Change password (Bearer required) |

### Sending Email

```json
POST /api/send-email
{
  "to": "recipient@example.com",
  "subject": "Hello",
  "body": "Plain text",
  "html": "<h1>Hello</h1>",
  "cc": "cc@example.com",
  "bcc": "bcc@example.com",
  "gatewayToken": "<gateway-jwt>",
  "provider": "google"
}
→ { "success": true, "message": "...", "timestamp": "..." }
```

Alternative endpoint: `POST /send-mail` (same payload).

## Token Storage Discipline

- ✅ httpOnly cookie set by the application server after token exchange
- ✅ Server keeps gateway token; client gets a session cookie
- ⚠️ Demo code stores `gateway_token` in localStorage — DO NOT do that in production
- ❌ Never put tokens in URL fragments that get logged
- ❌ Never persist tokens in browser storage long-term

## Required Environment Variables (Application Side)

For the gateway service itself:

| Var | Purpose |
|-----|---------|
| `JWT_SECRET` | Signs gateway tokens |
| `SESSION_SECRET` | Session management |
| `GOOGLE_CLIENT_ID` | From Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | From Google Cloud Console |
| `GOOGLE_CALLBACK_URL` | Default: `/auth/google/callback` |
| `GMAIL_USER` | Gmail sender address |
| `GMAIL_APP_PASSWORD` | 16-char app password (requires 2FA) |
| `STORAGE_TYPE` | `memory` (default), `redis`, `postgresql` |
| `CORS_ORIGIN` | Comma-separated allowed origins |

For applications consuming the gateway: just the base URL and any redirect URI you configure.

## Smoke Tests

```bash
# Gateway up?
curl https://oauth.xiangenhu.info/health

# Detailed
curl https://oauth.xiangenhu.info/health/detailed

# With a token
curl -H "Authorization: Bearer $TOKEN" \
     https://oauth.xiangenhu.info/auth/userinfo
```

## Output Format

```
## XGH Gateway Integration Report

### Login Flow
- Provider: [google/microsoft/github]
- Redirect URI: [url]
- Token handoff: [URL param / cookie set / etc.]

### Email Sending
- Endpoint used: [/api/send-email | /send-mail]
- Test send: [pass/fail]

### Security Review
- Token storage: [server-side cookie / localStorage (FIX) / other]
- HTTPS everywhere: [yes/no]
- Callback URL allowlisted: [yes/no]

### Health
- /health: [200/error]
- /health/detailed: [status]

### Issues
- [item]
```

## Shared references
Security baseline gate: `@.claude/commands/_shared/security-baseline.md` · Minor/student-data handling: `/team-privacy`
