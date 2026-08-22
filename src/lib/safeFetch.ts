import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * SEC — server-side fetching of a URL a user supplied.
 *
 * `detectSource()` in discovery.ts has been doing exactly this since it was
 * written, with `redirect: "follow"` and no checks at all. That is a
 * server-side request forgery hole, and on a serverless host it is the
 * expensive kind: a recruiter pasting
 *
 *     http://169.254.169.254/latest/meta-data/iam/security-credentials/
 *
 * as a "careers page URL" makes our server read the cloud instance metadata
 * endpoint and hand the response back in the error message. The same trick
 * reaches anything else the deployment can route to and the internet cannot —
 * an internal admin panel, a database's HTTP interface, a neighbouring service.
 *
 * ── Why hostname checks alone are not enough ──
 *
 * Blocking "localhost" and "10.*" by name stops nothing: `evil.com` can simply
 * resolve to 127.0.0.1. So the check is on the RESOLVED ADDRESSES, not the
 * text of the hostname, and it is repeated on every redirect hop — a permitted
 * public URL that 302s to 169.254.169.254 is the standard bypass, which is why
 * redirects are followed manually here rather than by fetch().
 *
 * DNS rebinding (a name that resolves to a public address when checked and a
 * private one when connected) is not fully solvable without pinning the socket
 * to the validated IP, which fetch() does not expose. The window is narrow and
 * the remaining controls — no credentials, no cookies, a size cap, a timeout,
 * and text returned to one authenticated recruiter rather than the public —
 * keep the residual risk proportionate. Stated rather than hidden.
 */

export type FetchRefusal = {
  ok: false;
  /** Written for the person who pasted the URL, not for a log. */
  reason: string;
  code: "BAD_URL" | "BAD_SCHEME" | "PRIVATE_ADDRESS" | "TOO_MANY_REDIRECTS" | "TOO_LARGE" | "UNREACHABLE" | "HTTP_ERROR";
};

export type FetchSuccess = {
  ok: true;
  /** The address actually landed on, after redirects. */
  finalUrl: string;
  status: number;
  contentType: string;
  body: string;
};

export const MAX_BYTES = 2_000_000;
export const MAX_REDIRECTS = 4;
export const TIMEOUT_MS = 12_000;

/**
 * Is this address one the public internet could not reach?
 *
 * Exported because it is the whole security control, and a control that cannot
 * be tested directly does not get tested.
 */
export function isBlockedAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 0) return true; // not an address at all — refuse rather than guess

  if (v === 4) {
    const p = ip.split(".").map(Number);
    if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
    const [a, b] = p as [number, number, number, number];
    if (a === 0) return true;                          // "this network"
    if (a === 10) return true;                         // RFC1918
    if (a === 127) return true;                        // loopback
    if (a === 169 && b === 254) return true;           // link-local — CLOUD METADATA
    if (a === 172 && b >= 16 && b <= 31) return true;  // RFC1918
    if (a === 192 && b === 168) return true;           // RFC1918
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a === 192 && b === 0) return true;             // IETF protocol assignments
    if (a >= 224) return true;                         // multicast + reserved + broadcast
    return false;
  }

  const s = ip.toLowerCase().split("%")[0];
  if (s === "::" || s === "::1") return true;                 // unspecified, loopback
  if (s.startsWith("fe80") || s.startsWith("fe9") ) return true; // link-local
  if (/^f[cd]/.test(s)) return true;                          // unique local
  if (s.startsWith("ff")) return true;                        // multicast
  // IPv4-mapped (::ffff:127.0.0.1) — judge the embedded v4 address.
  const mapped = s.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedAddress(mapped[1]!);
  return false;
}

/** Hostnames that never belong to the public internet, checked before DNS. */
export function isBlockedHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".home.arpa")) return true;
  // A bare label ("intranet") is a private-network name, not a public site.
  if (!h.includes(".") && isIP(h) === 0) return true;
  return false;
}

/**
 * How a hostname becomes addresses.
 *
 * Injectable so tests can exercise the fetch path without a live DNS lookup —
 * NOT a bypass: a test supplies its own resolver, it cannot switch the check
 * off, and production never passes this argument. An env-var escape hatch was
 * the obvious alternative and the wrong one; a flag that disables an SSRF
 * guard eventually gets set somewhere it shouldn't be.
 */
