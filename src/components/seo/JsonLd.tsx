/**
 * Renders schema.org JSON-LD.
 *
 * Only describe facts the page actually shows. Never emit aggregateRating, review counts or
 * price offers that the database cannot prove — fake structured data is a manual-action risk and
 * a trust problem.
 */
export function JsonLd({ data }: { data: Record<string, unknown> | Record<string, unknown>[] }) {
  // JSON.stringify output is escaped for the closing-script sequence so data cannot break out.
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
