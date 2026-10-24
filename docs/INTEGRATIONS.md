# Integration Plan

Planned adapter families: Safaricom M-PESA, Airtel Money, banks/authorized payment providers, email, SMS/push, maps/geocoding/routing, authorized identity/business/tax verification, analytics and monitoring.

Each adapter must document capabilities, required approvals, config validation, connection tests, disabled/needs-configuration/healthy/degraded/unavailable status, timeouts, bounded retries, sandbox mode and redacted logs. These are planned adapters, not proof that API access exists.

Keep secrets in Vercel server-side environment configuration or a suitable secret manager. Admin screens may report configured/not configured but must never reveal secret values. Some changes require redeployment. Do not assume tax or identity APIs are public or authorized.