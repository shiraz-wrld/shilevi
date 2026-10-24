-- Shilevi migration 0010: allow a user to cancel an open deletion request safely.
-- Manual review only. This migration has not been executed against a live project.
begin;

grant update (status) on public.account_deletion_requests to authenticated;
drop policy if exists "account_deletion_request_cancel_own" on public.account_deletion_requests;
create policy "account_deletion_request_cancel_own" on public.account_deletion_requests
for update to authenticated
using (user_id = (select auth.uid()) and status = 'pending')
with check (user_id = (select auth.uid()) and status = 'cancelled');

create or replace function public.guard_account_deletion_request_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  owner_admin boolean;
  owner_cancelling boolean;
begin
  owner_admin := (select public.is_shilevi_owner_admin());
  owner_cancelling := old.user_id = (select auth.uid())
    and old.status = 'pending'
    and new.status = 'cancelled';

  if not owner_admin and not owner_cancelling then
    raise exception 'Only an authorized owner admin may process requests; account holders may cancel their own pending request.'
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

  if owner_cancelling then
    new.processed_at := now();
    new.resolution_note := 'Cancelled by account holder';
    return new;
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

commit;
