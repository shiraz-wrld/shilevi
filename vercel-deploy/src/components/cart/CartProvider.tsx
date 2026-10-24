"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type CartItem = {
  listingId: string;
  ownerId: string;
  title: string;
  priceMinor: number;
  currency: string;
  quantity: number;
  division?: string;
};

export type AddToCartResult =
  | { ok: true }
  | { ok: false; reason: "different-seller" | "different-currency" | "invalid" };

type CartContextValue = {
  items: CartItem[];
  isReady: boolean;
  count: number;
  subtotalMinor: number;
  currency: string;
  sellerId: string | null;
  addItem: (item: Omit<CartItem, "quantity">, quantity?: number) => AddToCartResult;
  replaceWith: (item: Omit<CartItem, "quantity">, quantity?: number) => AddToCartResult;
  setQuantity: (listingId: string, quantity: number) => void;
  removeItem: (listingId: string) => void;
  clear: () => void;
};

const STORAGE_KEY = "shilevi.cart.v1";
const MAX_ITEMS = 20;

function isCartItem(value: unknown): value is CartItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.listingId === "string" &&
    /^[0-9a-f-]{36}$/i.test(item.listingId) &&
    typeof item.ownerId === "string" &&
    /^[0-9a-f-]{36}$/i.test(item.ownerId) &&
    typeof item.title === "string" &&
    item.title.length > 0 &&
    item.title.length <= 180 &&
    typeof item.priceMinor === "number" &&
    Number.isInteger(item.priceMinor) &&
    item.priceMinor >= 0 &&
    typeof item.currency === "string" &&
    /^[A-Z]{3}$/.test(item.currency) &&
    typeof item.quantity === "number" &&
    Number.isInteger(item.quantity) &&
    item.quantity >= 1 &&
    item.quantity <= 99 &&
    (item.division === undefined || typeof item.division === "string")
  );
}

function readCart(): CartItem[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const valid = parsed.filter(isCartItem).slice(0, MAX_ITEMS);
    if (!valid.length) return [];
    const ownerId = valid[0].ownerId;
    const currency = valid[0].currency;
    return valid.filter(item => item.ownerId === ownerId && item.currency === currency);
  } catch {
    return [];
  }
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    setItems(readCart());
    setIsReady(true);
  }, []);

  useEffect(() => {
    if (!isReady) return;
    try {
      if (items.length) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Storage can be unavailable in private mode; the in-memory cart still works.
    }
  }, [items, isReady]);

  function addItem(input: Omit<CartItem, "quantity">, quantity = 1): AddToCartResult {
    if (
      !/^[0-9a-f-]{36}$/i.test(input.listingId) ||
      !/^[0-9a-f-]{36}$/i.test(input.ownerId) ||
      !input.title.trim() ||
      !Number.isInteger(input.priceMinor) ||
      input.priceMinor <= 0 ||
      !/^[A-Z]{3}$/.test(input.currency) ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 99
    ) {
      return { ok: false, reason: "invalid" };
    }

    if (items.length && items[0].ownerId !== input.ownerId) {
      return { ok: false, reason: "different-seller" };
    }
    if (items.length && items[0].currency !== input.currency) {
      return { ok: false, reason: "different-currency" };
    }
    if (!items.some(item => item.listingId === input.listingId) && items.length >= MAX_ITEMS) {
      return { ok: false, reason: "invalid" };
    }

    setItems(current => {
      const existing = current.find(item => item.listingId === input.listingId);
      if (existing) {
        return current.map(item =>
          item.listingId === input.listingId
            ? { ...item, quantity: Math.min(99, item.quantity + quantity) }
            : item
        );
      }
      return [...current, { ...input, title: input.title.slice(0, 180), quantity }];
    });
    return { ok: true };
  }

  function replaceWith(input: Omit<CartItem, "quantity">, quantity = 1): AddToCartResult {
    if (
      !/^[0-9a-f-]{36}$/i.test(input.listingId) ||
      !/^[0-9a-f-]{36}$/i.test(input.ownerId) ||
      !input.title.trim() ||
      !Number.isInteger(input.priceMinor) ||
      input.priceMinor <= 0 ||
      !/^[A-Z]{3}$/.test(input.currency) ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 99
    ) {
      return { ok: false, reason: "invalid" };
    }
    setItems([{ ...input, title: input.title.slice(0, 180), quantity }]);
    return { ok: true };
  }

  function setQuantity(listingId: string, quantity: number) {
    if (!Number.isFinite(quantity)) return;
    setItems(current =>
      current.flatMap(item => {
        if (item.listingId !== listingId) return [item];
        if (quantity <= 0) return [];
        return [{ ...item, quantity: Math.min(99, Math.max(1, Math.round(quantity))) }];
      })
    );
  }

  function removeItem(listingId: string) {
    setItems(current => current.filter(item => item.listingId !== listingId));
  }

  function clear() {
    setItems([]);
  }

  const count = useMemo(() => items.reduce((total, item) => total + item.quantity, 0), [items]);
  const subtotalMinor = useMemo(
    () => items.reduce((total, item) => total + item.priceMinor * item.quantity, 0),
    [items]
  );

  const value: CartContextValue = {
    items,
    isReady,
    count,
    subtotalMinor,
    currency: items[0]?.currency ?? "KES",
    sellerId: items[0]?.ownerId ?? null,
    addItem,
    replaceWith,
    setQuantity,
    removeItem,
    clear,
  };

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const value = useContext(CartContext);
  if (!value) throw new Error("useCart must be used inside CartProvider.");
  return value;
}
