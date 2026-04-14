# Security Policy

## Supported Versions

This project is actively maintained. Security fixes are applied to the latest version only.

| Version | Supported |
| ------- | --------- |
| latest  | ✅        |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

If you discover a security vulnerability, please report it by opening a [GitHub Security Advisory](../../security/advisories/new) on this repository. This ensures the report is handled privately.

Please include as much of the following information as possible:

- Type of issue (e.g. SQL injection, authentication bypass, credential exposure)
- Full paths of source file(s) related to the manifestation of the issue
- The location of the affected source code (tag/branch/commit or direct URL)
- Any special configuration required to reproduce the issue
- Step-by-step instructions to reproduce the issue
- Proof-of-concept or exploit code (if possible)
- Impact of the issue, including how an attacker might exploit it

## Disclosure Policy

- Security reports are acknowledged within **48 hours**
- A fix will be developed and released as quickly as possible
- The reporter will be credited in the release notes (unless anonymity is requested)

## Security Considerations for Self-Hosters

When deploying this project, please ensure:

- `NEXTAUTH_SECRET` is a cryptographically random string of at least 32 bytes
- `ENCRYPTION_KEY` is a unique 32-byte random key — **never reuse across environments**
- `GITHUB_APP_PRIVATE_KEY` and `GITHUB_APP_WEBHOOK_SECRET` are stored securely (environment variables or a secrets manager, never committed to git)
- The dashboard is not exposed to the public internet without authentication
- Redis and PostgreSQL are not exposed publicly
- Webhook endpoint is validated via HMAC-SHA256 signature (already implemented)
