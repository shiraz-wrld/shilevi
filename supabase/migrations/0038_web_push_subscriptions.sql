-- Shilevi migration 0038: web push subscriptions and dispatch support.
--
-- The in-app inbox (0036) tells a rider that a job was offered — but only after they open the site.
-- Email is queued in `notification_outbox` and is only sent when RESEND_API_KEY is configured. This
-- migration adds the missing channel without replacing either:
--
--   1. `push_subscriptions`: one row per browser subscription, owned by the signed-in account. It is
--      written only through SECURITY DEFINER functions, so a client cannot attach a subscription to
--      another account, and the endpoint is unique so two accounts cannot fight over one device.
--   2. `enqueue_notification()` also queues a `push` row when the recipient has a live subscription.
--      One row per event, fanned out to every subscription at dispatch time, so retries cannot send
--      the same offer twice.
--   3. `render_notification()` is the single place that turns a template into a title, body and deep
--      link. The in-app feed and the push sender now share it, so a notification cannot say one thing
--      in the inbox and another on the lock screen. Bodies carry numbers and statuses only — never a
--      customer address, phone number or document.
--   4. Delivery offers and customer ride proposals now raise a notification at all. Previously a
--      rider was expected to poll `/deliver/jobs`.
--
-- Sending push itself needs `VAPID_PRIVATE_KEY` (see docs/PUSH_NOTIFICATIONS.md). Without it the
-- dispatcher reports a configuration error and rows stay queued; nothing pretends to have been sent.

begin;

-- ---------------------------------------------------------------- subscriptions

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique
    check (endpoint like 'https://%' and char_length(endpoint) between 10 and 2048),
  p256dh text not null check (char_length(p256dh) between 20 and 200),
  auth text not null check (char_length(auth) between 10 and 200),
  user_agent text check (user_agent is null or char_length(user_agent) <= 300),
  failure_count integer not null default 0 check (failure_count between 0 and 1000),
  last_success_at timestamptz,
  last_failure_at timestamptz,
  revoked_at timestamptz,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions(user_id) where revoked_at is null;

alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;
grant select on public.push_subscriptions to authenticated;
-- The dispatcher runs with the service role and needs to read endpoints and record failures.
grant select, update on public.push_subscriptions to service_role;

drop policy if exists "push_subscriptions_select_own" on public.push_subscriptions;
create policy "push_subscriptions_select_own" on public.push_subscriptions
for select to authenticated
using (user_id = (select auth.uid()));

-- No insert/update policy: subscribing and revoking go through the functions below, which is what
-- keeps an endpoint bound to the account that registered it.

create or replace function public.save_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_existing record;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Sign in required.';
  end if;
  if p_endpoint is null or p_endpoint not like 'https://%'
     or char_length(p_endpoint) > 2048 or char_length(p_endpoint) < 10 then
    raise exception 'A valid push endpoint is required.';
  end if;
  if char_length(coalesce(p_p256dh, '')) < 20 or char_length(coalesce(p_auth, '')) < 10 then
    raise exception 'The push subscription keys are incomplete.';
  end if;

  select * into v_existing from public.push_subscriptions s where s.endpoint = p_endpoint;
  if v_existing.id is not null and v_existing.user_id <> v_uid then
    raise exception 'This browser is already subscribed to another account.';
  end if;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (v_uid, p_endpoint, p_p256dh, p_auth, left(coalesce(p_user_agent, ''), 300))
  on conflict (endpoint) do update
    set p256dh = excluded.p256dh,
        auth = excluded.auth,
        user_agent = excluded.user_agent,
        revoked_at = null,
        failure_count = 0,
        last_seen_at = now()
  returning id into v_id;

  insert into public.audit_events (actor_id, action, resource_type, resource_id, outcome, metadata)
  values (v_uid, 'push.subscribe', 'push_subscriptions', v_id::text, 'success', '{}'::jsonb);

  return v_id;
end;
$$;
revoke all on function public.save_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;

