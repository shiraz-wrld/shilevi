# Shilevi

Shilevi is a Kenya-first, globally extensible marketplace for products, services, transport & delivery, and property & places.

## Project status

This is the initial foundation scaffold. It is not production-ready and has not been connected to a live Supabase project or deployed to Vercel.

## Planned stack

- Next.js App Router + TypeScript
- Tailwind CSS
- Supabase Auth, PostgreSQL, Storage, and Row Level Security
- Vercel deployments
- Vitest / Playwright for testing (to be configured in the next implementation step)

## Local setup

1. Install Node.js LTS and Git.
2. Copy `.env.example` to `.env.local`.
3. Fill in only the public Supabase URL and publishable key when a Supabase project has been created.
4. Run `npm install`.
5. Run `npm run dev`.

Do not put service-role keys, payment secrets, webhook secrets, or other private credentials in `NEXT_PUBLIC_*` variables or commit them to Git.

## Foundation documents

- `docs/PRODUCT_REQUIREMENTS.md` — product scope and core flows
- `docs/ARCHITECTURE.md` — proposed technical architecture and trust boundaries
- `docs/SECURITY.md` — security baseline and verification checklist
- `docs/ROADMAP.md` — phased delivery plan
- `docs/INTEGRATIONS.md` — integration adapters and secret-management rules
- `docs/DECISIONS.md` — decisions and open questions

## Important

This scaffold intentionally does not implement real payments, escrow, identity verification, rider tracking, or production admin access yet. Those features require verified provider APIs, tested server-side authorization, legal review where applicable, and end-to-end tests.
