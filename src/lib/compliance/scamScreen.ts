/**
 * TRUST-003 — advance-fee and payment-request heuristics.
 *
 * Jobsy will never ask a candidate for money, and no legitimate employer will
 * either. The FTC reports $150.4M in consumer losses to job scams, and a
 * platform that monetizes listings it does not screen has FTC Act § 5 exposure
 * independent of any listing's author.
 *
 * Deliberately high-recall and low-precision: a false positive costs a
 * moderator thirty seconds, and a false negative costs a candidate their
 * savings. Hits are held for review, not auto-published and not auto-deleted.
 */
const SCAM_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\b(pay|send|wire|transfer)\s+(us|me|a|an?)?\s*\$?\d+/i, label: "requests payment" },
  { re: /\b(training|starter|registration|application|processing|placement|onboarding)\s+fee\b/i, label: "mentions a fee to the applicant" },
  { re: /\b(gift\s?cards?|itunes\s+card|steam\s+card|google\s+play\s+card)\b/i, label: "mentions gift cards" },
  { re: /\b(bitcoin|btc|ethereum|crypto(currency)?|usdt|wallet\s+address)\b/i, label: "mentions cryptocurrency" },
  { re: /\b(routing|account)\s+number\b|\bbank\s+(details|account)\b/i, label: "requests bank details" },
  { re: /\bsocial\s+security\s+(number|#)\b|\bssn\b/i, label: "requests an SSN" },
  { re: /\b(cashier'?s?\s+check|money\s+order|western\s+union|moneygram|zelle|cash\s?app|venmo)\b/i, label: "mentions an untraceable payment method" },
  { re: /\b(buy|purchase)\s+(the\s+)?(equipment|laptop|software|starter\s+kit)\b/i, label: "asks the candidate to buy equipment" },
  { re: /\bno\s+(experience|interview)\s+(needed|required)\b.{0,60}\$\s?\d{3,}/i, label: "no-experience high-pay claim" },
  { re: /\bearn\s+\$?\d{3,}\s*(\/|per\s+)?(day|week)\b/i, label: "implausible earnings claim" },
  { re: /\bwork\s+from\s+home\b.{0,40}\b(no\s+experience|immediate\s+start)\b.{0,60}\$\s?\d{3,}/i, label: "classic work-from-home scam shape" },
];

export type ScamCheck = { suspicious: boolean; signals: string[] };

export function screenForScam(text: string): ScamCheck {
  const signals: string[] = [];
  for (const p of SCAM_PATTERNS) {
    if (p.re.test(text)) signals.push(p.label);
  }
  return { suspicious: signals.length > 0, signals };
}
