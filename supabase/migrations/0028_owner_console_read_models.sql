-- 0028 — Owner console read models.
--
-- The console needs to show identity, delivery, request, review, provider and coverage records
-- whose RLS is participant-only. Rather than widening table policies (which would also widen
-- what a signed-in customer could read), each screen gets a narrow SECURITY DEFINER function.
--
-- Guarantees shared by every function in this file:
--   * SECURITY DEFINER with an empty search_path and fully-qualified names.
--   * The caller must pass public.is_shilevi_owner_admin(), which requires an allowlisted,
--     email-confirmed account at assurance level 2 (aal2).
--   * EXECUTE is revoked from public/anon and granted to authenticated only.
--   * Read-only. No function inserts, updates or deletes.
--   * PII is minimised on purpose: street addresses, message bodies, phone numbers, payment
--     references and verification documents are never returned. Reviews are truncated.
--
-- These functions do not replace operator judgement. They surface evidence; they never assert
-- that a payment, delivery or verification actually succeeded.

-- ---------------------------------------------------------------- people

create or replace function public.admin_list_customers(p_search text default null, p_limit integer default 100)
returns table (
  user_id uuid,
  email text,
  display_name text,
  country_code text,
  roles text,
  order_count bigint,
  joined_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_search text;
begin
  if not public.is_shilevi_owner_admin() then
    raise exception 'Not authorized.';
  end if;

  v_limit := greatest(1, least(coalesce(p_limit, 100), 200));
  v_search := nullif(trim(coalesce(p_search, '')), '');

  return query
    select
      u.id,
      lower(u.email),
      p.display_name,
      coalesce(p.country_code, 'KE'),
      coalesce((
        select string_agg(r.role, ', ' order by r.role)
        from public.user_roles r
        where r.user_id = u.id
      ), ''),
      (select count(*) from public.orders o where o.customer_id = u.id),
      u.created_at
    from auth.users u
    left join public.profiles p on p.id = u.id
    where v_search is null
      or lower(coalesce(u.email, '')) like '%' || lower(v_search) || '%'
      or lower(coalesce(p.display_name, '')) like '%' || lower(v_search) || '%'
    order by u.created_at desc
    limit v_limit;
end;
$$;
revoke all on function public.admin_list_customers(text, integer) from public, anon;
grant execute on function public.admin_list_customers(text, integer) to authenticated;

create or replace function public.admin_list_role_assignments(p_limit integer default 200)
returns table (user_id uuid, email text, role text, granted_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer;
begin
  if not public.is_shilevi_owner_admin() then
    raise exception 'Not authorized.';
  end if;

  v_limit := greatest(1, least(coalesce(p_limit, 200), 500));

  return query
    select ur.user_id, lower(u.email), ur.role, ur.granted_at
    from public.user_roles ur
    join auth.users u on u.id = ur.user_id
    order by ur.granted_at desc
    limit v_limit;
end;
$$;
revoke all on function public.admin_list_role_assignments(integer) from public, anon;
grant execute on function public.admin_list_role_assignments(integer) to authenticated;

-- ---------------------------------------------------------------- providers

create or replace function public.admin_list_providers(p_limit integer default 100)
returns table (
  user_id uuid,
  email text,
  business_name text,
  activity_type text,
  application_status text,
  approved_activities bigint,
  listing_count bigint,
  active_areas bigint,
  submitted_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer;
begin
  if not public.is_shilevi_owner_admin() then
    raise exception 'Not authorized.';
  end if;

  v_limit := greatest(1, least(coalesce(p_limit, 100), 200));

  return query
    select
      pa.user_id,
      lower(u.email),
      pa.business_name,
      pa.activity_type,
      pa.status,
      (select count(*) from public.provider_activities a
        where a.application_id = pa.id and a.status = 'approved'),
      (select count(*) from public.listings l where l.provider_application_id = pa.id),
      (select count(*) from public.provider_service_areas s
        join public.provider_activities a on a.id = s.provider_activity_id
        where a.application_id = pa.id and s.is_active),
      coalesce(pa.submitted_at, pa.created_at)
    from public.provider_applications pa
    join auth.users u on u.id = pa.user_id
    order by coalesce(pa.submitted_at, pa.created_at) desc
    limit v_limit;
end;
$$;
revoke all on function public.admin_list_providers(integer) from public, anon;
grant execute on function public.admin_list_providers(integer) to authenticated;

-- ---------------------------------------------------------------- riders

create or replace function public.admin_list_riders(p_limit integer default 100)
returns table (
  user_id uuid,
  email text,
  completed_rides bigint,
  earned_minor bigint,
  paid_out_minor bigint,
  pending_payout_minor bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer;
begin
  if not public.is_shilevi_owner_admin() then
    raise exception 'Not authorized.';
  end if;

  v_limit := greatest(1, least(coalesce(p_limit, 100), 200));

  return query
    with base as (
      select r.rider_id as rider_user_id from public.rides r
      union
      select p.payee_id from public.payouts p where p.payee_role = 'rider'
      union
      select le.party_id from public.ledger_entries le
        where le.account = 'rider_payable' and le.party_id is not null
    )
    select
      b.rider_user_id,
      lower(u.email),
      (select count(*) from public.rides r
        where r.rider_id = b.rider_user_id and r.status = 'completed'),
      coalesce((select sum(le.credit_minor - le.debit_minor) from public.ledger_entries le
        where le.account = 'rider_payable' and le.party_id = b.rider_user_id), 0)::bigint,
      coalesce((select sum(p.amount_minor) from public.payouts p
        where p.payee_id = b.rider_user_id and p.payee_role = 'rider' and p.status = 'paid'), 0)::bigint,
      coalesce((select sum(p.amount_minor) from public.payouts p
        where p.payee_id = b.rider_user_id and p.payee_role = 'rider'
          and p.status in ('pending', 'processing')), 0)::bigint
    from base b
    join auth.users u on u.id = b.rider_user_id
    order by 4 desc
    limit v_limit;
end;
$$;
revoke all on function public.admin_list_riders(integer) from public, anon;
grant execute on function public.admin_list_riders(integer) to authenticated;

-- ---------------------------------------------------------------- fulfilment

create or replace function public.admin_list_deliveries(p_limit integer default 100)
returns table (
  id uuid,
  order_number text,
  status text,
  dropoff_county text,
  delivery_fee_minor bigint,
  rider_assigned boolean,
  created_at timestamptz,
  delivered_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer;
begin
  if not public.is_shilevi_owner_admin() then
    raise exception 'Not authorized.';
  end if;

  v_limit := greatest(1, least(coalesce(p_limit, 100), 200));

  return query
    select d.id, o.order_number, d.status, d.dropoff_county, d.delivery_fee_minor,
      (d.rider_id is not null), d.created_at, d.delivered_at
    from public.deliveries d
    join public.orders o on o.id = d.order_id
    order by d.created_at desc
    limit v_limit;
end;
$$;
revoke all on function public.admin_list_deliveries(integer) from public, anon;
grant execute on function public.admin_list_deliveries(integer) to authenticated;

create or replace function public.admin_list_listing_requests(p_limit integer default 100)
returns table (
  id uuid,
  listing_title text,
  status text,
  created_at timestamptz,
  responded_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer;
begin
  if not public.is_shilevi_owner_admin() then
    raise exception 'Not authorized.';
  end if;

  v_limit := greatest(1, least(coalesce(p_limit, 100), 200));

  return query
    select r.id, l.title, r.status, r.created_at, r.responded_at
    from public.listing_requests r
    join public.listings l on l.id = r.listing_id
    order by r.created_at desc
    limit v_limit;
end;
$$;
revoke all on function public.admin_list_listing_requests(integer) from public, anon;
grant execute on function public.admin_list_listing_requests(integer) to authenticated;

create or replace function public.admin_list_ride_reviews(p_limit integer default 100)
returns table (
  id uuid,
  rating smallint,
  comment text,
  created_at timestamptz,
  ride_number text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer;
begin
  if not public.is_shilevi_owner_admin() then
    raise exception 'Not authorized.';
  end if;

  v_limit := greatest(1, least(coalesce(p_limit, 100), 200));

  return query
    select rr.id, rr.rating, left(rr.comment, 400), rr.created_at, r.ride_number
    from public.ride_reviews rr
    join public.rides r on r.id = rr.ride_id
    order by rr.created_at desc
    limit v_limit;
end;
$$;
revoke all on function public.admin_list_ride_reviews(integer) from public, anon;
grant execute on function public.admin_list_ride_reviews(integer) to authenticated;

-- ---------------------------------------------------------------- onboarding & coverage

create or replace function public.admin_onboarding_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_shilevi_owner_admin() then
    raise exception 'Not authorized.';
  end if;

  return jsonb_build_object(
    'total', (select count(*) from public.user_onboarding),
    'completed', (select count(*) from public.user_onboarding where completed_at is not null),
    'incomplete', (select count(*) from public.user_onboarding where completed_at is null),
    'customers', (select count(*) from public.user_onboarding where account_intent = 'customer'),
    'providers', (select count(*) from public.user_onboarding where account_intent = 'provider'),
    'missing_county', (select count(*) from public.user_onboarding where county is null),
    'counties', coalesce((
      select jsonb_agg(row_to_json(county_rows))
      from (
        select county, count(*) as accounts
        from public.user_onboarding
        where county is not null
        group by county
        order by count(*) desc
        limit 8
      ) county_rows
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.admin_onboarding_overview() from public, anon;
grant execute on function public.admin_onboarding_overview() to authenticated;

create or replace function public.admin_service_area_coverage(p_limit integer default 100)
returns table (
  location_id uuid,
  county text,
  county_code smallint,
  is_active boolean,
  active_providers bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer;
begin
  if not public.is_shilevi_owner_admin() then
    raise exception 'Not authorized.';
  end if;

  v_limit := greatest(1, least(coalesce(p_limit, 100), 200));

  return query
    select l.id, l.county, l.county_code, l.is_active,
      (select count(*) from public.provider_service_areas s
        where s.location_id = l.id and s.is_active)
    from public.service_locations l
    order by l.county_code
    limit v_limit;
end;
$$;
revoke all on function public.admin_service_area_coverage(integer) from public, anon;
grant execute on function public.admin_service_area_coverage(integer) to authenticated;
