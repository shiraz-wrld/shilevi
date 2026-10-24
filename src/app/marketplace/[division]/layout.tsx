import type { Metadata } from "next";
import { divisionLabels, type Division } from "@/lib/site";

type Params = { params: Promise<{ division: string }> };

function isDivision(value: string): value is Division {
  return value in divisionLabels;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { division } = await params;
  const label = isDivision(division) ? divisionLabels[division] : "Marketplace";
  const description = isDivision(division)
    ? `Browse ${label.toLowerCase()} from verified providers across Kenya. Compare prices, delivery options and provider details on Shilevi.`
    : "Browse the Shilevi marketplace.";

  return {
    title: label,
    description,
    alternates: { canonical: `/marketplace/${division}` },
    openGraph: { title: `${label} | Shilevi`, description, url: `/marketplace/${division}` },
  };
}

export default function DivisionLayout({ children }: { children: React.ReactNode }) {
  return children;
}
