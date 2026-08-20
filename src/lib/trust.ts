import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db, blocks, reports, users, jobs, messages, matches, type ReportKind, type ReportReason } from "@/db";
import { audit } from "./audit";
import { sendEmail, reportAcknowledgedTemplate } from "./email";

/**
 * MSG-004 / TRUST-002 — blocking and reporting.
 *
 * A product that introduces strangers to each other for the purpose of
 * employment, over an email channel, with no block button, is not shippable.
 * This is the module that makes it shippable.
 */

// ─────────────────────────────────────────────────────────────
// BLOCKING
// ─────────────────────────────────────────────────────────────

/**
 * Block a user.
 *
 * AC-3 — the blocked party is never told. They see an ordinary "couldn't send"
 * or simply stop seeing the blocker in their deck. Telling them converts a
 * safety tool into a provocation.
 */
export async function blockUser(blockerId: string, blockedId: string): Promise<void> {
  if (blockerId === blockedId) throw new Error("You can't block yourself");
  await db.insert(blocks).values({ blockerId, blockedId }).onConflictDoNothing();
  await audit({
    action: "trust.user_blocked",
    actorId: blockerId,
    subjectType: "user",
    subjectId: blockedId,
  });
}

export async function unblockUser(blockerId: string, blockedId: string): Promise<void> {
  await db
    .delete(blocks)
    .where(and(eq(blocks.blockerId, blockerId), eq(blocks.blockedId, blockedId)));
  await audit({
    action: "trust.user_unblocked",
    actorId: blockerId,
    subjectType: "user",
    subjectId: blockedId,
  });
}

/**
 * AC-1 — is there a block in EITHER direction?
 *
 * Directional rows, symmetric enforcement. A blocks B means neither can message
 * the other: a one-way block would let the blocked party keep talking, which is
 * the opposite of what the person clicking "block" is asking for.
 */
export async function isBlocked(a: string, b: string): Promise<boolean> {
  const rows = await db
    .select({ id: blocks.id })
    .from(blocks)
    .where(
      or(
        and(eq(blocks.blockerId, a), eq(blocks.blockedId, b)),
        and(eq(blocks.blockerId, b), eq(blocks.blockedId, a))
      )
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * AC-2 — every user id the given user must never see, in either direction.
 *
 * Fetched once per deck build rather than per candidate, so a large block list
 * costs one query rather than N.
 */
export async function blockedIdsFor(userId: string): Promise<string[]> {
  const rows = await db
    .select({ blockerId: blocks.blockerId, blockedId: blocks.blockedId })
    .from(blocks)
    .where(or(eq(blocks.blockerId, userId), eq(blocks.blockedId, userId)));
  const out = new Set<string>();
  for (const r of rows) out.add(r.blockerId === userId ? r.blockedId : r.blockerId);
  return [...out];
}

// ─────────────────────────────────────────────────────────────
// REPORTING
// ─────────────────────────────────────────────────────────────

export type ReportInput = {
  reporterId: string;
  kind: ReportKind;
  targetId: string;
  reason: ReportReason;
  detail?: string | null;
};

/**
 * File a report.
 *
 * AC-3/5 — the snapshot is taken HERE, at report time, not read from the live
 * row when a moderator opens the queue. If the reported party edits or deletes
 * the content afterwards, the evidence survives. That is the entire reason this
 * function reads the target rather than storing a foreign key and hoping.
 */
export async function fileReport(input: ReportInput): Promise<{ id: string; ref: string }> {
  const snapshot = await captureSnapshot(input.kind, input.targetId);

  const [row] = await db
    .insert(reports)
    .values({
      reporterId: input.reporterId,
      kind: input.kind,
      targetId: input.targetId,
      reason: input.reason,
      detail: input.detail?.slice(0, 4000) ?? null,
      snapshot,
    })
    .returning({ id: reports.id, createdAt: reports.createdAt });

  const ref = row!.id.slice(0, 8).toUpperCase();

  await audit({
    action: "trust.report_filed",
    actorId: input.reporterId,
    subjectType: input.kind.toLowerCase(),
    subjectId: input.targetId,
    detail: { reason: input.reason, ref },
  });

  const reporter = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, input.reporterId))
    .limit(1);
  if (reporter[0]) {
    await sendEmail(
      reportAcknowledgedTemplate({ to: reporter[0].email, kind: input.kind, ref })
    );
  }

  return { id: row!.id, ref };
}

/**
 * Freeze the reported content.
 *
 * Deliberately stores only what a moderator needs to decide, and no more —
 * a snapshot table is not a place to accumulate personal data. Never throws:
 * a report about content that has already vanished is still a report worth
 * having, and losing it because the row is gone is the failure mode this whole
 * mechanism exists to prevent.
 */
async function captureSnapshot(kind: ReportKind, targetId: string): Promise<Record<string, unknown>> {
  const at = new Date().toISOString();
  try {
    if (kind === "JOB") {
      const r = await db
        .select({
          title: jobs.title,
          description: jobs.description,
          location: jobs.location,
          source: jobs.source,
          sourceUrl: jobs.sourceUrl,
          applyUrl: jobs.applyUrl,
          postedById: jobs.postedById,
          companyId: jobs.companyId,
          active: jobs.active,
        })
        .from(jobs)
        .where(eq(jobs.id, targetId))
        .limit(1);
      return { at, kind, target: r[0] ?? null };
    }

    if (kind === "USER") {
      const r = await db
        .select({
          name: users.name,
          headline: users.headline,
          bio: users.bio,
          location: users.location,
          role: users.role,
          companyId: users.companyId,
        })
        .from(users)
        .where(eq(users.id, targetId))
        .limit(1);
      return { at, kind, target: r[0] ?? null };
    }

    if (kind === "MESSAGE") {
      const r = await db
        .select({
          body: messages.body,
          senderId: messages.senderId,
          matchId: messages.matchId,
          createdAt: messages.createdAt,
        })
        .from(messages)
        .where(eq(messages.id, targetId))
        .limit(1);
      const msg = r[0];
      let thread: unknown[] = [];
      if (msg) {
        // A single message out of context is usually unreadable to a moderator.
        // Capture the surrounding thread so the decision can be a fair one.
        thread = await db
          .select({ body: messages.body, senderId: messages.senderId, createdAt: messages.createdAt })
          .from(messages)
          .where(eq(messages.matchId, msg.matchId))
          .orderBy(messages.createdAt)
          .limit(50);
      }
      return { at, kind, target: msg ?? null, thread };
    }

    return { at, kind, target: null };
  } catch (e) {
    return { at, kind, target: null, snapshotError: (e as Error).message };
  }
}

export { screenForScam, type ScamCheck } from "./compliance/scamScreen";

/** Convenience for the deck queries — a NOT IN clause, or nothing. */
export function notBlockedClause(column: Parameters<typeof inArray>[0], blocked: string[]) {
  return blocked.length ? sql`${column} NOT IN ${blocked}` : undefined;
}
