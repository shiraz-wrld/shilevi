/**
 * Database integration test for the order and money spine.
 *
 * Runs migrations 0015–0018 inside an in-process PostgreSQL (PGlite), so the RPCs, constraints,
 * triggers and ledger arithmetic are executed for real without touching any Supabase project.
 * The core marketplace tables that these migrations depend on are stubbed because they were
 * created by earlier migrations that are not replayed here.
 *
 * Run with: npm run test:db
 */
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const db = new PGlite();

const stubs = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

create schema if not exists auth;
create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);
create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select jsonb_build_object('aal', coalesce(nullif(current_setting('request.jwt.claim.aal', true), ''), 'aal2'));
$$;
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

-- Production version reads the owner allowlist and requires aal2. The stub lets the test
-- switch the owner identity explicitly instead of seeding real staff accounts.
create or replace function public.is_shilevi_owner_admin() returns boolean
language sql stable as $$
  select coalesce(current_setting('app.is_admin', true), 'false')::boolean;
$$;

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.marketplace_categories (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  division text not null,
  is_active boolean not null default true,
  sort_order integer not null default 0
);

create table public.provider_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  activity_type text not null,
  status text not null
);

create table public.listings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  provider_application_id uuid references public.provider_applications(id),
  category_id uuid references public.marketplace_categories(id),
  title text not null,
  description text,
  status text not null default 'draft',
  price_minor bigint,
  currency char(3) not null default 'KES',
  attributes jsonb not null default '{}'::jsonb,
  approximate_location text,
  brand_id uuid,
  is_featured boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz
);

create table public.user_roles (
  user_id uuid not null references auth.users(id),
  role text not null,
  primary key (user_id, role)
);

create table public.profiles (
  id uuid primary key references auth.users(id),
  display_name text,
  phone text,
  country_code text not null default 'KE'
);

-- Minimal audit table so later owner-read policies can be applied and checked for syntax.
create table public.audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  resource_type text not null,
  resource_id text,
  outcome text not null default 'success',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
`;

await db.exec(stubs);

const migrations = [
  "0015_provider_activities_category_permissions.sql",
  "0016_orders_deliveries.sql",
  "0017_payments_ledger_commission.sql",
  "0018_kenya_locations_coverage.sql",
  "0019_owner_audit_and_order_reads.sql",
  "0020_passenger_transport_rides.sql",
  "0021_house_hunt_payments_staff_notifications.sql",
  "0022_rider_balance_authorization.sql",
  "0023_payment_methods_and_sandbox_switch.sql",
  "0024_storage_buckets_and_policies.sql",
  "0026_refund_decision_execution.sql",
  "0027_platform_settings_access_and_validation.sql",
  "0028_owner_console_read_models.sql",
  "0029_delivery_network_foundation.sql",
  "0030_deliverer_onboarding_documents.sql",
];

for (const name of migrations) {
  const sql = fs.readFileSync(path.join(repoRoot, "supabase/migrations", name), "utf8");
  try {
    await db.exec(sql);
    console.log(`ok ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}: ${error.message}`);
    process.exit(1);
  }
}

// 0023 makes sandbox settlement require an explicit switch. The flow tests deliberately exercise
// sandbox money, so they turn it on; the guard itself is asserted separately below.
await db.query("update public.platform_settings set value = 'true'::jsonb where key = 'allow_mock_payments'");

const CUSTOMER = "11111111-1111-4111-8111-111111111111";
const PROVIDER = "22222222-2222-4222-8222-222222222222";
const RIDER = "33333333-3333-4333-8333-333333333333";
const CATEGORY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const APPLICATION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LISTING = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

await db.exec(`
  insert into auth.users (id, email) values
    ('${CUSTOMER}', 'customer@example.test'),
    ('${PROVIDER}', 'provider@example.test'),
    ('${RIDER}', 'rider@example.test');
  insert into public.user_roles (user_id, role) values ('${RIDER}', 'transport_partner');
  update auth.users set email_confirmed_at = now();
  insert into public.profiles (id, display_name, phone) values
    ('${CUSTOMER}', 'Test Customer', '+254700000001'),
    ('${RIDER}', 'Test Rider', '+254700000002'),
    ('${PROVIDER}', 'Test Landlord', '+254700000003');
  insert into public.marketplace_categories (id, slug, name, division, is_active)
    values ('${CATEGORY}', 'test-products', 'Test Products', 'products', true);
  insert into public.provider_applications (id, user_id, activity_type, status)
    values ('${APPLICATION}', '${PROVIDER}', 'product_seller', 'approved');
  insert into public.listings (
    id, owner_id, provider_application_id, category_id, title, status, price_minor, currency
  ) values (
    '${LISTING}', '${PROVIDER}', '${APPLICATION}', '${CATEGORY}', 'Test Product', 'published', 100000, 'KES'
  );
