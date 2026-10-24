import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  const disallow = ["/account", "/checkout", "/cart", "/admin", "/provider", "/rider", "/auth/", "/api/", "/reset-password", "/forgot-password"];

  return {
    rules: [
      { userAgent: "*", allow: "/", disallow },
      // Crawlers that honour these still see the same rules; the list documents intent.
      { userAgent: "GPTBot", allow: "/", disallow },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
