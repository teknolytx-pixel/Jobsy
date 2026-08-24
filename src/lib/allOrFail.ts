/**
 * RUNNING SEVERAL QUERIES AT ONCE WITHOUT KILLING THE PROCESS.
 *
 * ── The bug this exists to prevent ──
 *
 * The Candidates admin screen returned a bare 503 with no body — not the
 * carefully-worded "your database is a version behind, run the migration" that
 * the code was demonstrably capable of producing. Reproduced locally, the
 * handler returned perfect JSON. On the deployment it returned nothing.
 *
 * The difference was `Promise.all`:
 *
 *     const [stats, sources] = await Promise.all([candidateStats(), sourceRollup()]);
 *
 * Both queries hit tables that had not been migrated yet, so BOTH rejected.
 * `Promise.all` adopts the first rejection and silently abandons the second —
 * which becomes an unhandled rejection. A serverless runtime treats that as a
 * crashed invocation and returns its own 503, discarding the response the
 * handler was in the middle of producing.
 *
 * So the failure mode is nastier than it looks: the error handling was correct
 * and never got to run, and the symptom pointed at infrastructure rather than
 * at the two lines responsible.
 *
 * ── The rule ──
 *
 * `Promise.all` is safe when at most one thing can fail. The moment two
 * independent queries run together — and independent queries against the same
 * database fail together constantly, because the reasons are usually shared:
 * a missed migration, a dropped connection, a suspended compute — it is a
 * landmine.
 *
 * `allOrFail` settles everything first, so no rejection is ever abandoned, then
 * throws the first real error for the caller's existing catch to handle. Same
 * shape as Promise.all, none of the risk.
 */

/**
 * Await several promises, then throw the first failure.
 *
 * Every promise is settled before anything is thrown, so a rejection that
 * arrives second is observed rather than orphaned. The thrown error is the
 * first in argument order — not the first to arrive — so the message a caller
 * reports is deterministic rather than a race.
 */
export async function allOrFail<T extends readonly unknown[]>(
  promises: readonly [...{ [K in keyof T]: Promise<T[K]> }]
): Promise<T> {
  const settled = await Promise.allSettled(promises);
  const failure = settled.find((s) => s.status === "rejected");
  if (failure && failure.status === "rejected") throw failure.reason;
  return settled.map((s) => (s as PromiseFulfilledResult<unknown>).value) as unknown as T;
}
