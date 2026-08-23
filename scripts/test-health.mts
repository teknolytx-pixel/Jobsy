#!/usr/bin/env tsx
/**
 * NFR-010 — the checks that catch silent failures.
 *
 * Written after a real one: a user asked for a password reset and no email
 * arrived. The reset code was correct, well tested, and had been shipped for
 * weeks. The delivery configuration was not, and nothing anywhere reported it —
 * the app told the user "we've sent a reset link" and returned 202 either way.
 *
 * These assert the rules that make that visible.
 */
const { assess, QUEUED_ALARM_THRESHOLD } = await import("../src/lib/health");
type HealthInput = import("../src/lib/health").HealthInput;

let pass = 0,
  fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

const base: HealthInput = {
  email: { sent: 50, failed: 0, loggedOnly: 0, suppressed: 0, queued: 0 },
  failingSources: [],
  resumeParseFailures: 0,
  resumeUploads: 0,
  resumesStored: 0,
  config: {
    emailEnabled: true,
    appUrl: "https://jobsy.example.com",
    isProduction: true,
    expectedHosts: ["jobsy.example.com"],
    usingBlob: true,
  },
};

const of = (p: Partial<HealthInput>): ReturnType<typeof assess> =>
  assess({ ...base, ...p, config: { ...base.config, ...(p.config ?? {}) } });

console.log("\nHEALTHY BASELINE\n");
check("TC-HLT-01 a healthy deployment reports nothing", of({}).length === 0, JSON.stringify(of({}).map((f) => f.title)));

console.log("\nEMAIL — THE SILENT FAILURE\n");

const noKey = of({ config: { ...base.config, emailEnabled: false } });
check("TC-HLT-10 unconfigured email in production is CRITICAL",
  noKey.some((f) => f.area === "EMAIL" && f.severity === "CRITICAL"));
check("TC-HLT-11 and it names password reset specifically",
  /password reset/i.test(noKey.find((f) => f.area === "EMAIL")?.detail ?? ""));
check("TC-HLT-12 and says the app lies about it",
  /still tells people the email was sent/i.test(noKey.find((f) => f.area === "EMAIL")?.detail ?? ""));
check("TC-HLT-13 and gives the exact fix",
  /RESEND_API_KEY/.test(noKey.find((f) => f.area === "EMAIL")?.action ?? ""));

// Local development has no email key and that is correct, not an incident.
check("TC-HLT-14 unconfigured email outside production is not reported",
  of({ config: { ...base.config, emailEnabled: false, isProduction: false } })
    .filter((f) => f.area === "EMAIL").length === 0);

check("TC-HLT-15 messages already logged-only are reported even once email is fixed",
  of({ email: { ...base.email, loggedOnly: 3 } }).some((f) => f.area === "EMAIL"));

check("TC-HLT-20 a few failures are a warning",
  of({ email: { ...base.email, failed: 2 } }).find((f) => f.area === "EMAIL")?.severity === "WARNING");
// More failing than succeeding is an outage, and should not read the same as
// two bounced addresses.
check("TC-HLT-21 more failures than successes is critical",
  of({ email: { ...base.email, sent: 1, failed: 9 } }).find((f) => f.area === "EMAIL")?.severity === "CRITICAL");

check("TC-HLT-22 stuck QUEUED rows are reported",
  of({ email: { ...base.email, queued: QUEUED_ALARM_THRESHOLD + 1 } }).some((f) => /QUEUED/.test(f.title)));
check("TC-HLT-23 a couple in flight are not",
  of({ email: { ...base.email, queued: 1 } }).length === 0);

console.log("\nCONFIG — WHERE THE LINKS POINT\n");

// The live one: two Vercel projects serve this repo and only one is current.
const wrongHost = of({
  config: { ...base.config, appUrl: "https://jobsy-weld.vercel.app", expectedHosts: ["jobsy-git-main-jobsy3.vercel.app"] },
});
check("TC-HLT-30 reset links pointing at another site are CRITICAL",
  wrongHost.some((f) => f.area === "CONFIG" && f.severity === "CRITICAL"));
check("TC-HLT-31 and the message explains the token will not work there",
  /token will not be valid there/i.test(wrongHost.find((f) => f.area === "CONFIG")?.detail ?? ""));
