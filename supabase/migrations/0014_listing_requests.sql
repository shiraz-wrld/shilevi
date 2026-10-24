-- Shilevi migration 0014: customer-to-provider enquiries and request lifecycle.
-- Repository-only draft. Review and apply manually after migrations 0001-0013; never run from app/CI.
begin;

create table if not exists public.listing_requests (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete restrict,
  customer_id uuid not null references auth.users(id) on delete restrict,
  provider_id uuid not null references auth.users(id) on delete restrict,
  customer_message text not null,
  provider_response text,
  status text not null default 'open' check (status in ('open','accepted','declined','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  responded_at timestamptz,
  closed_at timestamptz,
  constraint listing_request_message_length check (char_length(trim(customer_message)) between 10 and 3000),
  constraint listing_request_response_length check (provider_response is null or char_length(provider_response) <= 3000),
  constraint listing_request_participants_differ check (customer_id <> provider_id)
);
create index if not exists listing_requests_customer_recent_idx on public.listing_requests(customer_id, created_at desc);
create index if not exists listing_requests_provider_recent_idx on public.listing_requests(provider_id, status, created_at desc);
create index if not exists listing_requests_listing_recent_idx on public.listing_requests(listing_id, created_at desc);

alter table public.listing_requests enable row level security;
revoke all on public.listing_requests from anon, authenticated;
grant select, insert on public.listing_requests to authenticated;
grant update (status, provider_response, responded_at, closed_at) on public.listing_requests to authenticated;

drop policy if exists listing_requests_select_participant on public.listing_requests;
create policy listing_requests_select_participant on public.listing_requests
for select to authenticated using (customer_id = (select auth.uid()) or provider_id = (select auth.uid()));

drop policy if exists listing_requests_insert_customer on public.listing_requests;
create policy listing_requests_insert_customer on public.listing_requests
for insert to authenticated with check (
  customer_id = (select auth.uid())
  and status = 'open'
  and provider_response is null
  and responded_at is null
  and closed_at is null
  and exists (
    select 1 from public.listings l
    join public.marketplace_categories c on c.id = l.category_id
    where l.id = listing_requests.listing_id
      and l.owner_id = listing_requests.provider_id
      and l.status = 'published'
      and c.is_active = true
      and listing_requests.customer_id <> l.owner_id
  )
);

drop policy if exists listing_requests_provider_respond on public.listing_requests;
create policy listing_requests_provider_respond on public.listing_requests
for update to authenticated
using (provider_id = (select auth.uid()) and status = 'open')
with check (provider_id = (select auth.uid()) and status in ('accepted','declined'));

drop policy if exists listing_requests_customer_close on public.listing_requests;
create policy listing_requests_customer_close on public.listing_requests
for update to authenticated
using (customer_id = (select auth.uid()) and status in ('open','accepted','declined'))
with check (customer_id = (select auth.uid()) and status = 'closed');

create or replace function public.guard_listing_request_transition()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare actor_id uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    if new.customer_id is distinct from actor_id
      or new.status <> 'open'
      or new.provider_response is not null
      or new.responded_at is not null
      or new.closed_at is not null
      or not exists (
        select 1 from public.listings l
        join public.marketplace_categories c on c.id = l.category_id
        where l.id = new.listing_id and l.owner_id = new.provider_id
          and l.status = 'published' and c.is_active = true
          and new.customer_id <> l.owner_id
      )
    then raise exception 'Request must target another provider’s active published listing.' using errcode = '42501'; end if;
    return new;
  end if;

  if old.id is distinct from new.id
    or old.listing_id is distinct from new.listing_id
    or old.customer_id is distinct from new.customer_id
    or old.provider_id is distinct from new.provider_id
    or old.customer_message is distinct from new.customer_message
    or old.created_at is distinct from new.created_at
  then raise exception 'Request participants and original message are immutable.' using errcode = '42501'; end if;

  if actor_id = old.provider_id and old.status = 'open' and new.status in ('accepted','declined') then
    if new.closed_at is distinct from old.closed_at
      or new.responded_at is null
      or (new.status = 'declined' and nullif(trim(coalesce(new.provider_response,'')), '') is null)
    then raise exception 'A provider response and valid response timestamp are required.' using errcode = '23514'; end if;
    return new;
  end if;

  if actor_id = old.customer_id and old.status in ('open','accepted','declined') and new.status = 'closed' then
    if new.provider_response is distinct from old.provider_response
      or new.responded_at is distinct from old.responded_at
      or new.closed_at is null
    then raise exception 'Customers may close a request but cannot alter the provider response.' using errcode = '42501'; end if;
    return new;
  end if;

  raise exception 'This request status transition is not permitted.' using errcode = '42501';
end;
$$;
revoke all on function public.guard_listing_request_transition() from public, anon, authenticated;
drop trigger if exists listing_request_transition_guard on public.listing_requests;
create trigger listing_request_transition_guard before insert or update on public.listing_requests
for each row execute function public.guard_listing_request_transition();

drop trigger if exists listing_requests_set_updated_at on public.listing_requests;
create trigger listing_requests_set_updated_at before update on public.listing_requests
for each row execute function public.set_updated_at();

commit;
