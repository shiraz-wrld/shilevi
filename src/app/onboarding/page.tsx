"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const countries = [{ value: "KE", label: "Kenya" }, { value: "UG", label: "Uganda" }, { value: "TZ", label: "Tanzania" }, { value: "RW", label: "Rwanda" }, { value: "NG", label: "Nigeria" }, { value: "ZA", label: "South Africa" }, { value: "GB", label: "United Kingdom" }, { value: "US", label: "United States" }];

export default function OnboardingPage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState("KE");
  const [county, setCounty] = useState("");
  const [town, setTown] = useState("");
  const [intent, setIntent] = useState<"customer" | "provider">("customer");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const supabase = createSupabaseBrowserClient();
        const { data, error } = await supabase.auth.getUser();
        if (error) throw error;
        if (!data.user) { window.location.replace("/login"); return; }
        if (!alive) return;
        setUserId(data.user.id);
        setName(typeof data.user.user_metadata?.display_name === "string" ? data.user.user_metadata.display_name.slice(0,120) : "");
        const result = await supabase.from("user_onboarding").select("full_name,phone,country_code,county,town,account_intent").eq("user_id", data.user.id).maybeSingle();
        if (result.error) throw result.error;
        if (result.data && alive) {
          setName(result.data.full_name ?? "");
          setPhone(result.data.phone ?? "");
          setCountry(result.data.country_code ?? "KE");
          setCounty(result.data.county ?? "");
          setTown(result.data.town ?? "");
          setIntent(result.data.account_intent === "provider" ? "provider" : "customer");
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
      const values = { full_name: cleanName, phone: cleanPhone || null, country_code: country, county: cleanCounty || null, town: cleanTown || null, account_intent: intent };
      const result = existing.data
        ? await supabase.from("user_onboarding").update(values).eq("user_id", userId)
        : await supabase.from("user_onboarding").insert({ user_id: userId, ...values });
      if (result.error) throw result.error;
      setSuccess(true);
      setMessage("Your details have been saved.");
      router.push(intent === "provider" ? "/provider/apply" : "/account");
    } catch {
      setMessage("We couldn't save your details. Confirm migration 0004 has been reviewed and run in your own Supabase project, then try again.");
    } finally { setBusy(false); }
  }

  return <main className="flex min-h-screen items-center justify-center bg-slate-50 px-5 py-10"><section className="w-full max-w-2xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-9"><Link href="/" className="text-xl font-black text-blue-700">shilevi</Link><p className="mt-8 text-sm font-bold uppercase tracking-wide text-blue-700">A few details</p><h1 className="mt-2 text-3xl font-black">Set up your Shilevi profile</h1><p className="mt-3 leading-7 text-slate-600">Tell us only what helps us personalize your account. You can apply for provider activities separately. We do not need your live GPS location to register.</p>{loading ? <p role="status" className="mt-8 text-slate-500">Loading your profile…</p> : <form onSubmit={submit} className="mt-8 space-y-5"><label className="block text-sm font-semibold">Full name<input required autoComplete="name" maxLength={120} value={name} onChange={e=>setName(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal focus:border-blue-600 focus:outline-none"/></label><label className="block text-sm font-semibold">Phone number <span className="font-normal text-slate-500">(optional)</span><input type="tel" autoComplete="tel" maxLength={32} value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+254 7xx xxx xxx" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal focus:border-blue-600 focus:outline-none"/></label><label className="block text-sm font-semibold">Country<select value={country} onChange={e=>setCountry(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-normal focus:border-blue-600 focus:outline-none">{countries.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}</select></label><div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-semibold">County / region <span className="font-normal text-slate-500">(optional)</span><input maxLength={100} value={county} onChange={e=>setCounty(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal focus:border-blue-600 focus:outline-none" placeholder="e.g. Nakuru"/></label><label className="block text-sm font-semibold">Town / city <span className="font-normal text-slate-500">(optional)</span><input maxLength={100} value={town} onChange={e=>setTown(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal focus:border-blue-600 focus:outline-none" placeholder="e.g. Naivasha"/></label></div><fieldset className="space-y-3"><legend className="text-sm font-bold">How will you use Shilevi first?</legend><label className={`flex cursor-pointer gap-3 rounded-2xl border p-4 ${intent==="customer"?"border-blue-600 bg-blue-50":"border-slate-200"}`}><input type="radio" name="intent" checked={intent==="customer"} onChange={()=>setIntent("customer")} className="mt-1 accent-blue-700"/><span><span className="block font-semibold">I want to shop or book</span><span className="mt-1 block text-sm text-slate-600">Browse products, find services, and explore places.</span></span></label><label className={`flex cursor-pointer gap-3 rounded-2xl border p-4 ${intent==="provider"?"border-blue-600 bg-blue-50":"border-slate-200"}`}><input type="radio" name="intent" checked={intent==="provider"} onChange={()=>setIntent("provider")} className="mt-1 accent-blue-700"/><span><span className="block font-semibold">I want to become a provider</span><span className="mt-1 block text-sm text-slate-600">Apply separately to sell, provide services, deliver, or list property.</span></span></label></fieldset><p className="rounded-xl bg-blue-50 p-4 text-sm leading-6 text-blue-900">Privacy note: county and town are optional profile details, not your live location or a precise delivery address. We’ll request extra information only when a feature needs it.</p><button disabled={busy || !userId} className="w-full rounded-xl bg-blue-700 px-5 py-3 font-bold text-white disabled:opacity-60">{busy?"Saving…":"Save and continue"}</button>{message&&<p role={success?"status":"alert"} className={success?"text-sm text-green-700":"text-sm text-red-700"}>{message}</p>}</form>}<p className="mt-6 text-sm text-slate-600"><Link href="/account" className="font-semibold text-blue-700">Skip for now and return to account</Link></p></section></main>;
}
