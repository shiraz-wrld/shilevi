"use client";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Browser-side push helpers.
 *
 * Permission is requested only from a click. The subscription is stored through
 * `save_push_subscription()` (migration 0038), which binds the endpoint to the signed-in account and
 * refuses an endpoint already owned by somebody else. Nothing here claims delivery: the server
 * dispatcher records what actually happened.
 */

export type PushState = "unsupported" | "not-configured" | "blocked" | "subscribed" | "available";

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function vapidPublicKey(): string | null {
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  return key ? key : null;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const output = new Uint8Array(buffer);
  for (let index = 0; index < raw.length; index += 1) {
    output[index] = raw.charCodeAt(index);
  }
  return output;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration("/");
  if (existing) return existing;
  await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  return navigator.serviceWorker.ready;
}

export async function currentPushState(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  if (!vapidPublicKey()) return "not-configured";
  if (Notification.permission === "denied") return "blocked";
  try {
    const reg = await navigator.serviceWorker.getRegistration("/");
    const subscription = await reg?.pushManager.getSubscription();
    return subscription ? "subscribed" : "available";
  } catch {
    return "available";
  }
}

export async function enablePush(): Promise<void> {
  if (!pushSupported()) {
    throw new Error("This browser cannot receive push notifications.");
  }
  const key = vapidPublicKey();
  if (!key) {
    throw new Error(
      "Push notifications are not configured on this deployment (NEXT_PUBLIC_VAPID_PUBLIC_KEY is unset).",
    );
  }
  if (Notification.permission === "denied") {
    throw new Error("Notifications are blocked for this site in your browser settings.");
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Notification permission was not granted, so nothing was subscribed.");
  }

  const reg = await registration();
  const existing = await reg.pushManager.getSubscription();
  const subscription =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    }));

  const json = subscription.toJSON();
  const endpoint = json.endpoint;
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!endpoint || !p256dh || !auth) {
    throw new Error("The browser returned an incomplete push subscription.");
  }

  const db = createSupabaseBrowserClient();
  const { error } = await db.rpc("save_push_subscription", {
    p_endpoint: endpoint,
    p_p256dh: p256dh,
    p_auth: auth,
    p_user_agent: navigator.userAgent.slice(0, 300),
  });
  if (error) throw new Error(error.message);
}

export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration("/");
  const subscription = await reg?.pushManager.getSubscription();
  if (!subscription) return;

  const endpoint = subscription.endpoint;
  const db = createSupabaseBrowserClient();
  const { error } = await db.rpc("revoke_push_subscription", { p_endpoint: endpoint });
  if (error) throw new Error(error.message);

  await subscription.unsubscribe();
}
