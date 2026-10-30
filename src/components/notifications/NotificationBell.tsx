"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export const NOTIFICATIONS_CHANGED = "shilevi:notifications-changed";

/**
 * Unread badge for the header.
 *
 * The count comes from `unread_notification_count()`, which is scoped to `auth.uid()` in the
 * database; a signed-out visitor never sees a badge and the number is never derived from cached
 * client state. It refreshes on navigation, when the tab regains focus, and when the inbox page
 * reports a change, so acknowledging a notification does not leave a stale badge behind.
 */
export function NotificationBell() {
  const { status } = useAuth();
  const pathname = usePathname();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (status !== "signed-in") {
      setCount(0);
      return;
    }

    let alive = true;
    const supabase = createSupabaseBrowserClient();

    const load = () => {
      void supabase.rpc("unread_notification_count").then(
        ({ data }) => {
          if (alive) setCount(Number(data ?? 0));
        },
        () => undefined,
      );
    };

    load();
    window.addEventListener(NOTIFICATIONS_CHANGED, load);
    window.addEventListener("focus", load);

    return () => {
      alive = false;
      window.removeEventListener(NOTIFICATIONS_CHANGED, load);
      window.removeEventListener("focus", load);
    };
  }, [status, pathname]);

  if (status !== "signed-in") return null;

  return (
    <Link
      href="/account/notifications"
      aria-label={count > 0 ? `Notifications, ${count} unread` : "Notifications"}
      className="relative flex h-10 w-10 items-center justify-center rounded-full text-ink-500 transition-colors hover:bg-mist-100 hover:text-ink-900"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
        <path
          d="M6 10a6 6 0 1 1 12 0c0 3 1 4.5 1.6 5.3.45.6.02 1.45-.72 1.45H5.12c-.74 0-1.17-.85-.72-1.45C5 14.5 6 13 6 10Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path d="M10 20a2.2 2.2 0 0 0 4 0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      {count > 0 && (
        <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-accent-500 px-1 text-[11px] font-black leading-none text-white">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
