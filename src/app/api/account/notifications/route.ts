import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { db, notificationPrefs } from "@/db";
import { AuthError, authErrorResponse, requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * MATCH-006 / NOTIF-001 — read and write notification preferences.
 *
 * The table and the unsubscribe token have existed since NOTIF-001. What was
 * missing was any way for a person to see or change them: every email carried a
 * "manage your preferences" link pointing at a page that did not exist, and
 * `sendEmail()` never read the rows even when they were set.
 *
 * Transactional mail is deliberately not represented here. There is no toggle
 * for "email me when my password changes" because there must not be one.
 */
const Body = z.object({
  newMatch: z.boolean().optional(),
  newMessage: z.boolean().optional(),
  recruiterInterest: z.boolean().optional(),
  applicationStatus: z.boolean().optional(),
  jobAlerts: z.boolean().optional(),
  productUpdates: z.boolean().optional(),
  /** The master switch behind every unsubscribe link. */
  unsubscribeAll: z.boolean().optional(),
});

/** Creates the row if a legacy account predates NOTIF-001. */
async function ensureRow(userId: string) {
  const rows = await db
    .select()
    .from(notificationPrefs)
    .where(eq(notificationPrefs.userId, userId))
    .limit(1);
  if (rows[0]) return rows[0];

  const [created] = await db
    .insert(notificationPrefs)
    .values({
      userId,
      unsubscribeTokenHash: createHash("sha256").update(randomBytes(32)).digest("hex"),
    })
    .onConflictDoNothing()
    .returning();
  return created ?? rows[0];
}

export async function GET() {
  try {
    const user = await requireUser();
    const p = await ensureRow(user.id);
    return NextResponse.json({
      newMatch: p.newMatch,
      newMessage: p.newMessage,
      recruiterInterest: p.recruiterInterest,
      applicationStatus: p.applicationStatus,
      jobAlerts: p.jobAlerts,
      productUpdates: p.productUpdates,
      unsubscribedAll: Boolean(p.suppressedAt),
    });
  } catch (e) {
    return authErrorResponse(e) ?? NextResponse.json({ error: "Failed" }, { status: 400 });
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await requireUser();
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    await ensureRow(user.id);

    const { unsubscribeAll, ...toggles } = parsed.data;
    const patch: Record<string, unknown> = { ...toggles, updatedAt: new Date() };

    // A timestamp rather than a boolean: knowing WHEN someone unsubscribed is
    // what answers a complaint about mail sent after they opted out.
    if (unsubscribeAll !== undefined) {
      patch.suppressedAt = unsubscribeAll ? new Date() : null;
    }

    await db.update(notificationPrefs).set(patch).where(eq(notificationPrefs.userId, user.id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    const status = e instanceof AuthError ? 401 : 400;
    return authErrorResponse(e) ?? NextResponse.json({ error: (e as Error).message }, { status });
  }
}
