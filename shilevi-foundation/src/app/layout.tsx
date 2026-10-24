import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Shilevi — Your marketplace, connected",
  description: "Discover products, services, transport and delivery, and property through Shilevi.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
