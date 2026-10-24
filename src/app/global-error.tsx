"use client";

import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Global error", { digest: error.digest });
  }, [error]);

  return (
    <html lang="en-KE">
      <body style={{ margin: 0, background: "#f8fafc", color: "#0f172a", fontFamily: "Arial, Helvetica, sans-serif" }}>
        <main style={{ maxWidth: 620, margin: "0 auto", padding: "96px 24px" }}>
          <p style={{ fontSize: 13, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: "#1d4ed8" }}>
            Service interrupted
          </p>
          <h1 style={{ fontSize: 32, fontWeight: 900, margin: "8px 0 0" }}>The application could not start</h1>
          <p style={{ fontSize: 17, lineHeight: 1.7, color: "#475569" }}>
            This is not something you did. Reload the page; if it continues, the platform team needs to check the
            server logs. No order was placed by this screen.
          </p>
          {error.digest && <p style={{ fontSize: 12, color: "#64748b" }}>Reference: {error.digest}</p>}
          <button
            onClick={reset}
            style={{ marginTop: 24, borderRadius: 12, border: 0, background: "#1d4ed8", color: "#fff", padding: "12px 20px", fontSize: 16, fontWeight: 700, cursor: "pointer" }}
          >
            Reload
          </button>
        </main>
      </body>
    </html>
  );
}
