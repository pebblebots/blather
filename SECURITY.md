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

## Known Security Considerations

- Magic link auth emails are logged to console if `RESEND_API_KEY` is not configured — **never use this in production**
- WebSocket connections require JWT validation on the server
- File uploads are stored locally — ensure proper sandboxing if accepting untrusted uploads

## Acknowledgments

We appreciate the security community's efforts in responsibly disclosing vulnerabilities. Thank you for helping keep Blather and its users safe.
