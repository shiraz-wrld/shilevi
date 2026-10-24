# Prompt 09 — Approved-provider listing drafts

## Goal
Allow a signed-in, approved provider to create a private draft listing in a category that matches their approved activity. This is not public publishing, booking, checkout, or payment processing.

## Implemented in this prompt
- `src/app/provider/listings/page.tsx` provides an owner-scoped listing workspace.
- `supabase/migrations/0007_provider_listing_drafts.sql` narrows client listing write privileges and adds draft-only create/edit policies.
- Listing creation requires an approved application and active category in the corresponding division.
- The client creates only `draft` records. Ownership, status, provider approval and category matching are enforced again by Postgres RLS and existing publication triggers.
- Money values are stored as integer minor units; the form converts the displayed amount to minor units.
- The provider workspace explains that drafts are not public and do not create an order or payment.

## Security and rollout notes
- Review and apply migrations 0001–0007 manually and in order in the owner's Supabase project.
- Never trust the client-supplied `owner_id`; RLS compares it with `auth.uid()`.
- Provider grants exclude status, ownership, provider application, category, publication timestamp, and featured state from edits.
- The database schema and RLS have not been validated against a live project. CI validates Next.js source, not database behavior.
- Editing existing drafts and any future submit-for-moderation workflow should be added only after staging tests prove the narrow grants and policies behave as intended.
