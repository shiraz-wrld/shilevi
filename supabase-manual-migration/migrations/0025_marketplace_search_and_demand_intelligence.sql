-- Shilevi migration 0025: marketplace search and demand intelligence.
--
-- What this adds, and why:
--
-- 1. Marketplace search existed only as a browser-side `ilike` on listing titles. It could not rank,
--    paginate, search descriptions, filter by county or return a truthful total, and it re-implemented
--    visibility rules in the client. `search_marketplace` does the work in the database: published
--    listings only, active categories only, taxonomy-aware category scope, industry-standard full-text
--    ranking with a substring fallback, stable keyset-ordered pagination and an exact total.
--    It is deliberately SECURITY INVOKER: the existing RLS on `listings` and `property_listings`
--    stays in force, so a mistake in the function cannot reveal an unpublished or unapproved listing.
--    It returns a whitelisted set of public columns — never `property_contacts` (exact address or
--    phone), never provider documents, never internal notes or reviewer fields.
--
-- 2. Nothing measured demand. `search_events` records search and click events with a deliberately
--    narrow field set: no IP address, no user agent, no session identifier, no free-form metadata
--    blob, and a normalised query capped at 120 characters. Rows are written only by trusted server
--    code through the service role, so a browser cannot forge impressions or conversions; the
--    `result_count` and the shown listing ids come from the database's own answer, not from the page.
--    Clients have no access to the table at all except an owner read policy for the admin view.
--
-- 3. `admin_search_insights` answers the operational questions (top queries, zero-result demand,
--    category and county demand, impressions without clicks, click-through) from real rows, and says
--    `has_data = false` rather than inventing history when the window is empty.
--
-- 4. `prune_search_events` exists so retention is an explicit, reversible operation instead of an
--    accidental permanent record. The default window is 180 days; the recommended schedule and the
--    data-protection reasoning are in docs/SEARCH.md.
--
-- Apply after 0024. This migration only adds objects and indexes; it deletes no rows and changes no
-- financial, payment or authorization behaviour.

begin;

-- ---------------------------------------------------------------- full-text search support

-- `to_tsvector(regconfig, text)` is immutable, so this can be a stored generated column: the index
-- and the query use exactly the same expression and cannot drift apart.
alter table public.listings
  add column if not exists search_vector tsvector
  generated always as (
    to_tsvector('simple'::regconfig, coalesce(title, '') || ' ' || coalesce(description, ''))
  ) stored;

create index if not exists listings_search_vector_idx
  on public.listings using gin (search_vector);

-- Discovery reads are almost always "published, newest first" or "published, cheapest first".
create index if not exists listings_published_at_idx
  on public.listings (published_at desc nulls last) where status = 'published';
create index if not exists listings_published_price_idx
  on public.listings (price_minor) where status = 'published';

-- ---------------------------------------------------------------- search

create or replace function public.search_marketplace(
  p_query text default null,
  p_division text default null,
  p_category_id uuid default null,
  p_county text default null,
  p_min_price_minor bigint default null,
  p_max_price_minor bigint default null,
  p_sort text default 'relevance',
  p_page integer default 1,
  p_page_size integer default 24
) returns jsonb
language plpgsql
stable
-- Intentionally not SECURITY DEFINER: RLS on listings and property_listings must keep deciding what
-- a caller is allowed to see. The function only narrows that set and whitelists the output columns.
set search_path = ''
as $$
declare
  v_query text;
  v_like text;
  v_tsq tsquery;
  v_sort text;
  v_page integer;
  v_size integer;
  v_offset integer;
