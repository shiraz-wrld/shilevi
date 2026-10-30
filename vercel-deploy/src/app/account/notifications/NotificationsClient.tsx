"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { NOTIFICATIONS_CHANGED } from "@/components/notifications/NotificationBell";

type Item = {
  id: number;
  title: string;
  body: string;
  link: string;
  read_at: string | null;
  when: string;
};

/**
 * The list only *reports* what the database did. `mark_notification_read` returns whether a row was
 * actually updated, so a stale or foreign id is never shown as "marked read".
 */
export function NotificationsClient({ items }: { items: Item[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | "all" | null>(null);
  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<"ok" | "error">("ok");
  const [pending, startTransition] = useTransition();

  async function markOne(id: number) {
    setBusy(id);
    setMessage("");
    try {
      const supabase = createSupabaseBrowserClient();
      const { data, error } = await supabase.rpc("mark_notification_read", { p_id: id });
      if (error) throw error;
      if (data !== true) {
        setTone("error");
        setMessage("That notification could not be updated. Refresh and try again.");
        return;
      }
      window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));
      startTransition(() => router.refresh());
    } catch (error) {
      setTone("error");
      setMessage(error instanceof Error ? error.message : "That notification could not be updated.");
    } finally {
      setBusy(null);
    }
  }

  async function markAll() {
    setBusy("all");
    setMessage("");
    try {
      const supabase = createSupabaseBrowserClient();
      const { data, error } = await supabase.rpc("mark_all_notifications_read");
      if (error) throw error;
      setTone("ok");
      setMessage(Number(data) > 0 ? "All notifications marked as read." : "Nothing was unread.");
      window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));
      startTransition(() => router.refresh());
    } catch (error) {
      setTone("error");
      setMessage(error instanceof Error ? error.message : "Notifications could not be updated.");
    } finally {
      setBusy(null);
    }
  }

  if (!items.length) {
    return (
      <section className="mt-7 rounded-2xl border border-dashed border-slate-300 bg-white p-8">
        <h2 className="text-lg font-bold">No notifications yet</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Application decisions, job offers, order and delivery updates and payout changes appear
          here. Nothing is generated to fill this page.
        </p>
        <Link href="/" className="mt-4 inline-flex rounded-xl bg-blue-700 px-5 py-3 text-sm font-bold text-white">
          Back to your home
        </Link>
      </section>
    );
  }

  return (
    <div className="mt-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          {items.filter(item => !item.read_at).length} unread of {items.length}
        </p>
        <button
          type="button"
          onClick={() => void markAll()}
          disabled={busy !== null || pending}
          className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold disabled:opacity-50"
        >
          {busy === "all" ? "Marking…" : "Mark all as read"}
        </button>
      </div>

      {message && (
        <p role={tone === "error" ? "alert" : "status"} className={tone === "error" ? "mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-800" : "mt-4 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800"}>
          {message}
        </p>
      )}

      <ul className="mt-5 space-y-3">
        {items.map(item => (
          <li
            key={item.id}
            className={`rounded-2xl border bg-white p-5 ${item.read_at ? "border-slate-200" : "border-blue-200 bg-blue-50/40"}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-900">
                  {!item.read_at && <span className="mr-2 inline-block h-2 w-2 rounded-full bg-blue-600" aria-hidden="true" />}
                  {item.title}
                </p>
                <p className="mt-1 text-sm leading-6 text-slate-700">{item.body}</p>
                <p className="mt-2 text-xs text-slate-500">{item.when}</p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Link href={item.link} className="rounded-xl bg-blue-700 px-4 py-2 text-sm font-bold text-white">
                  Open
                </Link>
                {!item.read_at && (
                  <button
                    type="button"
                    onClick={() => void markOne(item.id)}
                    disabled={busy !== null || pending}
                    className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold disabled:opacity-50"
                  >
                    {busy === item.id ? "Marking…" : "Mark read"}
                  </button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