`);

const asUser = async (id, admin = false) => {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
  await db.query("select set_config('app.is_admin', $1, false)", [admin ? "true" : "false"]);
};

// --- Customer places an order: prices are computed from the database, never trusted from the client.
await asUser(CUSTOMER);
const created = await db.query(
  "select * from public.create_order($1::jsonb, $2, $3, $4, $5)",
  [JSON.stringify([{ listing_id: LISTING, quantity: 2 }]), "platform_delivery", "12 Test Street, Nairobi", "+254700000000", "Leave at reception"]
);
assert.equal(created.rows.length, 1, "order created");
const orderId = created.rows[0].order_id;
console.log("order", created.rows[0].order_number, orderId);

const order = (await db.query("select * from public.orders where id = $1", [orderId])).rows[0];
assert.equal(Number(order.subtotal_minor), 200000);
assert.equal(Number(order.delivery_fee_minor), 10000);
assert.equal(Number(order.total_minor), 210000);
assert.equal(Number(order.commission_minor), 20000);
assert.equal(order.status, "pending_payment");
assert.equal(order.payment_status, "unpaid");

const items = (await db.query("select * from public.order_items where order_id = $1", [orderId])).rows;
assert.equal(items.length, 1);
assert.equal(Number(items[0].provider_net_minor), 180000);
assert.equal(Number(items[0].commission_minor), 20000);

// --- Delivery fee split and handover code.
const delivery = (await db.query("select * from public.deliveries where order_id = $1", [orderId])).rows[0];
const proof = (await db.query("select public.get_delivery_proof_code($1) as code", [orderId])).rows[0].code;
assert.equal(proof, delivery.proof_code);
assert.equal(Number(delivery.delivery_fee_minor), 10000);
assert.equal(Number(delivery.rider_fee_minor), 9000);
assert.equal(Number(delivery.platform_fee_minor), 1000);
assert.match(delivery.proof_code, /^[0-9]{4}$/);

// --- Sandbox payment writes a balanced double-entry ledger; settlement nets to zero.
const reference = await db.query("select public.confirm_mock_payment($1, $2) as ref", [orderId, "TEST-REF-1"]);
assert.equal(reference.rows[0].ref, "TEST-REF-1");
const paid = (await db.query("select * from public.orders where id = $1", [orderId])).rows[0];
assert.equal(paid.status, "paid");
assert.equal(paid.payment_status, "paid");

const totals = (await db.query("select sum(debit_minor)::bigint as d, sum(credit_minor)::bigint as c from public.ledger_entries where order_id = $1", [orderId])).rows[0];
assert.equal(Number(totals.d), Number(totals.c), "ledger balanced");
assert.equal(Number(totals.d), 420000);

const settlement = (await db.query("select sum(credit_minor - debit_minor)::bigint as balance from public.ledger_entries where order_id = $1 and account = 'settlement'", [orderId])).rows[0];
assert.equal(Number(settlement.balance), 0, "settlement clears");

// --- Provider prepares the order.
await asUser(PROVIDER);
for (const next of ["accepted", "preparing", "ready"]) {
  await db.query("select public.provider_update_order_status($1, $2, $3)", [orderId, next, `Moving to ${next}`]);
}

// --- Rider sees the job without the customer's address, then claims it atomically.
await asUser(RIDER);
const available = (await db.query("select * from public.list_available_deliveries()")).rows;
assert.equal(available.length, 1, "available job visible to rider");
assert.equal(available[0].delivery_id, delivery.id);
assert.equal("dropoff_address" in available[0], false, "available job hides the address");
const claimed = await db.query("select * from public.accept_delivery($1)", [delivery.id]);
assert.equal(claimed.rows[0].order_id, orderId);

await asUser(PROVIDER);
await db.query("select public.provider_update_order_status($1, $2, $3)", [orderId, "dispatched", "Handed to rider"]);

// --- Handover requires the proof code; delivery alone does not complete the order.
await asUser(RIDER);
for (const next of ["to_pickup", "collected", "in_transit"]) {
  await db.query("select public.rider_update_delivery($1, $2, null, $3)", [delivery.id, next, next]);
}
await db.query("select public.rider_update_delivery($1, 'delivered', $2, 'Delivered to customer')", [delivery.id, delivery.proof_code]);
const delivered = (await db.query("select * from public.orders where id = $1", [orderId])).rows[0];
assert.equal(delivered.status, "delivered");
assert.equal(delivered.completed_at, null);

await asUser(CUSTOMER);
await db.query("select public.customer_confirm_order($1)", [orderId]);
const completed = (await db.query("select * from public.orders where id = $1", [orderId])).rows[0];
assert.equal(completed.status, "completed");

// --- Refund path: request by customer, decision by owner, ledger reversed.
const refundId = (await db.query("select public.request_order_refund($1, $2) as id", [orderId, "Item arrived damaged"])).rows[0].id;
const pending = (await db.query("select * from public.orders where id = $1", [orderId])).rows[0];
assert.equal(pending.status, "refund_requested");
assert.equal(pending.payment_status, "refund_pending");

await asUser(CUSTOMER, true);
await db.query("select public.admin_decide_refund($1, true, $2)", [refundId, "Approved"]);
const refunded = (await db.query("select * from public.orders where id = $1", [orderId])).rows[0];
assert.equal(refunded.status, "refunded");
assert.equal(refunded.payment_status, "refunded");

const finalTotals = (await db.query("select sum(debit_minor)::bigint as d, sum(credit_minor)::bigint as c from public.ledger_entries where order_id = $1", [orderId])).rows[0];
assert.equal(Number(finalTotals.d), Number(finalTotals.c), "refund ledger balanced");

const net = await db.query(`
  select account, sum(credit_minor - debit_minor)::bigint as balance
  from public.ledger_entries where order_id = $1 group by account order by account
