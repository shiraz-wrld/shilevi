-- Shilevi migration 0009: secure account-deletion review workflow.
-- Review manually; never run this migration from the app or CI.
begin;

-- A deletion request must come from a recently authenticated session. For email/password
-- accounts the UI re-authenticates; OAuth users must have signed in recently.
drop policy if exists "account_deletion_request_insert_own" on public.account_deletion_requests;
create policy "account_deletion_request_insert_own" on public.account_deletion_requests
for insert to authenticated with check (
  user_id = (select auth.uid())
  and status = 'pending'
  and processed_at is null
  and resolution_note is null
  and nullif((select auth.jwt() ->> 'auth_time'), '') is not null
  and (select (auth.jwt() ->> 'auth_time')::bigint) >=
      extract(epoch from (now() - interval '10 minutes'))::bigint
);

-- Only verified owners at MFA assurance level 2 may inspect and process requests.
grant select on public.account_deletion_requests to authenticated;
grant update (status, processed_at, resolution_note) on public.account_deletion_requests to authenticated;
drop policy if exists "account_deletion_request_owner_select" on public.account_deletion_requests;
create policy "account_deletion_request_owner_select" on public.account_deletion_requests
for select to authenticated using ((select public.is_shilevi_owner_admin()));
drop policy if exists "account_deletion_request_owner_update" on public.account_deletion_requests;
create policy "account_deletion_request_owner_update" on public.account_deletion_requests
for update to authenticated
using ((select public.is_shilevi_owner_admin()))
with check ((select public.is_shilevi_owner_admin()));

create or replace function public.guard_account_deletion_request_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not (select public.is_shilevi_owner_admin()) then
    raise exception 'Only an authorized owner admin may process account-deletion requests.'
      using errcode = '42501';
  end if;

  if new.id is distinct from old.id
     or new.user_id is distinct from old.user_id
     or new.requested_at is distinct from old.requested_at then
    raise exception 'Request identity and submission time are immutable.'
      using errcode = '23514';
  end if;

  if old.status in ('completed', 'rejected', 'cancelled') then
    raise exception 'A closed account-deletion request cannot be reopened or changed.'
      using errcode = '23514';
  end if;

  if new.status not in ('in_review', 'completed', 'rejected', 'cancelled') then
    raise exception 'Invalid account-deletion review transition.'
      using errcode = '23514';
  end if;

  if new.status = 'in_review' then
    new.processed_at := null;
  else
    new.processed_at := coalesce(new.processed_at, now());
    if new.status in ('rejected', 'cancelled') and nullif(trim(new.resolution_note), '') is null then
      raise exception 'A reason is required when rejecting or cancelling a request.'
        using errcode = '23514';
    end if;
  end if;

  if new.resolution_note is not null and char_length(new.resolution_note) > 1000 then
    raise exception 'Resolution note must be 1000 characters or fewer.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists account_deletion_request_guard_update on public.account_deletion_requests;
create trigger account_deletion_request_guard_update
before update on public.account_deletion_requests
for each row execute function public.guard_account_deletion_request_update();

-- No account is deleted automatically. "Completed" means the owner has separately completed
-- the reviewed deletion/retention process; Auth and retained financial/legal records need handling.
commit;
