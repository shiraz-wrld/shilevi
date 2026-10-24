-- Shilevi migration 0013: narrow notification-preference column privileges.
-- Apply after migration 0012. This is a corrective hardening migration; review manually.
begin;
revoke insert, update on public.user_notification_preferences from authenticated;
grant insert (user_id, marketplace_updates, account_security_alerts, order_and_booking_updates, provider_activity_updates, product_news_and_promotions)
  on public.user_notification_preferences to authenticated;
grant update (marketplace_updates, account_security_alerts, order_and_booking_updates, provider_activity_updates, product_news_and_promotions)
  on public.user_notification_preferences to authenticated;
commit;
