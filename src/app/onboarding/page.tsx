"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  isSignupPathId,
  nextHrefForSignupPath,
  signupPath,
  signupPaths,
  type SignupPath,
} from "@/lib/auth/signup-intent";

const countries = [{ value: "KE", label: "Kenya" }, { value: "UG", label: "Uganda" }, { value: "TZ", label: "Tanzania" }, { value: "RW", label: "Rwanda" }, { value: "NG", label: "Nigeria" }, { value: "ZA", label: "South Africa" }, { value: "GB", label: "United Kingdom" }, { value: "US", label: "United States" }];

export default function OnboardingPage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState("KE");
  const [county, setCounty] = useState("");
  const [town, setTown] = useState("");
  const [pathId, setPathId] = useState<SignupPath["id"]>("customer");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);

  const chosen = signupPath(pathId) ?? signupPaths[0]!;

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const supabase = createSupabaseBrowserClient();
        const { data, error } = await supabase.auth.getUser();
        if (error) throw error;
        if (!data.user) { window.location.replace("/login?next=%2Fonboarding"); return; }
        if (!alive) return;
        setUserId(data.user.id);
        setName(typeof data.user.user_metadata?.display_name === "string" ? data.user.user_metadata.display_name.slice(0, 120) : "");

        // What the person chose at registration, carried in their own auth metadata — used only to
        // preselect the answer they already gave, never to grant anything.
        const fromMetadata = data.user.user_metadata?.signup_path;
        if (isSignupPathId(fromMetadata)) setPathId(fromMetadata);

        const result = await supabase
          .from("user_onboarding")
          .select("full_name,phone,country_code,county,town,account_intent,signup_activity")
          .eq("user_id", data.user.id)
          .maybeSingle();
        if (result.error) throw result.error;
        if (result.data && alive) {
          const row = result.data as {
            full_name?: string | null;
            phone?: string | null;
            country_code?: string | null;
            county?: string | null;
            town?: string | null;
            signup_activity?: string | null;
          };
          setName(row.full_name ?? "");
          setPhone(row.phone ?? "");
          setCountry(row.country_code ?? "KE");
          setCounty(row.county ?? "");
          setTown(row.town ?? "");
          if (isSignupPathId(row.signup_activity)) setPathId(row.signup_activity);
        }
      } catch {
        if (alive) setMessage("We couldn't load your onboarding details. Please check the database setup and try again.");
      } finally { if (alive) setLoading(false); }
    }
    void load();
    return () => { alive = false; };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(""); setSuccess(false);
    const cleanName = name.trim();
    const cleanPhone = phone.trim();
    const cleanCounty = county.trim();
    const cleanTown = town.trim();
    if (cleanName.length < 1 || cleanName.length > 120) { setMessage("Enter a name using 1–120 characters."); return; }
    if (cleanPhone && (cleanPhone.length < 7 || cleanPhone.length > 32 || !/^[+0-9()\s-]+$/.test(cleanPhone))) { setMessage("Enter a valid phone number or leave it blank for now."); return; }
    if (cleanCounty.length > 100 || cleanTown.length > 100) { setMessage("County and town must each be 100 characters or fewer."); return; }
    if (!userId) { setMessage("Please sign in again before saving."); return; }
    setBusy(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const existing = await supabase.from("user_onboarding").select("user_id").eq("user_id", userId).maybeSingle();
      if (existing.error) throw existing.error;
      const values = {
        full_name: cleanName,
        phone: cleanPhone || null,
        country_code: country,
        county: cleanCounty || null,
        town: cleanTown || null,
        account_intent: chosen.intent,
        signup_activity: chosen.signupActivity,
      };
      const result = existing.data
        ? await supabase.from("user_onboarding").update(values).eq("user_id", userId)
        : await supabase.from("user_onboarding").insert({ user_id: userId, ...values });
      if (result.error) throw result.error;
      setSuccess(true);
      setMessage("Your details have been saved.");
      router.push(nextHrefForSignupPath(chosen.id));
    } catch {
      setMessage("We couldn't save your details. Confirm migrations 0004 and 0040 have been reviewed and run in your own Supabase project, then try again.");
    } finally { setBusy(false); }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-5 py-10">
      <section className="w-full max-w-2xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-9">
        <Link href="/" className="text-xl font-black text-blue-700">shilevi</Link>
        <p className="mt-8 text-sm font-bold uppercase tracking-wide text-blue-700">A few details</p>
        <h1 className="mt-2 text-3xl font-black">Set up your Shilevi profile</h1>
        <p className="mt-3 leading-7 text-slate-600">
          Tell us only what helps us personalize your account. You can apply for provider activities
          separately. We do not need your live GPS location to register.
        </p>

        {loading ? (
          <p role="status" className="mt-8 text-slate-500">Loading your profile…</p>
        ) : (
          <form onSubmit={submit} className="mt-8 space-y-5">
            <label className="block text-sm font-semibold">
              Full name
              <input required autoComplete="name" maxLength={120} value={name} onChange={e => setName(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal focus:border-blue-600 focus:outline-none" />
            </label>
            <label className="block text-sm font-semibold">
              Phone number <span className="font-normal text-slate-500">(optional)</span>
              <input type="tel" autoComplete="tel" maxLength={32} value={phone} onChange={e => setPhone(e.target.value)} placeholder="+254 7xx xxx xxx" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal focus:border-blue-600 focus:outline-none" />
            </label>
            <label className="block text-sm font-semibold">
              Country
              <select value={country} onChange={e => setCountry(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-normal focus:border-blue-600 focus:outline-none">
                {countries.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-semibold">
                County / region <span className="font-normal text-slate-500">(optional)</span>
                <input maxLength={100} value={county} onChange={e => setCounty(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal focus:border-blue-600 focus:outline-none" placeholder="e.g. Nakuru" />
              </label>
              <label className="block text-sm font-semibold">
                Town / city <span className="font-normal text-slate-500">(optional)</span>
                <input maxLength={100} value={town} onChange={e => setTown(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal focus:border-blue-600 focus:outline-none" placeholder="e.g. Naivasha" />
              </label>
            </div>

            <fieldset className="space-y-3">
              <legend className="text-sm font-bold">How will you use Shilevi?</legend>
              <div role="radiogroup" aria-label="How will you use Shilevi?" className="grid gap-2 sm:grid-cols-2">
                {signupPaths.map(option => {
                  const active = option.id === pathId;
                  return (
                    <label key={option.id} className={`flex cursor-pointer gap-3 rounded-2xl border p-3 ${active ? "border-blue-600 bg-blue-50" : "border-slate-200"}`}>
                      <input type="radio" name="signup-path" checked={active} onChange={() => setPathId(option.id)} className="mt-1 accent-blue-700" />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold">{option.label}</span>
                        <span className="mt-0.5 block text-xs leading-5 text-slate-600">{option.detail}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <p className="rounded-xl bg-blue-50 p-4 text-sm leading-6 text-blue-900">
              Privacy note: county and town are optional profile details, not your live location or a
              precise delivery address. We&apos;ll request extra information only when a feature needs it.
              Choosing a provider path records what you want to do; it does not approve you.
            </p>
            <button disabled={busy || !userId} className="w-full rounded-xl bg-blue-700 px-5 py-3 font-bold text-white disabled:opacity-60">
              {busy ? "Saving…" : "Save and continue"}
            </button>
            {message && <p role={success ? "status" : "alert"} className={success ? "text-sm text-green-700" : "text-sm text-red-700"}>{message}</p>}
          </form>
        )}
        <p className="mt-6 text-sm text-slate-600">
          <Link href="/account" className="font-semibold text-blue-700">Skip for now and return to account</Link>
        </p>
      </section>
    </main>
  );
}