create or replace function public.revoke_push_subscription(p_endpoint text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_updated integer;
begin
  if v_uid is null then
    raise exception 'Sign in required.';
  end if;

  update public.push_subscriptions
  set revoked_at = coalesce(revoked_at, now())
  where endpoint = p_endpoint and user_id = v_uid;
  get diagnostics v_updated = row_count;

  return v_updated > 0;
end;
$$;
revoke all on function public.revoke_push_subscription(text) from public, anon;
grant execute on function public.revoke_push_subscription(text) to authenticated;

create or replace function public.my_push_subscription_count()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.push_subscriptions s
  where s.user_id = (select auth.uid()) and s.revoked_at is null;
$$;
revoke all on function public.my_push_subscription_count() from public, anon;
grant execute on function public.my_push_subscription_count() to authenticated;

-- ---------------------------------------------------------------- shared rendering

/**
 * The single definition of what a notification says.
 *
 * The in-app feed and the push sender both call this, so the two channels cannot disagree, and a
 * deep link is derived here rather than accepted from a browser or from a payload. An id is placed
 * in a path only when it is a well-formed UUID.
 */
create or replace function public.render_notification(
  p_template text,
  p_payload jsonb,
  p_uid uuid
) returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'title', case p_template
      when 'application_status' then 'Application updated'
      when 'ride_status' then 'Ride update'
      when 'payout_status' then 'Payout update'
      when 'order_status' then 'Order update'
      when 'delivery_status' then 'Delivery update'
      when 'refund_status' then 'Refund update'
      when 'house_hunt_unlock' then 'Contact unlocked'
      when 'delivery_offer' then 'New delivery job'
      when 'ride_offer' then 'New trip proposal'
      else 'Shilevi update'
    end,
    'body', case p_template
      when 'application_status' then
        'Your ' || coalesce(nullif(p_payload ->> 'activity_type', ''), 'provider') ||
        ' application is now ' || coalesce(nullif(p_payload ->> 'status', ''), 'updated') || '.'
      when 'ride_status' then
        'Trip ' || coalesce(nullif(p_payload ->> 'ride_number', ''), '') ||
        ' is now ' || coalesce(nullif(p_payload ->> 'status', ''), 'updated') || '.'
      when 'payout_status' then
        'Your payout is now ' || coalesce(nullif(p_payload ->> 'status', ''), 'updated') || '.'
      when 'order_status' then
        'Order ' || coalesce(nullif(p_payload ->> 'order_number', ''), '') ||
        ' is now ' || coalesce(nullif(p_payload ->> 'status', ''), 'updated') || '.'
      when 'delivery_status' then
        'Delivery ' || coalesce(nullif(p_payload ->> 'shipment_number', ''), '') ||
        ' is now ' || coalesce(nullif(p_payload ->> 'status', ''), 'updated') || '.'
      when 'refund_status' then
        'Your refund is now ' || coalesce(nullif(p_payload ->> 'status', ''), 'updated') || '.'
      when 'house_hunt_unlock' then
        'Your House Hunt contact unlock is confirmed.'
      when 'delivery_offer' then
        'A shipment matching your approved vehicle is available. Open your jobs to accept or decline before it expires.'
      when 'ride_offer' then
        'A customer is waiting for your response on a trip proposal.'
      else
        'You have a new update on Shilevi.'
    end,
    'link', case p_template
      when 'application_status' then
        case
          when p_payload ->> 'activity_type' = 'transport_partner' then '/deliver'
          else '/provider'
        end
      when 'ride_status' then
        case
          when p_payload ->> 'rider_id' = p_uid::text then '/rider/rides'
          else '/transport'
        end
      when 'payout_status' then
        case
          when p_payload ->> 'rider_id' = p_uid::text then '/rider/rides'
          else '/provider/orders'
        end
      when 'order_status' then
        case
          when (p_payload ->> 'order_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            then '/account/orders/' || (p_payload ->> 'order_id')
          else '/account/orders'
        end
      when 'delivery_status' then
        case
          when p_payload ->> 'rider_id' = p_uid::text then '/deliver/jobs'
          when (p_payload ->> 'order_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            then '/account/orders/' || (p_payload ->> 'order_id')
          else '/account/orders'
        end
      when 'house_hunt_unlock' then '/house-hunt'
      when 'delivery_offer' then '/deliver/jobs'
      when 'ride_offer' then '/rider/rides'
      else '/account'
    end
  );
$$;
revoke all on function public.render_notification(text, jsonb, uuid) from public, anon;
grant execute on function public.render_notification(text, jsonb, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------- queue

create or replace function public.enqueue_notification(
  p_user_id uuid,
  p_template text,
  p_payload jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
begin
  if p_user_id is null then
    return;
  end if;

  -- One push row per event, not one per device: the dispatcher fans out to the account's live
  -- subscriptions, so a retry can never deliver the same offer twice to the same device.
  if exists (
    select 1 from public.push_subscriptions s
    where s.user_id = p_user_id and s.revoked_at is null
  ) then
    insert into public.notification_outbox (user_id, channel, template, payload, status)
    values (p_user_id, 'push', left(p_template, 80), v_payload, 'queued');
  end if;

  select lower(trim(u.email)) into v_email from auth.users u where u.id = p_user_id;
  if v_email is null then
    insert into public.notification_outbox (user_id, channel, template, payload, status)
    values (p_user_id, 'email', left(p_template, 80), v_payload, 'skipped');
    return;
  end if;

  insert into public.notification_outbox (user_id, channel, template, recipient, payload)
  values (p_user_id, 'email', left(p_template, 80), v_email, v_payload);
end;
$$;
revoke all on function public.enqueue_notification(uuid, text, jsonb) from public, anon, authenticated;

-- The dispatcher must be able to claim and settle rows with the service role.
grant select, update on public.notification_outbox to service_role;

create or replace function public.my_notifications(p_limit integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_limit integer := greatest(1, least(coalesce(p_limit, 30), 100));
begin
  if v_uid is null then
    raise exception 'Sign in to read your notifications.';
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object('id', n.id, 'template', n.template)
      || public.render_notification(n.template, n.payload, v_uid)
      || jsonb_build_object('read_at', n.read_at, 'created_at', n.created_at)
      order by n.created_at desc, n.id desc
    )
    from (
      select *
      from public.notification_outbox o
      where o.user_id = v_uid
      order by o.created_at desc, o.id desc
      limit v_limit
    ) n
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.my_notifications(integer) from public, anon;
grant execute on function public.my_notifications(integer) to authenticated;

-- ---------------------------------------------------------------- offer notifications

/**
 * A real offer now reaches the rider. The payload carries identifiers and an expiry only; the
 * customer's address stays behind `list_my_delivery_offers()` and its assignment rules.
 */
create or replace function public.notify_delivery_offer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'offered'
     and (tg_op = 'INSERT' or new.status is distinct from old.status) then
    perform public.enqueue_notification(
      new.provider_user_id,
      'delivery_offer',
      jsonb_build_object(
        'delivery_id', new.delivery_id,
        'offer_id', new.id,
        'expires_at', new.expires_at
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists delivery_offers_enqueue_notification on public.delivery_offers;
create trigger delivery_offers_enqueue_notification
after insert or update of status on public.delivery_offers
for each row execute function public.notify_delivery_offer();

/** A customer proposal or counteroffer reaches the assigned rider. */
create or replace function public.notify_ride_offer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rider uuid;
begin
  if new.actor_role = 'customer' and new.offer_type in ('proposal', 'counteroffer') then
    select r.rider_id into v_rider from public.rides r where r.id = new.ride_id;
    perform public.enqueue_notification(
      v_rider,
      'ride_offer',
      jsonb_build_object('ride_id', new.ride_id, 'offer_type', new.offer_type)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists ride_offers_enqueue_notification on public.ride_offers;
create trigger ride_offers_enqueue_notification
after insert on public.ride_offers
for each row execute function public.notify_ride_offer();

commit;
