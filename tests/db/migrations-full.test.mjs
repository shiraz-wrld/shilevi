/**
 * Full migration replay.
 *
 * `npm run test:db` starts at 0015 and stubs the earlier tables, so a syntax error in 0001–0014
 * could pass every local check and only fail on the hosted database. That is exactly what happened
 * to 0005 (an `AS $` dollar-quote that should have been `AS $$`). This suite replays **all 25
 * migrations in order** against a real PostgreSQL engine (PGlite) with only the Supabase-provided
 * schemas stubbed, so every file is parsed, every function is compiled and every policy is created.
 *
 * The stubs are limited to what the hosted platform supplies and the repository does not own:
 *   - roles `anon`, `authenticated`, `service_role`;
 *   - `auth.users` and `auth.uid()` / `auth.jwt()`;
 *   - `storage.buckets`, `storage.objects` and `storage.foldername()`.
 *
 * Two deliberate differences from the hosted environment:
 *   - `pgcrypto` is not bundled with PGlite, so 0001's `create extension` line is skipped.
 *     `gen_random_uuid()` is built into PostgreSQL 13+ and still exercised everywhere.
 *   - The owner gate is not overridden: the real `is_shilevi_owner_admin()` from 0003 runs.
 *
 * Run: npm run test:migrations
 */
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migrationsDir = path.join(repoRoot, "supabase", "migrations");

const stubs = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

create schema if not exists auth;
create table auth.users (
  id uuid primary key,
  email text,
  email_confirmed_at timestamptz,
  last_sign_in_at timestamptz,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'aal', coalesce(nullif(current_setting('request.jwt.claim.aal', true), ''), 'aal1'),
    'auth_time', nullif(current_setting('request.jwt.claim.auth_time', true), '')
  );
$$;

create schema if not exists storage;
create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null references storage.buckets(id),
  name text not null,
  owner uuid,
  created_at timestamptz not null default now()
);
alter table storage.objects enable row level security;

create or replace function storage.foldername(name text) returns text[]
language plpgsql immutable as $$
declare
  parts text[];
begin
  parts := string_to_array(name, '/');
  return parts[1:array_length(parts, 1) - 1];
end;
$$;
`;

const db = new PGlite();
let failures = 0;
let checks = 0;

function check(name, condition, detail = "") {
  checks += 1;
  if (condition) {
    console.log(`ok   ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function scalar(sql) {
  const result = await db.query(sql);
  return result.rows[0]?.value ?? result.rows[0]?.count ?? null;
}

