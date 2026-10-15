# Security

The platform holds advertising accounts, business data and (later) leads. This
document lists what is implemented, how, and what is still pending. Pending
items are tracked, not hidden.

## Implemented (Phase 1)

| Area | Implementation |
| --- | --- |
| Password storage | argon2id (`@node-rs/argon2`, 19 MiB / t=2 / p=1). Constant-time login path: unknown users still run a verification against a dummy hash. |
| Sessions | Random 256-bit token in an `httpOnly`, `secure` (prod), `SameSite=Lax` cookie. Only the **sha256 hash** is stored. Sliding expiry (30 days default), expired sessions deleted on sight, revocation per session / all other sessions, password change revokes other sessions. |
| Two-factor authentication | TOTP per RFC 6238 (SHA1, 6 digits, 30 s) — Google Authenticator / Authy / 1Password compatible, implemented in `packages/core/src/auth/totp.ts` and checked against the RFC test vectors. Secret stored AES-256-GCM encrypted; each accepted time-step is recorded so a code is never accepted twice; ±1 step drift. 8 one-time recovery codes stored as sha256 hashes. Login becomes two-step: password → signed 5-minute challenge cookie (`mm_mfa`, HMAC-SHA256 with `APP_SECRET`) → code → session. Enabling MFA revokes other sessions; disabling requires password + code. `MFA_REQUIRED_FOR_ADMINS=true` forces enrolment for super admins and org OWNER/ADMIN users. |
| Rate limiting | Redis fixed windows (`packages/core/src/security/rate-limit.ts`): login 30/IP and 10/email per 15 min, MFA 5 attempts per challenge and 30/IP per 15 min — UI and API alike (HTTP 429). Fails open with an error log if Redis is down. |
| Authorization | Org roles (OWNER/ADMIN/MEMBER/VIEWER) + brand roles (BRAND_ADMIN/EDITOR/VIEWER). `resolveBrandContext()` is the single gate; services call `assertBrandRole()`. Approvals: BRAND_ADMIN only. |
| Tenant isolation | Server-side, below the service layer: `forBrand()` Prisma extension rewrites every query on tenant models; caller-supplied `brandId` is overridden. Covered by `tests/tenant-isolation.test.ts` and `tests/tenant-scope.test.ts`. Storage keys are brand-prefixed and served only through an authorized route. |
| Secrets at rest | `APP_ENCRYPTION_KEY` (32 bytes) with AES-256-GCM (`encryptString/encryptJson`) for provider tokens and the TOTP secret column. |
| Secrets in config | `.env` ignored by Git; production secrets generated on the server into `shared/.env` (mode 640, root:mm); config refuses `change-me` placeholders in production. |
| Input validation | zod schemas shared by UI actions and REST (`packages/core/src/validation.ts`); JSON bodies parsed strictly; uploads limited by size (`MEDIA_MAX_UPLOAD_MB`) and MIME/extension allow-list; raster images are verified with `sharp`; SVG served with `Content-Security-Policy: sandbox`. |
| CSRF | Server actions are protected by Next.js origin checks; cookies are `SameSite=Lax`; state-changing REST endpoints require JSON bodies (no form posts) or an explicit bearer token. |
| Audit | Append-only `audit_logs` for auth, brand, settings, products, knowledge, media, approvals — with actor, before/after, IP and user agent (Cloudflare `CF-Connecting-IP` honoured via Nginx real-ip). |
| Transport | Cloudflare proxy → Nginx with Let's Encrypt certificate → app on 127.0.0.1 only. Postgres/Redis/S3 gateway bound to 127.0.0.1. ufw allows 22/80/443 only. |
| Headers | `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, strict referrer policy, restrictive permissions policy. `robots.txt` disallows indexing. |
| Process isolation | App services run as the unprivileged `mm` user under systemd; deploys build in isolated release directories and never touch the running release on failure. |
| Idempotency | `background_jobs.idempotency_key` unique; approvals idempotent per subject version. |
| Money/publishing switches | `META_ADS_WRITE_ENABLED=false`, `GOOGLE_ADS_WRITE_ENABLED=false` by default; nothing in Phase 1 can spend or publish. |

## Pending (tracked)

| Item | Target | Notes |
| --- | --- | --- |
| Rate limiting on uploads and the website import | Phase 2 | Login and MFA are limited; add per-user limits to `POST …/media` and `…/import/analyze`. |
| MFA reset by a super admin | Phase 2 | Recovery codes cover lock-outs today; an admin reset flow (with audit) is still to add. |
| User invitations & brand grants UI | Phase 2 | Service exists for listing; invitation flow with expiring tokens to add. |
| Postgres row-level security | Hardening | Second layer under the Prisma extension. |
| Webhook signature validation | Phase 4/5 | Meta/Google webhooks must verify `X-Hub-Signature-256` etc. |
| OAuth scopes minimisation | Phase 4/5 | Request only documented scopes; store granted scopes per account. |
| Automated backups + restore drill | Hardening | pg_dump nightly + MinIO bucket sync off-box; see DEPLOYMENT.md. |
| Monitoring / error tracking | Hardening | Health endpoint exists; Sentry DSN placeholder; uptime + alert to add. |
| Secret rotation runbook | Hardening | Rotate `APP_ENCRYPTION_KEY` with re-encryption script; rotate DB/MinIO passwords. |
| Dedicated read-only GitHub deploy key on the server | Hardening | The server currently pulls with the project deploy key (scoped to this repo). Replace with a server-specific read-only key. |
| PII retention & deletion | Phase 6 | Lead deletion, retention periods, consent records. |
| Content Security Policy for the app | Hardening | Add a nonce-based CSP once third-party scripts are known. |

## Threat notes

- **Cross-brand access** is the primary risk for a multi-tenant marketing
  system. It is mitigated at the data layer and tested; any new tenant table
  must be added to `TENANT_MODELS` in `packages/db/src/tenant.ts` — the
  isolation test suite should be extended with it in the same PR.
- **Uncontrolled spend / publishing** is mitigated by approvals and write
  switches; future adapters must check both before any mutating API call.
- **Token leakage**: provider tokens are encrypted; never log them (`pino`
  redact list covers common keys). Logs are JSON to journald.
