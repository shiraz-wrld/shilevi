import "server-only";

import { isResendConfigured, serverEnv } from "@/lib/env.server";
import { site } from "@/lib/site";

/**
 * Transactional email through Resend.
 *
 * Auth emails (verification, recovery) are sent by Supabase Auth using custom SMTP; this module
 * handles application notifications queued in public.notification_outbox. Templates receive only
 * identifiers and statuses, never addresses, phone numbers, documents or payment credentials.
 */

export type NotificationPayload = Record<string, unknown>;

export type RenderedEmail = { subject: string; html: string; text: string };

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function label(value: unknown): string {
  return typeof value === "string" ? value.replaceAll("_", " ") : "";
}

function layout(title: string, intro: string, detail: string, cta?: { href: string; label: string }): RenderedEmail {
  const safeTitle = escapeHtml(title);
  const safeIntro = escapeHtml(intro);
  const safeDetail = escapeHtml(detail);
  const link = cta ? `${site.url}${cta.href}` : `${site.url}/account`;
  const linkLabel = cta ? cta.label : "Open your account";

  return {
    subject: `${title} | Shilevi`,
    text: `${title}\n\n${intro}\n\n${detail}\n\n${linkLabel}: ${link}\n\nShilevi will never ask for your password, PIN, or card number by email.`,
    html: `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e2e8f0;border-radius:20px;padding:32px">
<tr><td><p style="margin:0 0 24px;font-weight:900;font-size:20px;color:#1d4ed8">shilevi</p>
<h1 style="margin:0 0 12px;font-size:24px;line-height:1.25">${safeTitle}</h1>
<p style="margin:0 0 12px;line-height:1.6;color:#334155">${safeIntro}</p>
<p style="margin:0 0 24px;line-height:1.6;color:#334155">${safeDetail}</p>
<p style="margin:0 0 28px"><a href="${escapeHtml(link)}" style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:999px">${escapeHtml(linkLabel)}</a></p>
<p style="margin:0;padding-top:20px;border-top:1px solid #e2e8f0;font-size:12px;line-height:1.6;color:#64748b">This message was sent because of activity on your Shilevi account. Shilevi will never ask for your password, M-Pesa PIN, or card number by email.</p>
</td></tr></table></td></tr></table></body></html>`,
  };
}

export function renderNotification(template: string, payload: NotificationPayload): RenderedEmail {
  switch (template) {
    case "application_status": {
      const status = label(payload.status);
      return layout(
        "Your provider application was updated",
        `An application for ${label(payload.activity_type) || "a provider activity"} is now ${status || "updated"}.`,
        status === "approved"
          ? "Sign in to review the activities you can now use. Approval of one activity does not grant access to another."
          : "Sign in to read the review outcome and next steps. You can contact support if you need help.",
        { href: "/provider", label: "Open provider workspace" },
      );
    }
    case "ride_status": {
      const status = label(payload.status);
      const number = typeof payload.ride_number === "string" ? payload.ride_number : "your trip";
      return layout(
        `Trip ${number} is ${status || "updated"}`,
        "Your passenger trip status changed.",
        "Open your account for the current status, agreed fare and next action. Never share your M-Pesa PIN with anyone.",
        { href: "/transport", label: "View your trip" },
      );
    }
    case "property_verification": {
      const approved = payload.approved === true;
      return layout(
        approved ? "Your property listing was verified" : "Your property listing needs attention",
        approved
          ? "The property details and ownership or management evidence supplied were accepted."
          : "The verification review could not approve this property listing.",
        approved
          ? "Keep the vacancy status accurate so prospective tenants only see homes that are actually available."
          : "Sign in to update the property details or contact support with the correct evidence. The listing has not been removed.",
        { href: "/provider/properties", label: "Manage properties" },
      );
    }
    case "payout_status": {
      const status = label(payload.status);
      return layout(
        "Your payout status changed",
        `A withdrawal is now ${status || "updated"}.`,
        status === "paid"
          ? "The payout was confirmed. Check your M-Pesa statement for the exact amount received."
          : "Sign in to view the payout and your available balance. A payout is only marked paid after the provider confirms it.",
        { href: "/rider", label: "Open rider earnings" },
      );
    }
    default:
      return layout(
        "Shilevi account update",
        "There is an update on your Shilevi account.",
        "Sign in to review the latest activity.",
        { href: "/account", label: "Open your account" },
      );
  }
}

export async function sendEmail(input: { to: string; template: string; payload: NotificationPayload }): Promise<void> {
  if (!isResendConfigured()) {
    throw new Error("Resend is not configured.");
  }
  const message = renderNotification(input.template, input.payload);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${serverEnv.resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: serverEnv.resendFrom,
        to: [input.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      // Never log the recipient or provider body; status and a bounded message are enough.
      throw new Error(`Resend rejected the message (${response.status}): ${detail.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}
