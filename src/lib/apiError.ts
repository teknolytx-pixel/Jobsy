import { NextResponse } from "next/server";

/**
 * WHAT AN UNEXPECTED FAILURE SHOULD LOOK LIKE TO THE PERSON USING JOBSY.
 *
 * ── The failure that prompted this ──
 *
 * An administrator pasted a careers URL, detection worked perfectly, and the
 * screen showed them this:
 *
 *   Failed query: select "id", "kind", "token", "company_name", "careers_url",
 *   "auto_detected", "detected_via", "enabled", "status", "last_error", …
 *   from "job_sources" where ("job_sources"."kind" = $1 and …) params:
 *   JSONLD_CRAWL,https://jobs.citi.com/search-jobs,1
 *
 * Three things wrong with that, in increasing order of seriousness.
 *
 * It is unreadable. The person is a recruiter looking at a careers page, not a
 * developer reading a query plan, and nothing in those forty words tells them
 * what to do next.
 *
 * It is misleading. The detection SUCCEEDED — that is a job source it worked
 * out how to pull — and the message reads like the site was rejected.
 *
 * It leaks. Column names, table names and bound parameters are the shape of the
 * schema, handed to whoever asked. Not a catastrophe on its own, and not
 * something to hand out either.
 *
 * ── What replaced it ──
 *
 * The real error goes to the server log where it belongs, and the caller gets a
 * sentence describing what happened. One case is worth recognising by name: a
 * database that is a version behind the code. It has a specific fix and a
 * specific person who can apply it, and "run the pending migration" is
 * infinitely more use than "Failed query".
 */

/**
 * Postgres, through Drizzle, for the specific case where the deployed code
 * knows about an enum value, column or table the database has not been
 * migrated to yet.
 *
 * Matched on the database's own error text rather than a code, because the
 * error arrives wrapped by the driver and the original code is not reliably on
 * the object we are handed.
 */
const SCHEMA_BEHIND =
  /invalid input value for enum|column .* does not exist|relation .* does not exist|type .* does not exist/i;

export type SafeError = { error: string; hint?: string; status: number };

/** Classify an unexpected error without leaking its text. */
export function describeError(e: unknown, action: string): SafeError {
  const raw = e instanceof Error ? e.message : String(e);

  if (SCHEMA_BEHIND.test(raw)) {
    return {
      status: 503,
      error:
        "Jobsy's database is a version behind the app, so it doesn't recognise something this release added.",
      hint: "An administrator needs to run the pending database migration (npx drizzle-kit migrate), then this will work.",
    };
  }

  return {
    status: 500,
    error: `Something went wrong while ${action}. The details are in the server log.`,
  };
}

/**
 * The response to return from a catch block, after auth errors have been ruled
 * out.
 *
 * `action` completes the sentence "while ___" — "connecting that careers page",
 * "loading job sources". Written for the person reading it.
 */
export function errorResponse(e: unknown, action: string): NextResponse {
  const safe = describeError(e, action);
  // The full error, once, where an operator can find it.
  console.error(`[api] ${action}:`, e);
  return NextResponse.json(
    safe.hint ? { error: safe.error, suggestions: [safe.hint] } : { error: safe.error },
    { status: safe.status }
  );
}
