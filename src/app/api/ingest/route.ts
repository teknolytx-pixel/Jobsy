import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { deactivateStale, ingestAll } from "@/lib/ingest";
import { activeProviders, ALL_PROVIDERS } from "@/lib/providers";
import { listSources, syncAllSources } from "@/lib/sources";
import { syncFollowedEmployers } from "@/lib/followedEmployers";
import { runMaintenance } from "@/lib/maintenance";
import { secretEquals } from "@/lib/tokens";

export const dynamic = "force-dynamic";
/**
 * SRC-015 — 60, not 300.
 *
 * Vercel clamps this to the plan ceiling regardless of what is written here,
 * and Hobby's ceiling is 60 seconds. Claiming 300 did not buy any time; it just
 * meant the code believed it had five minutes, overran, and was killed with an
 * empty response body. Stating the real number keeps the budget below honest.
 */
export const maxDuration = 60;

/**
 * Wall-clock budget for the work, leaving headroom to serialise a response.
 * A run that gets killed reports nothing at all, which is strictly worse than
 * a run that stops early and says which boards it deferred.
 */
const BUDGET_MS = 45_000;

const authorized = (req: Request) => {
  const secret = env.cronSecret;
  if (!secret) {
    // Unset in dev so the app is runnable with no configuration. In production
    // an unset CRON_SECRET means an open endpoint that can be hammered, so
    // refuse rather than silently allow.
    if (process.env.NODE_ENV === "production") {
      console.error("[ingest] CRON_SECRET is not set in production — refusing.");
      return false;
    }
    return true;
  }
  const header = req.headers.get("authorization") ?? "";
  // ING-006 AC-5 — constant-time, so a wrong secret does not leak its correct
  // prefix through response timing.
  return secretEquals(header, `Bearer ${secret}`);
};

/**
 * Vercel Cron issues GET with `Authorization: Bearer $CRON_SECRET`, so an
 * authorized GET runs ingestion. An unauthorized GET just reports which
 * providers are wired up — useful as a health check.
 */
export async function GET(req: Request) {
  if (authorized(req) && req.headers.get("authorization")) return runIngest();

  const sources = await listSources().catch(() => []);
  // boards() is async for the demand-driven aggregators (SRC-014). Awaiting it
  // is not optional: a Promise reaches NextResponse.json as `{}` at best and
  // takes the whole health check down with a 500 at worst, which is exactly
  // what it did the first time this shipped.
  const providers = await Promise.all(
    ALL_PROVIDERS.map(async (p) => ({
      source: p.source,
      label: p.label,
      configured: p.isConfigured(),
      boards: p.isConfigured() ? await p.boards() : [],
    }))
  );
  return NextResponse.json({
    // broad, query-based discovery
    providers,
    // targeted: every job these named employers post
    connectedCompanies: sources.map((s) => ({
      id: s.id,
      company: s.companyName,
      kind: s.kind,
      token: s.token,
      enabled: s.enabled,
      status: s.status,
      lastRunAt: s.lastRunAt?.toISOString() ?? null,
      lastJobCount: s.lastJobCount,
      totalImported: s.totalImported,
      lastError: s.lastError,
    })),
  });
}

/** Manual trigger. */
export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return runIngest();
}

async function runIngest() {
  const started = Date.now();
  const deadline = started + BUDGET_MS;

  // 1. targeted — every job each connected employer currently has posted.
  //
  //    Capped at a share of the budget, not the whole of it. This phase runs
  //    first, so left uncapped a long enough company list starves discovery
  //    completely and nothing else in this function ever executes.
  const {
    results: companies,
    skipped: skippedSources,
    truncated: sourcesTruncated,
  } = await syncAllSources({ deadline: started + Math.round(BUDGET_MS * 0.55) });
  // 2. broad — query-based discovery across the aggregators, bounded by the
  //    clock and rotating least-recently-run boards first.
  /*
   * Followed employers run alongside connected sources. They exist for the
   * careers sites nothing can read, so leaving them out of the schedule would
   * make the escape hatch a one-off import rather than a subscription.
   */
  const followed = await syncFollowedEmployers({ deadline: started + Math.round(BUDGET_MS * 0.7) });

  const { runs, skipped, truncated } = await ingestAll({ deadline });
  const deactivated = await deactivateStale();
  // 3. housekeeping — ghost-job expiry, data purge, rate-limit sweep.
  //
  //    Runs last and independently: a failure here must not lose the ingest
  //    result. It is also SKIPPED rather than started when the budget is spent,
  //    because a maintenance pass killed halfway through is how a purge deletes
  //    rows and never records that it did.
  const maintenance =
    Date.now() < deadline
      ? await runMaintenance().catch((e) => ({
          errors: [`maintenance failed entirely: ${(e as Error).message}`],
        }))
      : { errors: ["skipped: ingest used the whole time budget"] };

  const sum = (rows: { fetched: number; created: number; updated: number }[]) =>
    rows.reduce(
      (a, r) => ({
        fetched: a.fetched + r.fetched,
        created: a.created + r.created,
        updated: a.updated + r.updated,
      }),
      { fetched: 0, created: 0, updated: 0 }
    );

  return NextResponse.json({
    followedEmployers: {
      count: followed.length,
      created: followed.reduce((a, f) => a + f.created, 0),
      matched: followed.reduce((a, f) => a + f.matched, 0),
      // Named individually, because a zero against one employer means
      // something different from a zero across all of them.
      results: followed.map((f) => ({
        name: f.name, matched: f.matched, created: f.created,
        providers: f.providers, error: f.error ?? null,
      })),
    },
    ok: true,
    ms: Date.now() - started,
    connectedCompanies: {
      count: companies.length,
      failing: companies.filter((c) => c.error).length,
      results: companies,
      totals: sum(companies),
      truncated: sourcesTruncated,
      skipped: skippedSources,
    },
    discovery: {
      providers: activeProviders().map((p) => p.source),
      runs,
      totals: sum(runs),
      // Visible, not silent: these boards ran out of clock and go first next time.
      truncated,
      skipped,
    },
    deactivated,
    maintenance,
  });
}
