import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { deactivateStale, ingestAll } from "@/lib/ingest";
import { activeProviders, ALL_PROVIDERS } from "@/lib/providers";
import { listSources, syncAllSources } from "@/lib/sources";
import { runMaintenance } from "@/lib/maintenance";
import { secretEquals } from "@/lib/tokens";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

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
  return NextResponse.json({
    // broad, query-based discovery
    providers: ALL_PROVIDERS.map((p) => ({
      source: p.source,
      label: p.label,
      configured: p.isConfigured(),
      boards: p.isConfigured() ? p.boards() : [],
    })),
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

  // 1. targeted — every job each connected employer currently has posted
  const companies = await syncAllSources();
  // 2. broad — query-based discovery across the aggregators
  const runs = await ingestAll();
  const deactivated = await deactivateStale();
  // 3. housekeeping — ghost-job expiry, data purge, rate-limit sweep. Runs
  //    last and independently: a failure here must not lose the ingest result.
  const maintenance = await runMaintenance().catch((e) => ({
    errors: [`maintenance failed entirely: ${(e as Error).message}`],
  }));

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
    ok: true,
    ms: Date.now() - started,
    connectedCompanies: {
      count: companies.length,
      failing: companies.filter((c) => c.error).length,
      results: companies,
      totals: sum(companies),
    },
    discovery: {
      providers: activeProviders().map((p) => p.source),
      runs,
      totals: sum(runs),
    },
    deactivated,
    maintenance,
  });
}
