-- Shilevi migration 0006: secure provider application submission transitions.
-- Review and run manually in the owner's Supabase project. Never apply from the app or CI.
-- No live Supabase project was accessed to create this migration.
begin;

-- Remove broad client update privileges inherited from earlier review setup, then grant only
-- the individual columns needed for applicant submission and owner review.
revoke update on public.provider_applications from authenticated;
grant update (status, submitted_at) on public.provider_applications to authenticated;
grant update (status, reviewed_at, reviewed_by, reviewer_note, rejection_reason) on public.provider_applications to authenticated;

drop policy if exists "provider_applications_submit_own" on public.provider_applications;
create policy "provider_applications_submit_own" on public.provider_applications
for update to authenticated
using (
  user_id = (select auth.uid())
  and status = 'draft'
)
with check (
  user_id = (select auth.uid())
  and status = 'pending'
  and submitted_at is not null
);

create or replace function public.guard_provider_application_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  owner_admin boolean := (select public.is_shilevi_owner_admin());
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  -- Applicants may submit only their own draft. All business/application fields and
  -- reviewer metadata must remain unchanged during this transition.
  if old.user_id = actor_id and old.status = 'draft' and new.status = 'pending' then
    if old.submitted_at is not null
      or new.submitted_at is null
      or new.reviewed_at is distinct from old.reviewed_at
      or new.reviewed_by is distinct from old.reviewed_by
      or new.reviewer_note is distinct from old.reviewer_note
      or new.rejection_reason is distinct from old.rejection_reason
      or new.user_id is distinct from old.user_id
      or new.activity_type is distinct from old.activity_type
      or new.business_name is distinct from old.business_name
      or new.application_data is distinct from old.application_data
      or new.country_code is distinct from old.country_code
      or new.public_reference is distinct from old.public_reference
      or new.created_at is distinct from old.created_at
    then
      raise exception 'Only a draft submission timestamp and status may change during submission.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- Owners may review only another user's pending application, and only with the
  -- verified-email allowlist and aal2 enforced by is_shilevi_owner_admin().
  if owner_admin and old.status = 'pending' and new.status in ('approved', 'rejected') then
    if old.user_id = actor_id then
      raise exception 'Owners cannot review their own provider application.'
        using errcode = '42501';
    end if;
    if new.reviewed_by is distinct from actor_id
      or new.reviewed_at is null
      or new.submitted_at is distinct from old.submitted_at
      or new.user_id is distinct from old.user_id
      or new.activity_type is distinct from old.activity_type
      or new.business_name is distinct from old.business_name
      or new.application_data is distinct from old.application_data
      or new.country_code is distinct from old.country_code
      or new.public_reference is distinct from old.public_reference
      or new.created_at is distinct from old.created_at
    then
      raise exception 'Review may change only status and review metadata.'
        using errcode = '42501';
    end if;
    if new.status = 'rejected' and nullif(trim(coalesce(new.rejection_reason, new.reviewer_note, '')), '') is null then
      raise exception 'A rejection reason is required.'
        using errcode = '23514';
    end if;
    if new.status = 'approved' and new.rejection_reason is not null then
      raise exception 'Approved applications cannot have a rejection reason.'
        using errcode = '23514';
    end if;
    return new;
  end if;

  raise exception 'Provider application status transition is not permitted.'
    using errcode = '42501';
end;
$$;

revoke all on function public.guard_provider_application_transition() from public, anon, authenticated;
drop trigger if exists provider_application_transition_guard on public.provider_applications;
create trigger provider_application_transition_guard
before update on public.provider_applications
for each row execute function public.guard_provider_application_transition();

-- The existing migration 0005 audit trigger records status/review metadata transitions.
-- Do not add applicant free-text or identity data to audit metadata.

commit;
