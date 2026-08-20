#!/usr/bin/env tsx
/**
 * MATCH-030 AC-2 / MATCH-031 AC-4 — the guard.
 *
 * The matching engine's promise to candidates is that it never sees a protected
 * attribute or a close proxy. A promise enforced only by code review is a
 * promise that survives until the first hurried afternoon.
 *
 * This runs in CI and fails the build if:
 *
 *   1. Any prohibited field name appears anywhere under src/lib/matching/.
 *   2. Any matching module imports the EEO self-identification store, which is
 *      collected for bias auditing and must be unreachable from scoring.
 *   3. The matchScore input type gains a field it should not have.
 *
 * If you are here because the build failed: the answer is almost never to add
 * an exception. It is to move the feature out of the matching path.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const MATCHING_DIR = join(ROOT, "src/lib/matching");

/**
 * Each entry is a field or concept the engine must never read.
 *
 * The `allow` regexes exist for one reason only: these words legitimately
 * appear in prose that EXPLAINS the prohibition. A comment saying "never uses
 * the candidate's name" must not fail the build that the comment describes.
 * They are deliberately narrow — a comment marker, not a code escape.
 */
type Rule = {
  label: string;
  /** Identifier-shaped patterns — what a real read of the field would look like. */
  patterns: RegExp[];
  why: string;
};

const PROHIBITED: Rule[] = [
  {
    label: "name",
    patterns: [/\b(?:cand|candidate|user|person|applicant)\s*\.\s*name\b/, /\bfullName\b/, /\bfirstName\b/, /\blastName\b/, /\bsurname\b/],
    why: "Name is a proxy for race, ethnicity, national origin and gender.",
  },
  {
    label: "photo",
    patterns: [/\bphotoUrl\b/, /\bavatarUrl\b/, /\bheadshot\b/, /\.\s*image\b/, /\bprofilePicture\b/],
    why: "A photograph is a proxy for race, age, gender and disability.",
  },
  {
    label: "school",
    patterns: [/\bschool\b/, /\buniversity\b/, /\balmaMater\b/, /\bcollege\b/, /\binstitution\b/],
    why: "School is a proxy for race and socioeconomic status.",
  },
  {
    label: "graduation year",
    patterns: [/\bgraduationYear\b/, /\bgradYear\b/, /\byearGraduated\b/, /\bclassOf\b/],
    why: "Graduation year is a direct age proxy — the theory at issue in Mobley v. Workday.",
  },
  {
    label: "age or date of birth",
    patterns: [/\bdateOfBirth\b/, /\bbirthDate\b/, /\bdob\b/, /\bcandidateAge\b/, /\.\s*age\b/],
    why: "Direct age discrimination under the ADEA.",
  },
  {
    label: "gender",
    patterns: [/\bgender\b/, /\bpronouns\b/, /\bsexCategory\b/],
    why: "Direct sex discrimination under Title VII.",
  },
  {
    label: "race or ethnicity",
    patterns: [/\braceEthnicity\b/, /\bethnicity\b/, /\braceCategory\b/],
    why: "Direct race discrimination under Title VII.",
  },
  {
    label: "religion",
    patterns: [/\breligion\b/, /\breligious\b/],
    why: "Direct religious discrimination under Title VII.",
  },
  {
    label: "disability",
    patterns: [/\bdisabilityStatus\b/, /\bisDisabled\b/, /\baccommodationNeeded\b/],
    why: "Direct disability discrimination under the ADA.",
  },
  {
    label: "citizenship or immigration status",
    patterns: [/\bcitizenship\b/, /\bimmigrationStatus\b/, /\bvisaType\b/, /\bvisaCategory\b/, /\bauthorizedToWork\b/, /\brequiresSponsorship\b/],
    why: "Citizenship-status discrimination under IRCA 8 U.S.C. § 1324b.",
  },
  {
    label: "marital or family status",
    patterns: [/\bmaritalStatus\b/, /\bhasChildren\b/, /\bfamilyStatus\b/, /\bdependants?\b/],
    why: "Protected in many states, and a sex-discrimination inference.",
  },
  {
    label: "ZIP code or exact address",
    patterns: [/\bzipCode\b/, /\bzip\b/, /\bpostalCode\b/, /\bstreetAddress\b/, /\baddressLine\b/, /\blatitude\b/, /\blongitude\b/],
    why: "Illinois HB 3773 expressly bans ZIP code as a proxy for a protected class.",
  },
  {
    label: "EEO self-identification store",
    patterns: [/\beeoSelfId\b/, /\beeo_self_id\b/],
    why:
      "MATCH-031 — demographic data is collected separately, for bias auditing only, " +
      "in a store the matching engine must not be able to read.",
  },
];

