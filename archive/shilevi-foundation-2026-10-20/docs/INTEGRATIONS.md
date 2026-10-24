# Integrations Plan

Every integration should be represented by a typed adapter and an explicit status. This does not imply credentials or API access exist.

## Planned adapter families
- Payments/mobile money: M-PESA/Safaricom, Airtel Money, banks and other authorized payment providers.
- Email: Resend or another approved provider.
- SMS and push notifications.
- Maps, geocoding, distance and routing.
- Identity/business verification and tax integrations, only through authorized APIs and with lawful basis.
- Analytics, monitoring, error reporting, file scanning, and customer support.

## Adapter contract
Each adapter should define:
- Stable provider identifier and capabilities.
- Configuration schema with no secret values returned to the browser.
- Server-side credential validation and connection test.
- `disabled`, `needs_configuration`, `healthy`, `degraded`, or `unavailable` status.
- Timeouts, bounded retries, idempotency where relevant, structured redacted logs, and error mapping.
- Sandbox/test mode distinct from production.
- Documentation for setup, required approvals, costs, data handling, and rollback.

## Secret management
Use Vercel server-side environment variables or an appropriate managed secret store for credentials. Admin UI may show whether a secret is configured, but must never reveal its value. Some credential changes require redeployment or a secure server-side secret-management workflow; do not promise instant changes where the hosting platform does not support them.

Never commit real credentials. Never ask users to paste secrets into chat. Never assume KRA or identity APIs are publicly available; confirm eligibility, permission, contract and legal basis first.
