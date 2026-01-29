# Security Audit (ArmgddnCompanion + related infrastructure)

Date: 2026-01-29

This document records security findings and remediation work performed during the audit of:

- `ArmgddnCompanion` (Electron app)
- `ArmgddnBrowser` (server + PHP frontend) **where it impacts Companion trust chain / ecosystem**

## Scope

- Companion IPC surface (renderer -> main)
- Companion download/update system
- Browser proxy/CORS and PHP endpoints that influence the same trust boundary (auth, downloads, updates)
- Secret handling (hardcoded tokens/keys, default secrets)

## Severity legend

- **Critical**: compromise enables code execution or signing/trust-chain takeover.
- **High**: compromise enables auth bypass / token theft / broad privilege escalation.
- **Medium**: meaningful hardening; reduces exposure or prevents plausible abuse.
- **Low**: hygiene / defense-in-depth.

---

## Critical

## C1) Update signing private key was committed to git history (Companion)

- **Finding**: `update-ed25519-priv.pem` contained an Ed25519 private key and was committed.
- **Impact**: anyone with access to the repo history could sign malicious update artifacts that pass verification.
- **Remediation (done)**:
  - The key file was neutralized in working tree.
  - The blob was **purged from git history** (history rewrite) and verified absent in fetched history.
- **Follow-up (deferred per request)**:
  - **Rotate the update signing keypair** and update CI secrets/public key distribution. (Strongly recommended even if deferred.)

---

## High

## H1) Telegram bot token was hardcoded (Browser) and committed

- **Finding**: `ArmgddnBrowser/bot-config.php` previously contained a hardcoded Telegram bot token.
- **Impact**: token compromise enables bot impersonation/abuse, and can affect membership/auth flows relied upon by the ecosystem.
- **Remediation (done in code)**:
  - Token was removed from code and replaced with `TELEGRAM_BOT_TOKEN` environment variable.
  - Code fails closed if missing.
- **Follow-up (recommended)**:
  - Rotate the Telegram bot token in BotFather.
  - Set `TELEGRAM_BOT_TOKEN` in production.

## H2) Default constant CSRF token fallback (Browser)

- **Finding**: CSRF token previously defaulted to a known constant (`armgddn-dev-csrf-token`).
- **Impact**: undermines CSRF protections if used in production.
- **Remediation (done in code)**:
  - Production now requires `CSRF_TOKEN`.
  - Dev fallback is only allowed explicitly (Node) / only on localhost (PHP).
- **Follow-up (required for prod)**:
  - Set `CSRF_TOKEN` in production environment.

## H3) Default JWT secret fallback (Browser backend)

- **Finding**: Browser backend config defaulted `JWT_SECRET` to a predictable value (`default-jwt-secret`).
- **Impact**: token forgery.
- **Remediation (done in code)**:
  - Production now requires `JWT_SECRET` (dev fallback only if explicitly enabled).
- **Follow-up (required for prod)**:
  - Set `JWT_SECRET` in production backend environment.

---

## Medium

## M1) Companion IPC: settings allowlist + prototype pollution guard

- **Remediation (done)**:
  - `save-settings` now allowlists keys and blocks `__proto__`/`constructor`/`prototype`.

## M2) Companion IPC: prevent renderer token leakage

- **Finding**: internal download objects contained `token` and process handles.
- **Remediation (done)**:
  - Added a `downloadToRenderer()` sanitizer and used it for `get-downloads` + `download-started`.
  - Reduced payload surface (dropped unused `files` list).

## M3) Companion IPC: URL hardening

- **Remediation (done)**:
  - `open-external` now parses with `URL` and enforces `https:`.
  - `get-app-load` host derivation requires HTTPS + allowlisted host.

## M4) Companion IPC: download action input validation

- **Remediation (done)**:
  - Added `isValidDownloadId()` and applied to pause/resume/cancel/retry IPC handlers.

## M5) Companion update checks/install: bounds and cleanup

- **Remediation (done)**:
  - `check-updates` now has request timeout + response size cap.
  - `install-update` now has:
    - request timeouts
    - installer size cap
    - cleanup of partial installers on errors/abort

---

## Medium / Low (Browser hardening relevant to ecosystem)

## B1) Browser PHP debug/ops endpoints disabled

- **Remediation (done)**:
  - Multiple legacy/debug endpoints were disabled (HTTP 410) or restricted to CLI to reduce info disclosure.

## B2) Browser `api-proxy.php`: cookie and redirect tightening

- **Remediation (done)**:
  - Strict `path` validation.
  - No redirect following.
  - Only forwards `ag_auth` cookie.

## B3) Telegram auth handler: anti-spoof hardening

- **Remediation (done)**:
  - Only trusts forwarded IP headers when request comes from local proxy.
  - Moved state/log files to temp dir (or env override) and added `LOCK_EX` where appropriate.

---

## Operational checklist (non-rotation)

- **Required for prod**:
  - `CSRF_TOKEN`
  - `JWT_SECRET`
  - `TELEGRAM_BOT_TOKEN` (if using Telegram auth/bot flows)

- **Dev-only optional**:
  - `ALLOW_DEV_CSRF_TOKEN=1` (Node) for local dev convenience
  - `ALLOW_DEV_JWT_SECRET=1` (Browser backend) for local dev convenience

---

## Status

- **Audit hardening work**: completed.
- **Key rotation**: explicitly deferred per request (note: this reduces the security value of signed updates until rotated).
