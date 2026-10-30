-- Shilevi migration 0034: move the delivery confirmation code out of a rider-readable row.
-- Forward-only. No financial record is touched.
--
-- The hole this closes:
--   `deliveries.proof_code` held the customer's four-digit confirmation code in plaintext, on a row
--   the assigned rider can select (they need the job address and fee). The rider job screen even
--   selected the column. `rider_update_delivery()` compared the submitted value with that same
--   column and had no attempt limit, so the party who must NOT know the code could read it — or
--   guess it in a few thousand tries — and mark their own delivery as verified.
--
-- What changes:
--   * the code lives in `delivery_proof_codes`, a table with RLS enabled, no policy and no grants to
--     `anon`/`authenticated`, so no client and no staff session can select it;
--   * `deliveries.proof_code` is copied into that table and then nulled, so old rows stop leaking;
--   * a trigger vaults any code written by the existing `place_order()` path, so that function keeps
--     working unchanged;
--   * `rider_update_delivery()` verifies against the vault, requires the code, counts failures and
--     locks the delivery for 15 minutes after five wrong attempts, and consumes the code on success;
--   * `get_delivery_proof_code()` still returns the code to the order's customer only, and returns
--     nothing once it has been used.
--
-- A hash was considered and rejected for now: the customer has to be able to read the code in-app
-- because no transactional email channel is configured, and a hash of four digits is reversible in
-- milliseconds. Attempt limiting is what makes a short code safe here; when email is configured the
-- code should be sent once and stored hashed.

begin;

