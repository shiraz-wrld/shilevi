"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCart } from "@/components/cart/CartProvider";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { formatMoney } from "@/lib/money";
import { MapPinPicker, type PickedPoint } from "@/components/tracking/MapPinPicker";

type County = { id: string; county: string; county_code: number };
type CheckoutSettings = {
  currency?: string;
  payment_mode?: string;
  delivery_flat_fee_minor?: number;
  commission_rate_bps?: number;
  delivery_commission_bps?: number;
};
type DeliveryMethod = "platform_delivery" | "seller_delivery" | "pickup";
type PaymentMethod = { provider: string; label: string; sandbox: boolean };

function friendlyOrderError(message: string) {
  if (/one seller at a time/i.test(message)) return "Your cart contains more than one seller. Please keep one seller per order.";
  if (/no longer available|no longer exists/i.test(message)) return "One of your items is no longer available. Remove it from your cart and try again.";
  if (/sign in required/i.test(message)) return "Please sign in again before placing the order.";
  if (/payment reference/i.test(message)) return "That payment reference was already used. Open your order history to check the result.";
  if (/not authorized|permission denied/i.test(message)) return "Your session is not allowed to do that. Sign in again and retry.";
  return message;
}

export default function CheckoutPage() {
  const router = useRouter();
  const { items, isReady, subtotalMinor, currency, clear } = useCart();
  const [userId, setUserId] = useState("");
  const [settings, setSettings] = useState<CheckoutSettings | null>(null);
  const [counties, setCounties] = useState<County[]>([]);
  const [method, setMethod] = useState<DeliveryMethod>("platform_delivery");
  const [county, setCounty] = useState("Nairobi");
  const [address, setAddress] = useState("");
  const [pin, setPin] = useState<PickedPoint | null>(null);
  const [landmark, setLandmark] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [createdOrderId, setCreatedOrderId] = useState("");
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [provider, setProvider] = useState("");

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const db = createSupabaseBrowserClient();
        const auth = await db.auth.getUser();
        if (auth.error) throw auth.error;
        if (!auth.data.user) {
          window.location.replace("/login?next=%2Fcheckout");
          return;
        }
        if (!alive) return;
        setUserId(auth.data.user.id);

        const [settingResult, countyResult, profileResult] = await Promise.all([
          db.rpc("get_checkout_settings"),
          db.from("service_locations").select("id,county,county_code").eq("is_active", true).order("sort_order"),
          db.from("user_onboarding").select("phone,county").eq("user_id", auth.data.user.id).maybeSingle(),
        ]);

        if (settingResult.error) throw settingResult.error;
        if (countyResult.error) throw countyResult.error;
        if (!alive) return;

        const methodResponse = await fetch("/api/payments/methods?purpose=order", { cache: "no-store" });
        const methodPayload = (await methodResponse.json().catch(() => ({}))) as {
          methods?: PaymentMethod[];
          error?: string;
        };
        if (!methodResponse.ok) throw new Error(methodPayload.error ?? "Payment methods could not be loaded.");
        const available = Array.isArray(methodPayload.methods) ? methodPayload.methods : [];
        if (!alive) return;
        setMethods(available);
        setProvider(current => current || available[0]?.provider || "");

        setSettings((settingResult.data ?? {}) as CheckoutSettings);
        setCounties((countyResult.data ?? []) as County[]);
        if (profileResult.data?.phone) setPhone(String(profileResult.data.phone).slice(0, 32));
        if (profileResult.data?.county) {
          const saved = String(profileResult.data.county);
          setCounty(saved);
        }
      } catch (caught) {
        if (alive) setError(caught instanceof Error ? caught.message : "We could not load checkout. Confirm migrations 0016-0018 have been reviewed and applied.");
      } finally {
        if (alive) setLoading(false);
      }
    }
    void load();
    return () => { alive = false; };
  }, []);

  const platformFee = method === "platform_delivery" ? Number(settings?.delivery_flat_fee_minor ?? 10000) : 0;
  const totalMinor = subtotalMinor + platformFee;
  const sandbox = methods.some(item => item.sandbox);
  const canPay = methods.length > 0;

  const selectedCounty = useMemo(() => counties.find(item => item.county === county) ?? null, [counties, county]);

  async function placeOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setCreatedOrderId("");

    if (!userId) { window.location.replace("/login?next=%2Fcheckout"); return; }
    if (!items.length) { setError("Your cart is empty."); return; }
    if (!canPay) {
      setError("No payment method is available yet. The owner must configure and activate one before customers can pay.");
      return;
    }
    if (!provider) {
      setError("Choose how you want to pay.");
      return;
    }
    if ((method !== "pickup" || provider === "mpesa") && phone.trim().length < 7) {
      setError("Add a phone number the seller or rider can use for this order.");
      return;
    }
    if (method !== "pickup" && address.trim().length < 5) {
      setError("Add a delivery address with enough detail for the seller or rider.");
      return;
    }
    if (method === "platform_delivery" && !selectedCounty) {
      setError("Choose the county for this delivery.");
      return;
    }

    setBusy(true);
    try {
      const db = createSupabaseBrowserClient();
      const deliveryAddress = method === "pickup"
        ? null
        : `${address.trim()}, ${selectedCounty?.county ?? county}`.slice(0, 500);

      const orderResult = await db.rpc("create_order", {
        p_items: items.map(item => ({ listing_id: item.listingId, quantity: item.quantity })),
        p_delivery_method: method,
        p_delivery_address: deliveryAddress,
        p_contact_phone: phone.trim() || null,
        p_notes: notes.trim() || null,
      });
      if (orderResult.error) {
        setError(friendlyOrderError(orderResult.error.message));
        return;
      }

      const created = (Array.isArray(orderResult.data) ? orderResult.data[0] : orderResult.data) as
        | { order_id?: string; order_number?: string }
        | null;
      if (!created?.order_id) {
        setError("The order was created but its reference could not be read. Check your order history before trying again.");
        return;
      }

      // The pin is attached after the order exists, and only when the customer placed one. A
      // feedback failure here must stop the flow before payment rather than silently shipping an
      // order whose destination nobody confirmed.
      if (method === "platform_delivery" && pin) {
        const destination = await db.rpc("set_delivery_destination", {
          p_order_id: created.order_id,
          p_lat: pin.latitude,
          p_lng: pin.longitude,
          p_accuracy_m: pin.accuracy_m,
          p_landmark: landmark.trim() || null,
        });
        if (destination.error) {
          setCreatedOrderId(created.order_id);
          setError("Your order was created, but the exact destination could not be saved. Open the order to set it before paying.");
          return;
        }
      }

      if (provider === "mock") {
        const paymentResult = await db.rpc("confirm_mock_payment", {
          p_order_id: created.order_id,
          p_reference: `MOCK-${created.order_number ?? created.order_id}`.slice(0, 120),
        });
        if (paymentResult.error) {
          clear();
          setCreatedOrderId(created.order_id);
          setError("Your order was created, but the sandbox payment did not complete. Open the order to retry payment. Do not submit a second order.");
          return;
        }
        clear();
        router.push(`/account/orders/${created.order_id}?placed=1`);
        return;
      }

      if (provider === "mpesa") {
        const response = await fetch("/api/payments/mpesa/initiate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            purpose: "order",
            targetId: created.order_id,
            phone: phone.trim(),
            idempotencyKey: `order-${created.order_id}`,
          }),
        });
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) {
          clear();
          setCreatedOrderId(created.order_id);
          setError(payload.error ?? "M-Pesa could not start the payment. Your order was created; open it to retry. Do not submit a second order.");
          return;
        }
        clear();
        router.push(`/account/orders/${created.order_id}?awaiting=1`);
        return;
      }

      clear();
      setCreatedOrderId(created.order_id);
      setError("That payment method is not available right now. Your order was created; open it to pay with another method.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We could not place the order. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!isReady || loading) return <main className="min-h-screen bg-slate-50 px-5 py-12"><p role="status" className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 text-slate-600">Preparing checkout…</p></main>;

  if (!items.length) return <main className="min-h-screen bg-slate-50 px-5 py-12"><section className="mx-auto max-w-2xl rounded-3xl border border-slate-200 bg-white p-8 text-center">
    <h1 className="text-3xl font-black">Your cart is empty</h1>
    <p className="mt-3 leading-7 text-slate-600">Add a published product before continuing to checkout.</p>
    <Link href="/marketplace/products" className="mt-6 inline-flex rounded-xl bg-blue-700 px-5 py-3 font-bold text-white">Browse products →</Link>
  </section></main>;

  return <main className="min-h-screen bg-slate-50 text-slate-950">
    <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-5 py-5"><Link href="/" className="text-2xl font-black text-blue-700">shilevi</Link><Link href="/cart" className="text-sm font-semibold text-blue-700">← Back to cart</Link></div></header>
    <div className="mx-auto max-w-5xl px-5 py-8 sm:py-12">
      <p className="text-sm font-bold uppercase tracking-wide text-blue-700">Secure checkout</p>
      <h1 className="mt-2 text-3xl font-black sm:text-4xl">Complete your order</h1>
      <p className="mt-3 max-w-2xl leading-7 text-slate-600">Choose how you want to receive the order. Shilevi calculates the final total and commission on the server; the browser cannot change the price.</p>

      {!canPay ? (
        <div className="mt-6 rounded-2xl border border-slate-300 bg-white p-4 text-sm leading-6 text-slate-700">
          <strong>Online payment is not enabled yet.</strong> Orders cannot be placed until the owner connects and activates a payment provider. Your cart is kept, so you can return when payment opens.
        </div>
      ) : sandbox ? (
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
          <strong>Sandbox payment is active.</strong> The sandbox method creates a real order record and a simulated payment. No money moves. It must be switched off before this deployment takes real payments.
        </div>
      ) : null}

      {error && <div role="alert" className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-800">{error}{createdOrderId && <Link href={`/account/orders/${createdOrderId}`} className="mt-3 block font-bold underline">Open the created order →</Link>}</div>}

      <form onSubmit={placeOrder} className="mt-7 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <section className="rounded-3xl border border-slate-200 bg-white p-6">
            <h2 className="text-xl font-black">Delivery method</h2>
            <div className="mt-4 space-y-3">
              <label className={`flex cursor-pointer gap-3 rounded-2xl border p-4 ${method === "platform_delivery" ? "border-blue-500 bg-blue-50" : "border-slate-200"}`}>
                <input type="radio" name="delivery" checked={method === "platform_delivery"} onChange={() => setMethod("platform_delivery")} />
                <span><span className="block font-bold">Shilevi delivery</span><span className="mt-1 block text-sm leading-6 text-slate-600">An approved rider is requested after payment. Delivery fee: {formatMoney(platformFee, settings?.currency ?? currency)}.</span></span>
              </label>
              <label className={`flex cursor-pointer gap-3 rounded-2xl border p-4 ${method === "seller_delivery" ? "border-blue-500 bg-blue-50" : "border-slate-200"}`}>
                <input type="radio" name="delivery" checked={method === "seller_delivery"} onChange={() => setMethod("seller_delivery")} />
                <span><span className="block font-bold">Seller delivery</span><span className="mt-1 block text-sm leading-6 text-slate-600">The seller arranges delivery with you. No platform delivery fee is added now; agree the terms with the seller.</span></span>
              </label>
              <label className={`flex cursor-pointer gap-3 rounded-2xl border p-4 ${method === "pickup" ? "border-blue-500 bg-blue-50" : "border-slate-200"}`}>
                <input type="radio" name="delivery" checked={method === "pickup"} onChange={() => setMethod("pickup")} />
                <span><span className="block font-bold">Pickup</span><span className="mt-1 block text-sm leading-6 text-slate-600">Collect from the seller. No delivery fee is added.</span></span>
              </label>
            </div>
          </section>

          {method !== "pickup" && <section className="rounded-3xl border border-slate-200 bg-white p-6">
            <h2 className="text-xl font-black">Delivery details</h2>
            <div className="mt-4 space-y-4">
              <label className="block text-sm font-semibold">County / region
                <select required value={county} onChange={event => setCounty(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-normal">
                  {counties.length === 0 && <option value={county}>{county}</option>}
                  {counties.map(item => <option key={item.id} value={item.county}>{item.county}</option>)}
                </select>
              </label>
              <label className="block text-sm font-semibold">Address or pickup landmark
                <textarea required minLength={5} maxLength={400} rows={3} value={address} onChange={event => setAddress(event.target.value)} placeholder="Estate, building, street, house or apartment number, and a landmark" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" />
              </label>
              <label className="block text-sm font-semibold">Contact phone
                <input required type="tel" maxLength={32} value={phone} onChange={event => setPhone(event.target.value)} placeholder="+254 7xx xxx xxx" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" />
              </label>
            </div>

            {method === "platform_delivery" && <div className="mt-5 border-t border-slate-200 pt-5">
              <h3 className="text-sm font-bold">Exact destination on the map</h3>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                Place the pin where the rider should hand over the order. Shilevi never reads your device location unless you press
                the button, and it never guesses a point from a county name. Without a pin a rider is still assigned, but by declared
                routes rather than distance, and no distance is shown to you.
              </p>
              <div className="mt-3">
                <MapPinPicker
                  value={pin}
                  onChange={setPin}
                  landmark={landmark}
                  onLandmarkChange={setLandmark}
                  landmarkLabel="Directions for the rider"
                />
              </div>
            </div>}

            <p className="mt-4 text-xs leading-5 text-slate-500">Your exact address is not shown on public listings. It is shared only with the seller and the assigned rider for an active order.</p>
          </section>}

          <section className="rounded-3xl border border-slate-200 bg-white p-6">
            <h2 className="text-xl font-black">Payment method</h2>
            <div className="mt-4 space-y-3">
              {methods.length === 0 && <p className="text-sm leading-6 text-slate-600">No payment method is available for this order yet.</p>}
              {methods.map(item => (
                <label key={item.provider} className={`flex cursor-pointer gap-3 rounded-2xl border p-4 ${provider === item.provider ? "border-blue-500 bg-blue-50" : "border-slate-200"}`}>
                  <input type="radio" name="payment" value={item.provider} checked={provider === item.provider} onChange={() => setProvider(item.provider)} className="mt-1" />
                  <span>
                    <span className="block font-bold">{item.label}</span>
                    <span className="mt-1 block text-sm leading-6 text-slate-600">
                      {item.sandbox
                        ? "Simulated payment for testing. No money leaves your account."
                        : "You will confirm this payment with the provider. Shilevi never sees or stores your card or wallet credentials."}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            {provider === "mpesa" && <p className="mt-3 text-sm leading-6 text-slate-600">Use the Safaricom number that should receive the payment prompt.</p>}
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-6">
            <h2 className="text-xl font-black">Note for the seller</h2>
            <label className="mt-3 block text-sm font-semibold">Optional instructions
              <textarea maxLength={1000} rows={3} value={notes} onChange={event => setNotes(event.target.value)} placeholder="Colour, size, delivery instructions, or anything the seller should know" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" />
            </label>
          </section>
        </div>

        <aside className="h-fit rounded-3xl border border-slate-200 bg-white p-6">
          <h2 className="text-xl font-black">Your order</h2>
          <ul className="mt-4 space-y-3">
            {items.map(item => <li key={item.listingId} className="flex justify-between gap-3 text-sm"><span className="min-w-0"><span className="block font-semibold">{item.title}</span><span className="text-slate-500">× {item.quantity}</span></span><span className="whitespace-nowrap font-semibold">{formatMoney(item.priceMinor * item.quantity, item.currency)}</span></li>)}
          </ul>
          <dl className="mt-5 space-y-3 border-t border-slate-200 pt-4 text-sm">
            <div className="flex justify-between gap-3"><dt className="text-slate-600">Subtotal</dt><dd className="font-semibold">{formatMoney(subtotalMinor, currency)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-600">Delivery</dt><dd className="font-semibold">{method === "platform_delivery" ? formatMoney(platformFee, settings?.currency ?? currency) : "Not charged now"}</dd></div>
            <div className="flex justify-between gap-3 border-t border-slate-200 pt-3 text-base"><dt className="font-black">Total</dt><dd className="font-black">{formatMoney(totalMinor, settings?.currency ?? currency)}</dd></div>
          </dl>
          <button disabled={busy || !canPay} className="mt-6 w-full rounded-xl bg-blue-700 px-5 py-3 font-bold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50">{busy ? "Placing order…" : canPay ? "Place order and pay" : "Payment not available"}</button>
          <p className="mt-4 text-xs leading-5 text-slate-500">By placing this order you agree to the <Link href="/legal/terms" className="font-semibold text-blue-700 underline">Terms</Link> and <Link href="/legal/privacy" className="font-semibold text-blue-700 underline">Privacy Notice</Link>. You can request a refund from the order page if something goes wrong.</p>
        </aside>
      </form>
    </div>
  </main>;
}
