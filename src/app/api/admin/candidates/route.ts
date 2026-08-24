import { allOrFail } from "@/lib/allOrFail";
import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { candidateSources, companies, db } from "@/db";
import { authErrorResponse, requirePlatformAdmin } from "@/lib/auth";
import { errorResponse } from "@/lib/apiError";
import {
  CANDIDATE_KIND_LABEL,
  LIVE_CANDIDATE_KINDS,
  requirementFor,
} from "@/lib/candidates/providers";
import { candidateStats, importFromSource, sourceRollup } from "@/lib/candidates/sync";

export const dynamic = "force-dynamic";

/**
 * Where an employer generates the key, said precisely.
 *
 * "Get an API key" is not instructions. Every one of these lives somewhere
 * specific and slightly buried, and an administrator asking their client for a
 * credential needs to be able to say exactly where to click.
 */
const CREDENTIAL_LOCATION: Record<string, string> = {
  GREENHOUSE:
    "In Greenhouse: Configure → Dev Center → API Credential Management → Create New API Key, " +
    "type Harvest. Grant it the Candidates: GET permissions only.",
  LEVER:
    "In Lever: Settings → Integrations and API → API Credentials → Generate New Key. " +
    "Read-only on opportunities is enough.",
  ASHBY: "In Ashby: Admin → API Keys → Create API Key, with candidate read access.",
  WORKABLE:
    "In Workable: Settings → Integrations → Access tokens → Generate. " +
    "You also need the account subdomain from your Workable URL.",
};

/** Kinds that need an account identifier as well as a secret. */
const TOKEN_LABEL: Record<string, string> = {
  WORKABLE: "Workable subdomain (the part before .workable.com)",
};
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
    const [stats, sources, orgs] = await allOrFail([
      candidateStats(),
      sourceRollup(),
      /*
       * The form needs somewhere to attach a source, and a candidate source is
       * always ONE employer's credential — never the platform's. Offering the
       * list here rather than a free-text company id is what stops an
       * administrator quietly filing another company's applicants under the
       * wrong employer, which would be a data-protection incident rather than a
       * typo.
       */
      db.select({ id: companies.id, name: companies.name }).from(companies).orderBy(companies.name).limit(500),
    ]);

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
      companies: orgs,
      available: Object.entries(CANDIDATE_KIND_LABEL)
        .filter(([k]) => k !== "MANUAL")
        .map(([kind, label]) => ({
          kind,
          label,
          live: LIVE_CANDIDATE_KINDS.includes(kind as never),
          // For the ones that are not live, say precisely what is missing.
          needs: requirementFor(kind as never),
          // Where the employer generates the credential, for the ones that work.
          where: CREDENTIAL_LOCATION[kind] ?? null,
          // Whether an account identifier is needed alongside the secret.
          tokenLabel: TOKEN_LABEL[kind] ?? null,
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
