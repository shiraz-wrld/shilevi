import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";

/**
 * Server loader for the in-app notification feed.
 *
 * `my_notifications()` (migration 0036) scopes rows to `auth.uid()` and derives the title, body and
 * deep link in the database. This module only shapes the answer and reports a truthful failure, so
 * the page can say the inbox is unavailable instead of showing an empty list that looks like "no
 * news".
 */

export type NotificationItem = {
  id: number;
  template: string;
  title: string;
  body: string;
  link: string;
  read_at: string | null;
  created_at: string;
};

export type NotificationsResult =
  | { ok: true; items: NotificationItem[]; unread: number }
  | { ok: false; error: string };

export function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-KE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Nairobi",
  }).format(date);
}

export async function loadNotifications(limit = 50): Promise<NotificationsResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Notifications are unavailable because the database is not configured." };
  }

  try {
    const supabase = await createSupabaseServerClient();
    const [feed, unread] = await Promise.all([
      supabase.rpc("my_notifications", { p_limit: limit }),
      supabase.rpc("unread_notification_count"),
    ]);

    if (feed.error || unread.error) {
      console.error("[notifications] read failed", { code: (feed.error ?? unread.error)?.code });
      return { ok: false, error: "Your notifications could not be loaded right now. Try again in a moment." };
    }

    const items = (feed.data ?? []) as NotificationItem[];
    return { ok: true, items, unread: Number(unread.data ?? 0) };
  } catch (error) {
    console.error("[notifications] unexpected failure", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return { ok: false, error: "Your notifications could not be loaded right now. Try again in a moment." };
  }
}
