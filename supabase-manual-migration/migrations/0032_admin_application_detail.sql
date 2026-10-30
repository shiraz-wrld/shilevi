-- Shilevi migration 0032: reviewer visibility, applicant identity and evidence for the console.
-- Forward-only and additive: one policy, one read-only function, and no change to any existing row.
--
-- Two real gaps are closed here, and both were behind the "apply migration 0006" error:
--
-- 1. `provider_applications` has never had a reviewer SELECT policy. Its only read policy is
--    `provider_applications_select_own` (migration 0001), so an owner could see nothing but their
--    own application. The review queue therefore appeared empty, and the single row an owner could
--    see was their own — which the trigger correctly refuses to let them approve. The generic
--    error sentence in the screen then blamed migration 0006, which was already installed.
-- 2. `profiles` is readable only by its own row (migration 0001) and email lives in `auth.users`,
--    which PostgREST never exposes. Even with the queue visible, an owner saw a bare user id, a
--    business name and free text — not enough to make a lawful decision, and not enough to notice
--    that the applicant never confirmed an email address.
--
-- Authorization for both is `has_staff_capability('applications.review')`, which is already true
-- for an allowlisted owner at aal2 and false for everyone else. Nothing here widens ordinary
-- applicant access: the existing self-only policy remains, and SELECT policies are combined with
-- OR rather than replaced.

begin;

drop policy if exists "provider_applications_read_reviewer" on public.provider_applications;
create policy "provider_applications_read_reviewer" on public.provider_applications
for select to authenticated
using ((select public.has_staff_capability('applications.review')));

create or replace function public.admin_application_detail(p_application_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_application public.provider_applications;
begin
  if not public.has_staff_capability('applications.review') then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  select * into v_application
  from public.provider_applications
  where id = p_application_id;

  if v_application.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'application', jsonb_build_object(
      'id', v_application.id,
      'user_id', v_application.user_id,
      'activity_type', v_application.activity_type,
      'status', v_application.status,
      'business_name', v_application.business_name,
      'business_registration_number', v_application.business_registration_number,
      'public_reference', v_application.public_reference,
      'country_code', v_application.country_code,
      'application_data', v_application.application_data,
      'submitted_at', v_application.submitted_at,
      'created_at', v_application.created_at,
      'reviewed_at', v_application.reviewed_at,
      'reviewed_by', v_application.reviewed_by,
      'reviewer_note', v_application.reviewer_note,
      'rejection_reason', v_application.rejection_reason
    ),
    'applicant', jsonb_build_object(
      'user_id', v_application.user_id,
      'display_name', (select p.display_name from public.profiles p where p.id = v_application.user_id),
      'phone', (select p.phone from public.profiles p where p.id = v_application.user_id),
      'email', (select u.email from auth.users u where u.id = v_application.user_id),
      'email_confirmed', coalesce(
        (select u.email_confirmed_at is not null from auth.users u where u.id = v_application.user_id),
        false
      ),
      'account_created_at', (select u.created_at from auth.users u where u.id = v_application.user_id),
      'last_sign_in_at', (select u.last_sign_in_at from auth.users u where u.id = v_application.user_id),
      'roles', coalesce(
        (select jsonb_agg(r.role order by r.role)
         from public.user_roles r
         where r.user_id = v_application.user_id),
        '[]'::jsonb
      )
    ),
    'documents', coalesce(
      (select jsonb_agg(
         jsonb_build_object(
           'id', d.id,
           'doc_type', d.doc_type,
           'status', d.status,
           'expires_at', d.expires_at,
           'reviewer_note', d.reviewer_note,
           'reviewed_at', d.reviewed_at,
           'created_at', d.created_at
         ) order by d.created_at desc
       )
       from public.delivery_documents d
       where d.application_id = v_application.id),
      '[]'::jsonb
    ),
    'vehicles', coalesce(
      (select jsonb_agg(
         jsonb_build_object(
           'id', v.id,
           'mode', v.mode,
           'make_model', v.make_model,
           'plate_number', v.plate_number,
           'seat_capacity', v.seat_capacity,
           'verification_status', v.verification_status,
           'reviewer_note', v.reviewer_note,
           'is_active', v.is_active,
           'created_at', v.created_at
         ) order by v.created_at desc
       )
       from public.transport_vehicles v
       where v.user_id = v_application.user_id),
      '[]'::jsonb
    ),
    'fleets', coalesce(
      (select jsonb_agg(
         jsonb_build_object(
           'id', f.id,
           'business_name', f.business_name,
           'status', f.status,
           'reviewer_note', f.reviewer_note,
           'reviewed_at', f.reviewed_at,
           'created_at', f.created_at
         ) order by f.created_at desc
       )
       from public.delivery_fleets f
       where f.owner_user_id = v_application.user_id
          or f.application_id = v_application.id),
      '[]'::jsonb
    ),
    'service_areas', coalesce(
      (select jsonb_agg(
         jsonb_build_object(
           'county', sl.county,
           'county_code', sl.county_code,
           'is_active', psa.is_active
         ) order by sl.county
       )
       from public.provider_activities pa
       join public.provider_service_areas psa on psa.provider_activity_id = pa.id
       join public.service_locations sl on sl.id = psa.location_id
       where pa.user_id = v_application.user_id),
      '[]'::jsonb
    ),
    'history', coalesce(
      (select jsonb_agg(
         jsonb_build_object(
           'action', a.action,
           'outcome', a.outcome,
           'metadata', a.metadata,
           'actor_id', a.actor_id,
           'created_at', a.created_at
         ) order by a.created_at desc
       )
       from public.audit_events a
       where a.resource_type = 'provider_applications'
         and a.resource_id = v_application.id::text),
      '[]'::jsonb
    )
  );
end;
$$;

revoke all on function public.admin_application_detail(uuid) from public, anon;
grant execute on function public.admin_application_detail(uuid) to authenticated;

commit;
