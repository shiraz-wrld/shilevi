import Link from "next/link";

const navigation = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/applications", label: "Applications" },
  { href: "/admin/listings", label: "Listings" },
  { href: "/admin/orders", label: "Orders" },
  { href: "/admin/rides", label: "Rides" },
  { href: "/admin/properties", label: "Properties" },
  { href: "/admin/payments", label: "Payments" },
  { href: "/admin/insights", label: "Search insights" },
  { href: "/admin/staff", label: "Staff" },
  { href: "/admin/categories", label: "Categories" },
  { href: "/admin/brands", label: "Brands" },
  { href: "/admin/deletion-requests", label: "Deletions" },
  { href: "/admin/audit-log", label: "Audit log" },
  { href: "/admin/security", label: "Security" },
];

export function AdminAccessDenied({ reason }: { reason: "configuration" | "forbidden" }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-5 py-12 text-white">
      <section className="w-full max-w-lg rounded-3xl border border-slate-800 bg-slate-900 p-8">
        <p className="text-sm font-bold uppercase tracking-wide text-blue-300">Shilevi security</p>
        <h1 className="mt-3 text-3xl font-black">{reason === "configuration" ? "Admin access is not configured" : "Access denied"}</h1>
        <p className="mt-4 leading-7 text-slate-300">
          {reason === "configuration"
            ? "Server-side Supabase environment variables must be configured before the admin session can be verified."
            : "This account is not authorized for the owner control center. Use one of the approved, email-verified owner accounts with MFA."}
        </p>
        <Link href="/" className="mt-6 inline-flex rounded-full bg-blue-600 px-5 py-3 font-bold text-white">Return to Shilevi</Link>
      </section>
    </main>
  );
}

export function AdminShell({
  email,
  mfaLevel,
  title,
  description,
  children,
}: {
  email: string | null;
  mfaLevel: string | null;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-slate-800">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-5 py-4">
          <Link href="/admin" className="text-xl font-black text-blue-300">
            shilevi <span className="text-slate-400">/ admin</span>
          </Link>
          <span className="text-sm text-slate-300">{email}</span>
        </div>
        <nav aria-label="Admin sections" className="mx-auto flex max-w-7xl gap-x-5 gap-y-2 overflow-x-auto px-5 pb-3 text-sm">
          {navigation.map(item => (
            <Link key={item.href} href={item.href} className="whitespace-nowrap text-slate-300 hover:text-blue-200">
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      <div className="mx-auto max-w-7xl px-5 py-10">
        <p className="text-sm font-bold uppercase tracking-widest text-blue-300">Owner-only operations</p>
        <h1 className="mt-3 text-3xl font-black sm:text-4xl">{title}</h1>
        <p className="mt-4 max-w-3xl leading-7 text-slate-300">{description}</p>
        {mfaLevel !== "aal2" && (
          <p className="mt-5 rounded-2xl border border-amber-800 bg-amber-950/40 p-4 text-sm leading-6 text-amber-100">
            This session does not have MFA assurance level 2. Owner actions and restricted reads require it.{" "}
            <Link href="/admin/security" className="font-bold underline">Set up MFA</Link>.
          </p>
        )}
        <div className="mt-8">{children}</div>
      </div>
    </main>
  );
}
