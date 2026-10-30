import type { Metadata, Viewport } from "next";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { CartProvider } from "@/components/cart/CartProvider";
import { CookieNotice } from "@/components/layout/CookieNotice";
import { JsonLd } from "@/components/seo/JsonLd";
import { absoluteUrl, site } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: { default: `${site.name} — ${site.tagline}`, template: `%s | ${site.name}` },
  description: site.description,
  applicationName: site.name,
  keywords: [
    "Kenya marketplace",
    "buy and sell Kenya",
    "local services Kenya",
    "delivery Kenya",
    "property Kenya",
    "Shilevi",
  ],
  authors: [{ name: site.name, url: site.url }],
  creator: site.name,
  publisher: site.name,
  formatDetection: { telephone: false, email: false, address: false },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    shortcut: "/icon.svg",
    apple: "/icon.svg",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1d4ed8",
  colorScheme: "light",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-KE">
      <body>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-xl focus:bg-blue-700 focus:px-4 focus:py-3 focus:font-bold focus:text-white"
        >
          Skip to main content
        </a>
        <AuthProvider>
          <CartProvider>{children}</CartProvider>
        </AuthProvider>
        <CookieNotice />
        <JsonLd
          data={[
            {
              "@context": "https://schema.org",
              "@type": "Organization",
              name: site.name,
              url: site.url,
              logo: absoluteUrl("/icon.svg"),
              description: site.description,
              email: site.supportEmail,
              areaServed: { "@type": "Country", name: site.country },
            },
            {
              "@context": "https://schema.org",
              "@type": "WebSite",
              name: site.name,
              url: site.url,
              inLanguage: "en-KE",
            },
          ]}
        />
      </body>
    </html>
  );
}