`, [orderId]);
console.log("account balances after refund", net.rows);

const counties = (await db.query("select count(*)::int as c from public.service_locations")).rows[0];
assert.equal(Number(counties.c), 47, "47 counties seeded");

// --- Explicit small-value commission proof: a KSh 50 sale yields KSh 5 platform commission
// and KSh 45 to the provider, calculated in SQL rather than trusted from the browser.
const SMALL_LISTING = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
await db.exec(`
  insert into public.listings (
    id, owner_id, provider_application_id, category_id, title, status, price_minor, currency
  ) values (
    '${SMALL_LISTING}', '${PROVIDER}', '${APPLICATION}', '${CATEGORY}', 'Small Test Product', 'published', 5000, 'KES'
  );
`);
await asUser(CUSTOMER);
const smallOrderId = (await db.query(
  "select * from public.create_order($1::jsonb, $2, $3, $4, $5)",
  [JSON.stringify([{ listing_id: SMALL_LISTING, quantity: 1 }]), "pickup", null, null, null]
)).rows[0].order_id;
const smallOrder = (await db.query("select * from public.orders where id = $1", [smallOrderId])).rows[0];
const smallItem = (await db.query("select * from public.order_items where order_id = $1", [smallOrderId])).rows[0];
assert.equal(Number(smallOrder.subtotal_minor), 5000, "KSh 50 subtotal stored in minor units");
assert.equal(Number(smallOrder.commission_minor), 500, "10% of KSh 50 is KSh 5");
assert.equal(Number(smallItem.provider_net_minor), 4500, "provider keeps KSh 45");
assert.equal(Number(smallOrder.total_minor), 5000, "pickup adds no delivery fee");
console.log("small-order commission: subtotal 5000, commission 500, provider net 4500");

// ============================================================================================
// Passenger transport: a ride is a separate entity with fare negotiation, dual confirmation and
// its own ledger. It must never reuse the delivery state machine.
// ============================================================================================
await asUser(RIDER);
const vehicleId = (await db.query(
  "select public.add_transport_vehicle($1, $2, $3, $4) as id",
  ["motorcycle", "Bajaj Boxer", "KMC 123A", 1]
)).rows[0].id;
let vehicle = (await db.query("select * from public.transport_vehicles where id = $1", [vehicleId])).rows[0];
assert.equal(vehicle.verification_status, "pending", "a self-added vehicle starts pending");

await asUser(CUSTOMER, true);
await db.query("select public.admin_review_transport_vehicle($1, true, $2)", [vehicleId, "Documents checked"]);
vehicle = (await db.query("select * from public.transport_vehicles where id = $1", [vehicleId])).rows[0];
assert.equal(vehicle.verification_status, "approved", "owner approval activates eligibility");

await asUser(CUSTOMER);
const riders = (await db.query("select * from public.list_available_riders($1)", ["motorcycle"])).rows;
assert.equal(riders.length, 1, "approved rider is discoverable");
assert.equal(riders[0].rider_id, RIDER);

const rideId = (await db.query("select public.request_ride($1::jsonb) as id", [JSON.stringify({
  rider_id: RIDER,
  ride_mode: "motorcycle",
  pickup_label: "Kenyatta Avenue, Nairobi CBD",
  dropoff_label: "Mombasa Road, Mlolongo",
  pickup_area: "Nairobi CBD",
  dropoff_area: "Mlolongo",
  proposed_fare_minor: 200000,
  distance_km: 24.5,
})])).rows[0].id;
let ride = (await db.query("select * from public.rides where id = $1", [rideId])).rows[0];
assert.equal(ride.status, "requested");
assert.equal(Number(ride.proposed_fare_minor), 200000, "KSh 2,000 proposal stored in minor units");

// The rider cannot start a trip before a fare is agreed and paid.
await asUser(RIDER);
await assert.rejects(
  () => db.query("select public.ride_rider_progress($1, 'arrived')", [rideId]),
  /cannot move|cannot/i,
  "invalid transition from requested is rejected",
);

// Rider counteroffers KSh 2,200; customer accepts; agreed fare is snapshotted.
await db.query("select public.ride_respond($1, 'counter', $2, $3)", [rideId, 220000, "Fuel is higher today"]);
ride = (await db.query("select * from public.rides where id = $1", [rideId])).rows[0];
assert.equal(ride.status, "countered");
assert.equal(Number(ride.counter_fare_minor), 220000);

await asUser(CUSTOMER);
await assert.rejects(
  () => db.query("select public.confirm_mock_ride_payment($1, $2)", [rideId, "EARLY-REF"]),
  /not awaiting payment|cannot/i,
  "payment before agreement is rejected",
);
await db.query("select public.ride_customer_respond($1, true)", [rideId]);
ride = (await db.query("select * from public.rides where id = $1", [rideId])).rows[0];
assert.equal(ride.status, "agreed");
assert.equal(Number(ride.agreed_fare_minor), 220000);

// 0023: sandbox settlement is refused unless the explicit switch is on, even in mock mode.
await db.query("update public.platform_settings set value = 'false'::jsonb where key = 'allow_mock_payments'");
await assert.rejects(
  () => db.query("select public.confirm_mock_ride_payment($1, $2)", [rideId, "GUARD-REF"]),
  /sandbox payments are disabled/i,
  "mock settlement is refused while the sandbox switch is off",
);
assert.equal(
  (await db.query("select payment_status from public.rides where id = $1", [rideId])).rows[0].payment_status,
  "unpaid",
  "a refused sandbox settlement leaves the ride unpaid",
);
await db.query("update public.platform_settings set value = 'true'::jsonb where key = 'allow_mock_payments'");

const rideRef = (await db.query("select public.confirm_mock_ride_payment($1, $2) as ref", [rideId, "RIDE-TEST-REF-1"])).rows[0].ref;
assert.equal(rideRef, "RIDE-TEST-REF-1");
ride = (await db.query("select * from public.rides where id = $1", [rideId])).rows[0];
assert.equal(ride.status, "paid");
assert.equal(ride.payment_status, "paid");
assert.equal(Number(ride.commission_minor), 22000, "10% of KSh 2,200 is KSh 220");
assert.equal(Number(ride.rider_net_minor), 198000, "rider keeps KSh 1,980");

const rideLedger = (await db.query(
  "select sum(debit_minor)::bigint as d, sum(credit_minor)::bigint as c from public.ledger_entries where ride_id = $1",
  [rideId]
)).rows[0];
assert.equal(Number(rideLedger.d), Number(rideLedger.c), "ride ledger balanced");
assert.equal(Number(rideLedger.d), 4400000 / 10, "ride entries total twice the gross");

// Contact is private until the fare is paid.
const contact = (await db.query("select * from public.get_ride_contact($1)", [rideId])).rows[0];
assert.equal(contact.phone, "+254700000002");

// Both sides must confirm. Rider completes, customer confirms; only then are earnings released.
await asUser(RIDER);
for (const next of ["arrived", "in_progress", "rider_completed"]) {
  await db.query("select public.ride_rider_progress($1, $2)", [rideId, next]);
}
ride = (await db.query("select * from public.rides where id = $1", [rideId])).rows[0];
assert.equal(ride.status, "rider_completed");
assert.ok(ride.rider_confirmed_at);
assert.equal(ride.released_at, null, "earnings are not released on the rider's word alone");

await asUser(CUSTOMER);
await db.query("select public.ride_customer_confirm($1)", [rideId]);
ride = (await db.query("select * from public.rides where id = $1", [rideId])).rows[0];
assert.equal(ride.status, "completed");
assert.ok(ride.released_at);

await db.query("select public.rate_ride($1, $2, $3)", [rideId, 5, "Smooth trip"]);
await assert.rejects(
  () => db.query("select public.rate_ride($1, $2, $3)", [rideId, 4, "Second review"]),
  /already been reviewed/i,
  "one review per ride",
);

// Earnings and withdrawal: available balance comes from the ledger, never from the client.
await asUser(RIDER);
const riderBalance = (await db.query("select public.rider_available_balance() as balance")).rows[0].balance;
assert.equal(Number(riderBalance), 198000, "available balance equals rider net");
await assert.rejects(
  () => db.query("select public.request_rider_payout($1, $2)", [99999999, "+254700000002"]),
  /available balance/i,
  "withdrawal above the ledger balance is rejected",
);
const payoutId = (await db.query("select public.request_rider_payout($1, $2) as id", [100000, "+254700000002"])).rows[0].id;
assert.equal(Number((await db.query("select public.rider_available_balance() as b")).rows[0].b), 98000, "pending payout is reserved");

// 0022: earnings are private to the rider, the owner and finance staff.
await asUser(CUSTOMER);
await assert.rejects(
  () => db.query("select public.rider_available_balance($1) as b", [RIDER]),
  /not authorized/i,
  "a customer cannot read a rider's available balance",
);
await asUser(CUSTOMER, true);
assert.equal(
  Number((await db.query("select public.rider_available_balance($1) as b", [RIDER])).rows[0].b),
  98000,
  "the owner may read a rider balance for reconciliation",
);

await asUser(CUSTOMER, true);
await db.query("select public.admin_update_payout($1, 'processing', $2)", [payoutId, null]);
await db.query("select public.admin_update_payout($1, 'paid', $2)", [payoutId, "MPESA-B2C-TEST-1"]);
// A repeated paid callback must not debit twice.
await db.query("select public.admin_update_payout($1, 'paid', $2)", [payoutId, "MPESA-B2C-TEST-1"]);
const payoutEntries = (await db.query("select count(*)::int as c from public.ledger_entries where payout_id = $1", [payoutId])).rows[0].c;
assert.equal(Number(payoutEntries), 2, "one payout settlement pair only");

await asUser(RIDER);
assert.equal(Number((await db.query("select public.rider_available_balance() as b")).rows[0].b), 98000, "paid withdrawal is deducted once");

// A provider-verified M-Pesa payment follows the same settlement path as the sandbox.
await db.query("update public.platform_settings set value = '\"mpesa\"'::jsonb where key = 'payment_mode'");
await asUser(CUSTOMER);
const ride2 = (await db.query("select public.request_ride($1::jsonb) as id", [JSON.stringify({
  rider_id: RIDER, ride_mode: "motorcycle", pickup_label: "Westlands, Nairobi",
  dropoff_label: "Karen, Nairobi", proposed_fare_minor: 150000,
})])).rows[0].id;
await asUser(RIDER);
await db.query("select public.ride_respond($1, 'accept', null, null)", [ride2]);
await asUser(CUSTOMER);
const intentId = (await db.query("select public.create_payment_intent($1, $2, $3) as id", ["ride", ride2, "ride-2-key"])).rows[0].id;
const intentAgain = (await db.query("select public.create_payment_intent($1, $2, $3) as id", ["ride", ride2, "ride-2-key"])).rows[0].id;
assert.equal(intentAgain, intentId, "idempotency key returns the same intent");
await db.query("select public.attach_payment_provider_reference($1, $2, $3)", [intentId, "MPESA-RIDE-REF-9", "ws_CO_9"]);
const confirmed = (await db.query("select public.confirm_provider_payment($1, $2, $3) as result", ["mpesa", "MPESA-RIDE-REF-9", 150000])).rows[0].result;
assert.equal(confirmed, "succeeded");
const ride2Row = (await db.query("select * from public.rides where id = $1", [ride2])).rows[0];
assert.equal(ride2Row.payment_status, "paid");
assert.equal(ride2Row.payment_provider, "mpesa");
assert.equal(
  (await db.query("select public.confirm_provider_payment($1, $2, $3) as r", ["mpesa", "MPESA-RIDE-REF-9", 150000])).rows[0].r,
  "already-succeeded",
  "duplicate callback does not double-credit",
);

// ============================================================================================
// House Hunt: browsing is free, the KSh 20 fee unlocks contact details only, and Shilevi keeps it.
// ============================================================================================
const PROPERTY_CATEGORY = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const PROPERTY_LISTING = "ffffffff-ffff-4fff-8fff-ffffffffffff";
await db.exec(`
  insert into public.marketplace_categories (id, slug, name, division, is_active)
    values ('${PROPERTY_CATEGORY}', 'test-property', 'Test Property', 'property_places', true);
  insert into public.listings (id, owner_id, provider_application_id, category_id, title, description, status, price_minor, currency)
    values ('${PROPERTY_LISTING}', '${PROVIDER}', '${APPLICATION}', '${PROPERTY_CATEGORY}', 'Two bedroom in Kilimani', 'Quiet apartment', 'draft', 300000, 'KES');
