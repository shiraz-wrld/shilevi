-- Shilevi migration 0035: personalized customer home.
--
-- What this adds, and why:
--
-- 1. `customer_preferences` holds the two things a signed-in shopper genuinely controls: the area
--    discovery is ranked by, and whether their own browsing history may personalise the home page.
--    One row per user, RLS-enabled, own-only.
--
-- 2. `search_events` already measured demand, but a customer could not read their own rows, so the
--    product could not answer "what did I look at?". A `search_events_self_read` policy adds that
--    without widening anything else: the existing owner policy is unchanged and no client may read
--    another person's history. `clear_my_marketplace_history()` detaches your rows instead of
--    deleting them, so demand totals stay honest while personalisation is forgotten.
--
-- 3. `record_listing_view` records a genuine detail-page view for the signed-in viewer. It is
--    security-definer so it can write past the (deliberately) absent insert policy, refuses anything
--    that is not a published listing, deduplicates repeated views of the same listing within 30
--    minutes, and never accepts a user id from the caller.
--
-- 4. `customer_home` is the read model behind the signed-in home page. It ranks published,
--    active-category listings using signals that actually exist: recency-weighted category affinity
--    from searches, views, saved items and past orders; the customer's chosen county; and the price
--    band they keep browsing. It returns `has_history = false` instead of inventing a profile, and it
--    never returns another person's rows, private addresses, contacts or documents.
--
-- This migration only adds objects, one index, one policy and functions. It deletes no rows and
-- changes no financial, payment, delivery, proof-of-delivery or authorization behaviour.

begin;

-- ---------------------------------------------------------------- customer preferences

create table if not exists public.customer_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  -- A county name from `service_locations`, or null for "no chosen area". Deliberately not a FK so
  -- that consolidating a county row never cascades a shopper's preference away.
  home_county text check (home_county is null or char_length(home_county) between 1 and 80),
  -- Consent for history-based ranking. Turning it off keeps the home page useful (area and newest
  -- listings) and stops affinity being computed from this account's events.
  personalization_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.customer_preferences enable row level security;
revoke all on public.customer_preferences from anon, authenticated;
grant select, insert, update on public.customer_preferences to authenticated;

drop policy if exists "customer_preferences_select_own" on public.customer_preferences;
create policy "customer_preferences_select_own" on public.customer_preferences
for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "customer_preferences_insert_own" on public.customer_preferences;
create policy "customer_preferences_insert_own" on public.customer_preferences
for insert to authenticated
with check (
  user_id = (select auth.uid())
  -- The area must be a real county the platform knows about; a browser cannot invent one.
  and (
    home_county is null
    or exists (
      select 1 from public.service_locations sl
      where lower(sl.county) = lower(customer_preferences.home_county)
    )
  )
);

drop policy if exists "customer_preferences_update_own" on public.customer_preferences;
create policy "customer_preferences_update_own" on public.customer_preferences
for update to authenticated
using (user_id = (select auth.uid()))
with check (
  user_id = (select auth.uid())
  and (
    home_county is null
    or exists (
      select 1 from public.service_locations sl
      where lower(sl.county) = lower(customer_preferences.home_county)
    )
  )
);

-- ---------------------------------------------------------------- own history

-- A detail view is a real engagement signal distinct from a search-result click. Extending the
-- existing check constraint keeps one table and one retention rule for all marketplace events.
alter table public.search_events drop constraint if exists search_events_event_type_check;
alter table public.search_events
  add constraint search_events_event_type_check
  check (event_type in ('search', 'listing_click', 'listing_view'));

create index if not exists search_events_user_recent_idx
  on public.search_events (user_id, created_at desc)
  where user_id is not null;

drop policy if exists "search_events_self_read" on public.search_events;
create policy "search_events_self_read" on public.search_events
for select to authenticated
using (user_id = (select auth.uid()));

