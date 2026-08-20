/**
 * TRUST-007 — safe serialisation of JSON embedded in HTML.
 *
 * `JSON.stringify` escapes quotes and backslashes. It does NOT escape `<`, `>`
 * or `&`, which is fine for an HTTP body and catastrophic inside a
 * `<script>` block: a value containing
 *
 *     </script><script>alert(1)</script>
 *
 * closes the surrounding script element and opens an attacker-controlled one.
 * The browser's HTML parser finds `</script>` before the JavaScript parser ever
 * sees the string, so quoting inside the JSON does not help.
 *
 * This bites Jobsy specifically because the public job page embeds
 * schema.org/JobPosting JSON-LD built from an employer-supplied description —
 * a string we do not control, rendered into a script element, on a page we
 * deliberately make crawlable. It was found by TC-JOB-001-07.
 *
 * Also escapes U+2028 and U+2029, which are valid in JSON strings but are line
 * terminators in older JavaScript parsers and can break a script the same way.
 */
export function safeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * Strip HTML from text destined for a plain-text context.
 *
 * Ingested job descriptions arrive as HTML from ATS feeds. JSON-LD wants either
 * plain text or well-formed HTML, and structured data with a stray `<script>`
 * in it is both a security problem and a rich-results failure.
 */
export function stripHtml(s: string): string {
  return s
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Escape text destined for an XML element or attribute (the Indeed feed). */
export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    // Control characters are illegal in XML 1.0 and make a feed unparseable.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}
