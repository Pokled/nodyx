# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 2.x     | :white_check_mark: |
| 1.x     | :x:                |

We only provide security fixes for the latest major release.

## Reporting a Vulnerability

**Do NOT open a public issue for security vulnerabilities.**

Instead, please report them privately:

1. **Email:** Send details to **security@nodyx.org**
2. **GitHub:** Use [GitHub's private vulnerability reporting](https://github.com/Pokled/nodyx/security/advisories/new)

### What to include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if you have one)

### What to expect

- **Acknowledgment** within 48 hours
- **Assessment** within 7 days
- **Fix timeline** communicated once assessed
- **Credit** in the release notes (unless you prefer anonymity)

## Security Features

Nodyx takes security seriously:

- **Password hashing:** Argon2id with OWASP-recommended parameters, transparent migration path for any legacy bcrypt hash.
- **E2E encrypted DMs:** ECDH P-256 key exchange with AES-256-GCM encryption. Private keys never leave the browser, the server only ever handles ciphertext.
- **Two-factor authentication:** TOTP (Google Authenticator, Aegis, Bitwarden) and Nodyx Signet, a passwordless ECDSA P-256 PWA.
- **Session management:** JWT and Redis with a configurable TTL, forced logout on demand.
- **Spoofing-resistant rate limiting:** the trusted proxy chain is scoped explicitly, so a forged `X-Forwarded-For` header cannot impersonate an internal request or dodge a limit.
- **Input validation:** Zod schemas on every API input.
- **SQL injection protection:** parameterized queries only, no string concatenation.
- **XSS and clickjacking protection:** Content-Security-Policy, X-Frame-Options and HSTS headers on every response, sanitized HTML rendering.
- **Verified backups:** every nightly backup is proven by an automated restore, not just a file copy sitting untested.
- **Owner account recovery:** a dedicated CLI mints a one-time reset link without ever touching or logging a password, for instances that lock themselves out.
- **AGPL-3.0:** the full source is always available for inspection, by anyone, forever.

## Responsible Disclosure

We believe in coordinated disclosure. If you report a vulnerability responsibly, we commit to:

- Not pursuing legal action against you
- Working with you to understand and fix the issue
- Crediting you publicly (with your permission)

Thank you for helping keep Nodyx and its communities safe.