/** Lines that are unambiguously commentary about the rule, not a read of the field. */
const COMMENT_LINE = /^\s*(\/\/|\*|\/\*)/;

type Violation = { file: string; line: number; text: string; rule: Rule };

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx|mts)$/.test(entry)) out.push(full);
  }
  return out;
}

function scan(): Violation[] {
  const violations: Violation[] = [];
  for (const file of walk(MATCHING_DIR)) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((text, i) => {
      // A comment explaining the prohibition is the point of the prohibition.
      if (COMMENT_LINE.test(text)) return;
      for (const rule of PROHIBITED) {
        for (const p of rule.patterns) {
          if (p.test(text)) {
            violations.push({ file: relative(ROOT, file), line: i + 1, text: text.trim(), rule });
            return;
          }
        }
      }
    });
  }
  return violations;
}

/**
 * Independent check: the engine's own input type must not have grown.
 *
 * The pattern scan catches a field being READ. This catches it being made
 * READABLE, which is the change that has to happen first.
 */
function checkInputSurface(): string[] {
  const errors: string[] = [];
  const engine = readFileSync(join(MATCHING_DIR, "engine.ts"), "utf8");

  const jobType = engine.match(/type\s+JobInput\s*=\s*\{[\s\S]*?\n\};/)?.[0] ?? "";
  const candType = engine.match(/type\s+CandidateInput\s*=\s*\{[\s\S]*?\n\};/)?.[0] ?? "";

  if (!jobType || !candType) {
    errors.push(
      "Could not find JobInput / CandidateInput in engine.ts. If they were renamed, update this guard — do not delete it."
    );
    return errors;
  }

  const ALLOWED_CANDIDATE_FIELDS = new Set([
    "headline", "bio", "skills", "location", "remotePref", "salaryTarget", "yearsExp",
  ]);

  for (const line of candType.split("\n")) {
    const field = line.match(/^\s*(\w+)\??\s*:/)?.[1];
    if (!field || field === "type" || field === "CandidateInput") continue;
    if (!ALLOWED_CANDIDATE_FIELDS.has(field)) {
      errors.push(
        `CandidateInput gained the field "${field}". Every field the engine can see is a field it can discriminate on. ` +
          `Add it to ALLOWED_CANDIDATE_FIELDS in this guard only after confirming it is not a protected attribute or a proxy for one.`
      );
    }
  }
  return errors;
}

const violations = scan();
const surfaceErrors = checkInputSurface();

if (violations.length === 0 && surfaceErrors.length === 0) {
  console.log("✓ MATCH-030: no prohibited inputs reachable from the matching engine");
  console.log(`  scanned ${walk(MATCHING_DIR).length} files against ${PROHIBITED.length} rules`);
  process.exit(0);
}

console.error("\n✗ MATCH-030 GUARD FAILED\n");

for (const v of violations) {
  console.error(`  ${v.file}:${v.line}`);
  console.error(`    ${v.text}`);
  console.error(`    → ${v.rule.label}: ${v.rule.why}\n`);
}
for (const e of surfaceErrors) {
  console.error(`  ${e}\n`);
}

console.error(
  "The matching engine must not read a protected attribute or a close proxy.\n" +
    "The fix is almost never an exception here — it is to move the feature out of\n" +
    "the matching path. See PRD MATCH-030 and the AEDT notice, which tells\n" +
    "candidates in writing that none of these are used.\n"
);
process.exit(1);
