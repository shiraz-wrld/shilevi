-- Shilevi migration 0022: close a cross-account financial read in rider_available_balance.
--
-- Found by the live RLS review. The function accepted any p_rider_id from an authenticated caller
-- and returned that rider's available balance, so any signed-in user who knew or guessed a rider's
-- user id could read their earnings position. It is SECURITY DEFINER, so RLS on ledger_entries and
-- payouts did not protect the result.
--
-- The owner (with MFA) and finance staff may still read a balance for reconciliation; everybody
-- else may read only their own. Apply after 0021. It changes no data and no table structure.

begin;

create or replace function public.rider_available_balance(p_rider_id uuid default auth.uid())
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_balance bigint;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;

  if p_rider_id is null then
    raise exception 'A rider account is required.';
  end if;

  -- Reading someone else's earnings is a finance operation: owner (aal2 allowlist) or a staff
  -- member holding finance.read / finance.payout (also gated on aal2 by has_staff_capability).
  if p_rider_id is distinct from auth.uid()
    and not (
      public.is_shilevi_owner_admin()
      or public.has_staff_capability('finance.read')
      or public.has_staff_capability('finance.payout')
    ) then
    raise exception 'Not authorized to read another account''s balance.';
  end if;

  select greatest(
    coalesce((
      select sum(le.credit_minor - le.debit_minor)
      from public.ledger_entries le
      where le.account = 'rider_payable' and le.party_id = p_rider_id
    ), 0)
    - coalesce((
      select sum(p.amount_minor) from public.payouts p
      where p.payee_id = p_rider_id and p.status in ('pending','processing')
    ), 0),
    0
  ) into v_balance;

  return v_balance;
end;
$$;

revoke all on function public.rider_available_balance(uuid) from public, anon;
grant execute on function public.rider_available_balance(uuid) to authenticated;

commit;
