import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/guards";
import { formatWhen, loadNotifications } from "@/lib/notifications";
import { PushOptIn } from "@/components/notifications/PushOptIn";
import { NotificationsClient } from "./NotificationsClient";

export const metadata: Metadata = {
  title: "Notifications",
  description: "Application decisions, job offers, order, delivery and payout updates for your account.",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  await requireUser("/account/notifications");
  const result = await loadNotifications(50);

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-5 py-5">
          <Link href="/" className="text-2xl font-black text-blue-700">
            shilevi
          </Link>
          <Link href="/account" className="text-sm font-semibold text-blue-700">
            ← Account
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-5 py-10 sm:py-14">
        <p className="text-sm font-bold uppercase tracking-wide text-blue-700">Your account</p>
        <h1 className="mt-2 text-3xl font-black sm:text-4xl">Notifications</h1>
        <p className="mt-3 max-w-2xl leading-7 text-slate-600">
          These are the updates Shilevi actually sent for this account — application decisions, ride
          and delivery status, order and payout changes. Email delivery depends on the configured
          provider; the record here does not.
        </p>

        <PushOptIn />

        {!result.ok ? (
          <p role="alert" className="mt-6 rounded-xl bg-amber-50 p-4 text-sm leading-6 text-amber-900">
            {result.error}
          </p>
        ) : (
          <NotificationsClient
            items={result.items.map(item => ({
              id: item.id,
              title: item.title,
              body: item.body,
              link: item.link,
              read_at: item.read_at,
              when: formatWhen(item.created_at),
            }))}
          />
        )}
      </div>
    </main>
  );
}
