/**
 * Which console paths are owner-only.
 *
 * The page itself enforces authorization; this list exists so middleware can return a genuine 404
 * for a signed-in non-owner before any admin chrome renders. Paths not listed here are
 * capability-scoped staff screens: middleware only checks that the account holds at least one
 * unrevoked grant, and the page then checks the exact capability (`orders.read`, `finance.read`,
 * ...). Keep this list in step with `requireOwnerAdmin` / `requireStaffCapability` usage.
 */
const OWNER_ONLY_ADMIN_PATHS = [
  "/admin",
  "/admin/applications",
  "/admin/audit-log",
  "/admin/brands",
  "/admin/categories",
  "/admin/commission",
  "/admin/deletion-requests",
  "/admin/document-requirements",
  "/admin/incidents",
  "/admin/insights",
  "/admin/listings",
  "/admin/notifications",
  "/admin/orders",
  "/admin/payments/providers",
  "/admin/payouts/reconciliation",
  "/admin/refunds",
  "/admin/security",
  "/admin/settings",
  "/admin/staff",
  "/admin/system-health",
];

export function isOwnerOnlyAdminPath(pathname: string): boolean {
  return OWNER_ONLY_ADMIN_PATHS.some(
    prefix => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
