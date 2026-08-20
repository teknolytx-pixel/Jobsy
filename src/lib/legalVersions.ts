/**
 * LEGAL-009 / XPLAIN-002 — document versions.
 *
 * Bump these when a document changes materially. `termsAcceptances` records the
 * version accepted, so a later dispute can establish exactly which text a given
 * user agreed to on a given date — which is the whole point of the record.
 *
 * A bump also triggers re-acceptance at next sign-in (LEGAL-009 AC-7). A
 * material change that silently applies to existing users is not agreed to by
 * anyone.
 */
export const CURRENT_TERMS = "1.0";
export const CURRENT_PRIVACY = "1.0";
export const CURRENT_AEDT_NOTICE = "1.0";

/** Versions before which acceptance is stale and must be re-obtained. */
export const MIN_ACCEPTABLE_TERMS = "1.0";
export const MIN_ACCEPTABLE_PRIVACY = "1.0";

/** Simple dotted-version comparison — "1.10" sorts above "1.9". */
export function versionAtLeast(have: string, want: string): boolean {
  const h = have.split(".").map(Number);
  const w = want.split(".").map(Number);
  for (let i = 0; i < Math.max(h.length, w.length); i++) {
    const a = h[i] ?? 0;
    const b = w[i] ?? 0;
    if (a !== b) return a > b;
  }
  return true;
}
