-- Shilevi migration 0019: owner-only read access for audit events and operational order review.
-- Manual review/execution only. Do not apply from the application or CI.
--
-- Why these policies exist:
--   * audit_events were previously revoked from every client role, so the owner audit screen had no
--     way to read the trail its own triggers write.
--   * orders can be read by participants only, so staff had no read-only operational view.
--
-- Safety properties:
--   * Both policies call public.is_shilevi_owner_admin(), which requires an email-verified account
--     on the private allowlist AND MFA assurance level aal2.
--   * Audit rows remain append-only. Only SELECT is granted; no INSERT/UPDATE/DELETE policy is added,
--     so a client cannot forge or erase an audit record.
--   * Order reads return row columns granted to authenticated today. Addresses are not newly
--     exposed by this migration; the admin screen selects only totals, statuses and delivery method.
begin;

-- Audit events: owner read only. Keep writes restricted to trusted SECURITY DEFINER triggers.
grant select on public.audit_events to authenticated;
drop policy if exists "audit_events_select_owner" on public.audit_events;
create policy "audit_events_select_owner" on public.audit_events
for select to authenticated
using ((select public.is_shilevi_owner_admin()));

-- Orders and their line items: owner read in addition to the participant policies from 0016.
drop policy if exists "orders_select_owner_admin" on public.orders;
create policy "orders_select_owner_admin" on public.orders
for select to authenticated
using ((select public.is_shilevi_owner_admin()));

drop policy if exists "order_items_select_owner_admin" on public.order_items;
create policy "order_items_select_owner_admin" on public.order_items
for select to authenticated
using ((select public.is_shilevi_owner_admin()));

-- Neither table gains write access for clients here.
revoke insert, update, delete on public.audit_events from anon, authenticated;

commit;
