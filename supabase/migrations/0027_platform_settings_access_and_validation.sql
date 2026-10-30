-- Shilevi migration 0027: owner-editable platform settings, reachable and validated.
--
-- Two problems in 0017 are corrected here, without changing any financial arithmetic:
--
--   1. reachability. get_admin_settings() and admin_update_setting() were granted to `service_role`
--      only. A service-role PostgREST call carries no end-user JWT, so auth.uid() is NULL and
--      is_shilevi_owner_admin() is false: both functions always raised "Not authorized." and the
--      settings screen could not exist. They are now granted to `authenticated`, matching every
--      other owner-guarded RPC in this schema; the owner allowlist and MFA level 2 are still checked
--      inside the function, and public/anon remain revoked.
--
--   2. validation. admin_update_setting() previously accepted any JSON value for a known key, so a
--      mistaken write (for example a commission of 900%) would have been stored and used by
--      create_order(). It now rejects values outside the range the application and database expect.
--      The ranges do not choose a business policy: the commission remains whatever the owner
--      explicitly sets, between the documented floor and ceiling.
--
-- The seeded defaults and every existing row are untouched.

create or replace function public.admin_update_setting(p_key text, p_value jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_numeric numeric;
begin
  if not public.is_shilevi_owner_admin() then
    raise exception 'Not authorized.';
  end if;

  if p_key not in (
    'currency','payment_mode','commission_rate_bps','delivery_commission_bps','delivery_flat_fee_minor'
  ) then
    raise exception 'Unknown setting.';
  end if;

  if p_key = 'currency' then
    if p_value is null or jsonb_typeof(p_value) <> 'string'
       or (p_value #>> '{}') !~ '^[A-Z]{3}$' then
      raise exception 'Currency must be a three-letter ISO code.';
    end if;
  elsif p_key = 'payment_mode' then
    if p_value is null or jsonb_typeof(p_value) <> 'string'
       or (p_value #>> '{}') not in ('live','mock') then
      raise exception 'Payment mode must be either live or mock.';
    end if;
  elsif p_key in ('commission_rate_bps','delivery_commission_bps') then
    if p_value is null or jsonb_typeof(p_value) <> 'number' then
      raise exception 'A basis-point rate must be a number.';
    end if;
    v_numeric := (p_value #>> '{}')::numeric;
    if v_numeric < 0 or v_numeric > 5000 or v_numeric <> trunc(v_numeric) then
      raise exception 'A basis-point rate must be a whole number between 0 and 5000.';
    end if;
  elsif p_key = 'delivery_flat_fee_minor' then
    if p_value is null or jsonb_typeof(p_value) <> 'number' then
      raise exception 'The delivery fee must be a number of minor units.';
    end if;
    v_numeric := (p_value #>> '{}')::numeric;
    if v_numeric < 0 or v_numeric > 1000000 or v_numeric <> trunc(v_numeric) then
      raise exception 'The delivery fee must be a whole number of minor units between 0 and 1000000.';
    end if;
  end if;

  insert into public.platform_settings (key, value, updated_by)
  values (p_key, p_value, (select auth.uid()))
  on conflict (key) do update
    set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
end;
$$;

revoke all on function public.admin_update_setting(text, jsonb) from public, anon;
grant execute on function public.admin_update_setting(text, jsonb) to authenticated;

revoke all on function public.get_admin_settings() from public, anon;
grant execute on function public.get_admin_settings() to authenticated;

comment on function public.admin_update_setting(text, jsonb) is
  'Owner-only platform setting write. Requires an allowlisted, email-confirmed owner at MFA level 2. '
  'Rejects unknown keys and out-of-range values.';
