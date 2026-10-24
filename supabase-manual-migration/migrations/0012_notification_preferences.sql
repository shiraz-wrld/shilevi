-- Shilevi migration 0012: account notification preferences.
-- Preferences are stored only; delivery channels must check these values when notification delivery is implemented.
-- Review and apply manually. This migration is not executed by the app or CI.
begin;

create table if not exists public.user_notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  marketplace_updates boolean not null default true,
  account_security_alerts boolean not null default true,
  order_and_booking_updates boolean not null default true,
  provider_activity_updates boolean not null default true,
  product_news_and_promotions boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.user_notification_preferences enable row level security;
revoke all on public.user_notification_preferences from anon, authenticated;
grant select, insert, update on public.user_notification_preferences to authenticated;

drop policy if exists "notification_preferences_select_own" on public.user_notification_preferences;
create policy "notification_preferences_select_own" on public.user_notification_preferences
for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "notification_preferences_insert_own" on public.user_notification_preferences;
create policy "notification_preferences_insert_own" on public.user_notification_preferences
for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists "notification_preferences_update_own" on public.user_notification_preferences;
create policy "notification_preferences_update_own" on public.user_notification_preferences
for update to authenticated using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop trigger if exists notification_preferences_set_updated_at on public.user_notification_preferences;
create trigger notification_preferences_set_updated_at
before update on public.user_notification_preferences
for each row execute function public.set_updated_at();

commit;
