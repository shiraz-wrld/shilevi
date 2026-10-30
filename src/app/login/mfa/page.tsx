import type { Metadata } from "next";
import { safeNextPath } from "@/lib/auth/redirect";
import MfaChallenge from "./MfaChallenge";

export const metadata: Metadata = {
  title: "Two-step verification",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

export default async function LoginMfaPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  // The destination is validated here and again by the page that receives it; this only prevents
  // the step-up screen from becoming an open redirect.
  return <MfaChallenge nextPath={safeNextPath(params.next, "/account")} />;
}
