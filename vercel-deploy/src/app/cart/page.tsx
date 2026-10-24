"use client";

import Link from "next/link";
import { useCart } from "@/components/cart/CartProvider";
import { formatMoney } from "@/lib/money";

export default function CartPage() {
  const { items, isReady, subtotalMinor, currency, setQuantity, removeItem, clear } = useCart();

  return <main className="min-h-screen bg-slate-50 text-slate-950">
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-5 py-5">
        <Link href="/" className="text-2xl font-black text-blue-700">shilevi</Link>
        <div className="flex items-center gap-3">
          <Link href="/account" className="text-sm font-semibold text-blue-700">My account</Link>
          <Link href="/" className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold">Keep shopping</Link>
        </div>
      </div>
    </header>

    <div className="mx-auto max-w-5xl px-5 py-8 sm:py-12">
      <p className="text-sm font-bold uppercase tracking-wide text-blue-700">Your basket</p>
      <h1 className="mt-2 text-3xl font-black sm:text-4xl">Review your cart</h1>
      <p className="mt-3 max-w-2xl leading-7 text-slate-600">Prices are shown in Kenyan shillings. Delivery is calculated at checkout, and Shilevi confirms the final total on the server before creating an order.</p>

      {!isReady ? <p role="status" className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 text-slate-600">Loading your cart…</p> : items.length === 0 ? <section className="mt-8 rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-center">
        <h2 className="text-2xl font-black">Your cart is empty</h2>
        <p className="mx-auto mt-3 max-w-md leading-7 text-slate-600">Browse published products from approved sellers and add something you need.</p>
        <Link href="/marketplace/products" className="mt-6 inline-flex rounded-xl bg-blue-700 px-5 py-3 font-bold text-white hover:bg-blue-800">Browse products →</Link>
      </section> : <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="space-y-4">
          {items.map(item => <article key={item.listingId} className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <Link href={`/listing/${item.listingId}`} className="text-lg font-bold text-slate-950 hover:text-blue-700">{item.title}</Link>
                <p className="mt-1 text-sm text-slate-500">{formatMoney(item.priceMinor, item.currency)} each</p>
              </div>
              <button type="button" onClick={() => removeItem(item.listingId)} className="text-sm font-semibold text-red-700 hover:underline">Remove</button>
            </div>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
              <div className="inline-flex items-center rounded-xl border border-slate-300">
                <button type="button" aria-label="Decrease quantity" onClick={() => setQuantity(item.listingId, item.quantity - 1)} className="px-4 py-2 text-lg font-bold text-slate-700">−</button>
                <input
                  aria-label={`Quantity for ${item.title}`}
                  type="number"
                  min={1}
                  max={99}
                  value={item.quantity}
                  onChange={event => setQuantity(item.listingId, Number(event.target.value))}
                  className="w-16 border-x border-slate-300 px-2 py-2 text-center"
                />
                <button type="button" aria-label="Increase quantity" onClick={() => setQuantity(item.listingId, item.quantity + 1)} className="px-4 py-2 text-lg font-bold text-slate-700">+</button>
              </div>
              <p className="text-lg font-black">{formatMoney(item.priceMinor * item.quantity, item.currency)}</p>
            </div>
          </article>)}

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white p-4 text-sm text-slate-600">
            <span>One seller per order keeps fulfilment and delivery clear.</span>
            <button type="button" onClick={clear} className="font-semibold text-red-700 hover:underline">Clear cart</button>
          </div>
        </section>

        <aside className="h-fit rounded-3xl border border-slate-200 bg-white p-6">
          <h2 className="text-xl font-black">Order summary</h2>
          <dl className="mt-5 space-y-3 text-sm">
            <div className="flex justify-between gap-3"><dt className="text-slate-600">Items ({items.length})</dt><dd className="font-semibold">{formatMoney(subtotalMinor, currency)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-600">Delivery</dt><dd className="text-slate-500">Calculated next</dd></div>
            <div className="flex justify-between gap-3 border-t border-slate-200 pt-3 text-base"><dt className="font-bold">Subtotal</dt><dd className="font-black">{formatMoney(subtotalMinor, currency)}</dd></div>
          </dl>
          <Link href="/checkout" className="mt-6 inline-flex w-full justify-center rounded-xl bg-blue-700 px-5 py-3 font-bold text-white hover:bg-blue-800">Continue to checkout →</Link>
          <p className="mt-4 text-xs leading-5 text-slate-500">You will review the delivery method, address, and final total before placing the order.</p>
        </aside>
      </div>}
    </div>
  </main>;
}
