import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { candidateSources, db } from "@/db";
import { authErrorResponse, requirePlatformAdmin } from "@/lib/auth";
import { errorResponse } from "@/lib/apiError";
import {
  CANDIDATE_KIND_LABEL,
  LIVE_CANDIDATE_KINDS,
  requirementFor,
} from "@/lib/candidates/providers";
import { candidateStats, importFromSource, sourceRollup } from "@/lib/candidates/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * CANDIDATE SOURCING — administrator only, and only ever administrator.
 *
 * This endpoint reads other people's names, phone numbers and CVs. That is a
 * different order of thing from the job endpoints beside it, and it gets the
 * strictest check available rather than a recruiter-level one.
 *
 * What it deliberately does NOT return is the candidates themselves. A screen
 * that answers "how many people do we hold and have we told them" needs counts,
 * not a browsable list of personal data — and every extra place PII is
 * serialised is another place it can leak. Reading an individual is a separate,
 * narrower route, gated on the state machine.
 */
export async function GET() {
  try {
    await requirePlatformAdmin();
    const [stats, sources] = await Promise.all([candidateStats(), sourceRollup()]);

    return NextResponse.json({
      stats,
      /**
       * The obligation, stated as a number rather than left to be inferred.
       *
       * A large `imported` with a zero `notified` is not a successful import.
       * It is a pile of people who have not been told they are in a hiring
       * system, which is the exact condition GDPR Article 14 and NYC LL144 both
       * address. The screen should be uncomfortable when this is high.
       */
      owed: stats.imported,
      sources: sources.map((s) => ({
        id: s.id,
        kind: s.kind,
        kindLabel: CANDIDATE_KIND_LABEL[s.kind],
        label: s.label,
        token: s.token,
        // Never the secret. Only whether one is present.
        hasCredential: Boolean(s.secret),
        lawfulBasis: s.lawfulBasis,
        enabled: s.enabled,
        status: s.status,
        held: s.held,
        lastCount: s.lastCount,
        totalImported: s.totalImported,
        lastRunAt: s.lastRunAt?.toISOString() ?? null,
        lastError: s.lastError,
        resumable: s.syncCursor > 0,
      })),
      available: Object.entries(CANDIDATE_KIND_LABEL)
        .filter(([k]) => k !== "MANUAL")
        .map(([kind, label]) => ({
          kind,
          label,
          live: LIVE_CANDIDATE_KINDS.includes(kind as never),
          // For the ones that are not live, say precisely what is missing.
          needs: requirementFor(kind as never),
        })),
    });
  } catch (e) {
    return authErrorResponse(e) ?? errorResponse(e, "loading candidate sources");
  }
}

const Connect = z.object({
  kind: z.enum([
    "GREENHOUSE",
    "LEVER",
    "ASHBY",
    "WORKABLE",
    "DICE",
    "MONSTER",
    "ZIPRECRUITER",
    "INDEED_RESUME",
    "NAUKRI",
  ]),
  companyId: z.string().min(1),
  label: z.string().min(1).max(120),
  /** Account subdomain or board slug. Not secret. */
  token: z.string().max(191).default(""),
  /** The API credential. Write-only: it is never returned by GET. */
  secret: z.string().min(8),
  lawfulBasis: z.enum(["APPLICATION", "LICENSED", "LEGITIMATE_INTEREST", "CONSENT"]),
});

export async function POST(req: Request) {
  try {
    const admin = await requirePlatformAdmin();
    const parsed = Connect.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 }
      );
    }
    const b = parsed.data;

    const [row] = await db
      .insert(candidateSources)
      .values({
        kind: b.kind,
        companyId: b.companyId,
        label: b.label,
        token: b.token,
        secret: b.secret,
        lawfulBasis: b.lawfulBasis,
        addedById: admin.id,
      })
      .onConflictDoUpdate({
        target: [candidateSources.companyId, candidateSources.kind, candidateSources.token],
        set: { secret: b.secret, label: b.label, lawfulBasis: b.lawfulBasis, enabled: true },
      })
      .returning();

    // Pull immediately, so the person who connected it sees whether the
    // credential works instead of waiting for a schedule to tell them later.
    const result = await importFromSource(row, { deadline: Date.now() + 60_000 });
    return NextResponse.json({ ok: !result.error, sourceId: row.id, result });
  } catch (e) {
    return authErrorResponse(e) ?? errorResponse(e, "connecting that candidate source");
  }
}

const Sync = z.object({ sourceId: z.string().min(1) });

/** The manual sync the admin panel offers. */
export async function PATCH(req: Request) {
  try {
    await requirePlatformAdmin();
    const parsed = Sync.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "sourceId is required" }, { status: 400 });
    }
    const [src] = await db
      .select()
      .from(candidateSources)
      .where(eq(candidateSources.id, parsed.data.sourceId))
      .limit(1);
    if (!src) return NextResponse.json({ error: "Source not found" }, { status: 404 });

    const result = await importFromSource(src, { deadline: Date.now() + 90_000 });
    return NextResponse.json({ ok: !result.error, result });
  } catch (e) {
    return authErrorResponse(e) ?? errorResponse(e, "syncing that candidate source");
  }
}