begin
  -- Normalise the term: strip control characters, collapse whitespace, cap the length. An empty
  -- term means "browse", not "invalid": the UI uses the same endpoint for category and county
  -- browsing, and returning published listings is the honest answer to an empty query.
  v_query := nullif(
    left(btrim(regexp_replace(coalesce(p_query, ''), '[[:cntrl:]]', ' ', 'g')), 120),
    ''
  );

  -- Escape LIKE metacharacters in the term itself. Without this a query of "%" would expand to
  -- '%%%' and match every row, which is both wrong and a cheap way to force full scans.
  v_like := replace(
    replace(
      replace(coalesce(v_query, ''), chr(92), chr(92) || chr(92)),
      '%', chr(92) || '%'
    ),
    '_', chr(92) || '_'
  );

  if v_query is not null then
    v_tsq := websearch_to_tsquery('simple'::regconfig, v_query);
    -- A query made only of punctuation produces an empty tsquery; treat it as no term and rely on
    -- the substring fallback rather than silently matching everything.
    if v_tsq::text = '' then
      v_tsq := null;
    end if;
  end if;

  if p_division is not null and p_division not in ('products', 'services', 'transport_delivery', 'property_places') then
    raise exception 'Unknown marketplace section.';
  end if;

  v_sort := lower(coalesce(p_sort, 'relevance'));
  if v_sort not in ('relevance', 'newest', 'price_low', 'price_high', 'title') then
    v_sort := 'relevance';
  end if;
  if v_sort = 'relevance' and v_query is null then
    v_sort := 'newest';
  end if;

  v_page := greatest(1, least(coalesce(p_page, 1), 10000));
  v_size := greatest(1, least(coalesce(p_page_size, 24), 48));
  v_offset := (v_page - 1) * v_size;

  if p_min_price_minor is not null and p_min_price_minor < 0 then
    raise exception 'Minimum price cannot be negative.';
  end if;
  if p_max_price_minor is not null and p_max_price_minor < 0 then
    raise exception 'Maximum price cannot be negative.';
  end if;
  if p_min_price_minor is not null and p_max_price_minor is not null and p_min_price_minor > p_max_price_minor then
    raise exception 'Minimum price cannot exceed the maximum price.';
  end if;

  return (
    with recursive category_scope as (
      select c.id from public.marketplace_categories c where c.id = p_category_id
      union all
      select child.id
      from public.marketplace_categories child
      join category_scope parent on child.parent_id = parent.id
    ),
    matched as (
      select
        l.id,
        l.title,
        l.description,
        l.currency,
        l.published_at,
        l.is_featured,
        l.transaction_type,
        l.category_id,
        coalesce(l.price_minor, pl.rent_minor) as effective_price,
        c.name as category_name,
        c.slug as category_slug,
        c.division,
        coalesce(pl.county, l.attributes ->> 'county') as county,
        coalesce(pl.city, l.attributes ->> 'city') as city,
        pl.neighbourhood,
        pl.property_type,
        pl.bedrooms,
        pl.bathrooms,
        pl.rent_minor,
        pl.deposit_minor,
        pl.is_vacant,
        pl.verification_status,
        nullif(l.attributes ->> 'cover_image_url', '') as cover_image_url,
        case
          when v_tsq is null then 0::real
          else ts_rank_cd(l.search_vector, v_tsq)
        end as rank
      from public.listings l
      join public.marketplace_categories c on c.id = l.category_id
      left join public.property_listings pl on pl.listing_id = l.id
      where l.status = 'published'
        and c.is_active
        and (p_division is null or c.division = p_division)
        and (p_category_id is null or l.category_id in (select id from category_scope))
        and (
          v_query is null
          or (v_tsq is not null and l.search_vector @@ v_tsq)
          or l.title ilike '%' || v_like || '%' escape E'\\'
          or l.description ilike '%' || v_like || '%' escape E'\\'
        )
        and (
          p_county is null
          or lower(coalesce(pl.county, l.attributes ->> 'county', '')) = lower(btrim(p_county))
        )
        and (p_min_price_minor is null or coalesce(l.price_minor, pl.rent_minor) >= p_min_price_minor)
        and (p_max_price_minor is null or coalesce(l.price_minor, pl.rent_minor) <= p_max_price_minor)
    ),
    counted as (
      select count(*)::integer as total from matched
    ),
    page_rows as (
      select * from matched
      order by
        case when v_sort = 'relevance' then rank end desc nulls last,
        case when v_sort = 'relevance' then is_featured end desc nulls last,
        case when v_sort = 'price_low' then effective_price end asc nulls last,
        case when v_sort = 'price_high' then effective_price end desc nulls last,
        case when v_sort = 'title' then lower(title) end asc nulls last,
        published_at desc nulls last,
        id
      limit v_size offset v_offset
    ),
    items as (
      -- The aggregate carries the same ORDER BY as the page, so the JSON order cannot drift from
      -- the order pagination used.
      select coalesce(
        jsonb_agg(
          item order by
            case when v_sort = 'relevance' then rank end desc nulls last,
            case when v_sort = 'relevance' then is_featured end desc nulls last,
            case when v_sort = 'price_low' then effective_price end asc nulls last,
            case when v_sort = 'price_high' then effective_price end desc nulls last,
            case when v_sort = 'title' then lower(title) end asc nulls last,
            published_at desc nulls last,
            id
        ),
        '[]'::jsonb
      ) as payload
      from (
        select
          jsonb_build_object(
            'id', p.id,
            'title', p.title,
            -- Public descriptions are already public; the cap keeps a single payload bounded.
            'description', left(coalesce(p.description, ''), 400),
            'price_minor', p.effective_price,
            'currency', p.currency,
            'category_id', p.category_id,
            'category_name', p.category_name,
            'category_slug', p.category_slug,
            'division', p.division,
            'transaction_type', p.transaction_type,
            'published_at', p.published_at,
            'is_featured', p.is_featured,
            'cover_image_url', p.cover_image_url,
            'location', jsonb_build_object(
              'county', p.county,
              'city', p.city,
              'neighbourhood', p.neighbourhood
            ),
            -- Property detail carries public facts only. The exact address and contact live in
            -- property_contacts and are never joined here.
            'property', case
              when p.property_type is null then null
              else jsonb_build_object(
                'property_type', p.property_type,
                'bedrooms', p.bedrooms,
                'bathrooms', p.bathrooms,
                'rent_minor', p.rent_minor,
                'deposit_minor', p.deposit_minor,
                'is_vacant', p.is_vacant,
                'verification_status', p.verification_status
              )
            end
          ) as item,
          p.rank,
          p.is_featured,
          p.effective_price,
          p.published_at,
          p.title,
          p.id
        from page_rows p
      ) shaped
    )
    select jsonb_build_object(
      'total', counted.total,
      'page', v_page,
      'page_size', v_size,
      'pages', case when counted.total = 0 then 0 else ceil(counted.total::numeric / v_size)::integer end,
      'query', v_query,
      'division', p_division,
      'sort', v_sort,
      'items', items.payload
    )
    from counted, items
  );
