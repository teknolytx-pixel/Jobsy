#!/usr/bin/env tsx
/**
 * SEC — the SSRF guard.
 *
 * `detectSource()` has fetched user-supplied URLs server-side, following
 * redirects, with no checks, since it was written. These tests exist because
 * that control is invisible when it works: nothing fails, nothing looks wrong,
 * and the only evidence it is missing is someone reading cloud metadata
 * through a "careers page URL" field.
 */
const { isBlockedAddress, isBlockedHostname, safeFetch, MAX_REDIRECTS } = await import(
  "../src/lib/safeFetch"
);

let pass = 0,
  fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

console.log("\nBLOCKED ADDRESSES\n");

// The one that matters most on a cloud host.
check("TC-SSRF-01 AWS/GCP metadata is blocked", isBlockedAddress("169.254.169.254"));
check("TC-SSRF-02 the whole link-local range is blocked", isBlockedAddress("169.254.0.1"));
check("TC-SSRF-03 loopback is blocked", isBlockedAddress("127.0.0.1"));
check("TC-SSRF-04 the whole loopback /8 is blocked", isBlockedAddress("127.1.2.3"));
check("TC-SSRF-05 RFC1918 10/8", isBlockedAddress("10.0.0.1"));
check("TC-SSRF-06 RFC1918 172.16/12", isBlockedAddress("172.16.0.1") && isBlockedAddress("172.31.255.254"));
check("TC-SSRF-07 172.32 is NOT private", isBlockedAddress("172.32.0.1") === false);
check("TC-SSRF-08 RFC1918 192.168/16", isBlockedAddress("192.168.1.1"));
check("TC-SSRF-09 CGNAT 100.64/10", isBlockedAddress("100.64.0.1"));
check("TC-SSRF-10 0.0.0.0", isBlockedAddress("0.0.0.0"));
check("TC-SSRF-11 multicast and broadcast", isBlockedAddress("224.0.0.1") && isBlockedAddress("255.255.255.255"));

check("TC-SSRF-20 IPv6 loopback", isBlockedAddress("::1"));
check("TC-SSRF-21 IPv6 link-local", isBlockedAddress("fe80::1"));
check("TC-SSRF-22 IPv6 unique-local", isBlockedAddress("fd00::1") && isBlockedAddress("fc00::1"));
// The classic bypass: an IPv4 private address wearing an IPv6 costume.
check("TC-SSRF-23 IPv4-mapped loopback", isBlockedAddress("::ffff:127.0.0.1"));
check("TC-SSRF-24 IPv4-mapped metadata", isBlockedAddress("::ffff:169.254.169.254"));

check("TC-SSRF-30 a real public address is allowed", isBlockedAddress("93.184.216.34") === false);
check("TC-SSRF-31 public IPv6 is allowed", isBlockedAddress("2606:2800:220:1:248:1893:25c8:1946") === false);
check("TC-SSRF-32 garbage is refused rather than guessed", isBlockedAddress("not-an-ip"));

console.log("\nBLOCKED HOSTNAMES\n");

check("TC-SSRF-40 localhost", isBlockedHostname("localhost"));
check("TC-SSRF-41 subdomains of localhost", isBlockedHostname("api.localhost"));
check("TC-SSRF-42 mDNS .local", isBlockedHostname("printer.local"));
check("TC-SSRF-43 .internal", isBlockedHostname("db.internal"));
check("TC-SSRF-44 a bare label is a private name", isBlockedHostname("intranet"));
check("TC-SSRF-45 a real domain is allowed", isBlockedHostname("boards.greenhouse.io") === false);
check("TC-SSRF-46 a trailing dot does not evade the check", isBlockedHostname("localhost."));

console.log("\nEND TO END\n");

const cases: [string, string, string][] = [
  ["TC-SSRF-50 metadata by IP", "http://169.254.169.254/latest/meta-data/", "PRIVATE_ADDRESS"],
  ["TC-SSRF-51 loopback by name", "http://localhost:3000/api/admin/reports", "PRIVATE_ADDRESS"],
  ["TC-SSRF-52 loopback by IP", "http://127.0.0.1:5432/", "PRIVATE_ADDRESS"],
  ["TC-SSRF-53 private range", "http://10.0.0.5/admin", "PRIVATE_ADDRESS"],
  ["TC-SSRF-54 file scheme", "file:///etc/passwd", "BAD_SCHEME"],
  ["TC-SSRF-56 gopher scheme", "gopher://127.0.0.1:70/", "BAD_SCHEME"],
  ["TC-SSRF-57 data scheme", "data:text/html,<script>1</script>", "BAD_SCHEME"],
  ["TC-SSRF-55 nonsense", "not a url at all", "BAD_URL"],
];

for (const [label, url, expected] of cases) {
  const r = await safeFetch(url);
  check(label, r.ok === false && r.code === expected, r.ok ? "ALLOWED — hole" : r.code);
}

check("TC-SSRF-60 the redirect budget is finite", MAX_REDIRECTS > 0 && MAX_REDIRECTS <= 10, String(MAX_REDIRECTS));

console.log(`\n${pass} passed, ${fail} failed  —  ssrf guard\n`);
process.exit(fail ? 1 : 0);