export type Resolver = (host: string) => Promise<{ address: string }[]>;

export type SafeFetchDeps = { resolve?: Resolver };

async function validate(raw: string, deps?: SafeFetchDeps): Promise<{ url: URL } | FetchRefusal> {
  const trimmed = raw.trim();

  /**
   * Only supply a scheme when there is genuinely none.
   *
   * The first version prepended `https://` to anything not starting with
   * "http", which quietly defeated the scheme check below: `file:///etc/passwd`
   * became `https://file:///etc/passwd`, parsed with hostname "file", and was
   * caught further down by luck rather than by the rule meant to catch it.
   * A control that works by accident is a control that stops working when the
   * accident changes.
   */
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed);

  let url: URL;
  try {
    url = new URL(hasScheme ? trimmed : `https://${trimmed}`);
  } catch {
    return { ok: false, code: "BAD_URL", reason: "That doesn't look like a web address." };
  }

  // file:, ftp:, gopher: and data: are all reachable from fetch in some
  // runtimes and none of them is a careers page.
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, code: "BAD_SCHEME", reason: "Only http:// and https:// addresses can be read." };
  }

  if (isBlockedHostname(url.hostname)) {
    return {
      ok: false,
      code: "PRIVATE_ADDRESS",
      reason: "That address is on a private network, so Jobsy can't read it. Paste a public careers page URL.",
    };
  }

  // The actual control: what does this name resolve to?
  let addrs: { address: string }[];
  try {
    const resolve: Resolver = deps?.resolve ?? ((h) => lookup(h, { all: true }));
    addrs = isIP(url.hostname) ? [{ address: url.hostname }] : await resolve(url.hostname);
  } catch {
    return { ok: false, code: "UNREACHABLE", reason: "That address didn't resolve. Check the spelling." };
  }

  if (!addrs.length || addrs.some((a) => isBlockedAddress(a.address))) {
    // `some`, not `every`: a name resolving to both a public and a private
    // address is a bypass attempt, not a partly-valid host.
    return {
      ok: false,
      code: "PRIVATE_ADDRESS",
      reason: "That address points inside a private network, so Jobsy can't read it.",
    };
  }

  return { url };
}

/**
 * Fetch a public web page, or refuse and say why.
 *
 * Never throws. Every caller is handling a URL a person typed, and an
 * exception is the wrong shape for "that URL is not allowed".
 */
export async function safeFetch(
  raw: string,
  deps?: SafeFetchDeps
): Promise<FetchSuccess | FetchRefusal> {
  let current = raw;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const checked = await validate(current, deps);
    if ("ok" in checked) return checked;

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(checked.url.toString(), {
        // Manual, so every hop goes back through validate(). This is the
        // single most important line in the file.
        redirect: "manual",
        signal: ac.signal,
        cache: "no-store",
        // No cookies, no auth — a forged request must not carry our identity.
        credentials: "omit",
        headers: {
          "User-Agent": "JobsyBot/1.0 (+https://jobsy.app/bot)",
          Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        },
      });
    } catch {
      clearTimeout(timer);
      return { ok: false, code: "UNREACHABLE", reason: "Couldn't reach that page — it may be down or blocking us." };
    }
    clearTimeout(timer);

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return { ok: false, code: "HTTP_ERROR", reason: `That page redirected without saying where.` };
      current = new URL(loc, checked.url).toString();
      continue;
    }

    if (!res.ok) {
      return { ok: false, code: "HTTP_ERROR", reason: `That page returned HTTP ${res.status}.` };
    }

    // Read with a cap rather than trusting content-length, which a hostile
    // server simply lies about.
    const reader = res.body?.getReader();
    if (!reader) return { ok: false, code: "HTTP_ERROR", reason: "That page returned nothing." };
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel();
        return { ok: false, code: "TOO_LARGE", reason: "That page is too big to read." };
      }
      chunks.push(value);
    }

    const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    return {
      ok: true,
      finalUrl: checked.url.toString(),
      status: res.status,
      contentType: res.headers.get("content-type") ?? "",
      body: buf.toString("utf8"),
    };
  }

  return { ok: false, code: "TOO_MANY_REDIRECTS", reason: "That address redirected too many times." };
}
