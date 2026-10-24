"use client";

import Link from "next/link";
import { useCart } from "@/components/cart/CartProvider";

export function CartLink({ className = "" }: { className?: string }) {
  const { count, isReady } = useCart();
  return (
    <Link
      href="/cart"
      className={`relative inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:border-blue-400 ${className}`}
    >
      Cart
      <span
        aria-label={`${count} item${count === 1 ? "" : "s"} in cart`}
        className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs font-bold ${count ? "bg-blue-700 text-white" : "bg-slate-100 text-slate-500"}`}
      >
        {isReady ? count : 0}
      </span>
    </Link>
  );
}
