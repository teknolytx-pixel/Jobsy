#!/usr/bin/env tsx
/**
 * The routing gate — which model may see which text.
 *
 * This suite exists because the rule it tests is invisible at runtime. Nothing
 * fails loudly if a resume goes to a provider that trains on it; the request
 * succeeds, the candidate gets a good rewrite, and the consequence is a
 * data-protection problem discovered by someone else, later. So the assertion
 * has to be made here, mechanically, on every build.
 */
const {
  SENSITIVITIES,
  AI_PROVIDERS,
  postures,
  mayHandle,
  refusalReason,
  route,
  subProcessorDisclosure,
} = await import("../src/lib/ai/policy");

let pass = 0,
  fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

console.log("\nAI ROUTING POLICY\n");

const free = postures(false);
const paid = postures(true);

check("TC-AIP-01 two sensitivity classes", SENSITIVITIES.length === 2, SENSITIVITIES.join(","));
check("TC-AIP-02 two providers", AI_PROVIDERS.length === 2, AI_PROVIDERS.join(","));

check("TC-AIP-10 groq does not train on input", free.groq.trainsOnInput === false);
check("TC-AIP-11 free gemini does train on input", free.gemini.trainsOnInput === true);
check("TC-AIP-12 paid gemini does not", paid.gemini.trainsOnInput === false);
check("TC-AIP-13 the paid flag never changes groq", paid.groq.trainsOnInput === false);

console.log("\nTHE GATE\n");

// The single assertion this whole file exists for.
check("TC-AIP-20 free gemini may NOT see candidate content",
  mayHandle(free.gemini, "CANDIDATE_CONTENT") === false);
check("TC-AIP-21 groq may", mayHandle(free.groq, "CANDIDATE_CONTENT") === true);
check("TC-AIP-22 paid gemini may", mayHandle(paid.gemini, "CANDIDATE_CONTENT") === true);

// Employer-published text is not personal data and both may handle it. If this
// ever fails, "use both providers" has quietly become "use one".
check("TC-AIP-23 both may see employer-public text",
  AI_PROVIDERS.every((p) => mayHandle(free[p], "EMPLOYER_PUBLIC")));

check("TC-AIP-24 a refusal explains itself",
  /free tier/i.test(refusalReason(free.gemini, "CANDIDATE_CONTENT") ?? ""),
  refusalReason(free.gemini, "CANDIDATE_CONTENT") ?? "");
check("TC-AIP-25 an allowed pair has no refusal",
  refusalReason(free.groq, "CANDIDATE_CONTENT") === null);

console.log("\nROUTING\n");

const both = ["groq", "gemini"] as const;

const r1 = route({ sensitivity: "CANDIDATE_CONTENT", configured: [...both], paidGemini: false });
check("TC-AIP-30 resume work routes to groq only", r1.eligible.join(",") === "groq", r1.eligible.join(","));
check("TC-AIP-31 and records why gemini was refused",
  r1.refused.length === 1 && r1.refused[0].provider === "gemini");

const r2 = route({ sensitivity: "EMPLOYER_PUBLIC", configured: [...both], paidGemini: false });
check("TC-AIP-32 job text routes to both", r2.eligible.join(",") === "groq,gemini", r2.eligible.join(","));
check("TC-AIP-33 with nothing refused", r2.refused.length === 0);

const r3 = route({ sensitivity: "CANDIDATE_CONTENT", configured: [...both], paidGemini: true });
check("TC-AIP-34 the paid flag adds gemini as a fallback, behind groq",
  r3.eligible.join(",") === "groq,gemini", r3.eligible.join(","));

// The failure mode that matters most: someone sets only GEMINI_API_KEY and
// assumes resume polish works. It must not silently fall back to the ineligible
// provider — it must produce no eligible provider at all.
const r4 = route({ sensitivity: "CANDIDATE_CONTENT", configured: ["gemini"], paidGemini: false });
check("TC-AIP-40 gemini alone cannot serve candidate content", r4.eligible.length === 0);
check("TC-AIP-41 and the reason is reported rather than swallowed", r4.refused.length === 1);

const r5 = route({ sensitivity: "EMPLOYER_PUBLIC", configured: [], paidGemini: false });
check("TC-AIP-42 no keys configured is not an error", r5.eligible.length === 0 && r5.refused.length === 0);

const r6 = route({ sensitivity: "CANDIDATE_CONTENT", configured: ["groq"], paidGemini: true });
check("TC-AIP-43 an unconfigured provider is never routed to", r6.eligible.join(",") === "groq");

console.log("\nSUB-PROCESSOR DISCLOSURE\n");

const d = subProcessorDisclosure({ configured: [...both], paidGemini: false });
check("TC-AIP-50 one line per configured provider", d.length === 2);
check("TC-AIP-51 groq's line covers resume text", /resume/i.test(d[0]), d[0]);
// The disclosure must state the narrower scope for the provider that is
// actually restricted, or the privacy policy overstates what we send.
check("TC-AIP-52 free gemini's line says job text only",
  /never your resume/i.test(d[1]), d[1]);
check("TC-AIP-53 paid gemini's line widens",
  /resume/i.test(subProcessorDisclosure({ configured: [...both], paidGemini: true })[1]));
check("TC-AIP-54 an unconfigured provider is not disclosed",
  subProcessorDisclosure({ configured: ["groq"], paidGemini: false }).length === 1);

console.log(`\n${pass} passed, ${fail} failed  —  ai routing policy\n`);
process.exit(fail ? 1 : 0);
