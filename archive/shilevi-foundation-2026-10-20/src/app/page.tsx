const divisions = [
  { number: "01", title: "Products", description: "Discover goods from approved sellers, from everyday essentials to specialist items." },
  { number: "02", title: "Services", description: "Find trusted local professionals, book services, and compare offers." },
  { number: "03", title: "Transport & delivery", description: "Arrange eligible deliveries with a clear price and an assigned delivery partner." },
  { number: "04", title: "Property & places", description: "Explore property, accommodation, venues, and other places." },
];

export default function HomePage() {
  return (
    <main className="min-h-screen">
      <header className="mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-5 lg:px-10">
        <a href="/" className="flex items-center gap-3" aria-label="Shilevi home">
          <span className="grid h-10 w-10 place-items-center rounded-2xl bg-[var(--primary)] text-lg font-black text-white">S</span>
          <span className="text-xl font-bold tracking-tight">shilevi</span>
        </a>
        <nav className="hidden items-center gap-7 text-sm font-medium text-[var(--muted)] md:flex" aria-label="Main navigation">
          <a href="#marketplaces" className="hover:text-[var(--primary)]">Explore</a>
          <a href="#how-it-works" className="hover:text-[var(--primary)]">How it works</a>
          <a href="#providers" className="hover:text-[var(--primary)]">Become a provider</a>
        </nav>
        <div className="flex items-center gap-3">
          <a className="hidden rounded-full px-4 py-2 text-sm font-semibold sm:inline-flex" href="/login">Log in</a>
          <a className="rounded-full bg-[var(--primary)] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-90" href="/signup">Get started</a>
        </div>
      </header>

      <section className="mx-auto grid max-w-7xl gap-12 px-6 pb-20 pt-14 lg:grid-cols-[1.05fr_.95fr] lg:items-center lg:px-10 lg:pb-28 lg:pt-20">
        <div>
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-white px-4 py-2 text-sm text-[var(--muted)]">
            <span className="h-2 w-2 rounded-full bg-[var(--sky)]" />
            Built for Kenya. Ready to grow.
          </div>
          <h1 className="max-w-3xl text-5xl font-black leading-[1.04] tracking-[-0.045em] sm:text-6xl lg:text-7xl">
            One place for <span className="text-[var(--primary)]">what you need.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-[var(--muted)]">
            Shop products, discover services, arrange delivery, and explore property and places — all through one connected marketplace.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <a href="#marketplaces" className="rounded-full bg-[var(--primary)] px-6 py-3.5 font-semibold text-white shadow-lg shadow-blue-900/10 hover:opacity-90">Explore Shilevi <span aria-hidden="true">→</span></a>
            <a href="#providers" className="rounded-full border border-[var(--border)] bg-white px-6 py-3.5 font-semibold hover:border-[var(--primary)]">Start selling or offering</a>
          </div>
          <div className="mt-10 flex flex-wrap gap-x-6 gap-y-2 text-sm text-[var(--muted)]">
            <span>✓ One account, multiple approved activities</span>
            <span>✓ Clear prices and protected workflows</span>
          </div>
        </div>

        <div className="relative">
          <div className="absolute -inset-5 rounded-[2.5rem] bg-gradient-to-br from-blue-100 via-sky-50 to-white blur-2xl" />
          <div className="relative rounded-[2rem] border border-white bg-white p-5 shadow-2xl shadow-blue-950/10 sm:p-7">
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-5">
              <div><p className="text-sm text-[var(--muted)]">Discover nearby</p><p className="mt-1 text-lg font-bold">Your next find starts here</p></div>
              <span className="rounded-full bg-[var(--primary-soft)] px-3 py-1.5 text-xs font-bold text-[var(--primary)]">SHILEVI</span>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-4">
              <div className="rounded-2xl bg-[#edf3ff] p-5"><div className="mb-7 grid h-12 w-12 place-items-center rounded-xl bg-white text-2xl">🛍️</div><p className="font-bold">Products</p><p className="mt-1 text-sm text-[var(--muted)]">Browse and buy</p></div>
              <div className="rounded-2xl bg-[#eafaff] p-5"><div className="mb-7 grid h-12 w-12 place-items-center rounded-xl bg-white text-2xl">🧰</div><p className="font-bold">Services</p><p className="mt-1 text-sm text-[var(--muted)]">Find local talent</p></div>
              <div className="rounded-2xl bg-[#f0f5ff] p-5"><div className="mb-7 grid h-12 w-12 place-items-center rounded-xl bg-white text-2xl">🚚</div><p className="font-bold">Delivery</p><p className="mt-1 text-sm text-[var(--muted)]">Move things safely</p></div>
              <div className="rounded-2xl bg-[#eefaff] p-5"><div className="mb-7 grid h-12 w-12 place-items-center rounded-xl bg-white text-2xl">🏡</div><p className="mb-1 font-bold">Property & places</p><p className="text-sm text-[var(--muted)]">Explore spaces</p></div>
            </div>
            <div className="mt-5 rounded-2xl bg-[var(--foreground)] p-5 text-white">
              <p className="text-sm text-blue-200">The Shilevi promise</p>
              <p className="mt-1 text-lg font-semibold">Clear offers. Trusted connections. Better access.</p>
            </div>
          </div>
        </div>
      </section>

      <section id="marketplaces" className="border-y border-[var(--border)] bg-white py-16 sm:py-20">
        <div className="mx-auto max-w-7xl px-6 lg:px-10">
          <div className="max-w-2xl"><p className="text-sm font-bold uppercase tracking-[.18em] text-[var(--primary)]">Four connected divisions</p><h2 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">Everything has its place.</h2><p className="mt-4 leading-7 text-[var(--muted)]">A single marketplace experience, with category-specific rules, listings, and workflows behind the scenes.</p></div>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {divisions.map((item) => <article key={item.number} className="rounded-3xl border border-[var(--border)] bg-[var(--background)] p-6 transition hover:-translate-y-1 hover:border-blue-200 hover:shadow-lg"><p className="text-sm font-bold text-[var(--primary)]">{item.number}</p><h3 className="mt-8 text-xl font-bold">{item.title}</h3><p className="mt-3 text-sm leading-6 text-[var(--muted)]">{item.description}</p></article>)}
          </div>
        </div>
      </section>

      <section id="how-it-works" className="mx-auto max-w-7xl px-6 py-16 lg:px-10 lg:py-20">
        <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
          <div><p className="text-sm font-bold uppercase tracking-[.18em] text-[var(--primary)]">Designed around trust</p><h2 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">A better process from discovery to completion.</h2></div>
          <div className="grid gap-4 sm:grid-cols-3">
            {["Find an offer", "Agree on the details", "Complete with confidence"].map((item, i) => <div key={item} className="rounded-2xl border border-[var(--border)] bg-white p-5"><span className="grid h-8 w-8 place-items-center rounded-full bg-[var(--primary-soft)] text-sm font-bold text-[var(--primary)]">{i + 1}</span><p className="mt-4 font-bold">{item}</p></div>)}
          </div>
        </div>
      </section>

      <section id="providers" className="mx-6 mb-12 rounded-[2rem] bg-[var(--primary)] px-6 py-12 text-white sm:mx-10 sm:px-10 lg:mx-auto lg:max-w-7xl lg:px-14 lg:py-14">
        <div className="flex flex-col justify-between gap-7 md:flex-row md:items-center">
          <div><p className="text-sm font-bold uppercase tracking-[.18em] text-blue-200">For businesses and professionals</p><h2 className="mt-3 max-w-2xl text-3xl font-black tracking-tight sm:text-4xl">Bring your business to Shilevi.</h2><p className="mt-3 max-w-xl leading-7 text-blue-100">Apply for the activities you want to offer. Each activity is reviewed independently before you can publish in it.</p></div>
          <a href="/signup?intent=provider" className="inline-flex shrink-0 items-center justify-center rounded-full bg-white px-6 py-3.5 font-bold text-[var(--primary)] hover:bg-blue-50">Become a provider <span className="ml-2" aria-hidden="true">→</span></a>
        </div>
      </section>

      <footer className="mx-auto flex max-w-7xl flex-col gap-4 px-6 pb-8 text-sm text-[var(--muted)] sm:flex-row sm:items-center sm:justify-between lg:px-10">
        <p>© {new Date().getFullYear()} Shilevi. All rights reserved.</p>
        <div className="flex flex-wrap gap-5"><a href="/legal/terms">Terms</a><a href="/legal/privacy">Privacy</a><a href="/legal/cookies">Cookie preferences</a><a href="/support">Support</a></div>
      </footer>
    </main>
  );
}
