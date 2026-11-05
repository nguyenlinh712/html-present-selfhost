# Security policy

## Reporting a vulnerability

Please do not post vulnerability details in a public issue. Contact the maintainers through the private security reporting channel configured for the repository where you obtained this software. Include the affected version, impact, and steps to reproduce. Do not include real visitor data or credentials.

## Deployment guidance

- Use HTTPS and set `COOKIE_SECURE=1` when TLS terminates before the application.
- Keep the admin interface private or restrict it at the reverse proxy.
- Treat uploaded HTML and JavaScript as executable content. Prefer serving it from a separate origin from the admin.
- Keep `DATA_DIR` private, restrict filesystem permissions, and maintain tested backups.
- Configure client IP and country headers only behind a trusted proxy that overwrites incoming values.
- Use a unique strong administrator password and rotate it if it may have been exposed.