check("TC-HLT-32 and the fix names the correct host",
  /jobsy-git-main-jobsy3/.test(wrongHost.find((f) => f.area === "CONFIG")?.action ?? ""));

check("TC-HLT-33 a matching host is silent",
  of({ config: { ...base.config, appUrl: "https://jobsy.example.com/" } }).filter((f) => f.area === "CONFIG").length === 0);
check("TC-HLT-34 case and port differences do not false-alarm",
  of({ config: { ...base.config, appUrl: "https://JOBSY.example.com" } }).filter((f) => f.area === "CONFIG").length === 0);
check("TC-HLT-35 a malformed app url is reported",
  of({ config: { ...base.config, appUrl: "not a url" } }).some((f) => f.area === "CONFIG"));
// With no expected hosts known there is nothing to compare against, and a
// guess would be a false alarm on every deployment.
check("TC-HLT-36 no expected hosts means no config finding",
  of({ config: { ...base.config, appUrl: "https://anything.example", expectedHosts: [] } })
    .filter((f) => f.area === "CONFIG").length === 0);

console.log("\nSTORAGE — WHERE THE CVs GO\n");

const noBlob = of({ config: { ...base.config, usingBlob: false } });
check("TC-HLT-70 no durable storage in production is CRITICAL",
  noBlob.some((f) => f.area === "STORAGE" && f.severity === "CRITICAL"));
// Reported BEFORE anything is lost, not after. Waiting for the first casualty
// is not monitoring.
check("TC-HLT-71 reported even with zero resumes on record",
  noBlob.some((f) => f.area === "STORAGE"));
check("TC-HLT-72 and it counts what is already at risk",
  /3 uploaded CVs/.test(
    of({ resumesStored: 3, config: { ...base.config, usingBlob: false } })
      .find((f) => f.area === "STORAGE")?.title ?? ""
  ));
check("TC-HLT-73 it explains why nothing LOOKS wrong",
  /nothing looks wrong until someone tries to open the file/i.test(
    noBlob.find((f) => f.area === "STORAGE")?.detail ?? ""
  ));
check("TC-HLT-74 local development is not an incident",
  of({ config: { ...base.config, usingBlob: false, isProduction: false } })
    .filter((f) => f.area === "STORAGE").length === 0);
check("TC-HLT-75 a configured store is silent",
  of({ resumesStored: 40 }).filter((f) => f.area === "STORAGE").length === 0);

console.log("\nINGESTION AND PARSING\n");

check("TC-HLT-40 a failing source is reported by name",
  of({ failingSources: [{ name: "Acme", error: "404 from board" }] }).some((f) => /Acme/.test(f.title)));

// A scanned PDF failing is expected and the candidate is told. A broken
// extractor is not. Rate, not total.
check("TC-HLT-50 a high parse-failure rate is reported",
  of({ resumeUploads: 10, resumeParseFailures: 6 }).some((f) => f.area === "PARSING"));
check("TC-HLT-51 an ordinary rate is not",
  of({ resumeUploads: 10, resumeParseFailures: 2 }).filter((f) => f.area === "PARSING").length === 0);
check("TC-HLT-52 a tiny sample never triggers it",
  of({ resumeUploads: 2, resumeParseFailures: 2 }).filter((f) => f.area === "PARSING").length === 0);

console.log("\nRECOVERY ENDPOINT — THE RULES IT DEPENDS ON\n");

/**
 * The endpoint that reveals an undelivered reset link is gated on email being
 * broken. These pin the two facts it relies on, because if either changes the
 * gate opens at the wrong time: it must report an EMAIL finding while email is
 * unconfigured in production, and must NOT once it is configured.
 */
check("TC-HLT-80 an EMAIL finding exists while email is unconfigured",
  of({ config: { ...base.config, emailEnabled: false } }).some((f) => f.area === "EMAIL"));
check("TC-HLT-81 and disappears once email works and nothing has failed",
  of({}).filter((f) => f.area === "EMAIL").length === 0);

console.log("\nORDERING\n");
const mixed = of({
  email: { ...base.email, failed: 1 },
  config: { ...base.config, emailEnabled: false },
});
check("TC-HLT-60 critical findings sort above warnings", mixed[0]?.severity === "CRITICAL",
  mixed.map((f) => f.severity).join(","));

console.log(`\n${pass} passed, ${fail} failed  —  operational health\n`);
process.exit(fail ? 1 : 0);
