import { NextResponse, type NextRequest } from "next/server";

/**
 * SEC-001 — response security headers.
 *
 * Until this file existed, Jobsy sent no security headers at all: no CSP, no
 * frame-ancestors, no HSTS, no referrer policy. Three of those matter here for
 * concrete, non-theoretical reasons.
 *
 * ── Clickjacking, and why it is worse for this product than for most ──
 *
 * The core interaction is a single tap that means "yes". A swipe deck framed
 * invisibly over an attacker's page turns any click on that page into a LIKE —
 * a recruiter shortlisting candidates they never saw, a candidate applying to
 * jobs they never read. There is no confirmation step to fall back on, because
 * the whole design premise is that there isn't one. `frame-ancestors 'none'`
 * is therefore load-bearing, not hygiene.
 *
 * ── The CSP, and the one compromise in it ──
 *
 * `script-src` carries 'unsafe-inline'. This is not laziness and it is worth
 * stating plainly rather than hiding behind a passing scanner grade: the Next
 * App Router emits inline bootstrap and flight-data scripts on every server
 * render, and a strict nonce-based policy requires threading a per-request
 * nonce through every one of them. That is a real change to how pages render,
 * not a header edit, and doing it badly produces a site that works in
 * development and is blank in production.
 *
 * What is bought in the meantime is still substantial: `object-src 'none'`
 * kills plugin-based execution, `base-uri 'self'` stops a `<base>` injection
 * from re-pointing every relative script URL, `form-action 'self'` stops an
 * injected form from posting a session-authenticated request off-site, and
 * `frame-ancestors 'none'` is unaffected by the script-src compromise. The
 * application's actual injection surface is separately controlled: React
 * escapes by default, the one `dangerouslySetInnerHTML` goes through
 * `safeJsonLd`, and the Indeed feed goes through `escapeXml`.
 *
 * ── HSTS ──
 *
 * Sent only over HTTPS, per RFC 6797 §7.2 — a browser must ignore it on a
 * plaintext connection, and sending it there trains nothing. No `preload`
 * directive: preloading is effectively irreversible and should be a deliberate
 * decision made once the domain is settled, not a default inherited from a
 * config file.
 */

const CSP = [
  "default-src 'self'",
  // See the note above on 'unsafe-inline'.
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  // media.licdn.com is the LinkedIn OIDC profile picture host already
  // allowlisted in next.config.ts; data: covers inlined SVG icons.
  "img-src 'self' data: blob: https://media.licdn.com",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

const HEADERS: Record<string, string> = {
  "Content-Security-Policy": CSP,
  // Redundant with frame-ancestors for modern browsers, kept for old ones.
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  // Send the origin cross-site, the full URL same-site. A job page URL carries
  // an id; a password-reset URL carries a token, and that must never reach a
  // third-party analytics or image host in a Referer header.
  "Referrer-Policy": "strict-origin-when-cross-origin",
  // Nothing here needs any of these. Denying them means a compromised script
  // cannot quietly reach for them either.
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), interest-cohort=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "X-DNS-Prefetch-Control": "off",
};

export function middleware(req: NextRequest) {
  const res = NextResponse.next();

  for (const [k, v] of Object.entries(HEADERS)) res.headers.set(k, v);

  // RFC 6797 §7.2 — only meaningful, and only permitted, over TLS.
  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
  if (proto === "https") {
    res.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  /**
   * Signed-in HTML must not sit in a shared cache. The API routes set their own
   * `Cache-Control` and are left alone; this is about the pages a proxy might
   * otherwise hold and hand to the next person on the same corporate egress.
   */
  if (req.cookies.has("jobsy_session") && !req.nextUrl.pathname.startsWith("/api/")) {
    res.headers.set("Cache-Control", "private, no-store");
  }

  return res;
}

export const config = {
  /**
   * Everything except Next's own static output and the favicon. Static assets
   * are public, immutable and cached hard; adding a per-request header to them
   * costs cache efficiency and buys nothing.
   */
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"],
};
