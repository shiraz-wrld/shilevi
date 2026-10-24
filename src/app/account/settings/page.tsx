"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const countries = [
  { value: "KE", label: "Kenya" }, { value: "UG", label: "Uganda" },
  { value: "TZ", label: "Tanzania" }, { value: "RW", label: "Rwanda" },
  { value: "NG", label: "Nigeria" }, { value: "ZA", label: "South Africa" },
  { value: "GB", label: "United Kingdom" }, { value: "US", label: "United States" },
];

type Profile = {
  full_name: string;
  phone: string | null;
  country_code: string;
  county: string | null;
  town: string | null;
  account_intent: "customer" | "provider";
};

export default function AccountSettingsPage() {
  const [userId, setUserId] = useState("");
  const [email, setEmail] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [emailMessage, setEmailMessage] = useState("");
  const [emailSuccess, setEmailSuccess] = useState(false);
  const [savingEmail, setSavingEmail] = useState(false);
  const [hasEmailIdentity, setHasEmailIdentity] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState("KE");
  const [county, setCounty] = useState("");
  const [town, setTown] = useState("");
  const [intent, setIntent] = useState<"customer" | "provider">("customer");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deletionStatus, setDeletionStatus] = useState("");
  const [deletionRequestId, setDeletionRequestId] = useState("");
  const [cancellingDeletion, setCancellingDeletion] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [preferences, setPreferences] = useState({ marketplace_updates: true, account_security_alerts: true, order_and_booking_updates: true, provider_activity_updates: true, product_news_and_promotions: false });
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [preferencesMessage, setPreferencesMessage] = useState("");
  const [preferencesSuccess, setPreferencesSuccess] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [requestingDeletion, setRequestingDeletion] = useState(false);
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"success" | "error">("success");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [deletionMessage, setDeletionMessage] = useState("");
  const [deletionSuccess, setDeletionSuccess] = useState(false);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const supabase = createSupabaseBrowserClient();
        const auth = await supabase.auth.getUser();
        if (auth.error) throw auth.error;
        if (!auth.data.user) { window.location.replace("/login?next=%2Faccount%2Fsettings"); return; }
        const user = auth.data.user;
        if (!alive) return;
        setUserId(user.id);
        setEmail(user.email ?? "");
        setHasEmailIdentity((user.identities ?? []).some(identity => identity.provider === "email"));
        const profile = await supabase.from("user_onboarding")
          .select("full_name,phone,country_code,county,town,account_intent")
          .eq("user_id", user.id).maybeSingle();
        if (profile.error) throw profile.error;
        if (profile.data && alive) {
          const row = profile.data as Profile;
          setName(row.full_name ?? "");
          setPhone(row.phone ?? "");
          setCountry(row.country_code ?? "KE");
          setCounty(row.county ?? "");
          setTown(row.town ?? "");
          setIntent(row.account_intent === "provider" ? "provider" : "customer");
        } else if (alive && typeof user.user_metadata?.display_name === "string") {
          setName(user.user_metadata.display_name.slice(0, 120));
        }
        const preferenceResult = await supabase.from("user_notification_preferences")
          .select("marketplace_updates,account_security_alerts,order_and_booking_updates,provider_activity_updates,product_news_and_promotions")
          .eq("user_id", user.id).maybeSingle();
        if (!preferenceResult.error && preferenceResult.data && alive) {
          setPreferences({
            marketplace_updates: preferenceResult.data.marketplace_updates,
            account_security_alerts: preferenceResult.data.account_security_alerts,
            order_and_booking_updates: preferenceResult.data.order_and_booking_updates,
            provider_activity_updates: preferenceResult.data.provider_activity_updates,
            product_news_and_promotions: preferenceResult.data.product_news_and_promotions,
          });
        }
        const requests = await supabase.from("account_deletion_requests")
          .select("id,status,requested_at").eq("user_id", user.id)
          .in("status", ["pending", "in_review"]).order("requested_at", { ascending: false }).limit(1);
        if (!requests.error && requests.data?.[0] && alive) {
          setDeletionStatus(requests.data[0].status);
          setDeletionRequestId(requests.data[0].id);
        }
      } catch {
        if (alive) {
          setMessage("We couldn't load your settings. Confirm the required reviewed migrations have been applied to your own Supabase project, then try again.");
          setMessageKind("error");
        }
      } finally { if (alive) setLoading(false); }
    }
    void load();
    return () => { alive = false; };
  }, []);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(""); setSavingProfile(true);
    const cleanName = name.trim();
    const cleanPhone = phone.trim();
    const cleanCounty = county.trim();
    const cleanTown = town.trim();
    if (cleanName.length < 1 || cleanName.length > 120) {
      setMessage("Enter a name using 1–120 characters."); setMessageKind("error"); setSavingProfile(false); return;
    }
    if (cleanPhone && (cleanPhone.length < 7 || cleanPhone.length > 32 || !/^[+0-9()\s-]+$/.test(cleanPhone))) {
      setMessage("Enter a valid phone number or leave it blank."); setMessageKind("error"); setSavingProfile(false); return;
    }
    if (cleanCounty.length > 100 || cleanTown.length > 100) {
      setMessage("County and town must each be 100 characters or fewer."); setMessageKind("error"); setSavingProfile(false); return;
    }
    if (!userId) { setMessage("Please sign in again."); setMessageKind("error"); setSavingProfile(false); return; }
    try {
      const supabase = createSupabaseBrowserClient();
      const existing = await supabase.from("user_onboarding").select("user_id").eq("user_id", userId).maybeSingle();
      if (existing.error) throw existing.error;
      const values = {
        full_name: cleanName, phone: cleanPhone || null, country_code: country,
        county: cleanCounty || null, town: cleanTown || null, account_intent: intent,
      };
      const result = existing.data
        ? await supabase.from("user_onboarding").update(values).eq("user_id", userId)
        : await supabase.from("user_onboarding").insert({ user_id: userId, ...values });
      if (result.error) throw result.error;
      setMessage("Your profile details have been saved."); setMessageKind("success");
    } catch {
      setMessage("We couldn't save your profile. Confirm migration 0004 is applied and that your session is valid.");
      setMessageKind("error");
    } finally { setSavingProfile(false); }
  }

  async function savePreferences(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSavingPreferences(true); setPreferencesMessage(""); setPreferencesSuccess(false);
    if (!userId) { setPreferencesMessage("Please sign in again before saving preferences."); setSavingPreferences(false); return; }
    try {
      const db = createSupabaseBrowserClient();
      const existing = await db.from("user_notification_preferences").select("user_id").eq("user_id", userId).maybeSingle();
      if (existing.error) throw existing.error;
      const result = existing.data
        ? await db.from("user_notification_preferences").update(preferences).eq("user_id", userId)
        : await db.from("user_notification_preferences").insert({ user_id: userId, ...preferences });
      if (result.error) throw result.error;
      setPreferencesSuccess(true);
      setPreferencesMessage("Your notification preferences have been saved. Delivery channels will honor these choices when those notification workflows are implemented.");
    } catch {
      setPreferencesMessage("Could not save preferences. Confirm migration 0012 is reviewed and applied, then retry.");
    } finally { setSavingPreferences(false); }
  }

  async function requestEmailChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setEmailMessage(""); setEmailSuccess(false);
    const target = newEmail.trim().toLowerCase();
    if (!hasEmailIdentity) {
      setEmailMessage("This account does not have an email/password identity. Email changes for external sign-in identities are not supported here.");
      return;
    }
    if (!target || target.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) {
      setEmailMessage("Enter a valid email address.");
      return;
    }
    if (target === email.trim().toLowerCase()) {
      setEmailMessage("Enter an email address different from your current address.");
      return;
    }
    setSavingEmail(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const redirectTo = new URL("/auth/callback?next=%2Faccount%2Fsettings", window.location.origin).toString();
      const result = await supabase.auth.updateUser({ email: target }, { emailRedirectTo: redirectTo });
      if (result.error) throw result.error;
      setEmailSuccess(true);
      setEmailMessage("Email change requested. Follow the confirmation instructions sent by Supabase Auth. Your current email remains active until the provider confirms the change.");
      setNewEmail("");
    } catch (caught) {
      setEmailMessage(caught instanceof Error ? caught.message : "We couldn't request the email change. Please try again.");
    } finally { setSavingEmail(false); }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPasswordMessage(""); setPasswordSuccess(false);
    if (!hasEmailIdentity) {
      setPasswordMessage("This account does not have an email/password sign-in. Use your identity provider's account security settings to change its password.");
      return;
    }
    if (newPassword.length < 10 || newPassword.length > 128) {
      setPasswordMessage("Use a new password between 10 and 128 characters."); return;
    }
    if (newPassword !== confirmPassword) { setPasswordMessage("The new passwords do not match."); return; }
    if (!currentPassword || !email) { setPasswordMessage("Enter your current password to confirm it's you."); return; }
    setSavingPassword(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const reauth = await supabase.auth.signInWithPassword({ email, password: currentPassword });
      if (reauth.error) throw new Error("Your current password could not be verified. Check it and try again.");
      const update = await supabase.auth.updateUser({ password: newPassword });
      if (update.error) throw update.error;
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      setPasswordSuccess(true); setPasswordMessage("Password updated successfully.");
    } catch (caught) {
      setPasswordMessage(caught instanceof Error ? caught.message : "We couldn't update your password. Please try again.");
    } finally { setSavingPassword(false); }
  }

  async function cancelDeletionRequest() {
    if (!deletionRequestId || deletionStatus !== "pending") return;
    if (!window.confirm("Cancel your pending account-deletion request? Your Shilevi account will remain active.")) return;
    setCancellingDeletion(true); setDeletionMessage(""); setDeletionSuccess(false);
    try {
      const supabase = createSupabaseBrowserClient();
      const result = await supabase.from("account_deletion_requests")
        .update({ status: "cancelled" }).eq("id", deletionRequestId).eq("status", "pending");
      if (result.error) throw result.error;
      setDeletionStatus(""); setDeletionRequestId(""); setDeletionSuccess(true);
      setDeletionMessage("Your pending deletion request has been cancelled. Your account remains active.");
    } catch {
      setDeletionMessage("We could not cancel the request. It may already be under review, or migration 0010 may not be applied.");
    } finally { setCancellingDeletion(false); }
  }

  async function requestDeletion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setDeletionMessage(""); setDeletionSuccess(false);
    if (deleteConfirmation.trim() !== "DELETE MY ACCOUNT") {
      setDeletionMessage('Type "DELETE MY ACCOUNT" exactly to confirm your request.'); return;
    }
    if (!userId) { setDeletionMessage("Please sign in again before submitting this request."); return; }
    if (hasEmailIdentity && (!deletePassword || !email)) {
      setDeletionMessage("Enter your current password to verify this request."); return;
    }
    setRequestingDeletion(true);
    try {
      const supabase = createSupabaseBrowserClient();
      if (hasEmailIdentity) {
        const reauth = await supabase.auth.signInWithPassword({ email, password: deletePassword });
        if (reauth.error) throw new Error("Your current password could not be verified. No request was submitted.");
      }
      const result = await supabase.from("account_deletion_requests").insert({ user_id: userId, status: "pending" });
      if (result.error) {
        if (result.error.code === "23505") throw new Error("You already have an open account-deletion request.");
        throw result.error;
      }
      setDeletionStatus("pending");
      setDeletePassword(""); setDeleteConfirmation("");
      setDeletionSuccess(true);
      setDeletionMessage("Your request was submitted. This does not immediately delete your account; the Shilevi team must review the request and handle applicable records and retention requirements.");
    } catch (caught) {
      setDeletionMessage(caught instanceof Error ? caught.message : "We couldn't submit your request. Confirm migration 0008 has been reviewed and applied.");
    } finally { setRequestingDeletion(false); }
  }

  return <main className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6 sm:py-12">
    <div className="mx-auto max-w-4xl">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/" className="text-2xl font-black tracking-tight text-blue-700">shilevi</Link>
        <Link href="/account" className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50">Back to account</Link>
      </header>
      <div className="mt-8">
        <p className="text-sm font-bold uppercase tracking-wide text-blue-700">Account centre</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">Your settings</h1>
        <p className="mt-3 max-w-2xl leading-7 text-slate-600">Manage your profile and account security. Email changes require confirmation through your sign-in provider.</p>
      </div>
      {loading ? <p role="status" className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 text-slate-600">Loading your settings…</p> : <>
        <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
          <h2 className="text-xl font-bold">Personal information</h2>
          <p className="mt-2 text-sm text-slate-600">Signed in as <span className="font-semibold text-slate-900">{email || "your account"}</span></p>
          <form onSubmit={saveProfile} className="mt-6 space-y-5">
            <label className="block text-sm font-semibold">Full name
              <input required autoComplete="name" maxLength={120} value={name} onChange={e=>setName(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal focus:border-blue-600 focus:outline-none" />
            </label>
            <label className="block text-sm font-semibold">Phone number <span className="font-normal text-slate-500">(optional)</span>
              <input type="tel" autoComplete="tel" maxLength={32} value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+254 7xx xxx xxx" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal focus:border-blue-600 focus:outline-none" />
            </label>
            <label className="block text-sm font-semibold">Country
              <select value={country} onChange={e=>setCountry(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-normal focus:border-blue-600 focus:outline-none">{countries.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}</select>
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-semibold">County / region <span className="font-normal text-slate-500">(optional)</span>
                <input maxLength={100} value={county} onChange={e=>setCounty(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal focus:border-blue-600 focus:outline-none" />
              </label>
              <label className="block text-sm font-semibold">Town / city <span className="font-normal text-slate-500">(optional)</span>
                <input maxLength={100} value={town} onChange={e=>setTown(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal focus:border-blue-600 focus:outline-none" />
              </label>
            </div>
            <fieldset className="space-y-3">
              <legend className="text-sm font-semibold">Main account use</legend>
              <label className="flex items-center gap-3 rounded-xl border border-slate-200 p-3"><input type="radio" name="intent" checked={intent==="customer"} onChange={()=>setIntent("customer")} />Customer — browse and use the marketplace</label>
              <label className="flex items-center gap-3 rounded-xl border border-slate-200 p-3"><input type="radio" name="intent" checked={intent==="provider"} onChange={()=>setIntent("provider")} />Provider — apply for one or more provider activities</label>
            </fieldset>
            <button disabled={savingProfile} className="w-full rounded-xl bg-blue-700 px-5 py-3 font-bold text-white hover:bg-blue-800 disabled:opacity-60 sm:w-auto">{savingProfile ? "Saving profile…" : "Save profile changes"}</button>
            {message && <p role={messageKind==="success"?"status":"alert"} className={messageKind==="success"?"rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800":"rounded-xl bg-red-50 p-3 text-sm text-red-800"}>{message}</p>}
          </form>
        </section>

        <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
          <h2 className="text-xl font-bold">Notification preferences</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">Choose the updates associated with your account. These settings are stored, but notification delivery has not been implemented yet.</p>
          <form onSubmit={savePreferences} className="mt-5 space-y-3">
            <label className="flex gap-3 rounded-xl border border-slate-200 p-4"><input type="checkbox" checked={preferences.marketplace_updates} onChange={e=>setPreferences(current=>({...current,marketplace_updates:e.target.checked}))} /><span className="text-sm font-semibold">Marketplace updates</span></label>
            <label className="flex gap-3 rounded-xl border border-slate-200 p-4"><input type="checkbox" checked={preferences.account_security_alerts} onChange={e=>setPreferences(current=>({...current,account_security_alerts:e.target.checked}))} /><span className="text-sm font-semibold">Account security alerts</span></label>
            <label className="flex gap-3 rounded-xl border border-slate-200 p-4"><input type="checkbox" checked={preferences.order_and_booking_updates} onChange={e=>setPreferences(current=>({...current,order_and_booking_updates:e.target.checked}))} /><span className="text-sm font-semibold">Order and booking updates</span></label>
            <label className="flex gap-3 rounded-xl border border-slate-200 p-4"><input type="checkbox" checked={preferences.provider_activity_updates} onChange={e=>setPreferences(current=>({...current,provider_activity_updates:e.target.checked}))} /><span className="text-sm font-semibold">Provider activity updates</span></label>
            <label className="flex gap-3 rounded-xl border border-slate-200 p-4"><input type="checkbox" checked={preferences.product_news_and_promotions} onChange={e=>setPreferences(current=>({...current,product_news_and_promotions:e.target.checked}))} /><span className="text-sm font-semibold">Product news and promotions</span></label>
            <button disabled={savingPreferences} className="rounded-xl bg-blue-700 px-5 py-3 font-bold text-white disabled:opacity-60">{savingPreferences ? "Saving…" : "Save preferences"}</button>
            {preferencesMessage && <p role={preferencesSuccess ? "status" : "alert"} className="rounded-xl bg-slate-50 p-3 text-sm">{preferencesMessage}</p>}
          </form>
        </section>

        <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
          <h2 className="text-xl font-bold">Email address</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">Current sign-in email: <span className="font-semibold text-slate-900">{email || "Not available"}</span>. Email changes require confirmation through Supabase Auth.</p>
          {hasEmailIdentity ? <form onSubmit={requestEmailChange} className="mt-5 space-y-4">
            <label className="block text-sm font-semibold">New email address<input required type="email" maxLength={254} autoComplete="email" value={newEmail} onChange={e=>setNewEmail(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" placeholder="you@example.com" /></label>
            <button disabled={savingEmail} className="rounded-xl border border-slate-300 px-5 py-3 font-bold disabled:opacity-60">{savingEmail ? "Requesting change…" : "Request email change"}</button>
            {emailMessage && <p role={emailSuccess ? "status" : "alert"} className="rounded-xl bg-slate-50 p-3 text-sm">{emailMessage}</p>}
          </form> : <p className="mt-4 rounded-xl bg-blue-50 p-4 text-sm text-blue-900">This account uses an external identity provider. Manage its email through that provider.</p>}
        </section>

        <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
          <h2 className="text-xl font-bold">Password and security</h2>
          {hasEmailIdentity ? <>
            <p className="mt-2 text-sm leading-6 text-slate-600">Confirm your current password before changing it. Use at least 10 characters for the new password.</p>
            <form onSubmit={changePassword} className="mt-5 space-y-4">
              <label className="block text-sm font-semibold">Current password<input type="password" required autoComplete="current-password" value={currentPassword} onChange={e=>setCurrentPassword(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" /></label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm font-semibold">New password<input type="password" required minLength={10} maxLength={128} autoComplete="new-password" value={newPassword} onChange={e=>setNewPassword(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" /></label>
                <label className="block text-sm font-semibold">Confirm new password<input type="password" required minLength={10} maxLength={128} autoComplete="new-password" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" /></label>
              </div>
              <button disabled={savingPassword} className="rounded-xl border border-slate-300 px-5 py-3 font-bold disabled:opacity-60">{savingPassword?"Updating password…":"Update password"}</button>
              {passwordMessage && <p role={passwordSuccess?"status":"alert"} className={passwordSuccess?"text-sm text-emerald-700":"text-sm text-red-700"}>{passwordMessage}</p>}
            </form>
          </> : <p className="mt-3 rounded-xl bg-blue-50 p-4 text-sm leading-6 text-blue-900">This account uses an external identity provider. Change your password with that provider; Shilevi cannot change an external password directly.</p>}
          <div className="mt-6 border-t border-slate-100 pt-5">
            <Link href="/forgot-password" className="font-semibold text-blue-700 hover:underline">Forgot your password?</Link>
            <p className="mt-2 text-sm text-slate-600">Multi-factor security and active-session management still need a dedicated setup flow.</p>
          </div>
        </section>

        <section className="mt-6 rounded-3xl border border-red-200 bg-white p-5 shadow-sm sm:p-8">
          <h2 className="text-xl font-bold text-red-800">Request account deletion</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">This submits a deletion request for review; it does not instantly delete your account. The team must review orders, financial records, legal retention obligations and any provider-owned files before processing. A recent-authentication check is enforced by database policy. Do not use this form for an urgent security incident.</p>
          {deletionStatus ? <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4"><p className="font-semibold text-amber-900">Request status: {deletionStatus.replaceAll("_"," ")}</p><p className="mt-1 text-sm leading-6 text-amber-900">You already have an open request. If it is still pending, you can cancel it here; requests already under review must be handled by the Shilevi team.</p>{deletionStatus === "pending" && <button type="button" disabled={cancellingDeletion} onClick={() => void cancelDeletionRequest()} className="mt-3 rounded-xl border border-amber-400 px-4 py-2 text-sm font-bold text-amber-950 disabled:opacity-50">{cancellingDeletion ? "Cancelling…" : "Cancel pending request"}</button>}{deletionMessage && <p role={deletionSuccess ? "status" : "alert"} className="mt-3 text-sm text-amber-950">{deletionMessage}</p>}</div> : <form onSubmit={requestDeletion} className="mt-5 space-y-4">
            {hasEmailIdentity ? <label className="block text-sm font-semibold">Current password (identity confirmation)<input type="password" required autoComplete="current-password" value={deletePassword} onChange={e=>setDeletePassword(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" /></label> : <p className="rounded-xl bg-blue-50 p-3 text-sm leading-6 text-blue-900">For security, your session must have been authenticated within the last 10 minutes. If this session is older, sign out and sign in again before submitting the request.</p>}
            <label className="block text-sm font-semibold">Type DELETE MY ACCOUNT to confirm
              <input required value={deleteConfirmation} onChange={e=>setDeleteConfirmation(e.target.value)} autoComplete="off" className="mt-2 w-full rounded-xl border border-red-200 px-4 py-3 font-normal focus:border-red-500 focus:outline-none" placeholder="DELETE MY ACCOUNT" />
            </label>
            <button disabled={requestingDeletion} className="rounded-xl bg-red-700 px-5 py-3 font-bold text-white hover:bg-red-800 disabled:opacity-60">{requestingDeletion?"Submitting request…":"Submit deletion request"}</button>
            {deletionMessage && <p role={deletionSuccess?"status":"alert"} className={deletionSuccess?"rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800":"rounded-xl bg-red-50 p-3 text-sm text-red-800"}>{deletionMessage}</p>}
          </form>}
        </section>
      </>}
      <footer className="py-8 text-sm text-slate-500">Shilevi account centre · <Link href="/account" className="font-semibold text-blue-700">Account dashboard</Link> · <Link href="/" className="font-semibold text-blue-700">Home</Link></footer>
    </div>
  </main>;
}