create or replace function public.record_listing_view(p_listing_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_category uuid;
begin
  -- Anonymous browsing is not attributed to anybody. The page only calls this for a signed-in user.
  if v_uid is null then
    return false;
  end if;

  select l.category_id into v_category
  from public.listings l
  join public.marketplace_categories c on c.id = l.category_id
  where l.id = p_listing_id
    and l.status = 'published'
    and c.is_active;

  if v_category is null then
    raise exception 'Listing not found.';
  end if;

  -- Reading the same listing repeatedly is one interest, not twenty. Thirty minutes covers a
  -- session while still letting a genuine return visit count.
  if exists (
    select 1 from public.search_events e
    where e.user_id = v_uid
      and e.event_type = 'listing_view'
      and e.listing_id = p_listing_id
      and e.created_at > now() - interval '30 minutes'
  ) then
    return false;
  end if;

  insert into public.search_events (event_type, user_id, category_id, listing_id)
  values ('listing_view', v_uid, v_category, p_listing_id);

  return true;
end;
$$;

revoke all on function public.record_listing_view(uuid) from public, anon;
grant execute on function public.record_listing_view(uuid) to authenticated;

-- Detach this account's rows rather than deleting them: demand totals stay accurate, and no other
-- person's data is touched. Rows with a null user_id can never be re-attributed.
create or replace function public.clear_my_marketplace_history()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_count integer;
begin
  if v_uid is null then
    raise exception 'Sign in to clear your history.';
  end if;

  update public.search_events
  set user_id = null
  where user_id = v_uid;
  get diagnostics v_count = row_count;

  delete from public.customer_preferences where user_id = v_uid;

  return v_count;
end;
$$;

revoke all on function public.clear_my_marketplace_history() from public, anon;
grant execute on function public.clear_my_marketplace_history() to authenticated;

create or replace function public.set_customer_area(
  p_county text default null,
  p_personalization_enabled boolean default null
)
returns public.customer_preferences
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_county text;
  v_row public.customer_preferences;
begin
  if v_uid is null then
    raise exception 'Sign in to choose an area.';
  end if;

  if p_county is not null and btrim(p_county) <> '' then
    select sl.county into v_county
    from public.service_locations sl
    where lower(sl.county) = lower(btrim(p_county))
    limit 1;

    if v_county is null then
      raise exception 'That area is not one of the supported counties.';
    end if;
  end if;

  insert into public.customer_preferences (user_id, home_county, personalization_enabled)
  values (v_uid, v_county, coalesce(p_personalization_enabled, true))
  on conflict (user_id) do update
    set home_county = v_county,
        personalization_enabled = coalesce(p_personalization_enabled, public.customer_preferences.personalization_enabled),
        updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.set_customer_area(text, boolean) from public, anon;
grant execute on function public.set_customer_area(text, boolean) to authenticated;

-- ---------------------------------------------------------------- home read model

create or replace function public.customer_home(
  p_county text default null,
  p_limit integer default 8
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to load your dashboard.';
  end if;

  -- One statement, so every aggregate sees the same signal set and the same clock. The CTEs are
  -- ordered by dependency; nothing here can reach another account's row.
  return (
    with me as (
      select auth.uid() as uid
    ),
    pref as (
      select coalesce(cp.personalization_enabled, true) as enabled, cp.home_county
      from me
      left join public.customer_preferences cp on cp.user_id = me.uid
    ),
    area as (
      select coalesce(
        (
          select sl.county
          from public.service_locations sl
          where p_county is not null
            and btrim(p_county) <> ''
            and lower(sl.county) = lower(btrim(p_county))
          limit 1
        ),
        (select home_county from pref)
      ) as county
    ),
    -- Recency-weighted signals. Half-life is ~21 days, so a sustained recent interest outranks one
    -- accidental click months ago without erasing longer-term taste.
    signal as (
      select e.category_id,
             2.0 * exp(-(extract(epoch from (now() - e.created_at)) / 86400.0) / 21.0) as weight,
             null::bigint as price_minor,
             e.created_at
      from public.search_events e, me, pref
      where e.user_id = me.uid
        and pref.enabled
        and e.category_id is not null
        and e.created_at > now() - interval '180 days'

      union all

      select l.category_id,
             1.5 * exp(-(extract(epoch from (now() - e.created_at)) / 86400.0) / 21.0),
             coalesce(l.price_minor, pl.rent_minor),
             e.created_at
      from public.search_events e
      join public.listings l on l.id = e.listing_id
      left join public.property_listings pl on pl.listing_id = l.id
      cross join me
      cross join pref
      where e.user_id = me.uid
        and pref.enabled
        and e.event_type in ('listing_click', 'listing_view')
        and e.created_at > now() - interval '180 days'

      union all

      select l.category_id,
             3.0 * exp(-(extract(epoch from (now() - s.created_at)) / 86400.0) / 21.0),
             coalesce(l.price_minor, pl.rent_minor),
             s.created_at
      from public.saved_listings s
      join public.listings l on l.id = s.listing_id
      left join public.property_listings pl on pl.listing_id = l.id
      cross join me
      cross join pref
      where s.user_id = me.uid
        and pref.enabled

      union all

      select l.category_id,
             4.0 * exp(-(extract(epoch from (now() - o.created_at)) / 86400.0) / 21.0),
             oi.unit_price_minor,
             o.created_at
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      join public.listings l on l.id = oi.listing_id
      cross join me
      cross join pref
      where o.customer_id = me.uid
        and pref.enabled
    ),
    stats as (
      select
        exists (select 1 from signal) as has_history,
        (select round(avg(price_minor)) from signal where price_minor is not null and price_minor > 0) as avg_price
    ),
    top_categories as (
      select category_id, sum(weight) as weight
      from signal
      group by category_id
      order by sum(weight) desc, category_id
      limit 3
    ),
    candidates as (
      select
        l.id,
        l.title,
        l.description,
        l.currency,
        coalesce(l.price_minor, pl.rent_minor) as price_minor,
        l.published_at,
        l.is_featured,
        l.category_id,
        c.name as category_name,
        c.division,
        coalesce(pl.county, l.attributes ->> 'county') as county,
        nullif(l.attributes ->> 'cover_image_url', '') as cover_image_url,
        coalesce(tc.weight, 0) * 3.0
          + case
              when (select county from area) is not null
                and lower(coalesce(pl.county, l.attributes ->> 'county', '')) = lower((select county from area))
              then 1.5 else 0
            end
          + case
              when (select avg_price from stats) is not null
                and coalesce(l.price_minor, pl.rent_minor)
                  between (select avg_price from stats) * 0.5 and (select avg_price from stats) * 1.75
              then 1.5 else 0
            end
          + exp(-(extract(epoch from (now() - coalesce(l.published_at, l.created_at))) / 86400.0) / 30.0)
          - case when sv.id is not null then 0.5 else 0 end
          as score
      from public.listings l
      join public.marketplace_categories c on c.id = l.category_id
      left join public.property_listings pl on pl.listing_id = l.id
      left join top_categories tc on tc.category_id = l.category_id
      left join public.saved_listings sv on sv.listing_id = l.id and sv.user_id = (select uid from me)
      where l.status = 'published'
        and c.is_active
        and l.owner_id <> (select uid from me)
        and (l.brand_id is null or exists (
          select 1 from public.marketplace_brands b where b.id = l.brand_id and b.is_active = true
        ))
    ),
    ranked as (
      select * from candidates
      order by score desc, published_at desc nulls last, id
      limit greatest(1, least(coalesce(p_limit, 8), 24))
    ),
    area_rows as (
      select
        l.id, l.title, l.description, l.currency,
        coalesce(l.price_minor, pl.rent_minor) as price_minor,
        l.published_at, l.category_id, c.name as category_name, c.division,
        coalesce(pl.county, l.attributes ->> 'county') as county,
        nullif(l.attributes ->> 'cover_image_url', '') as cover_image_url
      from public.listings l
      join public.marketplace_categories c on c.id = l.category_id
      left join public.property_listings pl on pl.listing_id = l.id
      cross join area
      cross join me
      where l.status = 'published'
        and c.is_active
        and l.owner_id <> me.uid
        and area.county is not null
        and lower(coalesce(pl.county, l.attributes ->> 'county', '')) = lower(area.county)
        and (l.brand_id is null or exists (
          select 1 from public.marketplace_brands b where b.id = l.brand_id and b.is_active = true
        ))
      order by l.published_at desc nulls last, l.id
      limit 6
    ),
    recent_searches as (
      select distinct on (coalesce(e.query_normalized, e.category_id::text, e.division, 'browse'))
        e.query_text,
        e.query_normalized,
        e.division,
        e.category_id,
        c.name as category_name,
        e.county,
        e.min_price_minor,
        e.max_price_minor,
        e.created_at
      from public.search_events e
      left join public.marketplace_categories c on c.id = e.category_id
      cross join me
      where e.user_id = me.uid
        and e.event_type = 'search'
        and e.created_at > now() - interval '90 days'
      order by coalesce(e.query_normalized, e.category_id::text, e.division, 'browse'), e.created_at desc
      limit 6
    ),
    recently_viewed as (
      select distinct on (l.id)
        l.id, l.title, coalesce(l.price_minor, pl.rent_minor) as price_minor, l.currency,
        c.name as category_name, e.created_at
      from public.search_events e
      join public.listings l on l.id = e.listing_id
      join public.marketplace_categories c on c.id = l.category_id
      left join public.property_listings pl on pl.listing_id = l.id
      cross join me
      where e.user_id = me.uid
        and e.event_type in ('listing_click', 'listing_view')
        and l.status = 'published'
        and c.is_active
      order by l.id, e.created_at desc
      limit 6
    ),
    recent_orders as (
      select
        o.id, o.order_number, o.status, o.payment_status, o.total_minor, o.currency, o.created_at,
        (select count(*) from public.order_items oi where oi.order_id = o.id) as item_count
      from public.orders o
      cross join me
      where o.customer_id = me.uid
      order by o.created_at desc
      limit 4
    ),
    saved as (
      select
        l.id, l.title, coalesce(l.price_minor, pl.rent_minor) as price_minor, l.currency,
        c.name as category_name, s.created_at
      from public.saved_listings s
      join public.listings l on l.id = s.listing_id
      join public.marketplace_categories c on c.id = l.category_id
      left join public.property_listings pl on pl.listing_id = l.id
      cross join me
      where s.user_id = me.uid
        and l.status = 'published'
        and c.is_active
      order by s.created_at desc
      limit 6
    ),
    pending as (
      select action, created_at
      from (
        select
          jsonb_build_object(
            'kind', 'pay', 'order_id', o.id, 'order_number', o.order_number,
            'label', 'Complete payment for order ' || o.order_number
          ) as action,
          o.created_at
        from public.orders o, me
        where o.customer_id = me.uid
          and o.status = 'pending_payment'
          and o.payment_status = 'unpaid'

        union all

        select
          jsonb_build_object(
            'kind', 'confirm', 'order_id', o.id, 'order_number', o.order_number,
            'label', 'Confirm receipt of order ' || o.order_number
          ),
          o.created_at
        from public.orders o, me
        where o.customer_id = me.uid
          and o.status = 'delivered'
      ) actions
    )
    select jsonb_build_object(
      'has_history', (select has_history from stats),
      'personalization_enabled', (select enabled from pref),
      'area', (select county from area),
      'average_price_minor', (select avg_price from stats),
      'recommendations', coalesce((
        select jsonb_agg(item order by score desc, published_at desc nulls last)
        from (
          select jsonb_build_object(
            'id', r.id, 'title', r.title,
            'description', left(coalesce(r.description, ''), 240),
            'price_minor', r.price_minor, 'currency', r.currency,
            'category_id', r.category_id, 'category_name', r.category_name,
            'division', r.division, 'county', r.county, 'published_at', r.published_at,
            'is_featured', r.is_featured, 'cover_image_url', r.cover_image_url
          ) as item, r.score, r.published_at
          from ranked r
        ) rows
      ), '[]'::jsonb),
      'nearby', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', a.id, 'title', a.title,
          'description', left(coalesce(a.description, ''), 200),
          'price_minor', a.price_minor, 'currency', a.currency,
          'category_name', a.category_name, 'division', a.division,
          'county', a.county, 'published_at', a.published_at, 'cover_image_url', a.cover_image_url
        ) order by a.published_at desc nulls last)
        from area_rows a
      ), '[]'::jsonb),
      'interests', coalesce((
        select jsonb_agg(jsonb_build_object(
          'category_id', t.category_id, 'category_name', c.name, 'division', c.division,
          'weight', round(t.weight, 3)
        ) order by t.weight desc)
        from top_categories t
        join public.marketplace_categories c on c.id = t.category_id
      ), '[]'::jsonb),
      'recent_searches', coalesce((
        select jsonb_agg(jsonb_build_object(
          'query', rs.query_text, 'query_normalized', rs.query_normalized,
          'division', rs.division, 'category_id', rs.category_id,
          'category_name', rs.category_name, 'county', rs.county,
          'min_price_minor', rs.min_price_minor, 'max_price_minor', rs.max_price_minor
        ) order by rs.created_at desc)
        from recent_searches rs
      ), '[]'::jsonb),
      'recently_viewed', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', rv.id, 'title', rv.title, 'price_minor', rv.price_minor,
          'currency', rv.currency, 'category_name', rv.category_name
        ) order by rv.created_at desc)
        from recently_viewed rv
      ), '[]'::jsonb),
      'saved', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', sv2.id, 'title', sv2.title, 'price_minor', sv2.price_minor,
          'currency', sv2.currency, 'category_name', sv2.category_name
        ) order by sv2.created_at desc)
        from saved sv2
      ), '[]'::jsonb),
      'orders', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', ro.id, 'order_number', ro.order_number, 'status', ro.status,
          'payment_status', ro.payment_status, 'total_minor', ro.total_minor,
          'currency', ro.currency, 'created_at', ro.created_at, 'item_count', ro.item_count
        ) order by ro.created_at desc)
        from recent_orders ro
      ), '[]'::jsonb),
      'pending_actions', coalesce((
        select jsonb_agg(action order by created_at desc)
        from pending
      ), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.customer_home(text, integer) from public, anon;
grant execute on function public.customer_home(text, integer) to authenticated;

commit;
