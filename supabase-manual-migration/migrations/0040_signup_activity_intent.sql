-- Shilevi migration 0040: record which account path a new person chose at registration.
--
-- Why a separate column instead of widening `account_intent`:
--
--   `user_onboarding.account_intent` is a two-value fact ("is this account here to buy, or here to
--   earn?") that the owner console already counts in `0028`. Widening its CHECK would silently
--   change those counts and every reader that compares against 'customer'/'provider'.
--
--   What a new person actually chooses is narrower than "provider": they pick *what they want to
--   do* — sell products, offer a service, deliver goods, carry passengers, or list property. That
--   answer belongs in its own column so support can see it, the signup form can resume a
--   half-finished registration, and the next step can be chosen without an application existing.
--
-- What this column is NOT:
--
--   It is not an authorization grant, and nothing may read it as one. `signup_activity` is
--   user-writable profile text. Registry checks that decide who may sell, deliver or carry
--   passengers stay in `provider_applications` (status), `provider_activities` (activation, 0033),
--   `transport_partner_details` / document requirements (0037) and the capability functions. An
--   account that writes 'transport_operator' here still fails `is_approved_transport_partner()`
--   until an owner approves an application and activates the activity.
--
--   It is also not a delivery/transport split: both rider paths raise a `transport_partner`
--   application. The difference between delivering goods and carrying passengers is decided by the
--   approved activity and the vehicle/document requirements, not by this label.

begin;

alter table public.user_onboarding
  add column if not exists signup_activity text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.user_onboarding'::regclass
      and conname = 'onboarding_signup_activity_check'
  ) then
    alter table public.user_onboarding
      add constraint onboarding_signup_activity_check
      check (
        signup_activity is null
        or signup_activity in (
          'product_seller',
          'service_provider',
          'delivery_rider',
          'transport_operator',
          'property_provider'
        )
      );
  end if;
end
$$;

comment on column public.user_onboarding.signup_activity is
  'Which account path the person chose at registration. Descriptive intent only; never an authorization grant.';

-- Column-level grants are additive: the earlier grant on this table covers the profile fields and
-- this one adds the new intent column. `completed_at` stays unwritable.
grant update (signup_activity) on public.user_onboarding to authenticated;

commit;
