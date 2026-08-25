import { NextResponse } from "next/server";
import { authErrorResponse, requirePlatformAdmin } from "@/lib/auth";
import { errorResponse } from "@/lib/apiError";
import { syncAllSources } from "@/lib/sources";
import { syncFollowedEmployers } from "@/lib/followedEmployers";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * SYNC EVERYTHING, NOW.
 *
 * The same work the nightly cron does, on demand, because "wait until tomorrow
 * to find out whether that connection works" is a miserable way to run a job
 * board.
 *
 * ── The budget, and why it is stated rather than hoped for ──
 *
 * Vercel clamps a function to its plan ceiling — 60 seconds on Hobby — whatever
 * this file declares. So the work stops itself at 50s and reports what it did
 * NOT get to, rather than being killed at 60 and reporting nothing. A partial
 * sync that names the sources it deferred is useful; a dead request is not.
 *
 * Sources are ordered least-recently-synced first, so pressing this repeatedly
 * works through the whole list instead of re-syncing the same few.
 */
const BUDGET_MS = 50_000;

export async function POST() {
  try {
    await requirePlatformAdmin();
    const started = Date.now();
    const deadline = started + BUDGET_MS;

    // Connected sources first: they are the ones an administrator just changed
    // and is most likely waiting on. Followed employers get what remains.
    const sources = await syncAllSources({ deadline: started + Math.round(BUDGET_MS * 0.75) });
    const followed = await syncFollowedEmployers({ deadline });

    const created =
      sources.results.reduce((a, r) => a + r.created, 0) +
      followed.reduce((a, f) => a + f.created, 0);
    const updated =
      sources.results.reduce((a, r) => a + r.updated, 0) +
      followed.reduce((a, f) => a + f.updated, 0);

    const failed = sources.results.filter((r) => r.error);

    return NextResponse.json({
      ok: true,
      created,
      updated,
      syncedSources: sources.results.length,
      syncedEmployers: followed.length,
      /*
       * Deferred is not an error and is not a success either. Naming the
       * sources the clock ran out on is what tells an administrator to press
       * the button again rather than assume everything ran.
       */
      deferred: sources.skipped.map((s) => s.companyName),
      failures: failed.map((r) => ({ company: r.company, error: r.error })),
      seconds: Math.round((Date.now() - started) / 1000),
    });
  } catch (e) {
    return authErrorResponse(e) ?? errorResponse(e, "syncing everything");
  }
}
