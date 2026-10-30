import "server-only";

import type { Metadata } from "next";
import { requireStaffCapability } from "@/lib/admin/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AdminShell } from "@/components/admin/AdminShell";

export const metadata: Metadata = {
  title: "Trip reviews",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

type ReviewRow = {
  id: string;
  rating: number;
  comment: string | null;
  created_at: string;
  ride_number: string;
};

function stars(rating: number): string {
  return "★★★★★".slice(0, Math.max(0, Math.min(5, rating))).padEnd(5, "☆");
}

export default async function AdminReviewsPage() {
  const result = await requireStaffCapability("rides.manage");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_list_ride_reviews", { p_limit: 100 });
  const reviews = (data ?? []) as unknown as ReviewRow[];

  const average = reviews.length
    ? reviews.reduce((total, review) => total + Number(review.rating), 0) / reviews.length
    : null;
  const lowRated = reviews.filter(review => review.rating <= 2).length;

  return (
    <AdminShell
      email={result.user.email ?? null}
      mfaLevel={result.mfaLevel}
      title="Trip reviews"
      description="Ratings a customer left after a completed trip. There is no edit or delete action here: reviews are participant evidence, so hiding one is a governed operation rather than a console click. Comment text is truncated to 400 characters."
    >
      {error ? (
        <p role="alert" className="rounded-2xl border border-amber-800 bg-amber-950/40 p-5 text-sm leading-6 text-amber-100">
          Reviews could not be read. Nothing was changed. Reload once; if it persists, System health reports whether the cause is a missing migration, an MFA session or a missing capability.</p>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-3">
            {[
              { label: "Reviews shown", value: String(reviews.length), detail: "Most recent 100 reviews" },
              { label: "Average rating", value: average === null ? "—" : average.toFixed(2), detail: "Across the reviews shown" },
              { label: "Low ratings", value: String(lowRated), detail: "Two stars or fewer" },
            ].map(card => (
              <article key={card.label} className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{card.label}</p>
                <p className="mt-2 text-2xl font-black text-slate-100">{card.value}</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">{card.detail}</p>
              </article>
            ))}
          </section>

          <h2 className="mt-8 text-lg font-black text-slate-100">Recent reviews</h2>
          {reviews.length === 0 ? (
            <p className="mt-3 rounded-2xl border border-slate-800 bg-slate-900 p-6 text-sm leading-6 text-slate-300">
              No trip has been reviewed yet. A review can only exist after a completed ride, so this zero
              also means no completed trip has been rated.
            </p>
          ) : (
            <ul className="mt-3 space-y-3">
              {reviews.map(review => (
                <li key={review.id} className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-bold text-slate-100">
                      <span aria-hidden className="mr-2 tracking-widest text-amber-300">{stars(review.rating)}</span>
                      <span className="sr-only">{review.rating} out of 5</span>
                      Trip {review.ride_number}
                    </p>
                    <p className="text-xs text-slate-400">{new Date(review.created_at).toLocaleString("en-KE")}</p>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-300">
                    {review.comment?.trim() ? review.comment : "No comment was left."}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 max-w-3xl text-xs leading-6 text-slate-500">
            Ratings are shown as recorded. This console never recalculates or substitutes a rating, and it
            does not present seeded test reviews as demand evidence.
          </p>
        </>
      )}
    </AdminShell>
  );
}
