export default function Loading() {
  return (
    <main aria-busy="true" aria-live="polite" className="mx-auto max-w-7xl px-5 py-16 sm:px-6">
      <span className="sr-only">Loading</span>
      <div className="h-4 w-32 animate-pulse rounded bg-slate-200" />
      <div className="mt-4 h-10 w-2/3 animate-pulse rounded bg-slate-200" />
      <div className="mt-3 h-4 w-1/2 animate-pulse rounded bg-slate-200" />
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map(index => (
          <div key={index} className="h-44 animate-pulse rounded-2xl border border-slate-200 bg-white" />
        ))}
      </div>
    </main>
  );
}