async function main() {
  await db.exec(stubs);

  const files = fs
    .readdirSync(migrationsDir)
    .filter(name => /^\d{4}_.+\.sql$/.test(name))
    .sort();

  check("migration chain is 0001–0042", files.length === 42 && files[0].startsWith("0001") && files.at(-1).startsWith("0042"), `${files.length} files`);

  for (const file of files) {
    let sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    // PGlite ships no pgcrypto; gen_random_uuid() is built in, so this one line is skipped.
    sql = sql.replace(/create extension if not exists pgcrypto;/i, "-- pgcrypto skipped in PGlite (gen_random_uuid is built in)");
    try {
      await db.exec(sql);
      console.log(`ok   applied ${file}`);
      checks += 1;
    } catch (error) {
      failures += 1;
      checks += 1;
      console.log(`FAIL applied ${file}`);
      console.log(`     ${String(error.message).split("\n")[0]}`);
      // Later migrations depend on this file; stop rather than report misleading downstream errors.
      throw new Error(`Migration ${file} failed to apply.`);
    }
  }

  console.log("\n== schema invariants ==");

  const tableCount = Number(await scalar("select count(*)::int as value from pg_tables where schemaname = 'public'"));
  check("62 public tables exist", tableCount === 62, `found ${tableCount}`);

  const rlsOff = await db.query("select tablename from pg_tables where schemaname = 'public' and rowsecurity = false order by tablename");
  check(
    "row level security is enabled on every public table",
    rlsOff.rows.length === 0,
    rlsOff.rows.map(row => row.tablename).join(", "),
  );

  const policyCount = Number(await scalar("select count(*)::int as value from pg_policies where schemaname = 'public'"));
  check("public policies exist (>= 80)", policyCount >= 80, `found ${policyCount}`);

  const storagePolicies = Number(await scalar("select count(*)::int as value from pg_policies where schemaname = 'storage'"));
  check("storage object policies exist (8)", storagePolicies === 8, `found ${storagePolicies}`);

  for (const fn of [
    "is_shilevi_owner_admin",
    "search_marketplace",
    "record_search_event",
    "admin_search_insights",
    "admin_decide_refund",
    "request_order_refund",
    "request_rider_payout",
    "rider_available_balance",
    "get_property_contact",
    "has_property_access",
    "confirm_mock_payment",
    "mock_payments_allowed",
    "create_order",
    "mark_order_paid",
    "confirm_provider_payout",
    "admin_set_payment_method",
    "admin_list_customers",
    "admin_list_role_assignments",
    "admin_list_providers",
    "admin_list_riders",
    "admin_list_deliveries",
    "admin_list_listing_requests",
    "admin_list_ride_reviews",
    "admin_onboarding_overview",
    "admin_service_area_coverage",
    "match_delivery_candidates",
    "offer_delivery_to_candidates",
    "list_my_delivery_offers",
    "accept_delivery_offer",
    "decline_delivery_offer",
    "set_delivery_vehicle_profile",
    "add_delivery_route",
    "delete_delivery_route",
    "submit_deliverer_application",
    "register_delivery_vehicle",
    "register_delivery_document",
    "admin_review_delivery_document",
    "admin_review_delivery_fleet",
    "admin_review_delivery_fleet_driver",
    "commission_rate_bps",
    "commission_split",
    "apply_payout_commission",
    "admin_reverse_payout_commission",
    "quote_delivery",
    "attach_delivery_quote_to_order",
    "admin_upsert_delivery_pricing_rule",
    "admin_retire_delivery_pricing_rule",
    "admin_payout_reconciliation",
    "create_delivery_application",
    "my_delivery_document_checklist",
    "attach_my_delivery_document",
    "publish_my_delivery_route",
    "save_push_subscription",
    "revoke_push_subscription",
    "render_notification",
  ]) {
    const exists = Number(
      await scalar(`select count(*)::int as value from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = '${fn}'`),
    );
    check(`function ${fn}() exists`, exists > 0);
  }

  const sandbox = await db.query("select value #>> '{}' as value from public.platform_settings where key = 'allow_mock_payments'");
  check("sandbox payments default to disabled", sandbox.rows[0]?.value === "false", String(sandbox.rows[0]?.value));

  const counties = Number(await scalar("select count(*)::int as value from public.service_locations"));
  check("47 counties seeded", counties === 47, `found ${counties}`);

  const buckets = await db.query("select id, public from storage.buckets order by id");
  const bucketById = Object.fromEntries(buckets.rows.map(row => [row.id, row.public]));
  check("listing-images bucket is public", bucketById["listing-images"] === true);
  check("provider-documents bucket is private", bucketById["provider-documents"] === false);

  const refundGrant = await db.query(`
    select
      has_function_privilege('authenticated', 'public.admin_decide_refund(uuid,boolean,text)', 'execute') as authenticated,
      has_function_privilege('anon', 'public.admin_decide_refund(uuid,boolean,text)', 'execute') as anon
  `);
  check(
    "refund decision is executable by an authenticated owner session (0026)",
    refundGrant.rows[0]?.authenticated === true,
  );
  check("refund decision is not executable by anon", refundGrant.rows[0]?.anon === false);

  const settingsGrant = await db.query(`
    select
      has_function_privilege('authenticated', 'public.admin_update_setting(text,jsonb)', 'execute') as update_authenticated,
      has_function_privilege('authenticated', 'public.get_admin_settings()', 'execute') as read_authenticated,
      has_function_privilege('anon', 'public.admin_update_setting(text,jsonb)', 'execute') as update_anon
  `);
  check(
    "settings write is executable by an authenticated owner session (0027)",
    settingsGrant.rows[0]?.update_authenticated === true,
  );
  check(
    "settings read is executable by an authenticated owner session (0027)",
    settingsGrant.rows[0]?.read_authenticated === true,
  );
  check("settings write is not executable by anon", settingsGrant.rows[0]?.update_anon === false);

  console.log("\n== owner console read models (0028) ==");

  // Functional checks, not just catalogue checks: seed one allowlisted owner and one stranger, then
  // call each read model as the owner and confirm the same calls are refused without aal2 or without
  // the allowlist. This is the guarantee the admin screens rely on.
  const ownerId = "11111111-1111-4111-8111-111111111111";
  const strangerId = "22222222-2222-4222-8222-222222222222";
  await db.exec(`
    insert into auth.users (id, email, email_confirmed_at) values
      ('${ownerId}', 'console.owner@gmail.com', now()),
      ('${strangerId}', 'stranger@example.com', now())
    on conflict (id) do nothing;
    insert into public.owner_admin_allowlist (email) values ('console.owner@gmail.com')
    on conflict do nothing;
    -- The auth trigger creates the profile row; set the display name rather than inserting a rival row.
    update public.profiles set display_name = 'Console Owner' where id = '${ownerId}';
    insert into public.user_roles (user_id, role) values ('${ownerId}', 'customer')
    on conflict do nothing;
    insert into public.user_onboarding (user_id, full_name, county, account_intent, completed_at)
    values ('${ownerId}', 'Console Owner', 'Nairobi', 'customer', now())
    on conflict (user_id) do nothing;
  `);

  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [ownerId]);
  await db.query("select set_config('request.jwt.claim.aal', 'aal2', false)");

  const customers = await db.query("select * from public.admin_list_customers(null, 10)");
  check(
    "owner can read the customer directory",
    customers.rows.some(row => row.user_id === ownerId && row.email === "console.owner@gmail.com"),
  );
  const searched = await db.query("select * from public.admin_list_customers('console owner', 10)");
  check(
    "customer directory search matches display names",
    searched.rows.length === 1 && searched.rows[0].user_id === ownerId,
    `${searched.rows.length} row(s): ${searched.rows.map(row => `${row.display_name}/${row.email}`).join(", ")}`,
  );

  const roles = await db.query("select * from public.admin_list_role_assignments(10)");
  check("owner can read role assignments", roles.rows.some(row => row.role === "customer" && row.user_id === ownerId));

  const coverage = await db.query("select * from public.admin_service_area_coverage(100)");
  check("service coverage lists the seeded counties", coverage.rows.length === 47, `found ${coverage.rows.length}`);

  const onboarding = await db.query("select public.admin_onboarding_overview() as value");
  const onboardingValue = onboarding.rows[0]?.value;
  check(
    "onboarding overview counts the seeded account",
    onboardingValue && Number(onboardingValue.total) === 1 && Number(onboardingValue.completed) === 1,
  );

  for (const [label, sql] of [
    ["provider directory", "select * from public.admin_list_providers(10)"],
    ["rider directory", "select * from public.admin_list_riders(10)"],
    ["delivery jobs", "select * from public.admin_list_deliveries(10)"],
    ["listing enquiries", "select * from public.admin_list_listing_requests(10)"],
    ["trip reviews", "select * from public.admin_list_ride_reviews(10)"],
  ]) {
    const result = await db.query(sql);
    check(`owner can read ${label}`, Array.isArray(result.rows));
  }

  await db.query("select set_config('request.jwt.claim.aal', 'aal1', false)");
  const aal1Denied = await db
    .query("select * from public.admin_list_customers(null, 10)")
    .then(() => false)
    .catch(() => true);
  check("read models refuse an owner session without MFA", aal1Denied);

  await db.query("select set_config('request.jwt.claim.aal', 'aal2', false)");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [strangerId]);
  const strangerDenied = await db
    .query("select * from public.admin_list_customers(null, 10)")
    .then(() => false)
    .catch(() => true);
  check("read models refuse a signed-in non-owner", strangerDenied);

  // Reset the claims so later checks are not evaluated as an owner session.
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
  await db.query("select set_config('request.jwt.claim.aal', 'aal1', false)");

  console.log("\n== delivery network (0029) ==");

  // Phase 2 acceptance checks: cargo capacity, route verification, matched-only offers and a
  // concurrency-safe acceptance. Fixtures are local test rows, never production data.
  const courierId = "33333333-3333-4333-8333-333333333333";
  const shipperId = "44444444-4444-4444-8444-444444444444";
  await db.exec(`
    insert into auth.users (id, email, email_confirmed_at) values
      ('${courierId}', 'courier@example.com', now()),
      ('${shipperId}', 'shipper@example.com', now())
    on conflict (id) do nothing;

    insert into public.provider_applications (user_id, activity_type, status, business_name, submitted_at)
    values ('${courierId}', 'transport_partner', 'approved', 'Test Courier', now());

    insert into public.transport_vehicles
      (user_id, mode, make_model, plate_number, seat_capacity, verification_status,
       vehicle_class_code, payload_kg, supports_fragile)
    values ('${courierId}', 'motorcycle', 'Test Boxer', 'TST 001A', 1, 'approved',
      'motorbike', 40, true);
  `);

  const locations = await db.query(
    "select county_code, id from public.service_locations where county_code in (1, 42, 47)",
  );
  const locationByCode = Object.fromEntries(locations.rows.map(row => [Number(row.county_code), row.id]));
  const mombasa = locationByCode[1];
  const kisumu = locationByCode[42];
  const nairobi = locationByCode[47];
  check("service locations are available for route fixtures", Boolean(mombasa && kisumu && nairobi));

  await db.query(
    "insert into public.delivery_provider_routes (provider_user_id, origin_location_id, destination_location_id) values ($1,$2,$3)",
    [courierId, nairobi, mombasa],
  );

  async function seedShipment(number, dropoffLocationId, weightKg) {
    const order = await db.query(
      `insert into public.orders
         (order_number, customer_id, status, payment_status, subtotal_minor, delivery_fee_minor,
          total_minor, commission_minor, delivery_method)
       values ($1, $2, 'paid', 'paid', 10000, 500, 10500, 1000, 'platform_delivery')
       returning id`,
      [number, shipperId],
    );
    const delivery = await db.query(
      `insert into public.deliveries
         (order_id, status, dropoff_address, delivery_fee_minor, rider_fee_minor, platform_fee_minor,
          pickup_county, dropoff_county, pickup_location_id, dropoff_location_id, package_count, weight_kg)
       values ($1, 'requested', 'Test dropoff', 500, 400, 100, 'Nairobi', 'Test', $2, $3, 2, $4)
       returning id`,
      [order.rows[0].id, nairobi, dropoffLocationId, weightKg],
    );
    return { orderId: order.rows[0].id, deliveryId: delivery.rows[0].id };
  }

  const light = await seedShipment("SHP-TEST-LIGHT", mombasa, 20);
  const heavy = await seedShipment("SHP-TEST-HEAVY", mombasa, 5000);
  const offRoute = await seedShipment("SHP-TEST-ROUTE", kisumu, 10);

  // Matching is a staff/owner operation.
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [ownerId]);
  await db.query("select set_config('request.jwt.claim.aal', 'aal2', false)");

  const candidates = await db.query("select * from public.match_delivery_candidates($1)", [light.deliveryId]);
  check(
    "a compatible parcel matches the approved vehicle on its configured route",
    candidates.rows.length === 1 && candidates.rows[0].provider_user_id === courierId,
    `${candidates.rows.length} candidate(s)`,
  );
  check(
    "the match explains why it was eligible",
    candidates.rows[0] && candidates.rows[0].reasons?.exact_route === true && Number(candidates.rows[0].rank_score) > 0,
    JSON.stringify(candidates.rows[0]?.reasons ?? {}),
  );

  const heavyCandidates = await db.query("select * from public.match_delivery_candidates($1)", [heavy.deliveryId]);
  check("a 5,000 kg shipment is never offered to a 40 kg motorbike", heavyCandidates.rows.length === 0);

  const routeCandidates = await db.query("select * from public.match_delivery_candidates($1)", [offRoute.deliveryId]);
  check("an unverified route produces no match instead of a guessed one", routeCandidates.rows.length === 0);

  const offered = await db.query("select * from public.offer_delivery_to_candidates($1, 3, 30)", [light.deliveryId]);
  check("offering creates one matched offer", offered.rows.length === 1);
  const offeredStatus = await db.query("select assignment_status from public.deliveries where id = $1", [light.deliveryId]);
  check("the shipment moves to offered", offeredStatus.rows[0].assignment_status === "offered");

  const offerId = (
    await db.query("select id from public.delivery_offers where delivery_id = $1 and provider_user_id = $2", [
      light.deliveryId,
      courierId,
    ])
  ).rows[0].id;

  // The deliverer side: only their own offers, and no street address in the payload.
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [courierId]);
  await db.query("select set_config('request.jwt.claim.aal', 'aal1', false)");
  const myOffers = await db.query("select * from public.list_my_delivery_offers()");
  check("the deliverer sees the matched offer", myOffers.rows.length === 1 && myOffers.rows[0].offer_id === offerId);
  check(
    "the offer payload carries areas, not the delivery address",
    myOffers.rows.length === 1 && !("dropoff_address" in myOffers.rows[0]) && myOffers.rows[0].pickup_county === "Nairobi",
  );
  const offerNotificationRows = await db.query(
    "select template, payload from public.notification_outbox where user_id = $1 and template = 'delivery_offer'",
    [courierId],
  );
  check(
    "offering a shipment queues a notification for that rider (0038)",
    offerNotificationRows.rows.length >= 1 && offerNotificationRows.rows[0].payload?.delivery_id,
    JSON.stringify(offerNotificationRows.rows[0] ?? null),
  );

  const accepted = await db.query("select * from public.accept_delivery_offer($1)", [offerId]);
  check("the eligible deliverer claims the shipment", accepted.rows.length === 1 && accepted.rows[0].delivery_id === light.deliveryId);

  const assigned = await db.query(
    "select rider_id, assigned_vehicle_id, status, assignment_status from public.deliveries where id = $1",
    [light.deliveryId],
  );
  check(
    "assignment records the provider, the vehicle and the state",
    assigned.rows[0].rider_id === courierId &&
      assigned.rows[0].assigned_vehicle_id !== null &&
      assigned.rows[0].status === "assigned" &&
      assigned.rows[0].assignment_status === "assigned",
  );

  const eventCount = await db.query(
    "select count(*)::int as value from public.delivery_events where delivery_id = $1 and status = 'assigned'",
    [light.deliveryId],
  );
  check("the assignment is written to the shipment history", Number(eventCount.rows[0].value) === 1);

  const secondAccept = await db
    .query("select * from public.accept_delivery_offer($1)", [offerId])
    .then(() => false)
    .catch(() => true);
  check("a second acceptance loses the race instead of double-booking", secondAccept);

  // Declining and suspension paths.
  const declineShipment = await seedShipment("SHP-TEST-DECLINE", mombasa, 10);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [ownerId]);
  await db.query("select set_config('request.jwt.claim.aal', 'aal2', false)");
  await db.query("select * from public.offer_delivery_to_candidates($1, 3, 30)", [declineShipment.deliveryId]);
  const declineOffer = (
    await db.query("select id from public.delivery_offers where delivery_id = $1", [declineShipment.deliveryId])
  ).rows[0].id;
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [courierId]);
  await db.query("select public.decline_delivery_offer($1, 'Vehicle unavailable')", [declineOffer]);
  const declined = await db.query("select status, response_note from public.delivery_offers where id = $1", [declineOffer]);
  check("declining records the response and keeps the shipment unassigned", declined.rows[0].status === "declined");

  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [ownerId]);
  await db.query("select set_config('request.jwt.claim.aal', 'aal2', false)");
  const suspendShipment = await seedShipment("SHP-TEST-SUSPEND", mombasa, 10);
  await db.query("select * from public.offer_delivery_to_candidates($1, 3, 30)", [suspendShipment.deliveryId]);
  const suspendOffer = (
    await db.query("select id from public.delivery_offers where delivery_id = $1", [suspendShipment.deliveryId])
  ).rows[0].id;
  await db.query(
    `update public.provider_applications
     set status = 'suspended', reviewed_by = $2, reviewed_at = now(), reviewer_note = 'Test suspension'
     where user_id = $1 and activity_type = 'transport_partner'`,
    [courierId, ownerId],
  );
  const suspendedRow = await db.query(
    "select status from public.provider_applications where user_id = $1 and activity_type = 'transport_partner'",
    [courierId],
  );
  check("an approved provider can be suspended with a recorded reason", suspendedRow.rows[0].status === "suspended");

  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [courierId]);
  const suspendedDenied = await db
    .query("select * from public.accept_delivery_offer($1)", [suspendOffer])
    .then(() => false)
    .catch(() => true);
  check("a suspended provider cannot accept an already-offered shipment", suspendedDenied);

  const stillUnassigned = await db.query("select rider_id, status from public.deliveries where id = $1", [suspendShipment.deliveryId]);
  check("the refusal leaves the shipment unassigned", stillUnassigned.rows[0].rider_id === null && stillUnassigned.rows[0].status === "requested");

  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [ownerId]);
  await db.query("select set_config('request.jwt.claim.aal', 'aal2', false)");
  await db.query(
    `update public.provider_applications
     set status = 'approved', reviewed_by = $2, reviewed_at = now(), reviewer_note = 'Reinstated after review'
     where user_id = $1 and activity_type = 'transport_partner'`,
    [courierId, ownerId],
  );
  const reinstated = await db.query(
    "select status from public.provider_applications where user_id = $1 and activity_type = 'transport_partner'",
    [courierId],
  );
  check("a suspended provider can be reinstated by an owner", reinstated.rows[0].status === "approved");
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
  await db.query("select set_config('request.jwt.claim.aal', 'aal1', false)");

  console.log("\n== deliverer onboarding and documents (0030) ==");

  const applicantId = "55555555-5555-4555-8555-555555555555";
  const fleetOwnerId = "66666666-6666-4666-8666-666666666666";
  const fleetDriverId = "77777777-7777-4777-8777-777777777777";
  await db.exec(`
    insert into auth.users (id, email, email_confirmed_at) values
      ('${applicantId}', 'applicant@example.com', now()),
      ('${fleetOwnerId}', 'fleet@example.com', now()),
      ('${fleetDriverId}', 'driver@example.com', now())
    on conflict (id) do nothing;
  `);

  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [applicantId]);
  await db.query("select set_config('request.jwt.claim.aal', 'aal2', false)");

  // A complete bicycle application: identity evidence and a profile photo, and nothing that belongs
  // to a motor vehicle.
  const bicycleDocs = [
    { doc_type: "national_id", storage_path: `delivery/${applicantId}/id-front.jpg` },
    { doc_type: "national_id_back", storage_path: `delivery/${applicantId}/id-back.jpg` },
    { doc_type: "profile_photo", storage_path: `delivery/${applicantId}/selfie.jpg` },
  ];
  const bicyclePayload = {
    full_name: "Applicant Courier",
    phone: "+254700000001",
    id_type: "national_id",
    id_number: "12345678",
    operating_area: "Nairobi",
    mode: "individual",
    vehicle: {
      class_code: "bicycle",
      make_model: "Cargo bicycle",
      plate_number: "BIKE-01",
      ownership_status: "owned",
    },
    documents: bicycleDocs,
  };
  const submitted = await db.query(
    "select * from public.submit_deliverer_application('individual', $1::jsonb, 'deliverer-terms-v1')",
    [JSON.stringify(bicyclePayload)],
  );
  const applicantApplicationId = submitted.rows[0].application_id;
  check("an existing account can submit a deliverer application", Boolean(applicantApplicationId));

  const applicationRow = await db.query(
    "select status, submitted_at, activity_type from public.provider_applications where id = $1",
    [applicantApplicationId],
  );
  check(
    "submission is pending and grants no eligibility",
    applicationRow.rows[0].status === "pending" && applicationRow.rows[0].submitted_at !== null,
  );

  const duplicate = await db
    .query("select * from public.submit_deliverer_application('individual', '{}'::jsonb, 'deliverer-terms-v1')")
    .then(() => false)
    .catch(() => true);
  check("a second live application is refused instead of duplicated", duplicate);

  const selfApprove = await db
    .query("update public.provider_applications set status = 'approved' where id = $1", [applicantApplicationId])
    .then(() => false)
    .catch(() => true);
  check("an applicant cannot approve their own application", selfApprove);

  const selfReview = await db
    .query("select public.admin_review_delivery_document($1, true, 'self')", [applicantApplicationId])
    .then(() => false)
    .catch(() => true);
  check("an applicant cannot use a review function", selfReview);

  const badPath = await db
    .query(
      "select public.register_delivery_document('national_id', 'delivery/00000000-0000-4000-8000-000000000000/x.pdf', $1)",
      [applicantApplicationId],
    )
    .then(() => false)
    .catch(() => true);
  check("documents must live in the caller's own private folder", badPath);

  const ownPath = `delivery/${applicantId}/national-id.pdf`;
  const documentId = (
    await db.query(
      "select public.register_delivery_document('national_id', $1, $2) as id",
      [ownPath, applicantApplicationId],
    )
  ).rows[0].id;
  check("an applicant can register a private document for review", Boolean(documentId));

  const documentStatus = await db.query(
    "select status, storage_path from public.delivery_documents where id = $1",
    [documentId],
  );
  check(
    "a registered document starts pending and keeps its private path",
    documentStatus.rows[0].status === "pending" &&
      documentStatus.rows[0].storage_path === ownPath &&
      !ownPath.includes("http"),
  );

  const pendingOffers = await db.query("select * from public.list_my_delivery_offers()");
  check("a pending applicant sees no delivery offers", pendingOffers.rows.length === 0);

  // Resume: save a draft, reload it, submit it, and confirm it is cleared.
  const draftUserId = "88888888-8888-4888-8888-888888888888";
  await db.exec(`
    insert into auth.users (id, email, email_confirmed_at) values ('${draftUserId}', 'draft@example.com', now())
    on conflict (id) do nothing;
  `);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [draftUserId]);
  await db.query("select public.save_delivery_application_draft('individual', $1::jsonb)", [
    JSON.stringify({
      ...bicyclePayload,
      full_name: "Draft Courier",
      operating_area: "Mombasa",
      documents: [
        { doc_type: "national_id", storage_path: `delivery/${draftUserId}/id-front.jpg` },
        { doc_type: "national_id_back", storage_path: `delivery/${draftUserId}/id-back.jpg` },
        { doc_type: "profile_photo", storage_path: `delivery/${draftUserId}/selfie.jpg` },
      ],
    }),
  ]);
  const draftRow = await db.query("select mode, payload from public.delivery_application_drafts where user_id = $1", [
    draftUserId,
  ]);
  check(
    "a draft can be saved and resumed",
    draftRow.rows[0]?.mode === "individual" && draftRow.rows[0]?.payload?.full_name === "Draft Courier",
  );
  const draftSubmitted = await db.query("select * from public.submit_delivery_application_draft('deliverer-terms-v1')");
  check("a saved draft can be submitted", Boolean(draftSubmitted.rows[0].application_id));
  const draftCleared = await db.query("select count(*)::int as value from public.delivery_application_drafts where user_id = $1", [draftUserId]);
  check("submitting clears the draft", Number(draftCleared.rows[0].value) === 0);

  // Fleet path.
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [fleetOwnerId]);
  await db.query("select set_config('request.jwt.claim.aal', 'aal2', false)");
  const fleetSubmitted = await db.query(
    "select * from public.submit_deliverer_application('fleet', $1::jsonb, 'deliverer-terms-v1')",
    [
      JSON.stringify({
        full_name: "Fleet Owner",
        phone: "+254700000002",
        id_type: "national_id",
        id_number: "87654321",
        operating_area: "Nairobi",
        business_name: "Test Fleet Ltd",
        representative: "Owner",
        mode: "fleet",
        vehicle: {
          class_code: "van",
          make_model: "Test Van",
          plate_number: "FLT 001A",
          ownership_status: "fleet_vehicle",
          licence_number: "DL-998877",
          licence_class: "BCE",
          licence_expiry: "2031-01-31",
        },
        documents: [
          { doc_type: "national_id", storage_path: `delivery/${fleetOwnerId}/id-front.jpg` },
          { doc_type: "national_id_back", storage_path: `delivery/${fleetOwnerId}/id-back.jpg` },
          { doc_type: "profile_photo", storage_path: `delivery/${fleetOwnerId}/selfie.jpg` },
          { doc_type: "driving_licence", storage_path: `delivery/${fleetOwnerId}/licence.jpg` },
          { doc_type: "vehicle_registration", storage_path: `delivery/${fleetOwnerId}/logbook.jpg` },
          { doc_type: "business_registration", storage_path: `delivery/${fleetOwnerId}/brs.jpg` },
        ],
      }),
    ],
  );
  const fleetId = fleetSubmitted.rows[0].fleet_id;
  check("a fleet application creates a linked fleet record", Boolean(fleetId));
  const fleetRow = await db.query("select status, submitted_at from public.delivery_fleets where id = $1", [fleetId]);
  check(
    "the fleet starts pending, not approved",
    fleetRow.rows[0].status === "pending" && fleetRow.rows[0].submitted_at !== null,
  );

  // The submission registers the fleet vehicle in the same transaction, so there is nothing to
  // register separately here; the row must exist and still be pending.
  const fleetVehicleId = (
    await db.query("select id from public.transport_vehicles where fleet_id = $1 limit 1", [fleetId])
  ).rows[0]?.id;
  check("a fleet application registers its vehicle in the same transaction", Boolean(fleetVehicleId));
  const fleetVehicleRow = await db.query(
    "select verification_status, fleet_id from public.transport_vehicles where id = $1",
    [fleetVehicleId],
  );
  check(
    "a fleet vehicle starts pending and is bound to the fleet",
    fleetVehicleRow.rows[0]?.verification_status === "pending" && fleetVehicleRow.rows[0]?.fleet_id === fleetId,
    JSON.stringify(fleetVehicleRow.rows[0]),
  );

  // Fleet review and independent driver approval.
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [ownerId]);
  await db.query("select set_config('request.jwt.claim.aal', 'aal2', false)");
  await db.query("select public.admin_review_delivery_fleet($1, true, 'Documents checked')", [fleetId]);
  const fleetApproved = await db.query("select status from public.delivery_fleets where id = $1", [fleetId]);
  check("staff can approve a reviewed fleet", fleetApproved.rows[0].status === "approved");

  const driverMembership = await db.query(
    `insert into public.delivery_fleet_drivers (fleet_id, driver_user_id)
     values ($1, $2) returning id, status`,
    [fleetId, fleetDriverId],
  );
  const driverMembershipId = driverMembership.rows[0].id;
  check("adding a driver leaves them pending review", driverMembership.rows[0].status === "pending");

  await db.query("select public.admin_review_delivery_fleet_driver($1, true, 'Licence checked')", [
    driverMembershipId,
  ]);
  const driverApproved = await db.query(
    "select status, reviewed_by from public.delivery_fleet_drivers where id = $1",
    [driverMembershipId],
  );
  check(
    "drivers are approved independently of the fleet",
    driverApproved.rows[0].status === "approved" && driverApproved.rows[0].reviewed_by === ownerId,
  );

  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [applicantId]);
  await db.query("select set_config('request.jwt.claim.aal', 'aal2', false)");
  const reviewOwnDoc = await db
    .query("select public.admin_review_delivery_document($1, true, 'self')", [documentId])
    .then(() => false)
    .catch(() => true);
  check("review functions remain staff-only", reviewOwnDoc);

  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [ownerId]);
  await db.query("select set_config('request.jwt.claim.aal', 'aal2', false)");
  await db.query("select public.admin_review_delivery_document($1, true, 'Matches the applicant')", [documentId]);
  const reviewedDoc = await db.query("select status, reviewed_by from public.delivery_documents where id = $1", [documentId]);
  check(
    "an owner can approve a document and the decision is attributed",
    reviewedDoc.rows[0].status === "approved" && reviewedDoc.rows[0].reviewed_by === ownerId,
  );

  await db.query("select set_config('request.jwt.claim.sub', '', false)");
  await db.query("select set_config('request.jwt.claim.aal', 'aal1', false)");

  const definer = await db.query(`
    select p.proname, coalesce(array_to_string(p.proconfig, ','), '') as config
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef = true
  `);
  const unsafeDefiner = definer.rows.filter(row => !row.config.includes("search_path="));
  check(
    "every SECURITY DEFINER function pins search_path",
    unsafeDefiner.length === 0,
    unsafeDefiner.map(row => row.proname).join(", "),
  );

  console.log("\n== delivery pricing, quotes and 10% commissions (0031) ==");

  const asUser = async (id, aal = "aal1") => {
    await db.query(`select set_config('request.jwt.claim.sub', '${id}', false)`);
    await db.query(`select set_config('request.jwt.claim.aal', '${aal}', false)`);
  };
  const expectFailure = async (sql, label) => {
    try {
      await db.query(sql);
      check(label, false, "the statement unexpectedly succeeded");
    } catch (error) {
      check(label, true, String(error.message).split("\n")[0]);
    }
  };

  const classCode = await scalar("select code as value from public.delivery_vehicle_classes where is_active order by sort_order limit 1");
  check("a vehicle class is seeded for pricing", Boolean(classCode), String(classCode));
  const seededPayoutRate = await scalar("select rate_bps::int as value from public.commission_rules where slug = 'deliverer-payout-commission'");
  check("deliverer payout commission defaults to 10%", Number(seededPayoutRate) === 1000, String(seededPayoutRate));

  const clientSplit = await db.query("select rate_bps, commission_minor, net_minor from public.commission_split(100000, 'client_payment')");
  check(
    "10% client payment commission on KSh 1,000 (10000 / 90000)",
    Number(clientSplit.rows[0].commission_minor) === 10000 && Number(clientSplit.rows[0].net_minor) === 90000,
    JSON.stringify(clientSplit.rows[0]),
  );

  // A customer must never be able to set commercial prices.
  await asUser(strangerId);
  await expectFailure(
    `select public.admin_upsert_delivery_pricing_rule('route-nairobi', 'Nairobi route', 20000, '${classCode}', 'Nairobi', 'Nairobi')`,
    "a customer cannot create a delivery pricing rule",
  );

  await asUser(ownerId, "aal2");
  const ruleId = await scalar(`
    select public.admin_upsert_delivery_pricing_rule(
      'route-nairobi', 'Nairobi same-city', 20000, '${classCode}', 'Nairobi', 'Nairobi',
      1000, 500, 2000, 3000, 4000, 1000, 0, null
    )::text as value
  `);
  check("the owner can create a delivery pricing rule", Boolean(ruleId), String(ruleId));

  // Quotes fail closed when no rule covers the route.
  await asUser(strangerId);
  await expectFailure(
    `select * from public.quote_delivery('Kisumu', 'Nairobi', '${classCode}', 1, 5)`,
    "an unpriced route produces no quote",
  );
  await expectFailure(
    `select * from public.quote_delivery('Nairobi', 'Nairobi', '${classCode}', 1, 99999)`,
    "cargo above the vehicle payload limit is refused",
  );

  const quote = await db.query(
    `select * from public.quote_delivery('Nairobi', 'Nairobi', '${classCode}', 2, 10)`,
  );
  const q = quote.rows[0];
  check("a covered route returns a real quote", Boolean(q?.quote_id), JSON.stringify(q));
  check(
    "quote arithmetic matches its components and the fee split invariant",
    Number(q?.total_minor) === 20000 + 1000 * 10 + 500 * 2
      && Number(q?.total_minor) === Number(q?.rider_fee_minor) + Number(q?.platform_fee_minor)
      && Number(q?.platform_fee_minor) === 3100,
    `total=${q?.total_minor} rider=${q?.rider_fee_minor} platform=${q?.platform_fee_minor}`,
  );
  check("the quote records the rule version", Number(q?.pricing_rule_version) === 1, String(q?.pricing_rule_version));

  // Attaching the quote reprices the unpaid order once, and only once.
  const orderId = await scalar(`
    insert into public.orders (
      order_number, customer_id, status, payment_status, currency, subtotal_minor,
      delivery_fee_minor, total_minor, commission_minor, commission_rate_bps, commission_base_minor,
      delivery_method, delivery_address
    ) values (
      'SX-TEST-0031', '${strangerId}', 'pending_payment', 'unpaid', 'KES', 100000,
      10000, 110000, 10000, 1000, 100000, 'platform_delivery', 'Test drop-off, Nairobi'
    ) returning id::text as value
  `);
  await db.query(`
    insert into public.deliveries (
      order_id, shipment_number, delivery_fee_minor, rider_fee_minor, platform_fee_minor,
      pickup_address, dropoff_address
    ) values (
      '${orderId}', 'SHP-TEST-0031', 10000, 9000, 1000,
      'Test pickup, Nairobi', 'Test drop-off, Nairobi'
    )
  `);

  await asUser(strangerId);
  await db.query(`select public.attach_delivery_quote_to_order('${orderId}', '${q.quote_id}')`);

  const repriced = await db.query(`
    select o.total_minor, o.delivery_fee_minor, d.package_count, d.weight_kg, d.rider_fee_minor,
           d.platform_fee_minor, d.required_vehicle_class_code, d.quote_snapshot #>> '{pricing_rule_version}' as snapshot_version
    from public.orders o join public.deliveries d on d.order_id = o.id
    where o.id = '${orderId}'
  `);
  const r = repriced.rows[0];
  check(
    "the order total is repriced from the quote before payment",
    Number(r?.total_minor) === 100000 + 31000 && Number(r?.delivery_fee_minor) === 31000,
    JSON.stringify(r),
  );
  check(
    "cargo and the quote snapshot land on the shipment",
    Number(r?.package_count) === 2 && Number(r?.weight_kg) === 10 && Number(r?.rider_fee_minor) === 27900
      && Number(r?.platform_fee_minor) === 3100 && r?.required_vehicle_class_code === classCode
      && r?.snapshot_version === "1",
    JSON.stringify(r),
  );
  await expectFailure(
    `select public.attach_delivery_quote_to_order('${orderId}', '${q.quote_id}')`,
    "a consumed quote cannot be reused",
  );

  // Payout commission: 10% recorded once, reversed with an audit trail, and never doubled.
  const payoutId = await scalar(`
    insert into public.payouts (payee_id, payee_role, amount_minor, currency, status)
    values ('${strangerId}', 'rider', 500000, 'KES', 'pending') returning id::text as value
  `);
  await expectFailure(
    `select * from public.apply_payout_commission('${payoutId}')`,
    "a deliverer cannot apply their own payout commission",
  );

  await asUser(ownerId, "aal2");
  const firstCommission = await db.query(`select * from public.apply_payout_commission('${payoutId}')`);
  check(
    "a KSh 5,000 payout carries KSh 500 commission and KSh 4,500 net",
    Number(firstCommission.rows[0].commission_minor) === 50000 && Number(firstCommission.rows[0].net_minor) === 450000,
    JSON.stringify(firstCommission.rows[0]),
  );
  await db.query(`select * from public.apply_payout_commission('${payoutId}')`);
  const commissionRows = await db.query(`
    select count(*)::int as rows, coalesce(sum(debit_minor), 0)::bigint as debits
    from public.ledger_entries where payout_id = '${payoutId}' and entry_type = 'commission'
  `);
  check(
    "retrying the payout commission writes nothing twice",
    Number(commissionRows.rows[0].rows) === 2 && Number(commissionRows.rows[0].debits) === 50000,
    JSON.stringify(commissionRows.rows[0]),
  );

  await expectFailure(
    `select * from public.admin_reverse_payout_commission('${payoutId}', 'test')`,
    "a reversal needs a written reason",
  );
  const reversal = await db.query(`select * from public.admin_reverse_payout_commission('${payoutId}', 'Payout failed at the provider')`);
  check(
    "reversing the commission restores the net amount",
    Number(reversal.rows[0].reversed_commission_minor) === 50000 && Number(reversal.rows[0].net_minor) === 500000,
    JSON.stringify(reversal.rows[0]),
  );
  await db.query(`select * from public.admin_reverse_payout_commission('${payoutId}', 'Payout failed at the provider')`);
  const reconciled = await db.query(`select * from public.admin_payout_reconciliation(10) where payout_id = '${payoutId}'`);
  const rec = reconciled.rows[0];
  check(
    "the reconciliation read model agrees with the ledger after reversal",
    Number(rec?.ledger_commission_minor) === 50000 && Number(rec?.ledger_reversed_minor) === 50000
      && Number(rec?.commission_minor) === 0 && Number(rec?.net_minor) === 500000,
    JSON.stringify(rec),
  );

  await asUser(strangerId);
  await expectFailure(
    "select * from public.admin_payout_reconciliation(10)",
    "payout reconciliation is finance-only",
  );
  await expectFailure(
    `insert into public.ledger_entries (order_id, payout_id, entry_type, account, debit_minor, credit_minor, currency)
     values (null, null, 'commission', 'platform_commission', 0, 100, 'KES')`,
    "a ledger entry must reference an order or a payout",
  );

  console.log("\n== reviewer visibility and applicant evidence (0032) ==");

  // 0032 exists because `provider_applications` had no reviewer SELECT policy: an owner could see
  // only their own row, so the queue looked empty and the only row they could see was one the
  // trigger refuses to let them approve. These checks pin both halves of the repair.
  const applicationId = await scalar(`
    insert into public.provider_applications (user_id, activity_type, status, business_name, application_data, submitted_at)
    values ('${strangerId}', 'product_seller', 'pending', 'Stranger Traders', '{"introduction":"Test applicant"}'::jsonb, now())
    returning id::text as value
  `);
  check("a submitted application exists for a different account", Boolean(applicationId), String(applicationId));

  await asUser(strangerId);
  await db.exec("set role authenticated");
  const strangerVisible = await scalar(
    `select count(*)::int as value from public.provider_applications where id = '${applicationId}'`,
  );
  await db.exec("reset role");
  check("an applicant still reads only their own application", Number(strangerVisible) === 1, String(strangerVisible));

  await asUser(strangerId);
  await db.exec("set role authenticated");
  const strangerCannotSeeOthers = await scalar(
    `select count(*)::int as value from public.provider_applications where user_id = '${ownerId}'`,
  );
  await db.exec("reset role");
  check("an applicant cannot read another account's application", Number(strangerCannotSeeOthers) === 0, String(strangerCannotSeeOthers));

  await asUser(ownerId, "aal1");
  await db.exec("set role authenticated");
  const ownerAal1Visible = await scalar(
    `select count(*)::int as value from public.provider_applications where id = '${applicationId}'`,
  );
  await db.exec("reset role");
  check("an aal1 owner still sees no application queue", Number(ownerAal1Visible) === 0, String(ownerAal1Visible));

  await asUser(ownerId, "aal2");
  await db.exec("set role authenticated");
  const ownerVisible = await scalar(
    `select count(*)::int as value from public.provider_applications where id = '${applicationId}'`,
  );
  await db.exec("reset role");
  check("an aal2 owner can read the review queue", Number(ownerVisible) === 1, String(ownerVisible));

  const detail = await db.query(`select public.admin_application_detail('${applicationId}') as value`);
  const detailJson = detail.rows[0]?.value ?? null;
  check(
    "the review read model returns the applicant's confirmed email and identity",
    detailJson?.applicant?.email === 'stranger@example.com' && detailJson?.applicant?.email_confirmed === true,
    JSON.stringify(detailJson?.applicant ?? null),
  );
  check(
    "the read model never returns factors, tokens or another account's records",
    detailJson !== null && !("factors" in detailJson) && !("access_token" in detailJson)
      && detailJson?.application?.id === applicationId,
    JSON.stringify(Object.keys(detailJson ?? {})),
  );

  await asUser(strangerId);
  await expectFailure(
    `select public.admin_application_detail('${applicationId}')`,
    "a customer cannot read the review read model",
  );

  const ownApplicationId = await scalar(`
    insert into public.provider_applications (user_id, activity_type, status, application_data, submitted_at)
    values ('${ownerId}', 'service_provider', 'pending', '{}'::jsonb, now())
    returning id::text as value
  `);
  await asUser(ownerId, "aal2");
  await db.exec("set role authenticated");
  await expectFailure(
    `update public.provider_applications set status = 'approved', reviewed_at = now(), reviewed_by = '${ownerId}'
     where id = '${ownApplicationId}'`,
    "an owner still cannot approve their own application",
  );
  await db.exec("reset role");

  console.log("\n== provider category activation (0033) ==");

  // Approval alone must not create activities, and an owner must then be able to activate exactly
  // one category for exactly one activity. Nothing could write provider_activities before 0033.
  await asUser(ownerId, "aal2");
  const approval = await db.query(
    `update public.provider_applications
     set status = 'approved', reviewed_at = now(), reviewed_by = '${ownerId}'
     where id = '${applicationId}' and status = 'pending'
     returning id::text as id, status`,
  );
  check("the owner can approve another account's application", approval.rows[0]?.status === "approved", JSON.stringify(approval.rows[0] ?? null));

  const activitiesAfterApproval = await scalar(
    `select count(*)::int as value from public.provider_activities where application_id = '${applicationId}'`,
  );
  check("approval on its own activates no category", Number(activitiesAfterApproval) === 0, String(activitiesAfterApproval));

  const productCategory = await scalar(`
    insert into public.marketplace_categories (slug, name, division, description, is_active, sort_order)
    values ('test-products-active', 'Test products', 'products', 'Fixture category', true, 900)
    returning id::text as value
  `);
  const serviceCategory = await scalar(`
    insert into public.marketplace_categories (slug, name, division, description, is_active, sort_order)
    values ('test-services-active', 'Test services', 'services', 'Fixture category', true, 901)
    returning id::text as value
  `);

  const activityId = await scalar(`
    select public.admin_grant_provider_activity('${applicationId}', '${productCategory}', array['sale'], 1)::text as value
  `);
  check("the owner can activate one category for an approved provider", Boolean(activityId), String(activityId));

  await asUser(strangerId);
  const mayPublish = await scalar(
    `select public.can_publish_with_activity('${activityId}', '${productCategory}', 'sale') as value`,
  );
  check("the activated category authorises that provider to publish in it", mayPublish === true, String(mayPublish));
  await expectFailure(
    `select public.admin_grant_provider_activity('${applicationId}', '${productCategory}', array['sale'])`,
    "a provider cannot activate a category for themselves",
  );

  await asUser(ownerId, "aal2");
  await expectFailure(
    `select public.admin_grant_provider_activity('${applicationId}', '${serviceCategory}', array['sale'])`,
    "a category from another division cannot be activated",
  );
  await expectFailure(
    `select public.admin_grant_provider_activity('${ownApplicationId}', '${productCategory}', array['sale'])`,
    "an unapproved application cannot be activated",
  );

  console.log("\n== delivery confirmation code vault (0034) ==");

  const proofOrderId = await scalar(`
    insert into public.orders (
      order_number, customer_id, status, payment_status, currency, subtotal_minor,
      delivery_fee_minor, total_minor, commission_minor, commission_rate_bps, commission_base_minor,
      delivery_method, delivery_address
    ) values (
      'SX-PROOF-0034', '${strangerId}', 'dispatched', 'paid', 'KES', 100000,
      10000, 110000, 10000, 1000, 100000, 'platform_delivery', 'Proof drop-off, Nairobi'
    ) returning id::text as value
  `);
  const proofDeliveryId = await scalar(`
    insert into public.deliveries (
      order_id, shipment_number, status, rider_id, delivery_fee_minor, rider_fee_minor, platform_fee_minor,
      pickup_address, dropoff_address, proof_code
    ) values (
      '${proofOrderId}', 'SHP-PROOF-0034', 'in_transit', '${courierId}', 10000, 9000, 1000,
      'Proof pickup, Nairobi', 'Proof drop-off, Nairobi', '4321'
    ) returning id::text as value
  `);

  const plaintextLeft = await scalar(
    `select proof_code from public.deliveries where id = '${proofDeliveryId}'`,
  );
  check("the code is removed from the rider-readable delivery row", plaintextLeft === null, String(plaintextLeft));

  await asUser(strangerId);
  const customerCode = await scalar(`select public.get_delivery_proof_code('${proofOrderId}') as value`);
  check("the customer can still read the code", customerCode === "4321", String(customerCode));

  await asUser(courierId);
  const wrongCheck = await scalar(
    `select public.verify_delivery_proof_code('${proofDeliveryId}', '0000') as value`,
  );
  check("a wrong confirmation code is rejected", wrongCheck === "invalid", String(wrongCheck));
  const attempts = await scalar(
    `select attempts::int as value from public.delivery_proof_codes where delivery_id = '${proofDeliveryId}'`,
  );
  check("a wrong code is counted and committed", Number(attempts) === 1, String(attempts));

  await expectFailure(
    `select public.rider_update_delivery('${proofDeliveryId}', 'delivered', '4321', null)`,
    "a delivery cannot be completed before the code is verified",
  );

  const verified = await scalar(
    `select public.verify_delivery_proof_code('${proofDeliveryId}', '4321') as value`,
  );
  check("the correct code verifies", verified === "verified", String(verified));
  await db.query(`select public.rider_update_delivery('${proofDeliveryId}', 'delivered', '4321', 'Handed over')`);
  const deliveredState = await db.query(
    `select d.status, c.consumed_at from public.deliveries d
     join public.delivery_proof_codes c on c.delivery_id = d.id where d.id = '${proofDeliveryId}'`,
  );
  check(
    "the correct code completes the delivery and consumes it",
    deliveredState.rows[0]?.status === "delivered" && deliveredState.rows[0]?.consumed_at !== null,
    JSON.stringify(deliveredState.rows[0] ?? null),
  );
  await expectFailure(
    `select public.rider_update_delivery('${proofDeliveryId}', 'delivered', '4321', 'Again')`,
    "a used code cannot be replayed",
  );
  const reuseCheck = await scalar(
    `select public.verify_delivery_proof_code('${proofDeliveryId}', '4321') as value`,
  );
  check("a consumed code reports as used", reuseCheck === "used", String(reuseCheck));

  // Five wrong attempts lock the delivery even when the right code is finally supplied.
  const lockOrderId = await scalar(`
    insert into public.orders (
      order_number, customer_id, status, payment_status, currency, subtotal_minor,
      delivery_fee_minor, total_minor, commission_minor, commission_rate_bps, commission_base_minor,
      delivery_method, delivery_address
    ) values (
      'SX-PROOF-LOCK-0034', '${strangerId}', 'dispatched', 'paid', 'KES', 100000,
      10000, 110000, 10000, 1000, 100000, 'platform_delivery', 'Lock drop-off, Nairobi'
    ) returning id::text as value
  `);
  const lockDeliveryId = await scalar(`
    insert into public.deliveries (
      order_id, shipment_number, status, rider_id, delivery_fee_minor, rider_fee_minor, platform_fee_minor,
      pickup_address, dropoff_address, proof_code
    ) values (
      '${lockOrderId}', 'SHP-PROOF-LOCK-0034', 'in_transit', '${courierId}', 10000, 9000, 1000,
      'Lock pickup, Nairobi', 'Lock drop-off, Nairobi', '8765'
    ) returning id::text as value
  `);

  await asUser(courierId);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const outcome = await scalar(
      `select public.verify_delivery_proof_code('${lockDeliveryId}', '1111') as value`,
    );
    check(`wrong code attempt ${attempt + 1} is refused`, outcome === "invalid" || outcome === "locked", String(outcome));
  }
  const locked = await db.query(
    `select attempts::int as attempts, locked_until from public.delivery_proof_codes where delivery_id = '${lockDeliveryId}'`,
  );
  check(
    "five wrong attempts lock the code",
    Number(locked.rows[0]?.attempts) === 5 && locked.rows[0]?.locked_until !== null,
    JSON.stringify(locked.rows[0] ?? null),
  );
  const lockedCheck = await scalar(
    `select public.verify_delivery_proof_code('${lockDeliveryId}', '8765') as value`,
  );
  check("a locked delivery rejects even the correct code", lockedCheck === "locked", String(lockedCheck));
  await expectFailure(
    `select public.rider_update_delivery('${lockDeliveryId}', 'delivered', '8765', null)`,
    "a locked delivery cannot be completed",
  );

  // Neither the vault nor the vaulted column may be readable by a signed-in client.
  await db.exec("set role authenticated");
  await expectFailure(
    `select code from public.delivery_proof_codes limit 1`,
    "a signed-in client cannot select proof codes",
  );
  await db.exec("reset role");

  await db.query("select set_config('request.jwt.claim.sub', '', false)");
  await db.query("select set_config('request.jwt.claim.aal', 'aal1', false)");

  console.log("\n== activity-specific deliverer requirements (0037) ==");

  const motorbikeUserId = "99999999-9999-4999-8999-999999999999";
  await db.exec(`
    insert into auth.users (id, email, email_confirmed_at) values
      ('${motorbikeUserId}', 'motorbike@example.com', now())
    on conflict (id) do nothing;
  `);

  const routeCounties = (
    await db.query("select id from public.service_locations order by county_code limit 2")
  ).rows;
  const routeOrigin = routeCounties[0]?.id;
  const routeDestination = routeCounties[1]?.id;

  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [motorbikeUserId]);

  const bicycleChecklist = await db.query(
    "select doc_type, is_required, label from public.my_delivery_document_checklist('individual','bicycle')",
  );
  const bicycleTypes = bicycleChecklist.rows.map(row => row.doc_type);
  check(
    "a bicycle courier is asked only for identity evidence and a photograph",
    bicycleTypes.includes("national_id") &&
      bicycleTypes.includes("national_id_back") &&
      bicycleTypes.includes("profile_photo") &&
      !bicycleTypes.includes("driving_licence") &&
      !bicycleTypes.includes("vehicle_registration"),
    bicycleTypes.join(", "),
  );
  check(
    "every bicycle requirement is mandatory",
    bicycleChecklist.rows.every(row => row.is_required),
    JSON.stringify(bicycleChecklist.rows.map(row => [row.doc_type, row.is_required])),
  );

  const motorbikeChecklist = await db.query(
    "select doc_type, document_id, status, is_required from public.my_delivery_document_checklist('individual','motorbike')",
  );
  const motorbikeTypes = motorbikeChecklist.rows.map(row => row.doc_type);
  check(
    "a motorbike courier must supply a licence and a registration",
    motorbikeTypes.includes("driving_licence") &&
      motorbikeTypes.includes("vehicle_registration") &&
      motorbikeTypes.includes("national_id"),
    motorbikeTypes.join(", "),
  );
  check(
    "a document nobody supplied is reported as missing, not satisfied",
    motorbikeChecklist.rows.every(row => row.status === "missing" && row.document_id === null),
    JSON.stringify(motorbikeChecklist.rows.map(row => row.status)),
  );
  check(
    "insurance stays optional until the owner makes that policy decision",
    motorbikeChecklist.rows.filter(row => row.doc_type === "vehicle_insurance").length === 0 ||
      motorbikeChecklist.rows.find(row => row.doc_type === "vehicle_insurance").is_required === false,
    JSON.stringify(motorbikeChecklist.rows.map(row => [row.doc_type, row.is_required])),
  );

  const motorbikeBase = {
    full_name: "Motorbike Courier",
    phone: "+254700000003",
    id_type: "national_id",
    id_number: "55556666",
    operating_area: "Nairobi",
    mode: "individual",
    origin_location_id: routeOrigin,
    destination_location_id: routeDestination,
    vehicle: {
      class_code: "motorbike",
      make_model: "Honda CG 125",
      plate_number: "KDA 001A",
      ownership_status: "owned",
      licence_number: "DL-112233",
      licence_class: "A",
      licence_expiry: "2030-06-30",
    },
  };
  const motorbikeAllDocs = [
    { doc_type: "national_id", storage_path: `delivery/${motorbikeUserId}/id-front.jpg` },
    { doc_type: "national_id_back", storage_path: `delivery/${motorbikeUserId}/id-back.jpg` },
    { doc_type: "profile_photo", storage_path: `delivery/${motorbikeUserId}/selfie.jpg` },
    { doc_type: "driving_licence", storage_path: `delivery/${motorbikeUserId}/licence.jpg` },
    { doc_type: "vehicle_registration", storage_path: `delivery/${motorbikeUserId}/logbook.jpg` },
  ];

  async function submitAttempt(payload) {
    return db
      .query("select * from public.submit_deliverer_application('individual', $1::jsonb, 'deliverer-terms-v1')", [
        JSON.stringify(payload),
      ])
      .then(() => "")
      .catch(error => String(error.message));
  }

  const missingLicenceDoc = await submitAttempt({
    ...motorbikeBase,
    documents: motorbikeAllDocs.filter(doc => doc.doc_type !== "driving_licence"),
  });
  check(
    "a motor-vehicle application is refused without the licence document",
    missingLicenceDoc.includes("Upload the required document") && missingLicenceDoc.includes("licence"),
    missingLicenceDoc,
  );

  const noGhostApplication = Number(
    await scalar(`select count(*)::int as value from public.provider_applications where user_id = '${motorbikeUserId}'`),
  );
  check("a refused submission leaves no half-written application", noGhostApplication === 0, String(noGhostApplication));

  const expiredLicence = await submitAttempt({
    ...motorbikeBase,
    vehicle: { ...motorbikeBase.vehicle, licence_expiry: "2020-01-01" },
    documents: motorbikeAllDocs,
  });
  check("an expired licence is refused server-side", expiredLicence.includes("expired"), expiredLicence);

  const noLicenceNumber = await submitAttempt({
    ...motorbikeBase,
    vehicle: { ...motorbikeBase.vehicle, licence_number: "" },
    documents: motorbikeAllDocs,
  });
  check(
    "a motor-vehicle application needs the licence number itself",
    noLicenceNumber.includes("licence number"),
    noLicenceNumber,
  );

  const noIdentityNumber = await submitAttempt({
    ...motorbikeBase,
    id_number: "",
    documents: motorbikeAllDocs,
  });
  check(
    "an application without an identity document number is refused",
    noIdentityNumber.includes("identity document number"),
    noIdentityNumber,
  );

  const foreignFolder = await submitAttempt({
    ...motorbikeBase,
    documents: [
      ...motorbikeAllDocs.filter(doc => doc.doc_type !== "national_id"),
      { doc_type: "national_id", storage_path: "delivery/00000000-0000-4000-8000-000000000000/id.jpg" },
    ],
  });
  check("a document from another account's folder is refused", foreignFolder.includes("own private folder"), foreignFolder);

  const fleetDocOnIndividual = await submitAttempt({
    ...motorbikeBase,
    documents: [
      ...motorbikeAllDocs,
      { doc_type: "business_registration", storage_path: `delivery/${motorbikeUserId}/brs.jpg` },
    ],
  });
  check(
    "a fleet document cannot ride on an individual application",
    fleetDocOnIndividual.includes("fleet document"),
    fleetDocOnIndividual,
  );

  const motorbikeSubmitted = await db.query(
    "select * from public.submit_deliverer_application('individual', $1::jsonb, 'deliverer-terms-v1')",
    [JSON.stringify({ ...motorbikeBase, documents: motorbikeAllDocs })],
  );
  const motorbikeApplicationId = motorbikeSubmitted.rows[0].application_id;
  const motorbikeVehicleId = (
    await db.query(
      "select id from public.transport_vehicles where user_id = $1 order by created_at desc limit 1",
      [motorbikeUserId],
    )
  ).rows[0]?.id;
  check(
    "a complete motor-vehicle application writes the application and its vehicle together",
    Boolean(motorbikeApplicationId) && Boolean(motorbikeVehicleId),
    JSON.stringify(motorbikeSubmitted.rows[0]),
  );

  const pendingVehicle = await db.query(
    "select verification_status from public.transport_vehicles where id = $1",
    [motorbikeVehicleId],
  );
  check("the vehicle enters pending verification, not approved", pendingVehicle.rows[0].verification_status === "pending");

  const submittedDocs = await db.query("select status from public.delivery_documents where user_id = $1", [
    motorbikeUserId,
  ]);
  check(
    "every submitted document enters pending review",
    submittedDocs.rows.length === motorbikeAllDocs.length && submittedDocs.rows.every(row => row.status === "pending"),
    `${submittedDocs.rows.length} rows`,
  );

  const afterSubmitChecklist = await db.query(
    "select doc_type, status, is_required from public.my_delivery_document_checklist()",
  );
  check(
    "the checklist resolves from the submitted application",
    afterSubmitChecklist.rows.length > 0 &&
      afterSubmitChecklist.rows
        .filter(row => row.is_required)
        .every(row => row.status === "pending") &&
      afterSubmitChecklist.rows.some(row => row.doc_type === "driving_licence"),
    JSON.stringify(afterSubmitChecklist.rows.map(row => [row.doc_type, row.status, row.is_required])),
  );
  check(
    "an optional document that was not supplied is listed without failing the application",
    afterSubmitChecklist.rows
      .filter(row => !row.is_required)
      .every(row => row.status === "missing"),
    JSON.stringify(afterSubmitChecklist.rows.filter(row => !row.is_required).map(row => row.status)),
  );

  const duplicateAttach = await db
    .query("select public.attach_my_delivery_document('national_id', $1)", [`delivery/${motorbikeUserId}/id-front-2.jpg`])
    .then(() => false)
    .catch(() => true);
  check("a document already awaiting review cannot be silently replaced", duplicateAttach);

  const routeBeforeApproval = await db
    .query("select public.publish_my_delivery_route()")
    .then(() => false)
    .catch(() => true);
  check("an unapproved provider cannot publish the declared route", routeBeforeApproval);

  // Reject the identity document as a reviewer, then replace it from the applicant's side.
  const identityDocumentId = (
    await db.query(
      "select id from public.delivery_documents where user_id = $1 and doc_type = 'national_id' order by created_at desc limit 1",
      [motorbikeUserId],
    )
  ).rows[0].id;

  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [ownerId]);
  await db.query("select set_config('request.jwt.claim.aal', 'aal2', false)");
  await db.query("select public.admin_review_delivery_document($1, false, 'The photo is out of focus.')", [
    identityDocumentId,
  ]);

  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [motorbikeUserId]);
  const rejectedChecklist = await db.query(
    "select doc_type, status, reviewer_note from public.my_delivery_document_checklist()",
  );
  check(
    "a rejected document is reported with its reason, not as satisfied",
    rejectedChecklist.rows.find(row => row.doc_type === "national_id")?.status === "rejected" &&
      rejectedChecklist.rows.find(row => row.doc_type === "national_id")?.reviewer_note === "The photo is out of focus.",
    JSON.stringify(rejectedChecklist.rows.map(row => [row.doc_type, row.status])),
  );

  const replacementId = (
    await db.query("select public.attach_my_delivery_document('national_id', $1) as id", [
      `delivery/${motorbikeUserId}/id-front-retake.jpg`,
    ])
  ).rows[0].id;
  check("a rejected document can be replaced without a new application", Boolean(replacementId));
  const replacementStatus = await db.query("select status from public.delivery_documents where id = $1", [
    replacementId,
  ]);
  check("the replacement starts pending, never approved", replacementStatus.rows[0].status === "pending");
  const repairedChecklist = await db.query("select status from public.my_delivery_document_checklist() where doc_type = 'national_id'");
  check(
    "the checklist shows the newest upload",
    repairedChecklist.rows[0].status === "pending",
    repairedChecklist.rows[0].status,
  );

  // Approval is what unlocks route publishing. The status-transition trigger refuses a plain
  // UPDATE unless the actor is the allowlisted owner, so approval goes through that same path.
  await db.exec("set role authenticated");
  await asUser(ownerId, "aal2");
  const ownerApproval = await db.query(
    `update public.provider_applications
     set status = 'approved', reviewed_at = now(), reviewed_by = '${ownerId}'
     where id = $1 and status = 'pending'
     returning status`,
    [motorbikeApplicationId],
  );
  check(
    "an authorized owner approves the completed application",
    ownerApproval.rows[0]?.status === "approved",
    JSON.stringify(ownerApproval.rows[0] ?? null),
  );
  await asUser(motorbikeUserId);
  const publishedRoute = (
    await db.query("select public.publish_my_delivery_route() as id")
  ).rows[0].id;
  check("an approved provider can publish the route they declared", Boolean(publishedRoute));
  const routeRow = await db.query("select origin_location_id, destination_location_id from public.delivery_provider_routes where id = $1", [
    publishedRoute,
  ]);
  check(
    "the published route matches the declared counties",
    routeRow.rows[0]?.origin_location_id === routeOrigin &&
      routeRow.rows[0]?.destination_location_id === routeDestination,
  );
  const republished = (
    await db.query("select public.publish_my_delivery_route() as id")
  ).rows[0].id;
  check("republishing the same route does not duplicate it", republished === publishedRoute);

  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', '', false)");

  console.log("\n== customer home personalization (0035) ==");

  // A second, service-division provider so the ranking can genuinely prefer one category over
  // another. Approval and category activation are separate steps, exactly as in production.
  const serviceApplicationId = await scalar(`
    insert into public.provider_applications (user_id, activity_type, status, business_name, submitted_at)
    values ('${courierId}', 'service_provider', 'approved', 'Fixture Salon', now())
    returning id::text as value
  `);
  await asUser(ownerId, "aal2");
  const serviceActivityId = await scalar(
    `select public.admin_grant_provider_activity('${serviceApplicationId}', '${serviceCategory}', array['booking'], 1)::text as value`,
  );

  const homeListing = async (
    title,
    categoryId,
    price,
    { status = "published", county = "Nairobi", owner = strangerId, application = applicationId, activity = activityId, transactionType = "sale" } = {},
  ) =>
    scalar(`
      insert into public.listings (
        owner_id, category_id, provider_application_id, provider_activity_id, transaction_type,
        title, description, status, price_minor, currency, attributes, published_at
      ) values (
        '${owner}', '${categoryId}', '${application}', '${activity}', '${transactionType}',
        '${title}', 'Fixture listing for home ranking',
        '${status}', ${price}, 'KES', '{"county":"${county}"}'::jsonb,
        ${status === "published" ? "now()" : "null"}
      ) returning id::text as value
    `);

  const bystanderId = "77777777-7777-4777-8777-777777777777";
  await db.exec(`
    insert into auth.users (id, email, email_confirmed_at)
    values ('${bystanderId}', 'bystander@example.com', now())
    on conflict (id) do nothing;
  `);

  const cheapProduct = await homeListing("Affordable bracelet", productCategory, 25000);
  const midProduct = await homeListing("Beaded bracelet set", productCategory, 27000);
  const pricyService = await homeListing("Premium salon visit", serviceCategory, 500000, {
    owner: courierId,
    application: serviceApplicationId,
    activity: serviceActivityId,
    transactionType: "booking",
  });
  const draftProduct = await homeListing("Unpublished bracelet", productCategory, 26000, { status: "draft" });
  const coastProduct = await homeListing("Coastal bracelet", productCategory, 24000, { county: "Mombasa" });
  await asUser(strangerId);

  await db.query("select set_config('request.jwt.claim.sub', '', false)");
  await expectFailure(`select public.customer_home(null, 8)`, "a signed-out caller cannot load a dashboard");

  await asUser(bystanderId);
  const fresh = JSON.parse(await scalar(`select public.customer_home(null, 8)::text as value`));
  check("a new account reports no browsing history", fresh.has_history === false, String(fresh.has_history));
  check(
    "a new account still gets real published listings as a fallback",
    Array.isArray(fresh.recommendations) && fresh.recommendations.length >= 3,
    String(fresh.recommendations?.length),
  );
  const freshIds = (fresh.recommendations ?? []).map(item => item.id);
  check("a draft listing is never recommended", !freshIds.includes(draftProduct), draftProduct);
  check("a published listing is recommended", freshIds.includes(cheapProduct), freshIds.join(","));

  const recordedView = await scalar(`select public.record_listing_view('${pricyService}') as value`);
  check("a detail view is recorded for the signed-in viewer", recordedView === true, String(recordedView));
  const duplicateView = await scalar(`select public.record_listing_view('${pricyService}') as value`);
  check("reading the same listing again inside 30 minutes is deduplicated", duplicateView === false, String(duplicateView));

  const engaged = JSON.parse(await scalar(`select public.customer_home(null, 8)::text as value`));
  check("recorded activity makes the account personalised", engaged.has_history === true, String(engaged.has_history));
  check(
    "the viewed category becomes the leading interest",
    engaged.interests?.[0]?.category_id === serviceCategory,
    JSON.stringify(engaged.interests),
  );
  check(
    "ranking promotes the viewed category",
    engaged.recommendations?.[0]?.category_id === serviceCategory,
    JSON.stringify(engaged.recommendations?.[0] ?? null),
  );
  check(
    "recently viewed lists the listing the customer opened",
    (engaged.recently_viewed ?? []).some(item => item.id === pricyService),
    JSON.stringify(engaged.recently_viewed),
  );

  // A price-band preference must not exclude different prices entirely.
  const rankedIds = (engaged.recommendations ?? []).map(item => item.id);
  check(
    "price-band preference does not collapse the feed to one price",
    rankedIds.includes(cheapProduct) || rankedIds.includes(midProduct),
    rankedIds.join(","),
  );
  check(
    "listings from another county remain eligible",
    rankedIds.includes(coastProduct),
    rankedIds.join(","),
  );

  const areaSet = JSON.parse(
    await scalar(`select row_to_json(t)::text as value from public.set_customer_area('Nairobi') t`),
  );
  check("a real county can be saved as the home area", areaSet.home_county === "Nairobi", JSON.stringify(areaSet));
  await expectFailure(
    `select public.set_customer_area('Atlantis')`,
    "an invented county is rejected",
  );

  const inArea = JSON.parse(await scalar(`select public.customer_home(null, 8)::text as value`));
  check("the saved area is applied to the dashboard", inArea.area === "Nairobi", String(inArea.area));
  check(
    "the nearby row only lists listings from that area",
    (inArea.nearby ?? []).length > 0 && (inArea.nearby ?? []).every(item => item.county === "Nairobi"),
    JSON.stringify(inArea.nearby),
  );

  await db.query(`select public.set_customer_area(null, false)`);
  const optedOut = JSON.parse(await scalar(`select public.customer_home(null, 8)::text as value`));
  check("opting out stops history-based ranking", optedOut.has_history === false, String(optedOut.has_history));
  check("opting out keeps real listings on the page", (optedOut.recommendations ?? []).length > 0, "empty");

  // Another signed-in account must not read this history, and must not see its own listing promoted.
  await db.exec("set role authenticated");
  await asUser(courierId);
  const foreignHistory = await scalar(`select count(*)::int as value from public.search_events`);
  check("another account cannot read this customer's history", Number(foreignHistory) === 0, String(foreignHistory));
  const ownerHome = JSON.parse(await scalar(`select public.customer_home(null, 8)::text as value`));
  const ownerIds = (ownerHome.recommendations ?? []).map(item => item.id);
  check("a provider is never recommended their own listing", !ownerIds.includes(pricyService), ownerIds.join(","));
  await db.exec("reset role");

  await asUser(bystanderId);
  const cleared = Number(await scalar(`select public.clear_my_marketplace_history() as value`));
  check("clearing history detaches this account's events", cleared >= 1, String(cleared));
  const remaining = Number(
    await scalar(`select count(*)::int as value from public.search_events where user_id = '${bystanderId}'`),
  );
  check("cleared history leaves nothing attributed to the account", remaining === 0, String(remaining));
  const anonymousKept = Number(
    await scalar(`select count(*)::int as value from public.search_events where user_id is null and event_type = 'listing_view'`),
  );
  check("cleared events stay as anonymous demand rows", anonymousKept >= 1, String(anonymousKept));
  const clearedPrefs = Number(
    await scalar(`select count(*)::int as value from public.customer_preferences where user_id = '${bystanderId}'`),
  );
  check("clearing history also removes the saved area", clearedPrefs === 0, String(clearedPrefs));

  await db.query("select set_config('request.jwt.claim.sub', '', false)");
  await db.query("select set_config('request.jwt.claim.aal', 'aal1', false)");

  console.log("\n== in-app notifications (0036) ==");

  const orderIdForLink = await scalar(`
    insert into public.orders (
      order_number, customer_id, status, payment_status, currency, subtotal_minor,
      delivery_fee_minor, total_minor, commission_minor, commission_rate_bps, commission_base_minor,
      delivery_method
    ) values (
      'SX-NOTIFY-0036', '${bystanderId}', 'paid', 'paid', 'KES', 100000,
      0, 100000, 10000, 1000, 100000, 'pickup'
    ) returning id::text as value
  `);

  const ownNotification = await scalar(`
    insert into public.notification_outbox (user_id, template, payload)
    values ('${bystanderId}', 'order_status', jsonb_build_object('order_id', '${orderIdForLink}', 'status', 'paid'))
    returning id::text as value
  `);
  const applicationNotification = await scalar(`
    insert into public.notification_outbox (user_id, template, payload)
    values ('${bystanderId}', 'application_status', jsonb_build_object('activity_type', 'transport_partner', 'status', 'approved'))
    returning id::text as value
  `);
  const foreignNotification = await scalar(`
    insert into public.notification_outbox (user_id, template, payload)
    values ('${courierId}', 'ride_status', jsonb_build_object('ride_number', 'RIDE-1', 'status', 'accepted'))
    returning id::text as value
  `);
  const malformedLinkNotification = await scalar(`
    insert into public.notification_outbox (user_id, template, payload)
    values ('${bystanderId}', 'order_status', jsonb_build_object('order_id', '../admin', 'status', 'preparing'))
    returning id::text as value
  `);

  await db.query("select set_config('request.jwt.claim.sub', '', false)");
  await expectFailure(
    `select public.my_notifications(30)`,
    "a signed-out caller cannot read notifications",
  );

  await asUser(bystanderId);
  const unreadBefore = Number(await scalar(`select public.unread_notification_count() as value`));
  check("unread notifications are counted for the recipient", unreadBefore === 3, String(unreadBefore));

  const feed = JSON.parse(await scalar(`select public.my_notifications(30)::text as value`));
  check("only the caller's notifications are returned", feed.length === 3, String(feed.length));
  check(
    "a notification never echoes its raw payload",
    feed.every(item => !("payload" in item) && !("recipient" in item)),
    JSON.stringify(Object.keys(feed[0] ?? {})),
  );
  check(
    "a delivery application links to the deliverer workspace",
    feed.find(item => item.template === "application_status")?.link === "/deliver",
    JSON.stringify(feed.map(item => item.link)),
  );
  check(
    "an order notification links to that order only when the id is well formed",
    feed.find(item => item.id === Number(ownNotification))?.link === `/account/orders/${orderIdForLink}` &&
      feed.find(item => item.id === Number(malformedLinkNotification))?.link === "/account/orders",
    JSON.stringify(feed.map(item => item.link)),
  );
  check(
    "notification bodies are written server-side from known fields",
    feed.find(item => item.template === "order_status" && item.id === Number(ownNotification))?.body ===
      "Order  is now paid.",
    JSON.stringify(feed.find(item => item.template === "order_status")?.body),
  );

  const marked = await scalar(`select public.mark_notification_read(${ownNotification}) as value`);
  check("the recipient can acknowledge a notification", marked === true, String(marked));
  const afterOne = Number(await scalar(`select public.unread_notification_count() as value`));
  check("acknowledging decrements the unread count", afterOne === 2, String(afterOne));

  const foreignMark = await scalar(`select public.mark_notification_read(${foreignNotification}) as value`);
  check("another account's notification cannot be acknowledged", foreignMark === false, String(foreignMark));
  const foreignReadAt = await scalar(
    `select coalesce(read_at::text, 'unread') as value from public.notification_outbox where id = ${foreignNotification}`,
  );
  check("the foreign row is left untouched", foreignReadAt === "unread", String(foreignReadAt));

  const markedAll = Number(await scalar(`select public.mark_all_notifications_read() as value`));
  check("mark-all acknowledges every remaining own row", markedAll === 2, String(markedAll));
  const afterAll = Number(await scalar(`select public.unread_notification_count() as value`));
  check("nothing is left unread after mark-all", afterAll === 0, String(afterAll));

  // Row-level security, not just the functions: a signed-in client may only see its own rows.
  await db.exec("set role authenticated");
  await asUser(bystanderId);
  const visibleRows = Number(await scalar(
    `select count(*)::int as value from public.notification_outbox where user_id = '${courierId}'`,
  ));
  check("a client cannot select another account's notification rows", visibleRows === 0, String(visibleRows));
  await db.exec("reset role");

  await db.query("select set_config('request.jwt.claim.sub', '', false)");

  console.log("\n== web push subscriptions (0038) ==");

  const pushUserId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const pushStrangerId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  await db.exec(`
    insert into auth.users (id, email, email_confirmed_at) values
      ('${pushUserId}', 'push@example.com', now()),
      ('${pushStrangerId}', 'push-stranger@example.com', now())
    on conflict (id) do nothing;
  `);

  await db.query("select set_config('request.jwt.claim.sub', '', false)");
  const anonSubscribe = await db
    .query("select public.save_push_subscription('https://push.example/anon','a'.repeat(30),'b'.repeat(20),null)")
    .then(() => false)
    .catch(() => true);
  check("a signed-out caller cannot register a push subscription", anonSubscribe);

  const endpoint = `https://push.example/${pushUserId}/device-1`;
  const keyA = "BOr6n0N1K7Bm0Q3y9k1N4m2P8q5R7s0T6u3V9w1X2y4Z";
  const authA = "5k2L9m4N7p1Q8r3S6t0U";

  await db.exec("set role authenticated");
  await asUser(pushUserId);
  const subscriptionId = (
    await db.query("select public.save_push_subscription($1,$2,$3,'test-agent') as id", [endpoint, keyA, authA])
  ).rows[0].id;
  check("a signed-in user can register this browser for push", Boolean(subscriptionId));
  const pushCount = Number(await scalar("select public.my_push_subscription_count() as value"));
  check("the subscription is counted for its owner", pushCount === 1, String(pushCount));

  await asUser(pushStrangerId);
  const hijack = await db
    .query("select public.save_push_subscription($1,$2,$3,null)", [endpoint, keyA, authA])
    .then(() => false)
    .catch(() => true);
  check("another account cannot claim an existing browser endpoint", hijack);

  const strangerSees = Number(
    await scalar(`select count(*)::int as value from public.push_subscriptions where user_id = '${pushUserId}'`),
  );
  check("a client cannot read another account's push subscription", strangerSees === 0, String(strangerSees));
  check(
    "a client cannot insert a subscription row directly",
    await db
      .query(
        `insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
         values ('${pushStrangerId}', 'https://push.example/direct', '${keyA}', '${authA}')`,
      )
      .then(() => false)
      .catch(() => true),
  );

  await db.exec("reset role");
  await asUser(pushUserId);
  await db.query("select public.enqueue_notification($1, 'delivery_offer', $2::jsonb)", [
    pushUserId,
    JSON.stringify({ delivery_id: "11111111-1111-4111-8111-111111111111", offer_id: "22222222-2222-4222-8222-222222222222" }),
  ]);
  const pushRow = await db.query(
    `select id, channel, status, payload from public.notification_outbox
     where user_id = $1 and channel = 'push' order by id desc limit 1`,
    [pushUserId],
  );
  check(
    "a live subscription queues exactly one push row for the event",
    pushRow.rows.length === 1 && pushRow.rows[0].status === "queued",
    JSON.stringify(pushRow.rows[0] ?? null),
  );

  const pushFeed = (
    await db.query("select public.my_notifications(10) as feed")
  ).rows[0].feed;
  const offerItem = pushFeed.find(item => item.template === "delivery_offer");
  check(
    "the offer notification renders for the rider",
    offerItem?.title === "New delivery job" && offerItem?.link === "/deliver/jobs",
    JSON.stringify(offerItem ?? null),
  );
  const renderedDirectly = (
    await db.query("select public.render_notification('delivery_offer', $1::jsonb, $2) as value", [
      JSON.stringify({ delivery_id: "11111111-1111-4111-8111-111111111111" }),
      pushUserId,
    ])
  ).rows[0].value;
  check(
    "push and the inbox share one rendering",
    renderedDirectly.title === offerItem.title &&
      renderedDirectly.body === offerItem.body &&
      renderedDirectly.link === offerItem.link,
    JSON.stringify(renderedDirectly),
  );
  check(
    "an offer notification never carries a customer address or phone number",
    !JSON.stringify(offerItem).match(/@|\+254|road|street|estate/i),
    JSON.stringify(offerItem),
  );

  const revoked = await db.query("select public.revoke_push_subscription($1) as value", [endpoint]);
  check("the owner can revoke their own subscription", revoked.rows[0].value === true);
  const afterRevokeCount = Number(await scalar("select public.my_push_subscription_count() as value"));
  check("a revoked subscription is no longer counted", afterRevokeCount === 0, String(afterRevokeCount));

  const strangerRevokes = await db.query(
    "select set_config('request.jwt.claim.sub', $1, false)",
    [pushStrangerId],
  );
  void strangerRevokes;
  const foreignRevoke = await db.query("select public.revoke_push_subscription($1) as value", [endpoint]);
  check("another account cannot revoke this subscription", foreignRevoke.rows[0].value === false);

  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [pushUserId]);
  const pushRowsBefore = Number(
    await scalar(`select count(*)::int as value from public.notification_outbox where user_id = '${pushUserId}' and channel = 'push'`),
  );
  await db.query("select public.enqueue_notification($1, 'delivery_offer', $2::jsonb)", [
    pushUserId,
    JSON.stringify({ delivery_id: "33333333-3333-4333-8333-333333333333" }),
  ]);
  const pushRowsAfter = Number(
    await scalar(`select count(*)::int as value from public.notification_outbox where user_id = '${pushUserId}' and channel = 'push'`),
  );
  check(
    "a revoked device queues no further push rows",
    pushRowsAfter === pushRowsBefore,
    `${pushRowsBefore} -> ${pushRowsAfter}`,
  );

  await db.exec("reset role");
  check(
    "the dispatcher role may claim and settle queued rows",
    await scalar(
      "select (has_table_privilege('service_role','public.notification_outbox','select') and has_table_privilege('service_role','public.notification_outbox','update')) as value",
    ) === true,
  );
  check(
    "the dispatcher role may read subscriptions to fan out",
    await scalar("select has_table_privilege('service_role','public.push_subscriptions','select') as value") === true,
  );
  await db.query("select set_config('request.jwt.claim.sub', '', false)");

  console.log("\n== notification dispatch leases (0039) ==");
  check(
    "the queue is claimed through one channel-scoped function",
    (await scalar(
      "select count(*)::int as value from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'claim_notification_batch' and p.pronargs = 3",
    )) === 1,
  );
  check(
    "a browser session cannot claim the queue",
    (await scalar("select has_function_privilege('authenticated','public.claim_notification_batch(text,integer,integer)','execute') as value")) === false,
  );
  check(
    "the server dispatcher may claim the queue",
    (await scalar("select has_function_privilege('service_role','public.claim_notification_batch(text,integer,integer)','execute') as value")) === true,
  );

  const leasePush = await db.query(
    "insert into public.notification_outbox (channel, template) values ('push', 'job_offer') returning id",
  );
  const leaseEmail = await db.query(
    "insert into public.notification_outbox (channel, template, recipient) values ('email', 'order_paid', 'lease@example.com') returning id",
  );
  const pushId = Number(leasePush.rows[0].id);
  const emailId = Number(leaseEmail.rows[0].id);

  const emailClaim = await db.query("select id, channel, attempts, status from public.claim_notification_batch('email', 50, 600)");
  check(
    "an email claim never takes a queued push row",
    emailClaim.rows.every(row => row.channel === 'email') && !emailClaim.rows.some(row => Number(row.id) === pushId),
    JSON.stringify(emailClaim.rows.map(row => row.channel)),
  );
  check(
    "the push row is still queued and untried after an email drain",
    Number(await scalar(`select attempts as value from public.notification_outbox where id = ${pushId}`)) === 0 &&
      (await scalar(`select status as value from public.notification_outbox where id = ${pushId}`)) === 'queued',
  );

  const pushClaim = await db.query("select id, attempts, status from public.claim_notification_batch('push', 50, 600)");
  check(
    "a push drain claims its own row and counts the attempt",
    pushClaim.rows.some(row => Number(row.id) === pushId && Number(row.attempts) === 1 && row.status === 'sending'),
    JSON.stringify(pushClaim.rows.filter(row => Number(row.id) === pushId)),
  );

  await db.query(
    `update public.notification_outbox set status = 'sending', attempts = 1, next_attempt_at = now() - interval '1 minute' where id = ${pushId}`,
  );
  const reclaimed = await db.query("select id, attempts, status from public.claim_notification_batch('push', 50, 600)");
  check(
    "a claim abandoned by a dead dispatcher is retried, not lost",
    reclaimed.rows.some(row => Number(row.id) === pushId && Number(row.attempts) === 2),
    JSON.stringify(reclaimed.rows.filter(row => Number(row.id) === pushId)),
  );

  await db.query(`delete from public.notification_outbox where id in (${pushId}, ${emailId})`);

  console.log("\n== signup path intent (0040) ==");

  // Registration asks which account path a person wants. That answer is stored so support and the
  // next sign-in can see it — it must never approve an application or activate an activity.
  //
  // Two fresh accounts, because the accounts used earlier in this file already hold approved
  // applications and activated activities; a leftover row would make the "intent grants nothing"
  // checks pass for the wrong reason. Every statement runs as `authenticated` where RLS matters.
  const intentUserId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const intentStrangerId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  await db.exec(`
    insert into auth.users (id, email, email_confirmed_at) values
      ('${intentUserId}', 'intent.newcomer@example.com', now()),
      ('${intentStrangerId}', 'intent.stranger@example.com', now())
    on conflict (id) do nothing;
  `);

  await asUser(intentUserId);
  await db.exec("set role authenticated");
  const intentInsert = await db.query(
    `insert into public.user_onboarding (user_id, full_name, account_intent, signup_activity)
     values ('${intentUserId}', 'Intent Holder', 'provider', 'transport_operator')
     returning signup_activity as value`,
  );
  await db.exec("reset role");
  check(
    "a new account can record the path it chose",
    intentInsert.rows[0]?.value === "transport_operator",
    JSON.stringify(intentInsert.rows[0] ?? null),
  );

  await asUser(intentStrangerId);
  await db.exec("set role authenticated");
  await expectFailure(
    `insert into public.user_onboarding (user_id, full_name, account_intent, signup_activity)
     values ('${intentStrangerId}', 'Invented Path', 'provider', 'astronaut')`,
    "an invented account path is rejected by the constraint",
  );
  const foreignIntent = await scalar(
    `select count(*)::int as value from public.user_onboarding where user_id = '${intentUserId}'`,
  );
  await db.exec("reset role");
  check("another account cannot read the recorded intent", Number(foreignIntent) === 0, String(foreignIntent));

  const intentIsNotApproval = await scalar(
    `select public.is_approved_transport_partner('${intentUserId}') as value`,
  );
  check(
    "recording a transport intent does not approve a transport partner",
    intentIsNotApproval === false,
    String(intentIsNotApproval),
  );
  const activitiesForIntent = await scalar(
    `select count(*)::int as value from public.provider_activities where user_id = '${intentUserId}'`,
  );
  check(
    "recording an intent activates no provider activity",
    Number(activitiesForIntent) === 0,
    String(activitiesForIntent),
  );

  console.log("\n== provider live positions and authorized tracking (0041) ==");

  // A live map only means something if every dot on it came from a device that is allowed to
  // publish it and is only visible to the person who is actually on the job.
  const trackOrderId = await scalar(`
    insert into public.orders (
      order_number, customer_id, status, payment_status, currency, subtotal_minor,
      delivery_fee_minor, total_minor, commission_minor, commission_rate_bps, commission_base_minor,
      delivery_method, delivery_address
    ) values (
      'SX-TRACK-0041', '${strangerId}', 'dispatched', 'paid', 'KES', 100000,
      10000, 110000, 10000, 1000, 100000, 'platform_delivery', 'Track drop-off, Nairobi'
    ) returning id::text as value
  `);
  const trackDeliveryId = await scalar(`
    insert into public.deliveries (
      order_id, shipment_number, status, rider_id, delivery_fee_minor, rider_fee_minor, platform_fee_minor,
      pickup_address, dropoff_address
    ) values (
      '${trackOrderId}', 'SHP-TRACK-0041', 'assigned', '${courierId}', 10000, 9000, 1000,
      'Track pickup, Nairobi', 'Track drop-off, Nairobi'
    ) returning id::text as value
  `);

  // An account with no approved provider path cannot obtain a position row at all.
  await asUser(intentStrangerId);
  await db.exec("set role authenticated");
  await expectFailure(
    `select public.publish_provider_position(-1.286400, 36.817200)`,
    "an account with no approved provider path cannot publish a position",
  );
  await db.exec("reset role");

  await asUser(courierId);
  await db.exec("set role authenticated");
  const published = await db.query(
    `select public.publish_provider_position(-1.286400, 36.817200, 12.5) as value`,
  );
  check(
    "an approved rider publishes their own position",
    published.rows[0]?.value?.throttled === false
      && Number(published.rows[0]?.value?.latitude) === -1.2864
      && Number(published.rows[0]?.value?.longitude) === 36.8172,
    JSON.stringify(published.rows[0]?.value ?? null),
  );

  // A watcher firing twice in a tick must not become a write storm, and the answer must say so
  // rather than silently pretending the newest fix was stored.
  const throttled = await db.query(
    `select public.publish_provider_position(-1.300000, 36.800000) as value`,
  );
  check(
    "a second ping inside two seconds is acknowledged but not written",
    throttled.rows[0]?.value?.throttled === true
      && Number(throttled.rows[0]?.value?.latitude) === -1.2864,
    JSON.stringify(throttled.rows[0]?.value ?? null),
  );

  const ownPosition = await db.query(`select public.my_provider_position() as value`);
  check(
    "the rider reads their own live position",
    ownPosition.rows[0]?.value?.sharing === true
      && ownPosition.rows[0]?.value?.position?.stale === false,
    JSON.stringify(ownPosition.rows[0]?.value ?? null),
  );
  await db.exec("reset role");

  // Another account can never read the position table directly.
  await asUser(intentStrangerId);
  await db.exec("set role authenticated");
  const directRows = await scalar(`select count(*)::int as value from public.provider_positions`);
  await db.exec("reset role");
  check("another account sees no position rows through RLS", Number(directRows) === 0, String(directRows));

  // The customer on the assigned delivery does see the rider, and nothing else.
  await asUser(strangerId);
  await db.exec("set role authenticated");
  const customerView = await db.query(
    `select public.delivery_tracking('${trackDeliveryId}') as value`,
  );
  const tracking = customerView.rows[0]?.value ?? null;
  check(
    "the customer sees the live rider position while the delivery is active",
    tracking?.live === true
      && Number(tracking?.position?.latitude) === -1.2864
      && tracking?.position?.stale === false,
    JSON.stringify(tracking),
  );
  check(
    "the customer view carries no identity or contact fields",
    tracking !== null
      && !JSON.stringify(tracking).match(/phone|email|licence|national_id|proof_code/i),
    JSON.stringify(tracking),
  );
  await db.exec("reset role");

  await asUser(intentStrangerId);
  await db.exec("set role authenticated");
  await expectFailure(
    `select public.delivery_tracking('${trackDeliveryId}')`,
    "an unrelated account cannot track someone else's delivery",
  );
  await db.exec("reset role");

  // Passenger rides carry real endpoints, so the read-model can return them.
  const trackRideId = await scalar(`
    insert into public.rides (
      ride_number, customer_id, rider_id, status, ride_mode, pickup_label, dropoff_label,
      pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, proposed_fare_minor, agreed_fare_minor
    ) values (
      'RIDE-TRACK-0041', '${strangerId}', '${courierId}', 'paid', 'motorcycle',
      'Westlands, Nairobi', 'Kilimani, Nairobi', -1.267000, 36.803000, -1.292000, 36.783000,
      7000, 7000
    ) returning id::text as value
  `);

  await asUser(strangerId);
  await db.exec("set role authenticated");
  const rideView = await db.query(`select public.ride_tracking('${trackRideId}') as value`);
  const rideTracking = rideView.rows[0]?.value ?? null;
  check(
    "the passenger sees the agreed ride endpoints and the driver's live position",
    rideTracking?.live === true
      && Number(rideTracking?.pickup_point?.latitude) === -1.267
      && Number(rideTracking?.position?.latitude) === -1.2864,
    JSON.stringify(rideTracking),
  );
  await db.exec("reset role");

  await asUser(intentStrangerId);
  await db.exec("set role authenticated");
  await expectFailure(
    `select public.ride_tracking('${trackRideId}')`,
    "an unrelated account cannot track someone else's ride",
  );
  await db.exec("reset role");

  // Going off duty must remove the position, not merely hide it.
  await asUser(courierId);
  await db.exec("set role authenticated");
  await db.query(`select public.stop_provider_position_sharing()`);
  const afterStop = await db.query(`select public.my_provider_position() as value`);
  check(
    "stopping sharing deletes the stored position",
    afterStop.rows[0]?.value?.sharing === false && afterStop.rows[0]?.value?.position === null,
    JSON.stringify(afterStop.rows[0]?.value ?? null),
  );
  await db.exec("reset role");

  const remainingPositions = await scalar(
    `select count(*)::int as value from public.provider_positions where user_id = '${courierId}'`,
  );
  check("no stale row survives an off-duty toggle", Number(remainingPositions) === 0, String(remainingPositions));

  await asUser(strangerId);
  await db.exec("set role authenticated");
  const afterStopView = await db.query(
    `select public.delivery_tracking('${trackDeliveryId}') as value`,
  );
  check(
    "the customer is told the rider is not sharing instead of shown an old pin",
    afterStopView.rows[0]?.value?.position === null
      && afterStopView.rows[0]?.value?.live === true
      && /not started sharing/i.test(afterStopView.rows[0]?.value?.notice ?? ""),
    JSON.stringify(afterStopView.rows[0]?.value ?? null),
  );
  await db.exec("reset role");

  console.log("\n== delivery coordinates and proximity matching (0042) ==");

  // A coordinate is only useful if it is real, owned by the right party and paired. These checks
  // cover the arithmetic, the two write paths, the all-or-nothing point rules, the prefill trigger
  // and the ranking order that freshness and distance now impose.
  const distance = await scalar(
    `select round(public.geo_distance_km(-1.2864, 36.8172, -4.0435, 39.6682)::numeric, 1) as value`,
  );
  check(
    "Nairobi to Mombasa is about 441 km by great circle",
    Number(distance) > 430 && Number(distance) < 450,
    String(distance),
  );
  const nullDistance = await scalar(`select public.geo_distance_km(null, 36.8, -1.2, 36.9) as value`);
  check("a missing coordinate yields no distance instead of zero", nullDistance === null, String(nullDistance));

  // Customer destination -------------------------------------------------------------
  const coordsSellerId = courierId;
  const coordsOrderId = await scalar(`
    insert into public.orders (
      order_number, customer_id, status, payment_status, currency, subtotal_minor,
      delivery_fee_minor, total_minor, commission_minor, commission_rate_bps, commission_base_minor,
      delivery_method, delivery_address
    ) values (
      'SX-COORD-0042', '${strangerId}', 'paid', 'paid', 'KES', 100000,
      10000, 110000, 10000, 1000, 100000, 'platform_delivery', 'Coordinate drop-off, Nairobi'
    ) returning id::text as value
  `);
  await db.query(`
    insert into public.order_items (
      order_id, owner_id, title_snapshot, unit_price_minor, quantity, line_total_minor,
      commission_minor, provider_net_minor
    ) values ('${coordsOrderId}', '${coordsSellerId}', 'Coordinate item', 100000, 1, 100000, 10000, 90000)
  `);
  const coordsDeliveryId = await scalar(`
    insert into public.deliveries (
      order_id, shipment_number, status, delivery_fee_minor, rider_fee_minor, platform_fee_minor,
      pickup_address, dropoff_address, pickup_location_id, dropoff_location_id
    ) values (
      '${coordsOrderId}', 'SHP-COORD-0042', 'requested', 10000, 9000, 1000,
      'Coordinate pickup, Nairobi', 'Coordinate drop-off, Nairobi', '${nairobi}', '${mombasa}'
    ) returning id::text as value
  `);

  await asUser(strangerId);
  await db.exec("set role authenticated");
  const destinationSet = await db.query(
    `select public.set_delivery_destination('${coordsOrderId}', -1.292100, 36.821900, 15, 'Blue gate') as value`,
  );
  check(
    "the customer confirms their own delivery destination",
    destinationSet.rows[0]?.value?.source === "customer_pin",
    JSON.stringify(destinationSet.rows[0]?.value ?? null),
  );
  // The delivery table itself is not readable by a browser session; every read goes through a
  // participant-scoped function. Drop to the owner role to inspect the stored row.
  await db.exec("reset role");
  const savedDestination = await db.query(
    `select dropoff_lat, dropoff_lng, dropoff_landmark, dropoff_point_source
     from public.deliveries where id = '${coordsDeliveryId}'`,
  );
  check(
    "the destination is stored with its source and landmark",
    Number(savedDestination.rows[0]?.dropoff_lat) === -1.2921
      && savedDestination.rows[0]?.dropoff_landmark === "Blue gate"
      && savedDestination.rows[0]?.dropoff_point_source === "customer_pin",
    JSON.stringify(savedDestination.rows[0] ?? null),
  );
  await db.exec("set role authenticated");
  await expectFailure(
    `select public.set_delivery_destination('${coordsOrderId}', 91, 36.82)`,
    "an out-of-range latitude is refused by the column check",
  );

  await asUser(intentStrangerId);
  await expectFailure(
    `select public.set_delivery_destination('${coordsOrderId}', -1.3, 36.8)`,
    "an unrelated account cannot set someone else's destination",
  );
  await db.exec("reset role");

  // Seller pickup point ---------------------------------------------------------------
  await asUser(coordsSellerId);
  await db.exec("set role authenticated");
  const pickupSet = await db.query(
    `select public.set_delivery_pickup_point('${coordsDeliveryId}', -1.286400, 36.817200, 10, 'Shop front') as value`,
  );
  check(
    "the seller confirms the collection point for their own shipment",
    pickupSet.rows[0]?.value?.source === "seller_pin",
    JSON.stringify(pickupSet.rows[0]?.value ?? null),
  );
  await db.exec("reset role");
  const savedPickup = await db.query(
    `select pickup_lat, pickup_landmark, pickup_point_source
     from public.deliveries where id = '${coordsDeliveryId}'`,
  );
  check(
    "the pickup point keeps its own source and landmark",
    Number(savedPickup.rows[0]?.pickup_lat) === -1.2864
      && savedPickup.rows[0]?.pickup_landmark === "Shop front"
      && savedPickup.rows[0]?.pickup_point_source === "seller_pin",
    JSON.stringify(savedPickup.rows[0] ?? null),
  );
  await db.exec("reset role");

  await asUser(intentStrangerId);
  await db.exec("set role authenticated");
  await expectFailure(
    `select public.set_delivery_pickup_point('${coordsDeliveryId}', -1.28, 36.81)`,
    "a non-seller cannot move another seller's pickup point",
  );
  await expectFailure(
    `select public.set_my_pickup_point(-1.28, 36.81)`,
    "an account with no seller path cannot save a pickup point",
  );
  await db.exec("reset role");

  // A saved point pre-fills new shipments for the same seller ---------------------------
  await asUser(coordsSellerId);
  await db.exec("set role authenticated");
  const savedPoint = await db.query(
    `select public.set_my_pickup_point(-1.290000, 36.820000, 8, 'Back entrance', 'Main branch') as value`,
  );
  check(
    "a seller stores one explicit pickup point",
    Number(savedPoint.rows[0]?.value?.latitude) === -1.29,
    JSON.stringify(savedPoint.rows[0]?.value ?? null),
  );
  await db.exec("reset role");

  const prefillOrderId = await scalar(`
    insert into public.orders (
      order_number, customer_id, status, payment_status, currency, subtotal_minor,
      delivery_fee_minor, total_minor, commission_minor, commission_rate_bps, commission_base_minor,
      delivery_method, delivery_address
    ) values (
      'SX-COORD-PREFILL', '${strangerId}', 'paid', 'paid', 'KES', 100000,
      10000, 110000, 10000, 1000, 100000, 'platform_delivery', 'Prefill drop-off, Nairobi'
    ) returning id::text as value
  `);
  await db.query(`
    insert into public.order_items (
      order_id, owner_id, title_snapshot, unit_price_minor, quantity, line_total_minor,
      commission_minor, provider_net_minor
    ) values ('${prefillOrderId}', '${coordsSellerId}', 'Prefill item', 100000, 1, 100000, 10000, 90000)
  `);
  const prefillDeliveryId = await scalar(`
    insert into public.deliveries (
      order_id, shipment_number, status, delivery_fee_minor, rider_fee_minor, platform_fee_minor,
      pickup_address, dropoff_address
    ) values (
      '${prefillOrderId}', 'SHP-COORD-PREFILL', 'requested', 10000, 9000, 1000,
      'Prefill pickup, Nairobi', 'Prefill drop-off, Nairobi'
    ) returning id::text as value
  `);
  const prefilled = await db.query(
    `select pickup_lat, pickup_point_source, pickup_landmark
     from public.deliveries where id = '${prefillDeliveryId}'`,
  );
  check(
    "a new shipment starts from the seller's own confirmed point",
    Number(prefilled.rows[0]?.pickup_lat) === -1.29
      && prefilled.rows[0]?.pickup_point_source === "seller_pin"
      && prefilled.rows[0]?.pickup_landmark === "Back entrance",
    JSON.stringify(prefilled.rows[0] ?? null),
  );
  const untouchedDestination = await db.query(
    `select dropoff_lat, dropoff_point_source from public.deliveries where id = '${prefillDeliveryId}'`,
  );
  check(
    "the destination stays empty until the customer pins it — it is never guessed",
    untouchedDestination.rows[0]?.dropoff_lat === null
      && untouchedDestination.rows[0]?.dropoff_point_source === "none",
    JSON.stringify(untouchedDestination.rows[0] ?? null),
  );

  // Proximity ranking ------------------------------------------------------------------
  const nearCourierId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const staleCourierId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  await db.exec(`
    insert into auth.users (id, email, email_confirmed_at) values
      ('${nearCourierId}', 'near.courier@example.com', now()),
      ('${staleCourierId}', 'stale.courier@example.com', now())
    on conflict (id) do nothing;
  `);
  for (const rider of [nearCourierId, staleCourierId]) {
    await db.query(
      `insert into public.provider_applications (user_id, activity_type, status, business_name, submitted_at)
       values ($1, 'transport_partner', 'approved', 'Ranking courier', now())`,
      [rider],
    );
    await db.query(
      `insert into public.transport_vehicles
         (user_id, mode, make_model, plate_number, seat_capacity, verification_status,
          vehicle_class_code, payload_kg)
       values ($1, 'motorcycle', 'Ranking Boxer', $2, 1, 'approved', 'motorbike', 40)`,
      [rider, rider === nearCourierId ? "RANK 001A" : "RANK 002A"],
    );
    await db.query(
      `insert into public.delivery_provider_routes (provider_user_id, origin_location_id, destination_location_id)
       values ($1,$2,$3)`,
      [rider, nairobi, mombasa],
    );
  }

  // Pickup is Nairobi CBD. One rider is about 1.7 km away, one is about 30 km away, and one is very
  // near but its fix is twenty minutes old — it must not be treated as current.
  await db.query(
    `update public.deliveries set pickup_lat = -1.286400, pickup_lng = 36.817200 where id = $1`,
    [coordsDeliveryId],
  );
  await db.query(
    `insert into public.provider_positions (user_id, latitude, longitude, accuracy_m, updated_at)
     values
       ('${courierId}', -1.050000, 36.900000, 20, now() - interval '30 seconds'),
       ('${nearCourierId}', -1.300000, 36.810000, 12, now() - interval '25 seconds'),
       ('${staleCourierId}', -1.288000, 36.818000, 30, now() - interval '20 minutes')`,
  );

  await asUser(ownerId, "aal2");
  const ranked = await db.query(
    `select * from public.match_delivery_candidates('${coordsDeliveryId}')`,
  );
  check(
    "all three approved riders remain eligible",
    ranked.rows.length === 3,
    ranked.rows.map(row => row.provider_user_id).join(", "),
  );
  check(
    "the nearest rider with a fresh fix is offered first",
    ranked.rows[0]?.provider_user_id === nearCourierId,
    `first=${ranked.rows[0]?.provider_user_id} distance=${ranked.rows[0]?.reasons?.rider_distance_km}`,
  );
  check(
    "the nearer rider really is nearer on the straight line",
    Number(ranked.rows[0]?.reasons?.rider_distance_km) > 1
      && Number(ranked.rows[0]?.reasons?.rider_distance_km) < 3
      && Number(ranked.rows[1]?.reasons?.rider_distance_km) > 25,
    `near=${ranked.rows[0]?.reasons?.rider_distance_km} far=${ranked.rows[1]?.reasons?.rider_distance_km}`,
  );
  check(
    "distance never outranks freshness: the far fresh rider is still second",
    ranked.rows[1]?.provider_user_id === courierId,
    `second=${ranked.rows[1]?.provider_user_id}`,
  );
  check(
    "a stale fix ranks last and reports no distance",
    ranked.rows[2]?.provider_user_id === staleCourierId
      && ranked.rows[2]?.reasons?.position_fresh === false
      && ranked.rows[2]?.reasons?.rider_distance_km === null,
    JSON.stringify(ranked.rows[2]?.reasons ?? {}),
  );
  check(
    "the ranking says the distance is a straight line",
    ranked.rows[0]?.reasons?.distance_basis === "straight_line"
      && ranked.rows[0]?.reasons?.pickup_point_confirmed === true,
    JSON.stringify(ranked.rows[0]?.reasons ?? {}),
  );

  // A suspended provider drops out of the pool even while the phone keeps reporting a position.
  const suspendedCourierId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  await db.query(
    `insert into auth.users (id, email, email_confirmed_at)
     values ('${suspendedCourierId}', 'suspended.courier@example.com', now())
     on conflict (id) do nothing`,
  );
  await db.query(
    `insert into public.provider_applications (user_id, activity_type, status, business_name, submitted_at)
     values ($1, 'transport_partner', 'suspended', 'Suspended courier', now())`,
    [suspendedCourierId],
  );
  await db.query(
    `insert into public.transport_vehicles
       (user_id, mode, make_model, plate_number, seat_capacity, verification_status,
        vehicle_class_code, payload_kg)
     values ($1, 'motorcycle', 'Suspended Boxer', 'RANK 003A', 1, 'approved', 'motorbike', 40)`,
    [suspendedCourierId],
  );
  await db.query(
    `insert into public.delivery_provider_routes (provider_user_id, origin_location_id, destination_location_id)
     values ($1,$2,$3)`,
    [suspendedCourierId, nairobi, mombasa],
  );
  await db.query(
    `insert into public.provider_positions (user_id, latitude, longitude, accuracy_m, updated_at)
     values ($1, -1.286600, 36.817400, 10, now() - interval '10 seconds')`,
    [suspendedCourierId],
  );
  const afterSuspension = await db.query(
    `select * from public.match_delivery_candidates('${coordsDeliveryId}')`,
  );
  check(
    "a suspended provider is excluded even when it is the closest one sharing a position",
    afterSuspension.rows.length === 3
      && !afterSuspension.rows.some(row => row.provider_user_id === suspendedCourierId),
    afterSuspension.rows.map(row => row.provider_user_id).join(", "),
  );

  // Tracking, destination and the after-collection rule ---------------------------------
  await db.exec("reset role");
  await db.query(
    `update public.deliveries set status = 'collected', rider_id = '${courierId}' where id = $1`,
    [coordsDeliveryId],
  );
  await asUser(strangerId);
  await db.exec("set role authenticated");
  await expectFailure(
    `select public.set_delivery_destination('${coordsOrderId}', -1.3, 36.8)`,
    "a collected parcel can no longer be re-pointed by the customer",
  );
  const tracked = await db.query(`select public.delivery_tracking('${coordsDeliveryId}') as value`);
  const trackedValue = tracked.rows[0]?.value ?? null;
  check(
    "the customer's tracking view now carries the real destination",
    Number(trackedValue?.dropoff_point?.latitude) === -1.2921
      && trackedValue?.dropoff_source === "customer_pin"
      && Number(trackedValue?.pickup_point?.latitude) === -1.2864,
    JSON.stringify(trackedValue),
  );
  check(
    "the live distance is labelled as straight-line and no ETA is invented",
    trackedValue?.distance_basis === "straight_line"
      && typeof trackedValue?.straight_line_km === "number"
      && !("eta" in (trackedValue ?? {}))
      && !("road_distance_km" in (trackedValue ?? {})),
    JSON.stringify(trackedValue),
  );
  check(
    "the tracking payload still carries no document, contact or code fields",
    trackedValue !== null
      && !JSON.stringify(trackedValue).match(/phone|email|licence|national_id|proof_code/i),
    JSON.stringify(trackedValue),
  );
  await db.exec("reset role");

  const historicalOrder = await db.query(
    `select subtotal_minor, delivery_fee_minor, total_minor, commission_minor
     from public.orders where id = '${coordsOrderId}'`,
  );
  check(
    "adding coordinates changed no price on the order",
    Number(historicalOrder.rows[0]?.subtotal_minor) === 100000
      && Number(historicalOrder.rows[0]?.delivery_fee_minor) === 10000
      && Number(historicalOrder.rows[0]?.total_minor) === 110000
      && Number(historicalOrder.rows[0]?.commission_minor) === 10000,
    JSON.stringify(historicalOrder.rows[0] ?? null),
  );
  const deliverySplit = await db.query(
    `select delivery_fee_minor, rider_fee_minor, platform_fee_minor
     from public.deliveries where id = '${coordsDeliveryId}'`,
  );
  check(
    "the delivery fee split is untouched by the coordinate work",
    Number(deliverySplit.rows[0]?.delivery_fee_minor) === 10000
      && Number(deliverySplit.rows[0]?.rider_fee_minor) === 9000
      && Number(deliverySplit.rows[0]?.platform_fee_minor) === 1000,
    JSON.stringify(deliverySplit.rows[0] ?? null),
  );

  console.log("\n== release verifier ==");
  const verifier = fs.readFileSync(path.join(repoRoot, "supabase", "verify_schema.sql"), "utf8");
  const verifyResult = await db.exec(verifier);
  const rows = Array.isArray(verifyResult) ? verifyResult.flatMap(entry => entry.rows ?? []) : [];
  const checkRows = rows.filter(row => row && typeof row.status === "string");
  const failed = checkRows.filter(row => row.status === "FAIL");
  check("verify_schema.sql returns rows", checkRows.length >= 60, `${checkRows.length} rows`);
  check(
    "verify_schema.sql reports no FAIL",
    failed.length === 0,
    failed.map(row => row.check_name).join(", "),
  );

  await db.close();

  console.log(`\n${checks} checks, ${failures} failure(s)`);
  if (failures > 0) {
    console.error("FULL MIGRATION CHAIN FAILED");
    process.exit(1);
  }
  console.log("ALL 0001–0042 MIGRATIONS APPLY CLEANLY");
}

main().catch(error => {
  console.error(error.message);
  console.error("FULL MIGRATION CHAIN FAILED");
  process.exit(1);
});
