import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { companies, db, users } from "@/db";
import { AuthError, requireUser } from "@/lib/auth";
import { normalizeSkills } from "@/lib/skills";
import { normalisePostalCode, resolveLocation, toCountryCode, UNKNOWN_COUNTRY } from "@/lib/geo";

const Body = z.object({
  name: z.string().min(1).optional(),
  // AUTH-002 — role is NOT accepted here. It used to be, and because the
  // handler spreads `...rest` straight into the update, any candidate could
  // PATCH {"role":"RECRUITER"} and cross the boundary in one request. Role is
  // set once at signup and changed only by platform staff.
  headline: z.string().max(140).optional(),
  bio: z.string().max(2000).optional(),
  location: z.string().max(120).optional(),
  remotePref: z.enum(["ONSITE", "HYBRID", "REMOTE", "ANY"]).optional(),
  yearsExp: z.number().int().min(0).max(60).optional(),
  salaryTarget: z.number().int().min(0).max(2000).nullable().optional(),
  availability: z.string().max(60).optional(),
  skills: z.array(z.string()).max(40).optional(),
  openToOffers: z.boolean().optional(),
  title: z.string().max(120).optional(),
  companyName: z.string().max(120).optional(),

  // ── FSD v1.1 §36.2 — CandidateLocation (CLP-001 – CLP-006) ──
  // No nationality, citizenship or immigration-status field appears here, and
  // none may be added: country of residence plus the employer-stated right to
  // work answers every rule in §30–§35. CLP-007 / FSD §38.1.
  currentCountry: z.string().length(2).nullable().optional(),
  currentStateProvince: z.string().max(64).nullable().optional(),
  currentCity: z.string().max(120).nullable().optional(),
  /** Optional. Improves radius accuracy for local-only roles, nothing else. */
  currentPostalCode: z.string().max(12).nullable().optional(),
  searchCountry: z.string().length(2).nullable().optional(),
  preferredCountries: z.array(z.string().length(2)).max(50).optional(),
  preferredRegions: z.array(z.string().max(32)).max(20).optional(),
  preferredCities: z.array(z.string().max(120)).max(30).optional(),
  internationalSearchEnabled: z.boolean().optional(),
  /** Empty = unstated; ["SAME"] = own country only; ["*"] = anywhere; else a list. */
  remoteEligibleCountries: z.array(z.string().max(4)).max(50).optional(),
  relocationWillingness: z.enum(["NONE", "DOMESTIC", "INTERNATIONAL"]).optional(),
});

export async function GET() {
  try {
    const u = await requireUser();
    return NextResponse.json({
      id: u.id, email: u.email, name: u.name, role: u.role, image: u.image,
      headline: u.headline, bio: u.bio, location: u.location, remotePref: u.remotePref,
      yearsExp: u.yearsExp, salaryTarget: u.salaryTarget, availability: u.availability,
      skills: u.skills, openToOffers: u.openToOffers, profileReady: u.profileReady,
      title: u.title, companyId: u.companyId, linkedinLinked: Boolean(u.linkedinSub),
      currentCountry: u.currentCountry, currentStateProvince: u.currentStateProvince,
      currentCity: u.currentCity, currentPostalCode: u.currentPostalCode,
      searchCountry: u.searchCountry,
      preferredCountries: u.preferredCountries, preferredRegions: u.preferredRegions,
      preferredCities: u.preferredCities,
      internationalSearchEnabled: u.internationalSearchEnabled,
      remoteEligibleCountries: u.remoteEligibleCountries,
      relocationWillingness: u.relocationWillingness,
    });
  } catch {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await requireUser();
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid" }, { status: 400 });
    }
    const { companyName, skills, ...rest } = parsed.data;

    let companyId = user.companyId;
    if (companyName) {
      const slug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const [c] = await db
        .insert(companies)
        .values({ name: companyName, slug, source: "JOBSY" })
        .onConflictDoUpdate({ target: companies.slug, set: { name: companyName } })
        .returning();
      companyId = c.id;
    }

    // ── CLP-001 / CLP-002 ──
    // If the candidate typed a location but never picked a country, resolve it
    // rather than leaving them country-unknown, which fails closed under
    // GEO-006 and would empty their deck without explanation.
    const geoPatch: Record<string, unknown> = {};
    if (rest.currentCountry) {
      const cc = toCountryCode(rest.currentCountry);
      geoPatch.currentCountry = cc === UNKNOWN_COUNTRY ? null : cc;
    } else if (rest.location && !user.currentCountry) {
      const r = resolveLocation(rest.location);
      if (r.country !== UNKNOWN_COUNTRY) {
        geoPatch.currentCountry = r.country;
        geoPatch.currentStateProvince = rest.currentStateProvince ?? r.stateProvince;
        geoPatch.currentCity = rest.currentCity ?? r.city;
      }
    }
    // A postal code the candidate supplies is normalised or dropped. A
    // malformed one is worse than none: it would place them confidently in the
    // wrong town. Never required, and never a matching input — see postal.ts.
    if (rest.currentPostalCode !== undefined) {
      const cc = (geoPatch.currentCountry as string) ?? user.currentCountry ?? "US";
      geoPatch.currentPostalCode = rest.currentPostalCode
        ? normalisePostalCode(rest.currentPostalCode, cc)
        : null;
    }
    if (rest.searchCountry !== undefined) {
      const sc = rest.searchCountry ? toCountryCode(rest.searchCountry) : null;
      geoPatch.searchCountry = sc === UNKNOWN_COUNTRY ? null : sc;
    }
    if (rest.preferredCountries) {
      geoPatch.preferredCountries = rest.preferredCountries
        .map(toCountryCode)
        .filter((c) => c !== UNKNOWN_COUNTRY);
    }
    if (rest.remoteEligibleCountries) {
      geoPatch.remoteEligibleCountries = rest.remoteEligibleCountries
        .map((c) => (c === "*" || c === "SAME" ? c : toCountryCode(c)))
        .filter((c) => c !== UNKNOWN_COUNTRY);
    }

    const nextSkills = skills ? normalizeSkills(skills) : undefined;
    const merged = {
      headline: rest.headline ?? user.headline,
      location: rest.location ?? user.location,
      skills: nextSkills ?? user.skills,
    };
    const ready = Boolean(merged.headline) && Boolean(merged.location) && merged.skills.length >= 3;

    const [updated] = await db
      .update(users)
      .set({
        ...rest,
        ...geoPatch,
        ...(nextSkills ? { skills: nextSkills } : {}),
        ...(companyId ? { companyId } : {}),
        profileReady: ready,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id))
      .returning();

    return NextResponse.json({ ok: true, profileReady: updated.profileReady, skills: updated.skills });
  } catch (e) {
    const status = e instanceof AuthError ? 401 : 400;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
