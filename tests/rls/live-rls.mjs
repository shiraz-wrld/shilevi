#!/usr/bin/env node
/**
 * Live Supabase Row-Level Security negative tests.
 *
 * Every assertion below runs against a real hosted project with genuine authenticated sessions and
 * real JWTs. Nothing here is satisfied by a client-side route guard: the probes are PostgREST
 * requests and RPC calls made with each identity's own access token.
 *
 * Exit codes:
 *   0  the suite ran and no test failed (BLOCKED/NOT TESTED notes are listed in the report)
 *   1  at least one test failed
 *   2  the suite could not run: configuration missing or provisioning failed (BLOCKED — NOT RUN)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvironment, redact, resolveConfig } from "./lib/config.mjs";
import { cleanup, createRun, provision } from "./lib/provision.mjs";
import { attempt, createRecorder, describe, isDenied, rowCount } from "./lib/assertions.mjs";

const cwd = process.cwd();
const env = loadEnvironment(cwd);
const config = resolveConfig(env);
const recorder = createRecorder();

let run = null;
let service = null;

/* ------------------------------------------------------------------ reporting */

function writeReports({ results, notes = [], setupError = null }) {
  const dir = resolve(cwd, "reports");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = `rls-live-${stamp}`;

  const counts = results.reduce(
    (acc, item) => {
      acc[item.status] = (acc[item.status] ?? 0) + 1;
      return acc;
    },
    { PASS: 0, FAIL: 0, BLOCKED: 0, "NOT TESTED": 0 },
  );

  const payload = {
    generatedAt: new Date().toISOString(),
    projectHost: config.host || null,
    runId: run?.id ?? null,
    executed: Boolean(run),
    setupError,
    counts,
    notes,
    results,
  };

  const jsonPath = resolve(dir, `${base}.json`);
  writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`);

  const lines = [
    "# Live Supabase RLS negative test report",
    "",
    `- Generated: ${payload.generatedAt}`,
    `- Project host: ${payload.projectHost ?? "not configured"}`,
    `- Run id: ${payload.runId ?? "none"}`,
    `- Executed against a hosted project: ${payload.executed ? "yes" : "**no — BLOCKED**"}`,
    "",
    `| Status | Count |`,
    `|---|---|`,
    ...Object.entries(counts).map(([status, count]) => `| ${status} | ${count} |`),
    "",
    ...(notes.length ? ["## Notes", "", ...notes.map(note => `- ${note}`), ""] : []),
    "## Results",
    "",
    "| ID | Boundary tested | Expected | Status | Evidence |",
    "|---|---|---|---|---|",
    ...results.map(
      item =>
        `| ${item.id} | ${escapeCell(item.boundary)} | ${escapeCell(item.expectation)} | ${item.status} | ${escapeCell(item.detail)} |`,
    ),
    "",
  ];
  const mdPath = resolve(dir, `${base}.md`);
  writeFileSync(mdPath, `${lines.join("\n")}\n`);
  return { jsonPath, mdPath };
}

function escapeCell(value) {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ");
}

function finish(code, notes = [], setupError = null) {
  const { jsonPath, mdPath } = writeReports({
    results: recorder.results,
    notes,
    setupError,
  });
  console.log(`\nReport: ${jsonPath}`);
  console.log(`Report: ${mdPath}`);
  process.exit(code);
}

/* ------------------------------------------------------------------ helpers */

const deny = async (meta, thunk) => {
  const outcome = await attempt(thunk);
  if (isDenied(outcome)) recorder.pass(meta, describe(outcome));
  else recorder.fail(meta, describe(outcome));
  return outcome;
};

const allow = async (meta, thunk, check = () => true) => {
  const outcome = await attempt(thunk);
  if (!outcome.ok) {
    recorder.fail(meta, describe(outcome));
    return outcome;
  }
  if (!check(outcome.data)) {
    recorder.fail(meta, `allowed, but the returned data was not what the boundary permits: ${redact(JSON.stringify(outcome.data)).slice(0, 200)}`);
    return outcome;
  }
  recorder.pass(meta, describe(outcome));
  return outcome;
};

async function backendValue(table, field, column, value) {
  const { data, error } = await service
    .from(table)
    .select(field)
    .eq(column, value)
    .limit(1);
  if (error) throw new Error(`${table} read failed: ${error.message}`);
  return data?.[0]?.[field] ?? null;
}

const denyWrite = async (meta, thunk, verify) => {
  const outcome = await attempt(thunk);
  const denied = isDenied(outcome);
  let unchanged = true;
  let detail = describe(outcome);
  if (verify) {
    try {
      const actual = await backendValue(verify.table, verify.field, verify.column, verify.value);
      unchanged = JSON.stringify(actual) === JSON.stringify(verify.expected);
      detail += unchanged
        ? " · stored value unchanged"
        : ` · STORED VALUE CHANGED to ${redact(JSON.stringify(actual))}`;
    } catch (error) {
      unchanged = false;
      detail += ` · could not verify stored value: ${redact(error.message)}`;
    }
  }
  if (denied && unchanged) recorder.pass(meta, detail);
  else recorder.fail(meta, detail);
};

const repeat = (meta, reason) => recorder.blocked(meta, reason);

/* ------------------------------------------------------------------ matrix */

async function runMatrix(state) {
  const { service: admin, fixtures: fx, identities: ids, clients: c, mfa } = state;
  const notes = [];
  const paymentMode = await backendValue("platform_settings", "value", "key", "payment_mode");

  // Sandbox settlement needs BOTH payment_mode = 'mock' and allow_mock_payments = true (0023).
  // Reading payment_mode alone would misreport a deployment that is correctly failing closed as
  // one where sandbox money is available, so ask the database for the effective answer.
  let sandboxEnabled = false;
  try {
    const sandbox = await admin.rpc("mock_payments_allowed");
    if (sandbox.error) throw sandbox.error;
    sandboxEnabled = sandbox.data === true;
  } catch (error) {
    notes.push(
      `Sandbox state could not be read: ${redact(error.message)}. Treating sandbox settlement as disabled; migration 0023 may be missing.`,
    );
  }

  notes.push(`Platform payment_mode is "${paymentMode}".`);
  notes.push(
    sandboxEnabled
      ? "Sandbox settlement is ENABLED on this project. Never run this suite against one taking real payments."
      : "Sandbox settlement is off; the mock settlement RPCs must refuse every caller.",
  );
  notes.push(
    `Owner MFA elevation: ${mfa.owner.ok ? `aal2 (${mfa.owner.level})` : `unavailable — ${redact(mfa.owner.reason)}`}`,
  );
  notes.push(
    `Staff MFA elevation: ${mfa.staff.ok ? `aal2 (${mfa.staff.level})` : `unavailable — ${redact(mfa.staff.reason)}`}`,
  );

  /* ---- fixtures that need real user sessions ------------------------------ */

  let orderId = null;
  let orderLineId = null;
  try {
    const response = await c.customerA.rpc("create_order", {
      p_items: [{ listing_id: fx.sellerListing.id, quantity: 1 }],
      p_delivery_method: "pickup",
    });
    if (response.error) throw response.error;
    const row = Array.isArray(response.data) ? response.data[0] : response.data;
    orderId = row?.order_id ?? null;
    if (!orderId) throw new Error("create_order returned no order id");
    run.orderIds.push(orderId);
    orderLineId = await backendValue("order_items", "id", "order_id", orderId);
  } catch (error) {
    notes.push(`Order fixture unavailable: ${redact(error.message)}`);
  }

  let rideId = null;
  try {
    const requested = await c.customerA.rpc("request_ride", {
      p_payload: {
        rider_id: ids.rider.user.id,
        ride_mode: "car",
        pickup_label: "RLS pickup point",
        dropoff_label: "RLS dropoff point",
        proposed_fare_minor: 2000,
      },
    });
    if (requested.error) throw requested.error;
    rideId = requested.data;
    run.rideIds.push(rideId);

    const countered = await c.rider.rpc("ride_respond", {
      p_ride_id: rideId,
      p_action: "counter",
      p_counter_fare_minor: 2200,
    });
    if (countered.error) throw countered.error;

    const accepted = await c.customerA.rpc("ride_customer_respond", {
      p_ride_id: rideId,
      p_accept: true,
    });
    if (accepted.error) throw accepted.error;
  } catch (error) {
    notes.push(`Ride fixture unavailable: ${redact(error.message)}`);
    rideId = null;
  }

  let intentId = null;
  if (orderId) {
    try {
      const created = await c.customerA.rpc("create_payment_intent", {
        p_purpose: "order",
        p_target_id: orderId,
        p_idempotency_key: `rls-${run.id}`,
      });
      if (created.error) throw created.error;
      intentId = created.data;
      if (intentId) run.intentIds.push(intentId);
    } catch (error) {
      notes.push(`Payment intent fixture unavailable: ${redact(error.message)}`);
    }
  }

  let riderBPayoutId = null;
  try {
    const payout = await admin
      .from("payouts")
      .insert({
        payee_id: ids.riderB.user.id,
        payee_role: "rider",
        amount_minor: 10000,
        status: "pending",
        method: "mpesa",
      })
      .select("id")
      .single();
    if (payout.error) throw payout.error;
    riderBPayoutId = payout.data.id;
    run.payoutIds.push(riderBPayoutId);
  } catch (error) {
    notes.push(`Payout fixture unavailable: ${redact(error.message)}`);
  }

  /* ---- A. profiles, roles and capabilities -------------------------------- */

  await deny(
    {
      id: "A1",
      boundary: "profiles · anonymous read",
      expectation: "An unauthenticated visitor cannot read profiles.",
    },
    () => c.anon.from("profiles").select("id,display_name").limit(5),
  );

  await allow(
    {
      id: "A2",
      boundary: "profiles · own read",
      expectation: "A customer can read their own profile.",
    },
    () => c.customerA.from("profiles").select("id,display_name").eq("id", ids.customerA.user.id),
    data => Array.isArray(data) && data.length === 1 && data[0].id === ids.customerA.user.id,
  );

  await deny(
    {
      id: "A3",
      boundary: "profiles · cross-account read",
      expectation: "Customer A cannot read Customer B's profile row.",
    },
    () => c.customerA.from("profiles").select("id,display_name").eq("id", ids.customerB.user.id),
  );

  const originalName = await backendValue("profiles", "display_name", "id", ids.customerB.user.id);
  await denyWrite(
    {
      id: "A4",
      boundary: "profiles · cross-account write",
      expectation: "Customer A cannot change Customer B's profile.",
    },
    () =>
      c.customerA
        .from("profiles")
        .update({ display_name: "RLS-HIJACK" })
        .eq("id", ids.customerB.user.id)
        .select("id"),
    { table: "profiles", field: "display_name", column: "id", value: ids.customerB.user.id, expected: originalName },
  );

  await allow(
    {
      id: "A5",
      boundary: "profiles · own write",
      expectation: "A customer can change their own editable profile fields.",
    },
    () =>
      c.customerA
        .from("profiles")
        .update({ display_name: `RLS customer ${run.id}` })
        .eq("id", ids.customerA.user.id)
        .select("id"),
    data => rowCount(data) === 1,
  );

  await deny(
    {
      id: "A6",
      boundary: "user_roles · self-promotion insert",
      expectation: "A customer cannot insert a role assignment for themselves.",
    },
    () => c.customerA.from("user_roles").insert({ user_id: ids.customerA.user.id, role: "admin" }).select("role"),
  );

  const rolesBefore = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", ids.customerA.user.id);
  await denyWrite(
    {
      id: "A7",
      boundary: "user_roles · self-promotion update",
      expectation: "A customer cannot rewrite their own role to admin or super_admin.",
    },
    () =>
      c.customerA
        .from("user_roles")
        .update({ role: "super_admin" })
        .eq("user_id", ids.customerA.user.id)
        .select("role"),
    {
      table: "user_roles",
      field: "role",
      column: "user_id",
      value: ids.customerA.user.id,
      expected: rolesBefore.data?.[0]?.role ?? "customer",
    },
  );

  await allow(
    {
      id: "A8",
      boundary: "user_roles · read scope",
      expectation: "A customer sees only their own role rows.",
    },
    () => c.customerA.from("user_roles").select("user_id,role"),
    data => Array.isArray(data) && data.every(row => row.user_id === ids.customerA.user.id),
  );

  await deny(
    {
      id: "A9",
      boundary: "staff_capabilities · self-grant",
      expectation: "A customer cannot insert a staff capability for themselves.",
    },
    () =>
      c.customerA
        .from("staff_capabilities")
        .insert({ user_id: ids.customerA.user.id, capability: "finance.payout" })
        .select("capability"),
  );

  await deny(
    {
      id: "A10",
      boundary: "staff_capabilities · owner-only RPC",
      expectation: "A customer cannot call admin_grant_staff_capability, even for their own account.",
    },
    () =>
      c.customerA.rpc("admin_grant_staff_capability", {
        p_email: ids.customerA.email,
        p_capability: "finance.payout",
        p_grant: true,
      }),
  );

  const capabilityAfter = await admin
    .from("staff_capabilities")
    .select("capability")
    .eq("user_id", ids.customerA.user.id);
  if (!capabilityAfter.error && (capabilityAfter.data ?? []).length === 0) {
    recorder.pass(
      {
        id: "A10b",
        boundary: "staff_capabilities · grant had no effect",
        expectation: "A denied self-grant leaves no capability row behind.",
      },
      "no capability row exists for the customer",
    );
  } else if (capabilityAfter.error) {
    recorder.fail(
      {
        id: "A10b",
        boundary: "staff_capabilities · grant had no effect",
        expectation: "A denied self-grant leaves no capability row behind.",
      },
      `could not verify: ${capabilityAfter.error.message}`,
    );
  } else {
    recorder.fail(
      {
        id: "A10b",
        boundary: "staff_capabilities · grant had no effect",
        expectation: "A denied self-grant leaves no capability row behind.",
      },
      "a capability row exists for a customer",
    );
  }

  await allow(
    {
      id: "A11",
      boundary: "staff_capabilities · read scope",
      expectation: "The staff account reads only its own capability rows.",
    },
    () => c.staff.from("staff_capabilities").select("user_id,capability"),
    data => Array.isArray(data) && data.every(row => row.user_id === ids.staff.user.id),
  );

  // Staff capabilities require aal2 at the database level. An aal1 session must stay inert.
  await deny(
    {
      id: "A12",
      boundary: "orders · staff read without MFA",
      expectation: "A staff session at aal1 cannot read orders even with orders.read.",
    },
    () => c.staffLow.from("orders").select("id").limit(10),
  );

  if (mfa.staff.ok) {
    await allow(
      {
        id: "A13",
        boundary: "orders · staff read with MFA",
        expectation: "The same capability becomes effective once the session reaches aal2.",
      },
      () => c.staff.from("orders").select("id").limit(10),
      data =>
        Array.isArray(data) &&
        (orderId ? data.some(row => row.id === orderId) : data.length >= 0),
    );
  } else {
    repeat(
      {
        id: "A13",
        boundary: "orders · staff read with MFA",
        expectation: "The same capability becomes effective once the session reaches aal2.",
      },
      `MFA could not be enrolled for the staff test account: ${redact(mfa.staff.reason)}`,
    );
  }

  await allow(
    {
      id: "A14",
      boundary: "owners · identity check",
      expectation: "A customer is never an owner administrator.",
    },
    () => c.customerA.rpc("is_shilevi_owner_admin"),
    data => data === false,
  );

  await allow(
    {
      id: "A15",
      boundary: "owners · allowlisted but aal1",
      expectation: "An allowlisted owner with only an aal1 session is not an owner at the database level.",
    },
    () => c.ownerLow.rpc("is_shilevi_owner_admin"),
    data => data === false,
  );

  if (mfa.owner.ok) {
    await allow(
      {
        id: "A16",
        boundary: "owners · allowlisted with aal2",
        expectation: "The allowlisted owner with MFA is recognised.",
      },
      () => c.owner.rpc("is_shilevi_owner_admin"),
      data => data === true,
    );

    await allow(
      {
        id: "A17",
        boundary: "audit_events · owner read",
        expectation: "An owner can read the audit log.",
      },
      () => c.owner.from("audit_events").select("id").limit(5),
      data => Array.isArray(data),
    );
  } else {
    repeat(
      {
        id: "A16",
        boundary: "owners · allowlisted with aal2",
        expectation: "The allowlisted owner with MFA is recognised.",
      },
      `MFA could not be enrolled for the owner test account: ${redact(mfa.owner.reason)}`,
    );
    repeat(
      {
        id: "A17",
        boundary: "audit_events · owner read",
        expectation: "An owner can read the audit log.",
      },
      "Requires the owner to reach aal2.",
    );
  }

  await deny(
    {
      id: "A18",
      boundary: "owner_admin_allowlist · client write",
      expectation: "A customer cannot add themselves to the owner allowlist.",
    },
    () =>
      c.customerA
        .from("owner_admin_allowlist")
        .insert({ email: ids.customerA.email })
        .select("email"),
  );

  // The sandbox switch must never be something a customer (or any client) can turn on: it decides
  // whether orders can be settled without a verified provider payment.
  const sandboxFlag = await backendValue("platform_settings", "value", "key", "allow_mock_payments");
  await denyWrite(
    {
      id: "A19",
      boundary: "platform_settings · sandbox switch write",
      expectation: "A customer cannot enable sandbox settlement.",
    },
    () =>
      c.customerA
        .from("platform_settings")
        .update({ value: true })
        .eq("key", "allow_mock_payments")
        .select("key"),
    {
      table: "platform_settings",
      field: "value",
      column: "key",
      value: "allow_mock_payments",
      expected: sandboxFlag,
    },
  );

  /* ---- B. applications, listings and orders -------------------------------- */

  await deny(
    {
      id: "B1",
      boundary: "listings · unapproved provider publishes",
      expectation: "A provider without an approved application cannot insert a published listing.",
    },
    () =>
      c.sellerB
        .from("listings")
        .insert({
          owner_id: ids.sellerB.user.id,
          category_id: fx.productCategory.id,
          provider_application_id: fx.sellerBApplication.id,
          transaction_type: "sale",
          title: "RLS forbidden listing",
          description: "Should never exist.",
          status: "published",
          price_minor: 100000,
          currency: "KES",
          attributes: {},
        })
        .select("id"),
  );

  await deny(
    {
      id: "B2",
      boundary: "listings · unapproved provider drafts",
      expectation: "An unapproved application cannot be used to create even a draft listing.",
    },
    () =>
      c.sellerB
        .from("listings")
        .insert({
          owner_id: ids.sellerB.user.id,
          category_id: fx.productCategory.id,
          provider_application_id: fx.sellerBApplication.id,
          transaction_type: "sale",
          title: "RLS draft that must be refused",
          description: "Should never exist.",
          status: "draft",
          price_minor: 100000,
          currency: "KES",
          attributes: {},
        })
        .select("id"),
  );

  const sellerTitle = await backendValue("listings", "title", "id", fx.sellerListing.id);
  await denyWrite(
    {
      id: "B3",
      boundary: "listings · cross-provider write",
      expectation: "Another seller cannot edit a listing they do not own.",
    },
    () =>
      c.sellerB
        .from("listings")
        .update({ title: "RLS overwritten" })
        .eq("id", fx.sellerListing.id)
        .select("id"),
    { table: "listings", field: "title", column: "id", value: fx.sellerListing.id, expected: sellerTitle },
  );

  await allow(
    {
      id: "B4",
      boundary: "listings · own draft write",
      expectation: "An approved provider can edit their own draft.",
    },
    () =>
      c.seller
        .from("listings")
        .update({ title: `RLS seller draft ${run.id} edited` })
        .eq("id", fx.sellerDraft.id)
        .select("id"),
    data => rowCount(data) === 1,
  );

  await denyWrite(
    {
      id: "B5",
      boundary: "listings · self-publication",
      expectation: "A provider cannot move their own draft straight to published by direct update.",
    },
    () =>
      c.seller
        .from("listings")
        .update({ status: "published" })
        .eq("id", fx.sellerDraft.id)
        .select("id,status"),
    { table: "listings", field: "status", column: "id", value: fx.sellerDraft.id, expected: "draft" },
  );

  await denyWrite(
    {
      id: "B6",
      boundary: "provider_applications · self-approval",
      expectation: "An applicant cannot move their own application to approved.",
    },
    () =>
      c.sellerB
        .from("provider_applications")
        .update({ status: "approved", reviewed_at: new Date().toISOString() })
        .eq("id", fx.sellerBApplication.id)
        .select("status"),
    {
      table: "provider_applications",
      field: "status",
      column: "id",
      value: fx.sellerBApplication.id,
      expected: "pending",
    },
  );

  await deny(
    {
      id: "B7",
      boundary: "provider_applications · field tampering",
      expectation: "A draft submission cannot also rewrite application_data or reviewer fields.",
    },
    () =>
      c.sellerB
        .from("provider_applications")
        .update({
          status: "pending",
          submitted_at: new Date().toISOString(),
          application_data: { injected: true },
        })
        .eq("id", fx.sellerBApplication.id)
        .select("status"),
  );

  if (orderId) {
    await deny(
      {
        id: "B8",
        boundary: "orders · cross-customer read",
        expectation: "Customer B cannot read Customer A's order.",
      },
      () => c.customerB.from("orders").select("id,total_minor").eq("id", orderId),
    );

    await allow(
      {
        id: "B9",
        boundary: "orders · participant read",
        expectation: "The selling provider can read the order they are fulfilling.",
      },
      () => c.seller.from("orders").select("id").eq("id", orderId),
      data => rowCount(data) === 1,
    );

    await deny(
      {
        id: "B10",
        boundary: "orders · unrelated provider read",
        expectation: "A different provider cannot read that order.",
      },
      () => c.sellerB.from("orders").select("id").eq("id", orderId),
    );

    const orderTotal = await backendValue("orders", "total_minor", "id", orderId);
    await denyWrite(
      {
        id: "B11",
        boundary: "orders · total tampering",
        expectation: "A customer cannot rewrite the order total.",
      },
      () => c.customerA.from("orders").update({ total_minor: 1 }).eq("id", orderId).select("total_minor"),
      { table: "orders", field: "total_minor", column: "id", value: orderId, expected: orderTotal },
    );

    const paymentStatus = await backendValue("orders", "payment_status", "id", orderId);
    await denyWrite(
      {
        id: "B12",
        boundary: "orders · payment-status tampering",
        expectation: "A customer cannot mark their own order paid.",
      },
      () => c.customerA.from("orders").update({ payment_status: "paid" }).eq("id", orderId).select("payment_status"),
      { table: "orders", field: "payment_status", column: "id", value: orderId, expected: paymentStatus },
    );

    if (orderLineId) {
      const providerNet = await backendValue("order_items", "provider_net_minor", "id", orderLineId);
      await denyWrite(
        {
          id: "B13",
          boundary: "order_items · payout tampering",
          expectation: "A customer cannot raise the provider payout on an order line.",
        },
        () =>
          c.customerA
            .from("order_items")
            .update({ provider_net_minor: 999999 })
            .eq("id", orderLineId)
            .select("provider_net_minor"),
        { table: "order_items", field: "provider_net_minor", column: "id", value: orderLineId, expected: providerNet },
      );
    } else {
      repeat(
        {
          id: "B13",
          boundary: "order_items · payout tampering",
          expectation: "A customer cannot raise the provider payout on an order line.",
        },
        "No order line was created.",
      );
    }

    await deny(
      {
        id: "B14",
        boundary: "orders · foreign provider status RPC",
        expectation: "A provider who does not own the order cannot advance it.",
      },
      () => c.sellerB.rpc("provider_update_order_status", { p_order_id: orderId, p_to_status: "accepted" }),
    );

    await deny(
      {
        id: "B15",
        boundary: "orders · customer status RPC",
        expectation: "The customer cannot drive the provider-side order state machine.",
      },
      () => c.customerA.rpc("provider_update_order_status", { p_order_id: orderId, p_to_status: "accepted" }),
    );
  } else {
    for (const [id, boundary, expectation] of [
      ["B8", "orders · cross-customer read", "Customer B cannot read Customer A's order."],
      ["B9", "orders · participant read", "The selling provider can read the order they are fulfilling."],
      ["B10", "orders · unrelated provider read", "A different provider cannot read that order."],
      ["B11", "orders · total tampering", "A customer cannot rewrite the order total."],
      ["B12", "orders · payment-status tampering", "A customer cannot mark their own order paid."],
      ["B13", "order_items · payout tampering", "A customer cannot raise the provider payout on an order line."],
      ["B14", "orders · foreign provider status RPC", "A provider who does not own the order cannot advance it."],
      ["B15", "orders · customer status RPC", "The customer cannot drive the provider-side order state machine."],
    ]) {
      repeat({ id, boundary, expectation }, "The order fixture could not be created.");
    }
  }

  await deny(
    {
      id: "B16",
      boundary: "orders · anonymous read",
      expectation: "An unauthenticated visitor cannot read orders.",
    },
    () => c.anon.from("orders").select("id").limit(5),
  );

  /* ---- C. passenger transport --------------------------------------------- */

  if (rideId) {
    await deny(
      {
        id: "C1",
        boundary: "rides · cross-customer read",
        expectation: "Another customer cannot read the ride.",
      },
      () => c.customerB.from("rides").select("id,agreed_fare_minor").eq("id", rideId),
    );

    await deny(
      {
        id: "C2",
        boundary: "rides · cross-rider read",
        expectation: "A rider who was not assigned the ride cannot read it.",
      },
      () => c.riderB.from("rides").select("id").eq("id", rideId),
    );

    await deny(
      {
        id: "C3",
        boundary: "rides · foreign rider progress",
        expectation: "A rider cannot advance a ride assigned to someone else.",
      },
      () => c.riderB.rpc("ride_rider_progress", { p_ride_id: rideId, p_to_status: "arrived" }),
    );

    await deny(
      {
        id: "C4",
        boundary: "rides · customer riding progress",
        expectation: "The customer cannot move the trip through the rider's state transitions.",
      },
      () => c.customerA.rpc("ride_rider_progress", { p_ride_id: rideId, p_to_status: "arrived" }),
    );

    const agreedFare = await backendValue("rides", "agreed_fare_minor", "id", rideId);
    await denyWrite(
      {
        id: "C5",
        boundary: "rides · fare tampering",
        expectation: "Neither party can change the agreed fare by direct write.",
      },
      () =>
        c.customerA
          .from("rides")
          .update({ agreed_fare_minor: 100 })
          .eq("id", rideId)
          .select("agreed_fare_minor"),
      { table: "rides", field: "agreed_fare_minor", column: "id", value: rideId, expected: agreedFare },
    );

    await deny(
      {
        id: "C6",
        boundary: "rides · browser payment confirmation",
        expectation: "A browser client cannot call mark_ride_paid; only the verified server path may.",
      },
      () => c.customerA.rpc("mark_ride_paid", { p_ride_id: rideId, p_reference: "FORGED-RLS", p_provider: "mpesa" }),
    );

    await deny(
      {
        id: "C7",
        boundary: "payments · browser provider confirmation",
        expectation: "A browser client cannot call confirm_provider_payment.",
      },
      () =>
        c.customerA.rpc("confirm_provider_payment", {
          p_provider: "mpesa",
          p_provider_reference: "FORGED-RLS",
          p_amount_minor: 2200,
        }),
    );

    await deny(
      {
        id: "C8",
        boundary: "rides · contact before payment",
        expectation: "The customer cannot read rider contact details before the ride is paid.",
      },
      () => c.customerA.rpc("get_ride_contact", { p_ride_id: rideId }),
    );

    await deny(
      {
        id: "C9",
        boundary: "rides · rider contact before payment",
        expectation: "The rider cannot read customer contact details before the ride is paid.",
      },
      () => c.rider.rpc("get_ride_contact", { p_ride_id: rideId }),
    );

    await deny(
      {
        id: "C10",
        boundary: "rides · foreign earnings read",
        expectation: "A customer cannot read a rider's available balance.",
      },
      () => c.customerA.rpc("rider_available_balance", { p_rider_id: ids.rider.user.id }),
    );

    await deny(
      {
        id: "C11",
        boundary: "rides · ineligible partner",
        expectation: "A ride cannot be requested from an account without an approved transport activity.",
      },
      () =>
        c.customerA.rpc("request_ride", {
          p_payload: {
            rider_id: ids.seller.user.id,
            ride_mode: "car",
            pickup_label: "RLS pickup point",
            dropoff_label: "RLS dropoff point",
            proposed_fare_minor: 2000,
          },
        }),
    );

    await deny(
      {
        id: "C12",
        boundary: "ride_reviews · foreign rating",
        expectation: "A stranger cannot rate a ride they were not part of.",
      },
      () => c.customerB.rpc("rate_ride", { p_ride_id: rideId, p_rating: 1, p_comment: "forged" }),
    );

    await deny(
      {
        id: "C13",
        boundary: "rides · foreign completion",
        expectation: "A stranger cannot confirm completion on another customer's ride.",
      },
      () => c.customerB.rpc("ride_customer_confirm", { p_ride_id: rideId }),
    );

    // Simulate the only legitimate settlement path: the server, holding the service role, after it
    // has verified the provider response. This is setup, not a bypass of the browser boundary.
    const settled = await attempt(() =>
      admin.rpc("mark_ride_paid", {
        p_ride_id: rideId,
        p_reference: `RLS-RIDE-${run.id}`,
        p_provider: "test",
      }),
    );

    if (settled.ok) {
      await allow(
        {
          id: "C14",
          boundary: "rides · contact after payment (customer)",
          expectation: "The paying customer can read contact details once payment is verified.",
        },
        () => c.customerA.rpc("get_ride_contact", { p_ride_id: rideId }),
        data => rowCount(data) >= 1,
      );

      await allow(
        {
          id: "C15",
          boundary: "rides · contact after payment (rider)",
          expectation: "The assigned rider can read the customer's contact details after payment.",
        },
        () => c.rider.rpc("get_ride_contact", { p_ride_id: rideId }),
        data => rowCount(data) >= 1,
      );

      await deny(
        {
          id: "C16",
          boundary: "rides · contact isolation after payment",
          expectation: "An unrelated customer still cannot read the contact details.",
        },
        () => c.customerB.rpc("get_ride_contact", { p_ride_id: rideId }),
      );

      await allow(
        {
          id: "C17",
          boundary: "rides · payer still reads the ride",
          expectation: "The customer keeps access to the ride they paid for.",
        },
        () => c.customerA.from("rides").select("id,payment_status").eq("id", rideId),
        data => rowCount(data) === 1,
      );
    } else {
      for (const [id, boundary] of [
        ["C14", "rides · contact after payment (customer)"],
        ["C15", "rides · contact after payment (rider)"],
        ["C16", "rides · contact isolation after payment"],
        ["C17", "rides · payer still reads the ride"],
      ]) {
        repeat({ id, boundary, expectation: "Payment-gated read after a verified settlement." }, `The settlement fixture failed: ${settled.error?.message ?? "unknown"}`);
      }
    }
  } else {
    for (const [id, boundary, expectation] of [
      ["C1", "rides · cross-customer read", "Another customer cannot read the ride."],
      ["C2", "rides · cross-rider read", "A rider who was not assigned the ride cannot read it."],
      ["C3", "rides · foreign rider progress", "A rider cannot advance a ride assigned to someone else."],
      ["C4", "rides · customer riding progress", "The customer cannot move the trip through the rider's state transitions."],
      ["C5", "rides · fare tampering", "Neither party can change the agreed fare by direct write."],
      ["C6", "rides · browser payment confirmation", "A browser client cannot call mark_ride_paid."],
      ["C7", "payments · browser provider confirmation", "A browser client cannot call confirm_provider_payment."],
      ["C8", "rides · contact before payment", "The customer cannot read rider contact details before payment."],
      ["C9", "rides · rider contact before payment", "The rider cannot read customer contact details before payment."],
      ["C10", "rides · foreign earnings read", "A customer cannot read a rider's available balance."],
      ["C11", "rides · ineligible partner", "A ride cannot be requested from an ineligible account."],
      ["C12", "ride_reviews · foreign rating", "A stranger cannot rate a ride they were not part of."],
      ["C13", "rides · foreign completion", "A stranger cannot confirm completion on another customer's ride."],
    ]) {
      repeat({ id, boundary, expectation }, "The ride fixture could not be created.");
    }
  }

  /* ---- D. House Hunt ------------------------------------------------------ */

  const search = await attempt(() => c.anon.rpc("search_public_properties", {}));
  if (search.ok) {
    const rows = Array.isArray(search.data) ? search.data : [];
    const leakedKeys = new Set();
    for (const row of rows) {
      for (const key of Object.keys(row ?? {})) {
        if (/address|phone|contact|unit/i.test(key)) leakedKeys.add(key);
      }
    }
    if (leakedKeys.size === 0) {
      recorder.pass(
        {
          id: "D1",
          boundary: "House Hunt · public search columns",
          expectation: "The public search RPC returns no address or contact columns.",
        },
        `${rows.length} public row(s); no contact columns`,
      );
    } else {
      recorder.fail(
        {
          id: "D1",
          boundary: "House Hunt · public search columns",
          expectation: "The public search RPC returns no address or contact columns.",
        },
        `leaked columns: ${[...leakedKeys].join(", ")}`,
      );
    }

    const serialised = JSON.stringify(rows);
    if (!serialised.includes("Unit 7B") && !serialised.includes("+254700000001")) {
      recorder.pass(
        {
          id: "D2",
          boundary: "House Hunt · public search values",
          expectation: "Exact address and landlord phone never appear in public search results.",
        },
        "no protected value present in the payload",
      );
    } else {
      recorder.fail(
        {
          id: "D2",
          boundary: "House Hunt · public search values",
          expectation: "Exact address and landlord phone never appear in public search results.",
        },
        "a protected contact value appeared in the public payload",
      );
    }
  } else {
    repeat(
      {
        id: "D1",
        boundary: "House Hunt · public search columns",
        expectation: "The public search RPC returns no address or contact columns.",
      },
      `search_public_properties failed: ${search.error.message}`,
    );
    repeat(
      {
        id: "D2",
        boundary: "House Hunt · public search values",
        expectation: "Exact address and landlord phone never appear in public search results.",
      },
      `search_public_properties failed: ${search.error.message}`,
    );
  }

  await deny(
    {
      id: "D3",
      boundary: "property_contacts · anonymous table read",
      expectation: "An unauthenticated visitor cannot read the contacts table.",
    },
    () => c.anon.from("property_contacts").select("listing_id,exact_address").limit(5),
  );

  await deny(
    {
      id: "D4",
      boundary: "property_contacts · non-owner read",
      expectation: "A different customer cannot read the landlord's protected contact row.",
    },
    () =>
      c.customerB
        .from("property_contacts")
        .select("listing_id,exact_address,contact_phone")
        .eq("listing_id", fx.landlordListing.id),
  );

  await deny(
    {
      id: "D5",
      boundary: "property_verification_documents · non-owner read",
      expectation: "A stranger cannot read a property's private verification documents.",
    },
    () => c.customerB.from("property_verification_documents").select("id,storage_path").limit(5),
  );

  await deny(
    {
      id: "D6",
      boundary: "House Hunt · contact RPC without payment",
      expectation: "get_property_contact refuses a user who has not paid.",
    },
    () => c.customerB.rpc("get_property_contact", { p_listing_id: fx.landlordListing.id }),
  );

  await deny(
    {
      id: "D7",
      boundary: "property_contact_unlocks · self-granted entitlement",
      expectation: "A user cannot insert their own paid unlock row.",
    },
    () =>
      c.customerB
        .from("property_contact_unlocks")
        .insert({
          user_id: ids.customerB.user.id,
          listing_id: fx.landlordListing.id,
          amount_minor: 2000,
          provider: "forged",
          payment_reference: `FORGED-${run.id}`,
          status: "paid",
        })
        .select("id"),
  );

  await deny(
    {
      id: "D8",
      boundary: "property_contact_unlocks · entitlement mutation",
      expectation: "A user cannot update an existing unlock row.",
    },
    () =>
      c.customerB
        .from("property_contact_unlocks")
        .update({ status: "paid" })
        .eq("listing_id", fx.landlordListing.id)
        .select("id"),
  );

  await deny(
    {
      id: "D9",
      boundary: "property_contact_unlocks · completion RPC",
      expectation: "A browser client cannot call the internal unlock completion function.",
    },
    () =>
      c.customerB.rpc("complete_property_unlock", {
        p_intent_id: "00000000-0000-0000-0000-000000000000",
        p_provider_reference: `FORGED-${run.id}`,
        p_provider: "mpesa",
      }),
  );

  const rentBefore = await backendValue("property_listings", "rent_minor", "listing_id", fx.landlordListing.id);
  await denyWrite(
    {
      id: "D10",
      boundary: "property_listings · cross-landlord write",
      expectation: "Another landlord cannot change the rent on someone else's property.",
    },
    () =>
      c.landlordB
        .from("property_listings")
        .update({ rent_minor: 100 })
        .eq("listing_id", fx.landlordListing.id)
        .select("rent_minor"),
    {
      table: "property_listings",
      field: "rent_minor",
      column: "listing_id",
      value: fx.landlordListing.id,
      expected: rentBefore,
    },
  );

  const addressBefore = await backendValue(
    "property_contacts",
    "exact_address",
    "listing_id",
    fx.landlordListing.id,
  );
  await denyWrite(
    {
      id: "D11",
      boundary: "property_contacts · cross-landlord write",
      expectation: "Another landlord cannot change the protected contact details.",
    },
    () =>
      c.landlordB
        .from("property_contacts")
        .update({ exact_address: "RLS overwritten address" })
        .eq("listing_id", fx.landlordListing.id)
        .select("exact_address"),
    {
      table: "property_contacts",
      field: "exact_address",
      column: "listing_id",
      value: fx.landlordListing.id,
      expected: addressBefore,
    },
  );

  await deny(
    {
      id: "D12",
      boundary: "property_contacts · staff without MFA",
      expectation: "A properties.verify staff session at aal1 cannot read contacts.",
    },
    () =>
      c.staffLow
        .from("property_contacts")
        .select("listing_id,exact_address")
        .eq("listing_id", fx.landlordListing.id),
  );

  if (mfa.staff.ok) {
    await allow(
      {
        id: "D13",
        boundary: "property_contacts · staff with MFA",
        expectation: "A properties.verify staff session at aal2 can review the contact row.",
      },
      () =>
        c.staff
          .from("property_contacts")
          .select("listing_id,exact_address")
          .eq("listing_id", fx.landlordListing.id),
      data => rowCount(data) === 1,
    );
  } else {
    repeat(
      {
        id: "D13",
        boundary: "property_contacts · staff with MFA",
        expectation: "A properties.verify staff session at aal2 can review the contact row.",
      },
      "Requires the staff account to reach aal2.",
    );
  }

  // Seed the paid entitlement the same way a verified provider callback would, then prove the read
  // gate and the ownership filter independent of the payment provider.
  let unlockId = null;
  try {
    const seeded = await admin
      .from("property_contact_unlocks")
      .insert({
        user_id: ids.customerA.user.id,
        listing_id: fx.landlordListing.id,
        amount_minor: 2000,
        currency: "KES",
        provider: "test",
        payment_reference: `RLS-UNLOCK-${run.id}`,
        status: "paid",
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      })
      .select("id")
      .single();
    if (seeded.error) throw seeded.error;
    unlockId = seeded.data.id;
    run.unlockIds.push(unlockId);
  } catch (error) {
    notes.push(`Property unlock fixture unavailable: ${redact(error.message)}`);
  }

  if (unlockId) {
    await allow(
      {
        id: "D14",
        boundary: "House Hunt · contact after payment",
        expectation: "The buyer with a paid entitlement receives the exact address and contact.",
      },
      () => c.customerA.rpc("get_property_contact", { p_listing_id: fx.landlordListing.id }),
      data => rowCount(data) === 1 && JSON.stringify(data).includes("Unit 7B"),
    );

    await deny(
      {
        id: "D15",
        boundary: "House Hunt · contact isolation",
        expectation: "A second customer without the entitlement is still refused.",
      },
      () => c.customerB.rpc("get_property_contact", { p_listing_id: fx.landlordListing.id }),
    );

    await deny(
      {
        id: "D16",
        boundary: "property_contact_unlocks · foreign entitlement read",
        expectation: "Customer B cannot read Customer A's unlock records.",
      },
      () =>
        c.customerB
          .from("property_contact_unlocks")
          .select("id,listing_id,status")
          .eq("user_id", ids.customerA.user.id),
    );

    await allow(
      {
        id: "D17",
        boundary: "property_contact_unlocks · own entitlement read",
        expectation: "The buyer can read their own entitlement.",
      },
      () =>
        c.customerA
          .from("property_contact_unlocks")
          .select("id,listing_id,status")
          .eq("user_id", ids.customerA.user.id),
      data => rowCount(data) >= 1 && data.every(row => row.listing_id === fx.landlordListing.id),
    );

    // The entitlement grants access through the RPC only; the raw contact table stays closed.
    await deny(
      {
        id: "D18",
        boundary: "property_contacts · table bypass",
        expectation: "Even a paying buyer cannot read the protected table directly.",
      },
      () =>
        c.customerA
          .from("property_contacts")
          .select("listing_id,exact_address")
          .eq("listing_id", fx.landlordListing.id),
    );
  } else {
    for (const [id, boundary, expectation] of [
      ["D14", "House Hunt · contact after payment", "The buyer with a paid entitlement receives the exact address."],
      ["D15", "House Hunt · contact isolation", "A second customer without the entitlement is still refused."],
      ["D16", "property_contact_unlocks · foreign entitlement read", "Customer B cannot read Customer A's unlock records."],
      ["D17", "property_contact_unlocks · own entitlement read", "The buyer can read their own entitlement."],
      ["D18", "property_contacts · table bypass", "Even a paying buyer cannot read the protected table directly."],
    ]) {
      repeat({ id, boundary, expectation }, "The entitlement fixture could not be seeded.");
    }
  }

  // Sandbox settlement is a configuration hazard: when it is on, an ordinary user can create an
  // entitlement without a verified provider payment. That is documented sandbox behaviour, so it is
  // reported as BLOCKED rather than passed. When it is off it must refuse every caller.
  if (sandboxEnabled) {
    repeat(
      {
        id: "D19",
        boundary: "House Hunt · entitlement requires verified payment",
        expectation: "In a money-taking configuration, an ordinary user cannot create an entitlement.",
      },
      "Sandbox settlement is enabled on this project: unlocks are free by design. Set payment_mode to a real provider and allow_mock_payments to false before handling money.",
    );

    if (orderId) {
      await deny(
        {
          id: "D20",
          boundary: "payments · sandbox confirmation of a foreign order",
          expectation: "Sandbox confirmation still cannot settle an order belonging to another customer.",
        },
        () => c.customerB.rpc("confirm_mock_payment", { p_order_id: orderId }),
      );
    } else {
      repeat(
        {
          id: "D20",
          boundary: "payments · sandbox confirmation of a foreign order",
          expectation: "Sandbox confirmation still cannot settle an order belonging to another customer.",
        },
        "The order fixture could not be created.",
      );
    }
  } else {
    // Fail closed: with the sandbox switch off, every mock settlement path must refuse, and a refusal
    // must leave no entitlement, payment or balance behind.
    let unlockCreated = null;
    await denyWrite(
      {
        id: "D19",
        boundary: "House Hunt · entitlement requires verified payment",
        expectation: "The sandbox unlock RPC is refused while sandbox settlement is off.",
      },
      () => c.customerB.rpc("confirm_mock_property_unlock", { p_listing_id: fx.landlordListing.id }),
      undefined,
    );
    try {
      const rows = await admin
        .from("property_contact_unlocks")
        .select("id")
        .eq("user_id", ids.customerB.user.id)
        .eq("listing_id", fx.landlordListing.id);
      if (rows.error) throw rows.error;
      unlockCreated = (rows.data ?? []).length;
    } catch {
      unlockCreated = null;
    }
    if (unlockCreated === 0) {
      recorder.pass(
        {
          id: "D19b",
          boundary: "House Hunt · refused unlock left no entitlement",
          expectation: "A refused sandbox unlock creates no contact entitlement.",
        },
        "no unlock row exists for the refused buyer",
      );
    } else {
      recorder.fail(
        {
          id: "D19b",
          boundary: "House Hunt · refused unlock left no entitlement",
          expectation: "A refused sandbox unlock creates no contact entitlement.",
        },
        unlockCreated === null ? "the entitlement could not be verified" : `${unlockCreated} entitlement row(s) exist`,
      );
    }

    if (orderId) {
      const orderStatusBefore = await backendValue("orders", "status", "id", orderId);
      await denyWrite(
        {
          id: "D20",
          boundary: "payments · sandbox confirmation disabled",
          expectation: "The sandbox order confirmation RPC is refused while sandbox settlement is off.",
        },
        () => c.customerA.rpc("confirm_mock_payment", { p_order_id: orderId }),
        { table: "orders", field: "status", column: "id", value: orderId, expected: orderStatusBefore },
      );
    } else {
      repeat(
        {
          id: "D20",
          boundary: "payments · sandbox confirmation disabled",
          expectation: "The sandbox order confirmation RPC is refused while sandbox settlement is off.",
        },
        "The order fixture could not be created.",
      );
    }

    if (rideId) {
      const rideStatusBefore = await backendValue("rides", "payment_status", "id", rideId);
      await denyWrite(
        {
          id: "D21",
          boundary: "transport · sandbox ride payment disabled",
          expectation: "The sandbox ride settlement RPC is refused while sandbox settlement is off.",
        },
        () => c.customerA.rpc("confirm_mock_ride_payment", { p_ride_id: rideId }),
        { table: "rides", field: "payment_status", column: "id", value: rideId, expected: rideStatusBefore },
      );
    } else {
      repeat(
        {
          id: "D21",
          boundary: "transport · sandbox ride payment disabled",
          expectation: "The sandbox ride settlement RPC is refused while sandbox settlement is off.",
        },
        "The ride fixture could not be created.",
      );
    }
  }

  /* ---- E. payments, ledger and payouts ------------------------------------ */

  if (intentId) {
    await deny(
      {
        id: "E1",
        boundary: "payment_intents · cross-customer read",
        expectation: "Another customer cannot read the payment intent.",
      },
      () => c.customerB.from("payment_intents").select("id,status,amount_minor").eq("id", intentId),
    );

    await allow(
      {
        id: "E2",
        boundary: "payment_intents · own read",
        expectation: "The payer can read their own intent.",
      },
      () => c.customerA.from("payment_intents").select("id,status").eq("id", intentId),
      data => rowCount(data) === 1,
    );

    const intentStatus = await backendValue("payment_intents", "status", "id", intentId);
    await denyWrite(
      {
        id: "E3",
        boundary: "payment_intents · status tampering",
        expectation: "A payer cannot mark their own intent succeeded.",
      },
      () =>
        c.customerA
          .from("payment_intents")
          .update({ status: "succeeded" })
          .eq("id", intentId)
          .select("status"),
      { table: "payment_intents", field: "status", column: "id", value: intentId, expected: intentStatus },
    );
  } else {
    for (const [id, boundary, expectation] of [
      ["E1", "payment_intents · cross-customer read", "Another customer cannot read the payment intent."],
      ["E2", "payment_intents · own read", "The payer can read their own intent."],
      ["E3", "payment_intents · status tampering", "A payer cannot mark their own intent succeeded."],
    ]) {
      repeat({ id, boundary, expectation }, "The payment intent fixture could not be created.");
    }
  }

  await deny(
    {
      id: "E4",
      boundary: "payment_intents · client insert",
      expectation: "A client cannot create a payment intent row directly.",
    },
    () =>
      c.customerA
        .from("payment_intents")
        .insert({
          user_id: ids.customerA.user.id,
          purpose: "property_contact",
          listing_id: fx.landlordListing.id,
          provider: "mock",
          amount_minor: 1,
          status: "succeeded",
        })
        .select("id"),
  );

  if (orderId) {
    await deny(
      {
        id: "E5",
        boundary: "payment_intents · foreign order intent",
        expectation: "Customer B cannot create an intent against Customer A's order.",
      },
      () => c.customerB.rpc("create_payment_intent", { p_purpose: "order", p_target_id: orderId }),
    );
  } else {
    repeat(
      {
        id: "E5",
        boundary: "payment_intents · foreign order intent",
        expectation: "Customer B cannot create an intent against Customer A's order.",
      },
      "The order fixture could not be created.",
    );
  }

  await deny(
    {
      id: "E6",
      boundary: "ledger_entries · customer read",
      expectation: "An ordinary customer cannot read the ledger.",
    },
    () => c.customerA.from("ledger_entries").select("id,account,credit_minor").limit(10),
  );

  await deny(
    {
      id: "E7",
      boundary: "ledger_entries · client insert",
      expectation: "A client cannot insert a ledger entry.",
    },
    () =>
      c.customerA
        .from("ledger_entries")
        .insert({
          entry_type: "adjustment",
          account: "provider_payable",
          debit_minor: 0,
          credit_minor: 999999,
          currency: "KES",
        })
        .select("id"),
  );

  await deny(
    {
      id: "E8",
      boundary: "ledger_entries · client update",
      expectation: "A client cannot rewrite a ledger entry.",
    },
    () => c.customerA.from("ledger_entries").update({ credit_minor: 1 }).select("id"),
  );

  if (riderBPayoutId) {
    await deny(
      {
        id: "E9",
        boundary: "payments · browser payout decision",
        expectation: "A customer cannot call admin_update_payout.",
      },
      () => c.customerA.rpc("admin_update_payout", { p_payout_id: riderBPayoutId, p_status: "paid" }),
    );
  } else {
    repeat(
      {
        id: "E9",
        boundary: "payments · browser payout decision",
        expectation: "A customer cannot call admin_update_payout.",
      },
      "The payout fixture could not be seeded.",
    );
  }

  if (riderBPayoutId) {
    const payoutStatus = await backendValue("payouts", "status", "id", riderBPayoutId);
    if (payoutStatus === "pending") {
      recorder.pass(
        {
          id: "E9b",
          boundary: "payouts · decision had no effect",
          expectation: "The refused payout decision leaves the payout untouched.",
        },
        "payout is still pending",
      );
    } else {
      recorder.fail(
        {
          id: "E9b",
          boundary: "payouts · decision had no effect",
          expectation: "The refused payout decision leaves the payout untouched.",
        },
        `payout status is now "${payoutStatus}"`,
      );
    }

    await deny(
      {
        id: "E10",
        boundary: "payouts · cross-rider read",
        expectation: "A rider cannot read another rider's payout.",
      },
      () => c.rider.from("payouts").select("id,amount_minor").eq("id", riderBPayoutId),
    );

    await allow(
      {
        id: "E11",
        boundary: "payouts · own read",
        expectation: "The payee can read their own payout.",
      },
      () => c.riderB.from("payouts").select("id,status").eq("id", riderBPayoutId),
      data => rowCount(data) === 1,
    );
  } else {
    for (const [id, boundary, expectation] of [
      ["E10", "payouts · cross-rider read", "A rider cannot read another rider's payout."],
      ["E11", "payouts · own read", "The payee can read their own payout."],
    ]) {
      repeat({ id, boundary, expectation }, "The payout fixture could not be seeded.");
    }
  }

  await deny(
    {
      id: "E12",
      boundary: "payouts · customer read",
      expectation: "A customer who is not a payee cannot read payouts.",
    },
    () => c.customerA.from("payouts").select("id").limit(5),
  );

  if (orderId) {
    await deny(
      {
        id: "E13",
        boundary: "payments · browser order settlement",
        expectation: "A browser client cannot call mark_order_paid.",
      },
      () => c.customerA.rpc("mark_order_paid", { p_order_id: orderId, p_reference: "FORGED-RLS", p_provider: "mpesa" }),
    );
  } else {
    repeat(
      {
        id: "E13",
        boundary: "payments · browser order settlement",
        expectation: "A browser client cannot call mark_order_paid.",
      },
      "The order fixture could not be created.",
    );
  }

  if (riderBPayoutId) {
    await deny(
      {
        id: "E14",
        boundary: "payments · browser payout settlement",
        expectation: "A browser client cannot call confirm_provider_payout.",
      },
      () => c.riderB.rpc("confirm_provider_payout", { p_payout_id: riderBPayoutId, p_status: "paid" }),
    );
  } else {
    repeat(
      {
        id: "E14",
        boundary: "payments · browser payout settlement",
        expectation: "A browser client cannot call confirm_provider_payout.",
      },
      "The payout fixture could not be seeded.",
    );
  }

  /* ---- F. notifications and audit ---------------------------------------- */

  await deny(
    {
      id: "F1",
      boundary: "notification_outbox · customer read",
      expectation: "A customer cannot read the notification outbox.",
    },
    () => c.customerA.from("notification_outbox").select("id,payload").limit(5),
  );

  await deny(
    {
      id: "F2",
      boundary: "notification_outbox · client insert",
      expectation: "A customer cannot queue outbox rows.",
    },
    () =>
      c.customerA
        .from("notification_outbox")
        .insert({ user_id: ids.customerA.user.id, template: "forged", recipient: "forged@example.com" })
        .select("id"),
  );

  await deny(
    {
      id: "F3",
      boundary: "notification_outbox · customer update",
      expectation: "A customer cannot alter delivery status once a row exists.",
    },
    () => c.customerA.from("notification_outbox").update({ status: "sent" }).select("id"),
  );

  await deny(
    {
      id: "F4",
      boundary: "audit_events · customer read",
      expectation: "An ordinary customer cannot read the audit log.",
    },
    () => c.customerA.from("audit_events").select("id,action,metadata").limit(10),
  );

  await deny(
    {
      id: "F5",
      boundary: "audit_events · client insert",
      expectation: "A customer cannot forge an audit record.",
    },
    () =>
      c.customerA
        .from("audit_events")
        .insert({ actor_id: ids.customerA.user.id, action: "forged", resource_type: "test" })
        .select("id"),
  );

  await deny(
    {
      id: "F6",
      boundary: "audit_events · client update",
      expectation: "A customer cannot modify audit records.",
    },
    () => c.customerA.from("audit_events").update({ outcome: "failure" }).select("id"),
  );

  if (mfa.staff.ok) {
    await deny(
      {
        id: "F7",
        boundary: "audit_events · staff without audit.read",
        expectation: "Staff with orders.read and finance.read still cannot read the audit log.",
      },
      () => c.staff.from("audit_events").select("id").limit(5),
    );
  } else {
    repeat(
      {
        id: "F7",
        boundary: "audit_events · staff without audit.read",
        expectation: "Staff with orders.read and finance.read still cannot read the audit log.",
      },
      "Requires the staff account to reach aal2.",
    );
  }

  await allow(
    {
      id: "F8",
      boundary: "notification preferences · own write",
      expectation: "A customer can manage their own notification preferences.",
    },
    async () => {
      const existing = await c.customerA
        .from("user_notification_preferences")
        .select("user_id")
        .eq("user_id", ids.customerA.user.id);
      if (existing.error) return existing;
      if ((existing.data ?? []).length === 0) {
        return c.customerA
          .from("user_notification_preferences")
          .insert({ user_id: ids.customerA.user.id })
          .select("user_id");
      }
      return c.customerA
        .from("user_notification_preferences")
        .update({ marketplace_updates: false })
        .eq("user_id", ids.customerA.user.id)
        .select("user_id");
    },
    data => Array.isArray(data) && data.every(row => row.user_id === ids.customerA.user.id),
  );

  await deny(
    {
      id: "F9",
      boundary: "notification preferences · cross-customer read",
      expectation: "Customer B cannot read Customer A's preferences.",
    },
    () =>
      c.customerB
        .from("user_notification_preferences")
        .select("user_id")
        .eq("user_id", ids.customerA.user.id),
  );

  await deny(
    {
      id: "F10",
      boundary: "notification preferences · cross-customer write",
      expectation: "Customer B cannot change Customer A's preferences.",
    },
    () =>
      c.customerB
        .from("user_notification_preferences")
        .update({ marketplace_updates: false })
        .eq("user_id", ids.customerA.user.id)
        .select("user_id"),
  );

  /* ---- G. storage --------------------------------------------------------- */

  const buckets = await attempt(() => admin.storage.listBuckets());
  if (!buckets.ok) {
    recorder.fail(
      {
        id: "G1",
        boundary: "storage · bucket inventory",
        expectation: "The suite can enumerate storage buckets with the service role.",
      },
      buckets.error.message,
    );
  } else if ((buckets.data ?? []).length === 0) {
    recorder.notTested(
      {
        id: "G1",
        boundary: "storage · bucket inventory",
        expectation: "Every non-public bucket denies ordinary users.",
      },
      "the project has no storage buckets yet — no policy can be exercised",
    );
  } else {
    for (const bucket of buckets.data) {
      const meta = {
        id: `G1:${bucket.name}`,
        boundary: `storage · bucket "${bucket.name}"`,
        expectation: bucket.public
          ? "A public bucket is readable only where the product intends it."
          : "A private bucket refuses listing to an ordinary customer.",
      };
      if (bucket.public) {
        recorder.notTested(
          meta,
          "bucket is marked public; review that this is intended for listing images only",
        );
        continue;
      }
      await deny(meta, () => c.customerA.storage.from(bucket.name).list("", { limit: 5 }));
      await deny(
        {
          id: `G2:${bucket.name}`,
          boundary: `storage · bucket "${bucket.name}" anonymous`,
          expectation: "A private bucket refuses anonymous listing.",
        },
        () => c.anon.storage.from(bucket.name).list("", { limit: 5 }),
      );
    }
  }

  return notes;
}

/* ------------------------------------------------------------------ main */

async function main() {
  if (!config.configured) {
    console.error("BLOCKED — NOT RUN: the live RLS suite is not configured.\n");
    for (const reason of config.blocked) console.error(`  - ${reason}`);
    console.error("\nRequired before it can run against a disposable Supabase project:");
    console.error("  NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co");
    console.error("  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key>");
    console.error("  SUPABASE_SERVICE_ROLE_KEY=<service role key>");
    console.error("  SHILEVI_RLS_ALLOW_LIVE=1");
    console.error("\nSee docs/RLS_NEGATIVE_TESTS.md. No request was made to any project.");
    run = null;
    finish(2, config.blocked);
    return;
  }

  for (const warning of config.warnings) console.warn(`warning: ${warning}`);
  console.log(`Live RLS suite against ${config.host}`);

  run = createRun();
  try {
    const state = await provision(config, run, stage => console.log(`setup: ${stage}`));
    service = state.service;
    console.log(
      `Identities ready (owner MFA: ${state.mfa.owner.ok ? "aal2" : "unavailable"}, staff MFA: ${state.mfa.staff.ok ? "aal2" : "unavailable"})`,
    );

    const notes = await runMatrix(state);
    notes.push(`Test accounts: ${run.userIds.length} created for run ${run.id}.`);

    if (!config.keepData) {
      const cleanupWarnings = await cleanup(state.service, run);
      if (cleanupWarnings.length) {
        for (const warning of cleanupWarnings) console.warn(`cleanup: ${warning}`);
        notes.push(`Cleanup reported ${cleanupWarnings.length} warning(s); see console output.`);
      } else {
        notes.push("Cleanup removed every record created by this run.");
      }
    } else {
      notes.push("SHILEVI_RLS_KEEP_DATA=1: created records were left in place for inspection.");
    }

    const counts = recorder.summary();
    console.log(
      `\nPASS ${counts.PASS} · FAIL ${counts.FAIL} · BLOCKED ${counts.BLOCKED} · NOT TESTED ${counts["NOT TESTED"]}`,
    );
    finish(counts.FAIL > 0 ? 1 : 0, notes);
  } catch (error) {
    const message = redact(error instanceof Error ? error.message : String(error));
    recorder.blocked(
      {
        id: "SETUP",
        boundary: "test environment provisioning",
        expectation: "A disposable project with auth admin access and the migrations applied.",
      },
      message,
    );
    console.error(`\nBLOCKED — NOT RUN: provisioning failed: ${message}`);
    if (service && run?.userIds?.length && !config.keepData) {
      const warnings = await cleanup(service, run).catch(() => []);
      for (const warning of warnings) console.warn(`cleanup: ${warning}`);
    }
    finish(2, [`Provisioning failed: ${message}`], message);
  }
}

main().catch(error => {
  console.error("Unexpected failure:", redact(error instanceof Error ? error.stack ?? error.message : String(error)));
  process.exit(1);
});
