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
 * ── Why this reads `cause` and not just `message` ──
 *
 * The first version of this file matched on the error text and produced the
 * generic 500 anyway, because Drizzle does not put the database's complaint in
 * the message. It throws its own error reading
 *
 *   Failed query: select "id", "kind", … params: JSONLD_CRAWL,…
 *
 * and hangs the actual Postgres error — the one that says
 * `invalid input value for enum source_kind`, and carries the SQLSTATE code —
 * on `.cause`. Matching the outer message therefore matched the one string
 * guaranteed to contain no diagnosis at all.
 *
 * So walk the chain, and prefer the SQLSTATE code over the text: the codes are
 * defined by Postgres and stable across versions and locales, while the message
 * is prose that can be translated.
 */
const SCHEMA_BEHIND_CODES = new Set([
  "22P02", // invalid_text_representation — an enum value the type does not have
  "42704", // undefined_object — the type itself is missing
  "42703", // undefined_column
  "42P01", // undefined_table
]);

const SCHEMA_BEHIND_TEXT =
  /invalid input value for enum|column .* does not exist|relation .* does not exist|type .* does not exist/i;

export type SafeError = {
  error: string;
  hint?: string;
  status: number;
  /**
   * A SQLSTATE code, when there was one.
   *
   * Shown to the caller because five characters of standardised code is not a
   * schema leak, and without it a 500 on somebody else's deployment is
   * undiagnosable from the screen. It is the difference between "something went
   * wrong" and a fault anyone can look up.
   */
  reference?: string;
};

type ErrorLike = { message?: unknown; code?: unknown; cause?: unknown };

/** Every error in the `cause` chain, outermost first. Depth-capped against cycles. */
function chain(e: unknown, depth = 0): ErrorLike[] {
  if (!e || typeof e !== "object" || depth > 5) return [];
  const self = e as ErrorLike;
  return [self, ...chain(self.cause, depth + 1)];
}

/** Classify an unexpected error without repeating its text. */
export function describeError(e: unknown, action: string): SafeError {
  const links = chain(e);
  const text = links
    .map((l) => (typeof l.message === "string" ? l.message : ""))
    .join("\n")
    .concat(e instanceof Error ? "" : `\n${String(e)}`);
  const code = links.map((l) => l.code).find((c) => typeof c === "string") as string | undefined;

  if ((code && SCHEMA_BEHIND_CODES.has(code)) || SCHEMA_BEHIND_TEXT.test(text)) {
    return {
      status: 503,
      error:
        "Jobsy's database is a version behind the app, so it doesn't recognise something this release added.",
      hint: "An administrator needs to run the pending database migration (npx drizzle-kit migrate), then this will work.",
      reference: code,
    };
  }

  return {
    status: 500,
    error: `Something went wrong while ${action}. The details are in the server log.`,
    reference: code,
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
  /**
   * The full error, once, where an operator can find it — INCLUDING the cause
   * chain, which is where the diagnosis lives and which console.error prints
   * only shallowly for a wrapped error.
   */
  console.error(`[api] ${action}:`, e);
  for (let c = (e as { cause?: unknown })?.cause, i = 0; c && i < 5; c = (c as { cause?: unknown })?.cause, i++) {
    console.error(`[api] ${action}: caused by`, c);
  }

  const suggestions = safe.hint ? [safe.hint] : [];
  return NextResponse.json(
    {
      error: safe.reference ? `${safe.error} (reference ${safe.reference})` : safe.error,
      ...(suggestions.length ? { suggestions } : {}),
    },
    { status: safe.status }
  );
}
