/**
 * THE PRODUCTION GUARD FOR DB-BACKED TEST SUITES.
 *
 * ── Why this exists ──
 *
 * `scripts/seed.ts` has refused to run against a hosted database since ADMIN-007,
 * because seeding a live deployment creates demo accounts with a known password.
 * The test suites had no such guard, and they are considerably more destructive
 * than seeding: each one INSERTS four hundred and fifty fixture users or jobs and
 * then DELETES every row whose email or slug carries its tag.
 *
 * That is fine against a local Postgres and unacceptable against a live database
 * — and nothing stopped it. A `.env` copied from a deployment, or a
 * `vercel env pull`, is enough: `npm test` would then quietly write hundreds of
 * "Noise 214" candidates into the real users table, and the cleanup would delete
 * by prefix on the way out. Any real account that happened to match a tag prefix
 * would go with it.
 *
 * The failure mode is the dangerous kind: it succeeds. Nothing errors, the suite
 * reports all green, and the damage is only visible later in the product.
 *
 * ── The escape hatch is deliberately awkward ──
 *
 * Same shape as the seed guard, and a different variable name so that allowing
 * one does not silently allow the other. Someone who genuinely wants to run
 * fixtures against a hosted database has to say so in a sentence they cannot
 * type by accident.
 */
export function assertNotProduction(suite: string): void {
  const url = process.env.DATABASE_URL ?? "";
  const looksProd =
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL_ENV === "production" ||
    /neon\.tech|amazonaws|render\.com|supabase|\.rds\.|planetscale|railway\.app/i.test(url);

  if (!looksProd) return;
  if (process.env.ALLOW_PROD_TESTS === "yes-i-am-sure") {
    console.warn(
      `\n  ⚠ ${suite} is running against what looks like a PRODUCTION database.\n` +
        `    You set ALLOW_PROD_TESTS. It will insert hundreds of fixture rows and\n` +
        `    delete by tag prefix on the way out.\n`
    );
    return;
  }

  // Host only — never the credentials, which are in the same string.
  let host = "the configured database";
  try {
    host = new URL(url).host;
  } catch {
    /* an unparseable URL tells us nothing useful; the refusal stands either way */
  }

  console.error(
    `\n  REFUSING TO RUN ${suite}\n\n` +
      `  DATABASE_URL points at ${host}, which looks like a hosted database.\n\n` +
      `  This suite inserts 450+ fixture users or jobs and then deletes rows by\n` +
      `  tag prefix. Against a live deployment that is real damage to real data.\n\n` +
      `  Point DATABASE_URL at a local Postgres, or — only if you truly mean it:\n` +
      `      ALLOW_PROD_TESTS=yes-i-am-sure\n`
  );
  process.exit(1);
}