create table if not exists public.delivery_proof_codes (
  delivery_id uuid primary key references public.deliveries(id) on delete cascade,
  code text not null check (code ~ '^[0-9]{4,8}$'),
  attempts integer not null default 0 check (attempts >= 0),
  locked_until timestamptz,
  verified_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.delivery_proof_codes enable row level security;
revoke all on public.delivery_proof_codes from anon, authenticated;
-- No policy is created on purpose: only SECURITY DEFINER functions below read or write this table.

create or replace function public.vault_delivery_proof_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.proof_code is not null then
    insert into public.delivery_proof_codes (delivery_id, code)
    values (new.id, new.proof_code)
    on conflict (delivery_id) do nothing;

    update public.deliveries
    set proof_code = null
    where id = new.id and proof_code is not null;
  end if;
  return null;
end;
$$;
revoke all on function public.vault_delivery_proof_code() from public, anon, authenticated;

drop trigger if exists deliveries_vault_proof_code on public.deliveries;
create trigger deliveries_vault_proof_code
after insert on public.deliveries
for each row execute function public.vault_delivery_proof_code();

-- Move codes that already exist, then remove the plaintext from the rider-readable row.
insert into public.delivery_proof_codes (delivery_id, code)
select d.id, d.proof_code
from public.deliveries d
where d.proof_code is not null
on conflict (delivery_id) do nothing;

update public.deliveries set proof_code = null where proof_code is not null;

create or replace function public.rider_update_delivery(
  p_delivery_id uuid,
  p_to_status text,
  p_proof_code text default null,
  p_note text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delivery record;
  v_expected text;
  v_order_status text;
  v_actor_role text := 'rider';
  v_proof record;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;

  select * into v_delivery from public.deliveries where id = p_delivery_id for update;
  if v_delivery.id is null or v_delivery.rider_id <> auth.uid() then
    raise exception 'Delivery not found.';
  end if;

  v_expected := case v_delivery.status
    when 'assigned' then 'to_pickup'
    when 'to_pickup' then 'collected'
    when 'collected' then 'in_transit'
    when 'in_transit' then 'delivered'
    else null
  end;

  if p_to_status = 'failed' then
    if v_delivery.status not in ('assigned','to_pickup','collected') then
      raise exception 'This delivery cannot be marked failed at this stage.';
    end if;
  elsif v_expected is null or p_to_status <> v_expected then
    raise exception 'This delivery cannot move from % to %.', v_delivery.status, p_to_status;
  end if;

  if p_to_status = 'delivered' then
    select * into v_proof
    from public.delivery_proof_codes
    where delivery_id = p_delivery_id
    for update;

    -- The code is never compared here. Comparing it here would mean a wrong guess rolls back its own
    -- attempt counter along with the raised exception, which is exactly the brute-force hole this
    -- migration is closing. `verify_delivery_proof_code()` does the comparison and commits the
    -- attempt, and this transition only accepts a verification it marked moments ago.
    if v_proof.delivery_id is null or v_proof.consumed_at is not null then
      raise exception 'This delivery has already been confirmed.' using errcode = '23505';
    end if;
    if v_proof.verified_at is null or v_proof.verified_at < now() - interval '10 minutes' then
      raise exception 'Verify the customer confirmation code before completing this delivery.'
        using errcode = '23514';
    end if;

    update public.delivery_proof_codes
    set consumed_at = now(), verified_at = null
    where delivery_id = p_delivery_id;
  end if;

  update public.deliveries
  set status = p_to_status,
      picked_up_at = case when p_to_status = 'collected' then now() else picked_up_at end,
      delivered_at = case when p_to_status = 'delivered' then now() else delivered_at end,
      proof_note = case when p_to_status = 'delivered' then left(coalesce(p_note, ''), 500) else proof_note end
  where id = p_delivery_id;

  insert into public.delivery_events (delivery_id, status, actor_id, actor_role, note)
  values (p_delivery_id, p_to_status, auth.uid(), v_actor_role, left(coalesce(p_note, ''), 500));

  if p_to_status = 'delivered' then
    select o.status into v_order_status
    from public.orders o
    where o.id = v_delivery.order_id
    for update;

    update public.orders
    set status = 'delivered'
    where id = v_delivery.order_id and status in ('dispatched','ready');

    if found then
      insert into public.order_status_history (order_id, from_status, to_status, actor_id, actor_role, note)
      values (v_delivery.order_id, v_order_status, 'delivered', auth.uid(), 'rider', 'Delivery completed.');
    end if;
  end if;
end;
$$;
revoke all on function public.rider_update_delivery(uuid, text, text, text) from public, anon;
grant execute on function public.rider_update_delivery(uuid, text, text, text) to authenticated;

create or replace function public.verify_delivery_proof_code(
  p_delivery_id uuid,
  p_code text
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_proof record;
  v_rider uuid;
  v_attempts integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;

  select d.rider_id into v_rider from public.deliveries d where d.id = p_delivery_id;
  if v_rider is null or v_rider <> auth.uid() then
    raise exception 'Delivery not found.';
  end if;

  select * into v_proof
  from public.delivery_proof_codes
  where delivery_id = p_delivery_id
  for update;

  if v_proof.delivery_id is null or v_proof.consumed_at is not null then
    return 'used';
  end if;
  if v_proof.locked_until is not null and v_proof.locked_until > now() then
    return 'locked';
  end if;

  if p_code is null or trim(p_code) = '' or trim(p_code) <> v_proof.code then
    v_attempts := v_proof.attempts + 1;
    update public.delivery_proof_codes
    set attempts = v_attempts,
        locked_until = case when v_attempts >= 5 then now() + interval '15 minutes' else locked_until end
    where delivery_id = p_delivery_id;

    insert into public.delivery_events (delivery_id, status, actor_id, actor_role, note)
    values (p_delivery_id, 'proof_failed', auth.uid(), 'rider', 'Incorrect confirmation code.');

    -- Returning instead of raising is deliberate: a raised exception would roll the attempt counter
    -- back and leave the code freely guessable.
    return case when v_attempts >= 5 then 'locked' else 'invalid' end;
  end if;

  update public.delivery_proof_codes
  set verified_at = now(), attempts = 0, locked_until = null
  where delivery_id = p_delivery_id;

  return 'verified';
end;
$$;
revoke all on function public.verify_delivery_proof_code(uuid, text) from public, anon;
grant execute on function public.verify_delivery_proof_code(uuid, text) to authenticated;

create or replace function public.get_delivery_proof_code(p_order_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;
  if not exists (
    select 1 from public.orders o
    where o.id = p_order_id and o.customer_id = auth.uid()
  ) then
    raise exception 'Order not found.';
  end if;

  select c.code into v_code
  from public.delivery_proof_codes c
  join public.deliveries d on d.id = c.delivery_id
  where d.order_id = p_order_id
    and c.consumed_at is null;

  return v_code;
end;
$$;
revoke all on function public.get_delivery_proof_code(uuid) from public, anon;
grant execute on function public.get_delivery_proof_code(uuid) to authenticated;

commit;
