import type { NextConfig } from "next";
import { SECURITY_HEADERS } from "./src/lib/security/headers";

/**
 * Private areas are already `noindex` in their metadata and disallowed in robots.txt. These
 * response headers add defence in depth: a crawler that ignores robots.txt still receives an
 * explicit noindex instruction, including on redirect responses inside the area.
 */
const PRIVATE_AREAS = ["/account", "/admin", "/provider", "/rider", "/checkout", "/cart", "/onboarding"];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // The repository ships two lockfiles by design: the root application and the generated
  // `vercel-deploy/` copy that Vercel builds. Without this, Next walks up and traces from the
  // parent directory, which can bundle the wrong files. Tracing from the build's own directory
  // keeps the output correct in both places.
  outputFileTracingRoot: process.cwd(),
  images: {
    // Brand logos and listing media are served from Supabase Storage and provider CDNs.
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co" },
      { protocol: "https", hostname: "*.supabase.in" },
    ],
  },
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      {
        source: "/api/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
      ...PRIVATE_AREAS.map(area => ({
        source: `${area}/:path*`,
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }],
      })),
      ...PRIVATE_AREAS.map(area => ({
        source: area,
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }],
      })),
    ];
  },
};

export default nextConfig;