end;
$$;

revoke all on function public.search_marketplace(text, text, uuid, text, bigint, bigint, text, integer, integer) from public, anon, authenticated;
grant execute on function public.search_marketplace(text, text, uuid, text, bigint, bigint, text, integer, integer) to anon, authenticated, service_role;

-- ---------------------------------------------------------------- search events

create table if not exists public.search_events (
  id bigint generated always as identity primary key,
  event_type text not null check (event_type in ('search', 'listing_click')),
  -- Nullable: most searches are anonymous, and account deletion must not delete demand history.
  user_id uuid references auth.users(id) on delete set null,
  query_text text check (query_text is null or char_length(query_text) <= 120),
  query_normalized text check (query_normalized is null or char_length(query_normalized) <= 120),
  division text check (division is null or division in ('products', 'services', 'transport_delivery', 'property_places')),
  category_id uuid references public.marketplace_categories(id) on delete set null,
  county text check (county is null or char_length(county) <= 80),
  min_price_minor bigint,
  max_price_minor bigint,
  sort text check (sort is null or char_length(sort) <= 24),
  page integer check (page is null or page between 1 and 10000),
  result_count integer check (result_count is null or result_count >= 0),
  -- The first page of results the visitor actually saw, capped at 24 ids. Listing ids are not
  -- personal data; they are what make "shown but never opened" measurable without tracking people.
  shown_listing_ids uuid[],
  listing_id uuid references public.listings(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists search_events_created_idx on public.search_events (created_at desc);
create index if not exists search_events_type_created_idx on public.search_events (event_type, created_at desc);
create index if not exists search_events_query_idx on public.search_events (query_normalized, created_at desc)
  where event_type = 'search';
create index if not exists search_events_listing_idx on public.search_events (listing_id, created_at desc)
  where event_type = 'listing_click';

alter table public.search_events enable row level security;

-- No client reads by default. Writers are server-side only; the owner read policy below exists so
-- the admin reporting page can be built on the owner's own session instead of the service role.
revoke all on public.search_events from anon, authenticated;

drop policy if exists "search_events_owner_read" on public.search_events;
create policy "search_events_owner_read" on public.search_events
for select to authenticated
using ((select public.is_shilevi_owner_admin()));

grant select on public.search_events to authenticated;

-- Server-only writer. The route derives result_count and shown_listing_ids from search_marketplace,
-- so a browser cannot inflate impressions or fabricate conversions.
create or replace function public.record_search_event(
  p_event_type text,
  p_query text default null,
  p_division text default null,
  p_category_id uuid default null,
  p_county text default null,
  p_min_price_minor bigint default null,
  p_max_price_minor bigint default null,
  p_sort text default null,
  p_page integer default null,
  p_result_count integer default null,
  p_listing_id uuid default null,
  p_shown_listing_ids uuid[] default null,
  p_user_id uuid default null
) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_query text;
  v_normalized text;
  v_shown uuid[];
  v_id bigint;
begin
  if p_event_type not in ('search', 'listing_click') then
    raise exception 'Unknown search event type.';
  end if;

  v_query := nullif(left(btrim(regexp_replace(coalesce(p_query, ''), '[[:cntrl:]]', ' ', 'g')), 120), '');
  if v_query is not null then
    v_normalized := left(lower(regexp_replace(v_query, '\s+', ' ', 'g')), 120);
  end if;

  if p_event_type = 'listing_click' then
    if p_listing_id is null then
      raise exception 'A listing is required for a click event.';
    end if;
    -- Only a published listing can produce an engagement event. This stops a draft or rejected
    -- listing from being probed into the analytics surface.
    if not exists (
      select 1 from public.listings l where l.id = p_listing_id and l.status = 'published'
    ) then
      raise exception 'Listing not found.';
    end if;
  end if;

  if p_shown_listing_ids is null then
    v_shown := null;
  else
    -- LIMIT must apply to the unnested rows, not to the single aggregated row.
    v_shown := (
      select array_agg(capped.value)
      from (select value from unnest(p_shown_listing_ids) as value limit 24) capped
    );
  end if;

  insert into public.search_events (
    event_type, user_id, query_text, query_normalized, division, category_id, county,
    min_price_minor, max_price_minor, sort, page, result_count, shown_listing_ids, listing_id
  ) values (
    p_event_type,
    p_user_id,
    v_query,
    v_normalized,
    p_division,
    p_category_id,
    left(nullif(btrim(p_county), ''), 80),
    case when p_min_price_minor is not null and p_min_price_minor >= 0 then p_min_price_minor end,
    case when p_max_price_minor is not null and p_max_price_minor >= 0 then p_max_price_minor end,
    left(nullif(btrim(p_sort), ''), 24),
    case when p_page is not null then greatest(1, least(p_page, 10000)) end,
    case when p_result_count is not null then greatest(0, p_result_count) end,
    v_shown,
    p_listing_id
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.record_search_event(text, text, text, uuid, text, bigint, bigint, text, integer, integer, uuid, uuid[], uuid) from public, anon, authenticated;
grant execute on function public.record_search_event(text, text, text, uuid, text, bigint, bigint, text, integer, integer, uuid, uuid[], uuid) to service_role;

-- ---------------------------------------------------------------- demand intelligence

create or replace function public.admin_search_insights(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days integer;
  v_from timestamptz;
  v_searches bigint;
  v_clicks bigint;
  v_zero bigint;
begin
  if not public.is_shilevi_owner_admin() then
    raise exception 'Not authorized.';
  end if;

  v_days := greatest(1, least(coalesce(p_days, 30), 365));
  v_from := now() - make_interval(days => v_days);

  select
    count(*) filter (where event_type = 'search'),
    count(*) filter (where event_type = 'listing_click'),
    count(*) filter (where event_type = 'search' and result_count = 0)
  into v_searches, v_clicks, v_zero
  from public.search_events
  where created_at >= v_from;

  return jsonb_build_object(
    'days', v_days,
    'from', v_from,
    'has_data', v_searches > 0,
    'searches', v_searches,
    'clicks', v_clicks,
    'zero_result_searches', v_zero,
    'click_through', case when v_searches = 0 then null
      else round(v_clicks::numeric / v_searches::numeric, 4) end,
    'top_queries', coalesce((
      select jsonb_agg(row_to_json(t))
      from (
        select
          query_normalized as query,
          count(*) as searches,
          count(*) filter (where result_count = 0) as zero_results,
          round(avg(result_count))::integer as average_results,
          max(created_at) as last_searched
        from public.search_events
        where event_type = 'search' and created_at >= v_from and query_normalized is not null
        group by 1
        order by count(*) desc, max(created_at) desc
        limit 15
      ) t
    ), '[]'::jsonb),
    'zero_result_queries', coalesce((
      select jsonb_agg(row_to_json(t))
      from (
        select query_normalized as query, count(*) as searches, max(created_at) as last_searched
        from public.search_events
        where event_type = 'search' and created_at >= v_from
          and result_count = 0 and query_normalized is not null
        group by 1
        order by count(*) desc, max(created_at) desc
        limit 15
      ) t
    ), '[]'::jsonb),
    'top_categories', coalesce((
      select jsonb_agg(row_to_json(t))
      from (
        select c.name as category, c.slug, count(*) as searches
        from public.search_events e
        join public.marketplace_categories c on c.id = e.category_id
        where e.event_type = 'search' and e.created_at >= v_from
        group by c.name, c.slug
        order by count(*) desc
        limit 10
      ) t
    ), '[]'::jsonb),
    'top_counties', coalesce((
      select jsonb_agg(row_to_json(t))
      from (
        select county, count(*) as searches
        from public.search_events
        where event_type = 'search' and created_at >= v_from and county is not null
        group by county
        order by count(*) desc
        limit 10
      ) t
    ), '[]'::jsonb),
    -- Listings that were shown repeatedly and never opened. Minimum exposure is 5 so a single
    -- impression is not reported as a problem.
    'low_click_listings', coalesce((
      select jsonb_agg(row_to_json(t))
      from (
        select
          i.listing_id,
          l.title,
          i.shown_count,
          coalesce(k.click_count, 0) as click_count
        from (
          select shown as listing_id, count(*) as shown_count
          from public.search_events s, unnest(coalesce(s.shown_listing_ids, '{}'::uuid[])) as shown
          where s.event_type = 'search' and s.created_at >= v_from
          group by 1
        ) i
        join public.listings l on l.id = i.listing_id
        left join (
          select listing_id, count(*) as click_count
          from public.search_events
          where event_type = 'listing_click' and created_at >= v_from and listing_id is not null
          group by 1
        ) k on k.listing_id = i.listing_id
        where coalesce(k.click_count, 0) = 0 and i.shown_count >= 5
        order by i.shown_count desc
        limit 10
      ) t
    ), '[]'::jsonb),
    'daily', coalesce((
      select jsonb_agg(row_to_json(t))
      from (
        select
          date_trunc('day', created_at)::date as day,
          count(*) filter (where event_type = 'search') as searches,
          count(*) filter (where event_type = 'listing_click') as clicks
        from public.search_events
        where created_at >= v_from
        group by 1
        order by 1
      ) t
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.admin_search_insights(integer) from public, anon, authenticated;
grant execute on function public.admin_search_insights(integer) to authenticated;

-- Retention is an explicit operation so the window can be audited, scheduled and reasoned about.
-- Granted to the service role only: a client cannot delete analytics history.
create or replace function public.prune_search_events(p_days integer default 180)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days integer;
  v_deleted integer;
begin
  v_days := greatest(1, least(coalesce(p_days, 180), 3650));
  delete from public.search_events where created_at < now() - make_interval(days => v_days);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.prune_search_events(integer) from public, anon, authenticated;
grant execute on function public.prune_search_events(integer) to service_role;

commit;
