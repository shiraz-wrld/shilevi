-- Shilevi migration 0026: make the owner refund decision reachable, and only for a verified owner.
--
-- Migration 0017 revoked EXECUTE on public.admin_decide_refund() from `authenticated` and granted
-- it to `service_role` only, with the note "use a trusted server path". No such path can exist:
-- a service-role PostgREST call carries no end-user JWT, so `auth.uid()` is NULL inside the
-- function and its own `is_shilevi_owner_admin()` guard can never pass. Every refund decision
-- therefore failed with "Not authorized." — customers could request a refund, but no operator
-- could ever decide one.
--
-- This migration restores the intended path without touching the decision logic, the ledger
-- arithmetic, or any authorization rule:
--
--   * the function still requires `public.is_shilevi_owner_admin()`, which checks an
--     email-confirmed account on the owner allowlist *and* MFA assurance level 2 from the JWT;
--   * a refund can still only be decided once (`status <> 'requested'` under `for update`);
--   * the API route that calls it re-verifies same-origin, the session, the allowlist and AAL2
--     before calling, and returns 401/403/409 rather than pretending success;
--   * `public` and `anon` remain revoked, so no signed-out visitor can reach it.
--
-- This matches every other owner-guarded RPC in this schema (admin_set_payment_method,
-- admin_verify_property, admin_update_payout, admin_search_insights), which are granted to
-- `authenticated` and enforce ownership inside the database.

revoke all on function public.admin_decide_refund(uuid, boolean, text) from public, anon;
grant execute on function public.admin_decide_refund(uuid, boolean, text) to authenticated;

comment on function public.admin_decide_refund(uuid, boolean, text) is
  'Owner-only refund decision. Requires an allowlisted, email-confirmed owner session at MFA '
  'assurance level 2. Settles the refund ledger and moves the order to refunded (or restores the '
  'previous status on rejection). Executable by authenticated; the guard is inside the function.';
