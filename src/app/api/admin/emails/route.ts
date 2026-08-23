import { NextResponse } from "next/server";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { db, emailLogs } from "@/db";
import { requirePlatformAdmin, authErrorResponse } from "@/lib/auth";
import { audit, safeDetail } from "@/lib/audit";
import { env } from "@/lib/env";
import { clientIp } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

/**
 * ADMIN — read a message that was never delivered.
 *
 * A deliberate, temporary hole in the account-recovery model, and worth being
 * blunt about: a password-reset link IS the account. An administrator who can
 * read one can sign in as anybody. Normally there is no such thing as reading
 * another user's reset link, and that is a feature.
 *
 * It exists because the alternative is worse. With no verified sending domain,
 * every message is written to `email_logs` and discarded, so a user who forgets
 * their password has no route back into their account at all, and a recruiter
 * who signs up cannot post a job or send a message — verification gates both.
 * The links are already sitting in the database; the only question is whether
 * anyone can reach them.
 *
 * ── What keeps it proportionate ──
 *
 * 1. UNDELIVERED ONLY. A message Resend accepted is not shown, ever. The
 *    recipient already has it, so revealing it to an admin is exposure with no
 *    corresponding benefit.
 * 2. NOT WHILE EMAIL WORKS. Once a sending domain is configured this endpoint
 *    refuses outright. It cannot quietly outlive the outage it was built for.
 * 3. AUDITED BY RECIPIENT. Every read is written to the audit log with the
 *    address whose link was exposed, so "who could have taken over this
 *    account" is answerable later.
 * 4. ONE ADDRESS AT A TIME. There is no listing. An admin must already know
 *    who they are helping, which makes browsing for a target impossible.
 */

/** Only these ever appear here. A delivered message is the recipient's. */
const UNDELIVERED = ["LOGGED_ONLY", "FAILED"] as const;

/** Nothing older than this, regardless of token lifetime. */
const WINDOW_DAYS = 7;

/** Mirrors TTL in src/lib/tokens.ts, to show whether a link is still usable. */
const TTL_SEC: Record<string, number> = {
  PASSWORD_RESET: 60 * 60,
  VERIFY_EMAIL: 24 * 60 * 60,
  COMPANY_INVITE: 7 * 24 * 60 * 60,
};

export async function GET(req: Request) {
  let admin;
  try {
    admin = await requirePlatformAdmin();
  } catch (e) {
    return authErrorResponse(e)!;
  }

  /**
   * The self-closing door.
   *
   * The moment email genuinely works, this stops answering. Without it the
   * endpoint would linger long after the reason for it had gone, which is how
   * an emergency measure becomes a permanent weakness.
   */
  if (env.email.enabled) {
    return NextResponse.json(
      {
        error:
          "Email is configured on this deployment, so undelivered messages are no longer readable here. Ask the user to request a new link.",
        code: "NOT_NEEDED",
      },
      { status: 409 }
    );
  }

  const to = new URL(req.url).searchParams.get("to")?.trim().toLowerCase();
  if (!to) {
    // No listing endpoint on purpose — see note 4 above.
    return NextResponse.json(
      { error: "Give the exact email address of the person you're helping.", code: "TO_REQUIRED" },
      { status: 400 }
    );
  }

  const rows = await db
    .select()
    .from(emailLogs)
    .where(
      and(
        eq(emailLogs.to, to),
        inArray(emailLogs.status, [...UNDELIVERED]),
        gte(emailLogs.createdAt, new Date(Date.now() - WINDOW_DAYS * 86_400_000))
      )
    )
    .orderBy(desc(emailLogs.createdAt))
    .limit(10);

  // Logged BEFORE the body is returned, so a crash mid-response still leaves
  // the record that the attempt happened.
  await audit({
    action: "admin.messages_viewed",
    actorId: admin.id,
    subjectType: "email_log",
    detail: safeDetail({ to, results: rows.length, reason: "email_undeliverable" }),
    ip: clientIp(req),
  });

  const now = Date.now();

  return NextResponse.json({
    to,
    messages: rows.map((r) => {
      const ttl = TTL_SEC[r.template] ?? null;
      const expiresAt = ttl ? new Date(r.createdAt.getTime() + ttl * 1000) : null;
      // Pulled out so an admin can copy the link without reading the whole
      // message, and so the UI can show expiry rather than a dead link.
      const link = r.body.match(/https?:\/\/\S+/)?.[0]?.replace(/[).,]+$/, "") ?? null;
      return {
        id: r.id,
        template: r.template,
        status: r.status,
        subject: r.subject,
        createdAt: r.createdAt.toISOString(),
        expiresAt: expiresAt?.toISOString() ?? null,
        expired: expiresAt ? expiresAt.getTime() < now : false,
        link,
      };
    }),
    note:
      "These were never sent. A reset link signs the person in — send it only to the address it was issued for, and only if you are sure who asked.",
  });
}
