-- Shilevi migration 0036: in-app notification centre.
--
-- What this adds, and why:
--
-- 1. `notification_outbox` already carried every queued message (application decisions, ride
--    status, payout status, order and delivery events), but only the owner console could read it.
--    A rider therefore had no way to see "a new job was offered to you" unless email was configured
--    — and email still is not. `read_at` plus an own-row read policy turns the same rows into a real
--    in-app inbox without a second, competing notifications table.
--
-- 2. The feed is built by `my_notifications()`: a security-definer read scoped to `auth.uid()` that
--    derives the title, body and deep link **server-side**. A browser never sees the raw payload
--    (which carries ids and statuses only) and never chooses its own destination, so a forged row
--    cannot become an open redirect.
--
-- 3. Read state is own-only. `mark_notification_read` / `mark_all_notifications_read` cannot touch
--    another account's rows, and the column grant allows a client to change `read_at` and nothing
--    else — never `status`, `recipient`, `attempts` or the payload.
--
-- This migration only adds a column, indexes, one policy, column grants and functions. It changes no
-- financial, delivery, proof-of-delivery or authorization behaviour.

begin;

alter table public.notification_outbox
  add column if not exists read_at timestamptz;

create index if not exists notification_outbox_unread_idx
  on public.notification_outbox (user_id, created_at desc)
  where read_at is null and user_id is not null;

-- The owner policy from 0021 is unchanged. This adds the recipient's own view.
drop policy if exists "notification_outbox_self_read" on public.notification_outbox;
create policy "notification_outbox_self_read" on public.notification_outbox
for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "notification_outbox_self_update" on public.notification_outbox;
create policy "notification_outbox_self_update" on public.notification_outbox
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

-- Column-level write: a recipient may acknowledge a message, nothing more.
revoke update on public.notification_outbox from authenticated;
grant update (read_at) on public.notification_outbox to authenticated;

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
      jsonb_build_object(
        'id', n.id,
        'template', n.template,
        'title', case n.template
          when 'application_status' then 'Application updated'
          when 'ride_status' then 'Ride update'
          when 'payout_status' then 'Payout update'
          when 'order_status' then 'Order update'
          when 'delivery_status' then 'Delivery update'
          when 'refund_status' then 'Refund update'
          when 'house_hunt_unlock' then 'Contact unlocked'
          else 'Shilevi update'
        end,
        'body', case n.template
          when 'application_status' then
            'Your ' || coalesce(nullif(n.payload ->> 'activity_type', ''), 'provider') ||
            ' application is now ' || coalesce(nullif(n.payload ->> 'status', ''), 'updated') || '.'
          when 'ride_status' then
            'Trip ' || coalesce(nullif(n.payload ->> 'ride_number', ''), '') ||
            ' is now ' || coalesce(nullif(n.payload ->> 'status', ''), 'updated') || '.'
          when 'payout_status' then
            'Your payout is now ' || coalesce(nullif(n.payload ->> 'status', ''), 'updated') || '.'
          when 'order_status' then
            'Order ' || coalesce(nullif(n.payload ->> 'order_number', ''), '') ||
            ' is now ' || coalesce(nullif(n.payload ->> 'status', ''), 'updated') || '.'
          when 'delivery_status' then
            'Delivery ' || coalesce(nullif(n.payload ->> 'shipment_number', ''), '') ||
            ' is now ' || coalesce(nullif(n.payload ->> 'status', ''), 'updated') || '.'
          when 'refund_status' then
            'Your refund is now ' || coalesce(nullif(n.payload ->> 'status', ''), 'updated') || '.'
          when 'house_hunt_unlock' then
            'Your House Hunt contact unlock is confirmed.'
          else
            'You have a new update on Shilevi.'
        end,
        -- Deep links are derived here, never supplied by the browser, and an id is only placed in a
        -- path when it is a well-formed UUID. Anything unrecognised becomes a safe index link.
        'link', case n.template
          when 'application_status' then
            case
              when n.payload ->> 'activity_type' = 'transport_partner' then '/deliver'
              else '/provider'
            end
          when 'ride_status' then
            case
              when n.payload ->> 'rider_id' = v_uid::text then '/rider/rides'
              else '/transport'
            end
          when 'payout_status' then
            case
              when n.payload ->> 'rider_id' = v_uid::text then '/rider/rides'
              else '/provider/orders'
            end
          when 'order_status' then
            case
              when (n.payload ->> 'order_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
                then '/account/orders/' || (n.payload ->> 'order_id')
              else '/account/orders'
            end
          when 'delivery_status' then
            case
              when n.payload ->> 'rider_id' = v_uid::text then '/deliver/jobs'
              when (n.payload ->> 'order_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
                then '/account/orders/' || (n.payload ->> 'order_id')
              else '/account/orders'
            end
          when 'house_hunt_unlock' then '/house-hunt'
          else '/account'
        end,
        'read_at', n.read_at,
        'created_at', n.created_at
      )
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

create or replace function public.unread_notification_count()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.notification_outbox n
  where n.user_id = (select auth.uid())
    and n.read_at is null;
$$;

revoke all on function public.unread_notification_count() from public, anon;
grant execute on function public.unread_notification_count() to authenticated;

create or replace function public.mark_notification_read(p_id bigint)
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
    raise exception 'Sign in to update your notifications.';
  end if;

  -- The `user_id` predicate is the authorization: a caller cannot acknowledge a row they cannot see.
  update public.notification_outbox
  set read_at = coalesce(read_at, now())
  where id = p_id and user_id = v_uid;
  get diagnostics v_updated = row_count;

  return v_updated > 0;
end;
$$;

revoke all on function public.mark_notification_read(bigint) from public, anon;
grant execute on function public.mark_notification_read(bigint) to authenticated;

create or replace function public.mark_all_notifications_read()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_updated integer;
begin
  if v_uid is null then
    raise exception 'Sign in to update your notifications.';
  end if;

  update public.notification_outbox
  set read_at = now()
  where user_id = v_uid and read_at is null;
  get diagnostics v_updated = row_count;

  return v_updated;
end;
$$;

revoke all on function public.mark_all_notifications_read() from public, anon;
grant execute on function public.mark_all_notifications_read() to authenticated;

commit;
