/**
 * Identity and fixture provisioning for the live RLS suite.
 *
 * Rules:
 *  - Normal-user authorization tests use the anon key and genuinely signed-in sessions.
 *  - The service-role key is used only to create the test identities, to seed the approval chain
 *    that a real owner would create through review, and to clean up afterwards.
 *  - Every record is namespaced with the run id so cleanup can never touch real data.
 */
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { assuranceLevel, totpCode } from "./totp.mjs";

const ROLE_EMAILS = {
  customerA: "customer-a",
  customerB: "customer-b",
  seller: "seller",
  sellerB: "seller-unapproved",
  landlord: "landlord",
  landlordB: "landlord-b",
  rider: "rider",
  riderB: "rider-b",
  staff: "staff",
};

export function createServiceClient(config) {
  return createClient(config.url, config.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export function createAnonClient(config) {
  return createClient(config.url, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function nowIso() {
  return new Date().toISOString();
}

export function createRun() {
  const stamp = nowIso().replace(/[-:.TZ]/g, "").slice(0, 14);
  const suffix = randomBytes(3).toString("hex");
  return {
    id: `${stamp}${suffix}`,
    password: randomBytes(24).toString("base64url"),
    userIds: [],
    listingIds: [],
    orderIds: [],
    rideIds: [],
    intentIds: [],
    payoutIds: [],
    unlockIds: [],
    capabilityUserIds: [],
    categorySlugs: [],
    allowlistEmail: null,
  };
}

async function insertRow(service, table, row, label = table) {
  const { data, error } = await service.from(table).insert(row).select("*").single();
  if (error) throw new Error(`${label} insert failed: ${error.message}`);
  return data;
}

async function createUser(service, email, password, displayName) {
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName },
  });
  if (error) throw new Error(`Creating a test account failed: ${error.message}`);
  return data.user;
}

async function signIn(config, email, password) {
  const client = createAnonClient(config);
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Signing in a test account failed: ${error.message}`);
  return client;
}

/**
 * Completes a real TOTP challenge so the session reaches aal2. Returns { ok, level } or a reason.
 * Never throws: a project with MFA disabled must surface as BLOCKED, not as a crash.
 */
export async function elevateSession(client) {
  try {
    const level = await client.auth.mfa.getAuthenticatorAssuranceLevel();
    if (!level.error && level.data?.currentLevel === "aal2") return { ok: true, level: "aal2" };

    const enroll = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: "rls-suite" });
    if (enroll.error) return { ok: false, reason: enroll.error.message };
    const factorId = enroll.data.id;
    const secret = enroll.data.totp?.secret;

    const challenge = await client.auth.mfa.challenge({ factorId });
    if (challenge.error) return { ok: false, reason: challenge.error.message };
    const challengeId = challenge.data.id;

    // Tolerate a small clock difference between this machine and the auth server.
    for (const offsetMs of [0, -30_000, 30_000]) {
      const code = totpCode(secret, { at: Date.now() + offsetMs });
      const verify = await client.auth.mfa.verify({ factorId, challengeId, code });
      if (!verify.error) {
        const after = await client.auth.mfa.getAuthenticatorAssuranceLevel();
        const reached = after.error ? "unknown" : after.data?.currentLevel;
        return { ok: true, level: reached };
      }
    }
    return { ok: false, reason: "The TOTP challenge was rejected (check clock skew on this machine)." };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

export async function sessionLevel(client) {
  try {
    const { data } = await client.auth.getSession();
    return assuranceLevel(data.session?.access_token);
  } catch {
    return "unknown";
  }
}

async function seedProvider(service, { userId, activityType, categoryId, transactionTypes }) {
  const application = await insertRow(service, "provider_applications", {
    user_id: userId,
    activity_type: activityType,
    status: "approved",
    business_name: `RLS test ${activityType}`,
    application_data: { suite: "live-rls" },
    submitted_at: nowIso(),
    reviewed_at: nowIso(),
  });
  const activity = await insertRow(service, "provider_activities", {
    user_id: userId,
    application_id: application.id,
    category_id: categoryId,
    transaction_types: transactionTypes,
    status: "approved",
    verification_tier: 1,
    approved_at: nowIso(),
  });
  return { application, activity };
}

async function seedListing(service, run, options) {
  const listing = await insertRow(service, "listings", {
    owner_id: options.ownerId,
    category_id: options.categoryId,
    provider_application_id: options.applicationId,
    provider_activity_id: options.activityId,
    transaction_type: options.transactionType,
    title: options.title,
    description: "Created by the live RLS suite.",
    status: options.status ?? "published",
    price_minor: options.priceMinor ?? 500000,
    currency: "KES",
    attributes: {},
  });
  run.listingIds.push(listing.id);
  return listing;
}

/**
 * A property listing cannot be published until its details and contact record exist, so property
 * fixtures are inserted as drafts, completed, then published. Products publish directly.
 */
async function publishListing(service, listingId) {
  const { error } = await service.from("listings").update({ status: "published" }).eq("id", listingId);
  if (error) throw new Error(`publishing the property fixture failed: ${error.message}`);
}

/**
 * Builds every identity and fixture the matrix needs. Throws on setup failure; the runner converts
 * that into BLOCKED results with the stage name so the cause is obvious.
 */
export async function provision(config, run, onStage = () => {}) {
  const service = createServiceClient(config);
  const state = {
    service,
    run,
    identities: {},
    clients: {},
    fixtures: {},
    mfa: {},
    warnings: [],
  };

  onStage("categories");
  const productCategory = await insertRow(service, "marketplace_categories", {
    slug: `rls-${run.id}-products`,
    name: `RLS products ${run.id}`,
    division: "products",
    description: "Live RLS suite fixture.",
    is_active: true,
  });
  const propertyCategory = await insertRow(service, "marketplace_categories", {
    slug: `rls-${run.id}-property`,
    name: `RLS property ${run.id}`,
    division: "property_places",
    description: "Live RLS suite fixture.",
    is_active: true,
  });
  const transportCategory = await insertRow(service, "marketplace_categories", {
    slug: `rls-${run.id}-transport`,
    name: `RLS transport ${run.id}`,
    division: "transport_delivery",
    description: "Live RLS suite fixture.",
    is_active: true,
  });
  run.categorySlugs.push(productCategory.slug, propertyCategory.slug, transportCategory.slug);
  state.fixtures.productCategory = productCategory;
  state.fixtures.propertyCategory = propertyCategory;
  state.fixtures.transportCategory = transportCategory;

  onStage("accounts");
  const ownerEmail = `shilevi.rls.${run.id}.owner@gmail.com`;
  run.allowlistEmail = ownerEmail;

  const created = {};
  for (const [role, label] of Object.entries(ROLE_EMAILS)) {
    const email = `rls.${run.id}.${label}@example.com`;
    const user = await createUser(service, email, run.password, `RLS ${role}`);
    run.userIds.push(user.id);
    created[role] = { email, user };
  }
  const owner = await createUser(service, ownerEmail, run.password, "RLS owner");
  run.userIds.push(owner.id);
  created.owner = { email: ownerEmail, user: owner };
  state.identities = created;

  // If the auth bootstrap trigger is missing, every later assertion would fail for the wrong
  // reason. Fail setup loudly instead of producing misleading security failures.
  const bootstrap = await service
    .from("profiles")
    .select("id")
    .eq("id", created.customerA.user.id)
    .maybeSingle();
  if (bootstrap.error) {
    throw new Error(`profiles check failed: ${bootstrap.error.message}`);
  }
  if (!bootstrap.data) {
    throw new Error(
      "No profile row was created for a new account. Apply migrations 0001–0022 first: the auth bootstrap trigger is missing.",
    );
  }

  onStage("owner-allowlist");
  await insertRow(
    service,
    "owner_admin_allowlist",
    { email: ownerEmail },
    "owner_admin_allowlist",
  );

  onStage("sessions");
  state.clients.anon = createAnonClient(config);
  for (const [role, entry] of Object.entries(created)) {
    state.clients[role] = await signIn(config, entry.email, run.password);
    state.clients[role].__role = role;
  }

  onStage("provider-chains");
  const sellerChain = await seedProvider(service, {
    userId: created.seller.user.id,
    activityType: "product_seller",
    categoryId: productCategory.id,
    transactionTypes: ["sale"],
  });
  state.fixtures.sellerApplication = sellerChain.application;
  state.fixtures.sellerActivity = sellerChain.activity;

  const sellerListing = await seedListing(service, run, {
    ownerId: created.seller.user.id,
    categoryId: productCategory.id,
    applicationId: sellerChain.application.id,
    activityId: sellerChain.activity.id,
    transactionType: "sale",
    title: `RLS seller listing ${run.id}`,
    priceMinor: 500000,
  });
  state.fixtures.sellerListing = sellerListing;

  const sellerDraft = await insertRow(service, "listings", {
    owner_id: created.seller.user.id,
    category_id: productCategory.id,
    provider_application_id: sellerChain.application.id,
    provider_activity_id: sellerChain.activity.id,
    transaction_type: "sale",
    title: `RLS seller draft ${run.id}`,
    description: "Created by the live RLS suite.",
    status: "draft",
    price_minor: 250000,
    currency: "KES",
    attributes: {},
  });
  run.listingIds.push(sellerDraft.id);
  state.fixtures.sellerDraft = sellerDraft;

  // The unapproved provider owns a pending application only: no activity, no listing rights.
  state.fixtures.sellerBApplication = await insertRow(service, "provider_applications", {
    user_id: created.sellerB.user.id,
    activity_type: "product_seller",
    status: "pending",
    business_name: "RLS unapproved seller",
    application_data: { suite: "live-rls" },
    submitted_at: nowIso(),
  });

  const landlordChain = await seedProvider(service, {
    userId: created.landlord.user.id,
    activityType: "property_provider",
    categoryId: propertyCategory.id,
    transactionTypes: ["rent", "viewing"],
  });
  const landlordListing = await seedListing(service, run, {
    ownerId: created.landlord.user.id,
    categoryId: propertyCategory.id,
    applicationId: landlordChain.application.id,
    activityId: landlordChain.activity.id,
    transactionType: "rent",
    title: `RLS property ${run.id}`,
    priceMinor: 4500000,
    status: "draft",
  });
  await insertRow(service, "property_listings", {
    listing_id: landlordListing.id,
    county: "Nairobi",
    city: "Nairobi",
    neighbourhood: "Kilimani",
    property_type: "apartment",
    bedrooms: 2,
    bathrooms: 1,
    rent_minor: 4500000,
    deposit_minor: 4500000,
    is_vacant: true,
    amenities: ["water", "parking"],
    verification_status: "verified",
  });
  state.fixtures.landlordProperty = await insertRow(service, "property_contacts", {
    listing_id: landlordListing.id,
    exact_address: `RLS Test Court, Unit 7B, ${run.id}`,
    unit_number: "7B",
    contact_name: "RLS Landlord",
    contact_phone: "+254700000001",
    contact_email: `landlord.${run.id}@example.com`,
  });
  await publishListing(service, landlordListing.id);
  state.fixtures.landlordListing = landlordListing;
  state.fixtures.landlordApplication = landlordChain.application;
  state.fixtures.landlordActivity = landlordChain.activity;

  const landlordBChain = await seedProvider(service, {
    userId: created.landlordB.user.id,
    activityType: "property_provider",
    categoryId: propertyCategory.id,
    transactionTypes: ["rent"],
  });
  const landlordBListing = await seedListing(service, run, {
    ownerId: created.landlordB.user.id,
    categoryId: propertyCategory.id,
    applicationId: landlordBChain.application.id,
    activityId: landlordBChain.activity.id,
    transactionType: "rent",
    title: `RLS second property ${run.id}`,
    priceMinor: 3000000,
    status: "draft",
  });
  await insertRow(service, "property_listings", {
    listing_id: landlordBListing.id,
    county: "Nairobi",
    city: "Nairobi",
    property_type: "bedsitter",
    bedrooms: 1,
    bathrooms: 1,
    rent_minor: 3000000,
    is_vacant: true,
  });
  await insertRow(service, "property_contacts", {
    listing_id: landlordBListing.id,
    exact_address: `RLS Other Court, ${run.id}`,
    contact_name: "RLS Other Landlord",
    contact_phone: "+254700000002",
  });
  await publishListing(service, landlordBListing.id);
  state.fixtures.landlordBListing = landlordBListing;

  onStage("transport");
  for (const role of ["rider", "riderB"]) {
    const chain = await seedProvider(service, {
      userId: created[role].user.id,
      activityType: "transport_partner",
      categoryId: transportCategory.id,
      transactionTypes: ["ride"],
    });
    await insertRow(service, "transport_vehicles", {
      user_id: created[role].user.id,
      mode: "car",
      make_model: "RLS test sedan",
      plate_number: `RLS${run.id.slice(-5)}${role === "rider" ? "A" : "B"}`,
      seat_capacity: 4,
      verification_status: "approved",
      is_active: true,
    });
    state.fixtures[`${role}Activity`] = chain.activity;
  }

  onStage("staff");
  // Capabilities are normally granted by an owner through admin_grant_staff_capability. The owner
  // path needs aal2, so it is seeded here to keep setup deterministic; the grant path itself is
  // covered by the migration tests. The staff account deliberately lacks audit.read.
  const staffCapabilities = ["orders.read", "properties.verify", "finance.read"];
  for (const capability of staffCapabilities) {
    await insertRow(service, "staff_capabilities", {
      user_id: created.staff.user.id,
      capability,
      granted_by: owner.id,
    });
  }
  state.fixtures.staffCapabilities = staffCapabilities;

  onStage("mfa");
  state.mfa.owner = await elevateSession(state.clients.owner);
  state.mfa.staff = await elevateSession(state.clients.staff);

  // A second staff session left at aal1 proves the MFA gate independently.
  state.clients.staffLow = await signIn(config, created.staff.email, run.password);
  state.clients.ownerLow = await signIn(config, ownerEmail, run.password);

  onStage("ready");
  return state;
}

/**
 * Removes only what the run created. Every delete is awaited and failures are reported rather than
 * thrown, so a cleanup problem cannot hide the security results.
 */
export async function cleanup(service, run) {
  const warnings = [];
  const userIds = run.userIds;

  const drop = async (table, column, values) => {
    if (!values?.length) return;
    const { error } = await service.from(table).delete().in(column, values);
    if (error) warnings.push(`${table}.${column}: ${error.message}`);
  };

  await drop("property_contact_unlocks", "listing_id", run.listingIds);
  await drop("property_contacts", "listing_id", run.listingIds);
  await drop("property_listings", "listing_id", run.listingIds);
  await drop("payment_intents", "id", run.intentIds);
  await drop("payment_intents", "user_id", userIds);
  await drop("ledger_entries", "order_id", run.orderIds);
  await drop("ledger_entries", "ride_id", run.rideIds);
  await drop("ledger_entries", "payout_id", run.payoutIds);
  await drop("payouts", "id", run.payoutIds);
  await drop("payouts", "payee_id", userIds);
  await drop("orders", "customer_id", userIds);
  await drop("rides", "customer_id", userIds);
  await drop("transport_vehicles", "user_id", userIds);
  await drop("listings", "id", run.listingIds);
  await drop("listings", "owner_id", userIds);
  await drop("provider_activities", "user_id", userIds);
  await drop("provider_applications", "user_id", userIds);
  await drop("staff_capabilities", "user_id", userIds);
  await drop("notification_outbox", "user_id", userIds);
  await drop("user_notification_preferences", "user_id", userIds);
  await drop("saved_listings", "user_id", userIds);
  await drop("user_onboarding", "user_id", userIds);
  await drop("audit_events", "actor_id", userIds);

  if (run.allowlistEmail) {
    const { error } = await service
      .from("owner_admin_allowlist")
      .delete()
      .eq("email", run.allowlistEmail);
    if (error) warnings.push(`owner_admin_allowlist: ${error.message}`);
  }

  for (const id of userIds) {
    const { error } = await service.auth.admin.deleteUser(id);
    if (error) warnings.push(`auth users: ${error.message}`);
  }

  if (run.categorySlugs.length) {
    const { error } = await service
      .from("marketplace_categories")
      .delete()
      .in("slug", run.categorySlugs);
    if (error) warnings.push(`marketplace_categories: ${error.message}`);
  }

  return warnings;
}
