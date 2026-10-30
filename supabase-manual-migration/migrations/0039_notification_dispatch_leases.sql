-- Shilevi migration 0039: a single, lease-based claim for the notification queue.
-- Forward-only and additive: one function. No row is rewritten, no channel changes meaning.
--
-- Two defects this closes, both found by reading the dispatchers against migration 0021/0038:
--
--   1. Channel starvation. `POST /api/notifications/dispatch` (email) selected outbox rows with no
--      channel filter and then marked every row that was not email as `skipped` with
--      "No usable email recipient". Once 0038 began queueing `channel = 'push'` rows for real
--      events, the email drain consumed those rows and retired them, so push notifications could
--      never be delivered no matter how healthy the VAPID configuration was.
--
--   2. Lost claims. Both dispatchers flipped a row to `sending` before delivery, but neither ever
--      selected `sending` again. A request killed mid-flight (Vercel timeout, deploy, crash)
--      therefore lost that notification permanently with no error anywhere.
--
-- The contract is now in the database, not duplicated in two routes:
--   * a claim is scoped to exactly one channel;
--   * a claimed row carries a lease (`next_attempt_at` = now + lease), so a dead dispatcher's row
--     becomes claimable again when the lease runs out;
--   * the attempt is counted at claim time, so a crash still counts against the retry budget;
--   * a row that has used its attempts is retired as `skipped`, never retried forever;
--   * `for update skip locked` means two concurrent dispatchers never hand out the same row.
--
-- Only the service role may claim: the queue is drained by a scheduled server job, never a browser.

begin;

create or replace function public.claim_notification_batch(
  p_channel text,
  p_limit integer default 20,
  p_lease_seconds integer default 900
)
returns setof public.notification_outbox
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lease timestamptz;
begin
  if p_channel is null or char_length(trim(p_channel)) = 0 then
    raise exception 'A channel is required.' using errcode = '22023';
  end if;

  -- A 30 second floor and a one hour ceiling keep a caller from leasing a row for a day or from
  -- expiring another dispatcher's work immediately.
  v_lease := now() + make_interval(secs => greatest(least(coalesce(p_lease_seconds, 900), 3600), 30));

  -- A row that has used its whole retry budget is retired before anything else, so it can never sit
  -- `queued` for ever waiting for a claim that will always refuse it.
  update public.notification_outbox o
     set status = 'skipped',
         last_error = coalesce(o.last_error, 'Retry budget exhausted.'),
         next_attempt_at = now()
   where o.channel = p_channel
     and o.attempts >= 5
     and o.status in ('queued', 'failed', 'sending');

  -- Release claims whose dispatcher never came back. This runs before the claim below, so a
  -- released row may be picked up by this very call, which is the intended behaviour: the lease
  -- already gave the previous attempt its full window.
  update public.notification_outbox o
     set status = 'failed',
         last_error = coalesce(o.last_error, 'Dispatch lease expired before the message was sent.'),
         next_attempt_at = now()
   where o.channel = p_channel
     and o.status = 'sending'
     and o.next_attempt_at <= now();

  return query
  with due as (
    select o.id
    from public.notification_outbox o
    where o.channel = p_channel
      and o.status in ('queued', 'failed')
      and o.next_attempt_at <= now()
      and o.attempts < 5
    order by o.created_at, o.id
    limit greatest(least(coalesce(p_limit, 20), 100), 1)
      for update skip locked
  )
  update public.notification_outbox o
     set status = 'sending',
         attempts = o.attempts + 1,
         next_attempt_at = v_lease
    from due
   where o.id = due.id
  returning o.*;
end;
$$;

revoke all on function public.claim_notification_batch(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_notification_batch(text, integer, integer) to service_role;

comment on function public.claim_notification_batch(text, integer, integer) is
  'Claims one channel of notification_outbox with a lease. Retries bounded by attempts < 5.';

commit;