`);

await asUser(PROVIDER);
await db.query("select public.save_property_details($1, $2::jsonb)", [PROPERTY_LISTING, JSON.stringify({
  county: "Nairobi", city: "Nairobi", neighbourhood: "Kilimani", property_type: "apartment",
  bedrooms: 2, bathrooms: 1, rent_minor: 300000, deposit_minor: 300000, is_vacant: true,
  amenities: ["Water", "Parking"], exact_address: "Wood Avenue, House 42B", unit_number: "42B",
  contact_name: "Test Landlord", contact_phone: "+254700000003", contact_email: "landlord@example.test",
})]);
await assert.rejects(
  () => db.query("select public.save_property_details($1, $2::jsonb)", [PROPERTY_LISTING, JSON.stringify({
    county: "Nairobi", city: "Nairobi", property_type: "apartment", rent_minor: 300000,
    exact_address: "x", contact_name: "x", contact_phone: "1",
  })]),
  /phone|address/i,
  "invalid contact details are rejected",
);
await db.query("update public.listings set status = 'published' where id = $1", [PROPERTY_LISTING]);

await asUser(CUSTOMER);
const publicRows = (await db.query("select * from public.search_public_properties($1, $2, $3, $4, $5)", ["Nairobi", null, 500000, 2, 10])).rows;
assert.equal(publicRows.length, 1, "published property is publicly searchable");
assert.equal(publicRows[0].neighbourhood, "Kilimani");
assert.equal("exact_address" in publicRows[0], false, "public search never returns the exact address");

await assert.rejects(
  () => db.query("select * from public.get_property_contact($1)", [PROPERTY_LISTING]),
  /not been purchased/i,
  "contact is locked before payment",
);
await db.query("update public.platform_settings set value = '\"mock\"'::jsonb where key = 'payment_mode'");
const unlockRef = (await db.query("select public.confirm_mock_property_unlock($1) as ref", [PROPERTY_LISTING])).rows[0].ref;
assert.match(unlockRef, /^MOCK-PROPERTY-/);
const propertyContact = (await db.query("select * from public.get_property_contact($1)", [PROPERTY_LISTING])).rows[0];
assert.equal(propertyContact.exact_address, "Wood Avenue, House 42B");
assert.equal(propertyContact.contact_phone, "+254700000003");
assert.ok(propertyContact.expires_at, "access carries an expiry");

// Repeating the unlock must not charge again or write another entitlement.
await db.query("select public.confirm_mock_property_unlock($1)", [PROPERTY_LISTING]);
const unlockCount = (await db.query("select count(*)::int as c from public.property_contact_unlocks where listing_id = $1", [PROPERTY_LISTING])).rows[0].c;
assert.equal(Number(unlockCount), 1, "one paid entitlement per user and property");

const propertyLedger = (await db.query(
  "select sum(debit_minor)::bigint as d, sum(credit_minor)::bigint as c from public.ledger_entries where property_unlock_id is not null"
)).rows[0];
assert.equal(Number(propertyLedger.d), Number(propertyLedger.c), "property fee ledger balanced");
assert.equal(Number(propertyLedger.d), 4000, "KSh 20 fee posts 2,000 debit and 2,000 credit");
const platformFee = (await db.query(
  "select sum(credit_minor - debit_minor)::bigint as b from public.ledger_entries where entry_type = 'property_unlock' and account = 'platform_commission'"
)).rows[0].b;
assert.equal(Number(platformFee), 2000, "the KSh 20 belongs to Shilevi, not the landlord");

await asUser(PROVIDER);
await assert.rejects(
  () => db.query("select * from public.get_property_contact($1)", [PROPERTY_LISTING]),
  /not been purchased/i,
  "another account cannot read the unlocked contact",
);

// Staff capabilities default to none and are not self-granted.
await asUser(CUSTOMER);
assert.equal(
  (await db.query("select public.has_staff_capability('finance.payout') as allowed")).rows[0].allowed,
  false,
  "an ordinary customer has no staff capability",
);
await assert.rejects(
  () => db.query("select public.admin_grant_staff_capability($1, $2, true)", ["provider@example.test", "finance.payout"]),
  /Not authorized/i,
  "an ordinary user cannot grant themselves a staff capability",
);

await asUser(CUSTOMER, true);
await db.query("select public.admin_grant_staff_capability($1, $2, true)", ["provider@example.test", "orders.read"]);
await asUser(PROVIDER);
assert.equal(
  (await db.query("select public.has_staff_capability('orders.read') as allowed")).rows[0].allowed,
  true,
  "granted staff capability is effective",
);
await asUser(CUSTOMER, true);
await db.query("select public.admin_grant_staff_capability($1, $2, false)", ["provider@example.test", "orders.read"]);
await asUser(PROVIDER);
assert.equal(
  (await db.query("select public.has_staff_capability('orders.read') as allowed")).rows[0].allowed,
  false,
  "revoked capability stops working",
);

// A provider-verified payment for a product order settles through mark_order_paid, the same ledger
// shape used by the sandbox path.
await db.query("update public.platform_settings set value = '\"mpesa\"'::jsonb where key = 'payment_mode'");
await asUser(CUSTOMER);
const providerOrderId = (await db.query(
  "select * from public.create_order($1::jsonb, $2, $3, $4, $5)",
  [JSON.stringify([{ listing_id: SMALL_LISTING, quantity: 1 }]), "pickup", null, null, null]
)).rows[0].order_id;
const orderIntent = (await db.query("select public.create_payment_intent($1, $2, $3) as id", ["order", providerOrderId, "order-key-1"])).rows[0].id;
await db.query("select public.attach_payment_provider_reference($1, $2, $3)", [orderIntent, "MPESA-ORDER-REF-1", "ws_CO_ORDER"]);
assert.equal(
  (await db.query("select public.confirm_provider_payment($1, $2, $3) as r", ["mpesa", "MPESA-ORDER-REF-1", 5000])).rows[0].r,
  "succeeded",
);
const providerOrder = (await db.query("select * from public.orders where id = $1", [providerOrderId])).rows[0];
assert.equal(providerOrder.payment_status, "paid");
assert.equal(providerOrder.payment_reference, "MPESA-ORDER-REF-1");
const providerOrderLedger = (await db.query(
  "select sum(debit_minor)::bigint as d, sum(credit_minor)::bigint as c from public.ledger_entries where order_id = $1",
  [providerOrderId]
)).rows[0];
assert.equal(Number(providerOrderLedger.d), Number(providerOrderLedger.c), "provider order ledger balanced");

console.log("ride flow: KSh 2,200 agreed, KSh 220 commission, KSh 1,980 rider net, dual confirmation, KSh 1,000 withdrawal settled");
console.log("house hunt: free search, KSh 20 unlock, exact contact released only after payment, duplicate unlock blocked");

// --- 0027: platform settings are owner-only and range-checked before they can price anything.
await asUser(CUSTOMER, true);
await db.query("select public.admin_update_setting('commission_rate_bps', '1500'::jsonb)");
assert.equal(
  (await db.query("select value #>> '{}' as v from public.platform_settings where key = 'commission_rate_bps'")).rows[0].v,
  "1500",
  "owner can set a valid commission",
);
await assert.rejects(
  db.query("select public.admin_update_setting('commission_rate_bps', '9000'::jsonb)"),
  /between 0 and 5000/,
  "a commission above the ceiling is rejected",
);
await assert.rejects(
  db.query("select public.admin_update_setting('currency', '\"kes\"'::jsonb)"),
  /three-letter ISO code/,
  "a malformed currency is rejected",
);
await assert.rejects(
  db.query("select public.admin_update_setting('unknown_key', '1'::jsonb)"),
  /Unknown setting/,
  "an unknown key is rejected",
);
await asUser(CUSTOMER, false);
await assert.rejects(
  db.query("select public.admin_update_setting('commission_rate_bps', '1000'::jsonb)"),
  /Not authorized/,
  "a non-owner cannot change pricing",
);
await asUser(CUSTOMER, true);
await db.query("select public.admin_update_setting('commission_rate_bps', '1000'::jsonb)");
console.log("settings: owner-only, range-checked, non-owner denied");

console.log("staff: self-grant denied, owner grant effective, revocation effective");
console.log("ALL MIGRATION AND FLOW CHECKS PASSED");
