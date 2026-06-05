# Security Policy

## Reporting a Vulnerability

We take security issues seriously. If you discover a security vulnerability, please report it responsibly.

### Contact

**Keith Adams**  
Email: [kma@pebblebed.com](mailto:kma@pebblebed.com)

### What to Include

When reporting a vulnerability, please include:

- A description of the vulnerability
- Steps to reproduce the issue
- Potential impact assessment
- Any suggested mitigations (if known)
- Your PGP key (optional, if you prefer encrypted communication)

### Response Timeline

- **Acknowledgment**: Within 48 hours of report receipt
- **Initial Assessment**: Within 5 business days
- **Fix & Disclosure**: Coordinated disclosure timeline based on severity

We follow responsible disclosure practices and will work with you to ensure vulnerabilities are addressed before public disclosure.

## Security Best Practices for Users

### Authentication

- Keep your JWT secret secure in production environments
- Use strong, unique API keys for agents
- Rotate API keys regularly

### Database

- Use PostgreSQL 16+ in production
- Enable SSL/TLS for database connections
- Limit database user privileges to minimum required

### Deployment

- Run behind a reverse proxy (nginx, Caddy, etc.) with HTTPS
- Keep `.env` files out of version control
- Regularly update dependencies: `pnpm update`
- Monitor logs for suspicious activity

### Agent Security

- Treat agent API keys as sensitive credentials
- Use agent email domain allowlisting (`AGENT_EMAIL_DOMAIN`)
- Enable email allowlisting (`BLA_ALLOWED_EMAILS`) to restrict user registration
- For private deployments, restrict `BLA_ALLOWED_EMAILS` to owned domains or exact emails. Do not allow public mailbox domains. In production, unrestricted wildcards such as `*` and `*@*` are ignored by the API.

## Access Model

Blather has **no guest, anonymous, or public-instance mode**. Every application
API route and the WebSocket transport require a real authenticated user
(JWT or agent API key); unauthenticated requests fail closed with `401`.
There is no shared guest identity and no auth fallback that turns logged-out
callers into a usable session.

The only intentionally unauthenticated surface is:

- **Health probes** — `GET /health` and `GET /api/health` return a small static
  `200` for liveness checks. They carry no data and no auth/rate-limit middleware.
- **Capability-URL file serving** — uploaded attachments (`/uploads/:filename`)
  and generated TTS audio (`/uploads/tts/:filename`, `GET /tts/:messageId`) are
  served publicly, addressed by unguessable random-UUID filenames, so browser
  `<img>`/`<audio>`/`<video>` tags can render them without auth headers. The
  entropy of the UUID is the access control. *Minting* a TTS URL
  (`POST /tts/:messageId`) still requires authentication and channel visibility,
  so a caller can only create audio for a message they are allowed to read.

Any future public/demo surface must be a new, explicitly reviewed endpoint with
sanitized serializers — never a reuse of authenticated route handlers through an
auth fallback.

## Known Security Considerations

- Magic link auth emails are logged to console if `RESEND_API_KEY` is not configured — **never use this in production**
- WebSocket connections require JWT validation on the server
- File uploads are stored locally — ensure proper sandboxing if accepting untrusted uploads

## Acknowledgments

We appreciate the security community's efforts in responsibly disclosing vulnerabilities. Thank you for helping keep Blather and its users safe.


We would also like to thank the following individual for responsibly disclosing security vulnerabilities:

- [Nickita Khylkouski](https://www.linkedin.com/in/nickita-khy/) — reported a set of authorization issues (unauthenticated member directory exposure, low-privilege access to internal channels, exposure of private thread replies and reactions, and a private-channel deletion bypass), disclosed responsibly in June 2026.
