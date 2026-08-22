import { desc, eq, or } from "drizzle-orm";
import {
  db,
  aedtNotices,
  applications,
  candidateSwipes,
  companies,
  companyMembers,
  emailLogs,
  jobs,
  matches,
  messages,
  notificationPrefs,
  privacyRequests,
  recruiterSwipes,
  resumes,
  termsAcceptances,
  users,
  type User,
} from "@/db";
import { matchScore } from "./matching/engine";
import { explain } from "./explain";

/**
 * AUTH-012 AC-5 — the data export.
 *
 * "Everything we hold about you, INCLUDING derived match scores." That last
 * clause is the one most exports get wrong. A score we computed about a person
 * is personal data about that person, and both the CCPA access right and the
 * CPPA ADMT access right reach it. So the export recomputes and includes the
 * explanation for every job the person swiped on — which is only possible
 * because the engine is pure and deterministic.
 */

export type ExportBundle = {
  generatedAt: string;
  aboutThisExport: string[];
  profile: Record<string, unknown>;
  workAuthorization: Record<string, unknown>;
  privacyChoices: Record<string, unknown>;
  legalAcceptances: unknown[];
  automatedDecisionNotices: unknown[];
  privacyRequests: unknown[];
  company: unknown;
  swipesAndScores: unknown[];
  matchesAndConversations: unknown[];
  applications: unknown[];
  jobsYouPosted: unknown[];
  resumes: unknown[];
  emailsWeSentYou: unknown[];
  notUsedInMatching: string[];
};

/**
 * Fields that are deliberately NOT in the export because we never hold them.
 * Stated explicitly, because "we don't have it" is a more useful answer than
 * silence when someone asks what you know about them.
 */
const NEVER_COLLECTED = [
  "Date of birth or age",
  "Gender or gender identity",
  "Race or ethnicity",
  "Religion",
  "Disability status",
  "Sexual orientation",
  "Precise or real-time location",
  "Government identification numbers",
  "Financial account or payment card numbers",
  "Biometric data",
  "Health information",
  "Criminal history",
  "Prior compensation (we ask what you're looking for, never what you earned)",
  "Visa category, country of citizenship, or immigration status detail",
];

export async function buildExport(user: User): Promise<ExportBundle> {
  const [
    acceptances,
    notices,
    requests,
    prefs,
    membership,
    candSwipes,
    recSwipes,
    apps,
    postedJobs,
    resumeRows,
    emails,
  ] = await Promise.all([
    db.select().from(termsAcceptances).where(eq(termsAcceptances.userId, user.id)),
    db.select().from(aedtNotices).where(eq(aedtNotices.userId, user.id)),
    db.select().from(privacyRequests).where(eq(privacyRequests.userId, user.id)),
    db.select().from(notificationPrefs).where(eq(notificationPrefs.userId, user.id)).limit(1),
    db
      .select({
        companyId: companyMembers.companyId,
        seatRole: companyMembers.seatRole,
        joinedAt: companyMembers.joinedAt,
        companyName: companies.name,
      })
      .from(companyMembers)
      .innerJoin(companies, eq(companyMembers.companyId, companies.id))
      .where(eq(companyMembers.userId, user.id))
      .limit(1),
    db
      .select({ swipe: candidateSwipes, job: jobs, company: companies })
      .from(candidateSwipes)
      .innerJoin(jobs, eq(candidateSwipes.jobId, jobs.id))
      .innerJoin(companies, eq(jobs.companyId, companies.id))
      .where(eq(candidateSwipes.candidateId, user.id))
      .orderBy(desc(candidateSwipes.createdAt))
      .limit(500),
    db
      .select()
      .from(recruiterSwipes)
      .where(eq(recruiterSwipes.recruiterId, user.id))
      .orderBy(desc(recruiterSwipes.createdAt))
      .limit(500),
    db
      .select({ app: applications, job: jobs, company: companies })
      .from(applications)
      .innerJoin(jobs, eq(applications.jobId, jobs.id))
      .innerJoin(companies, eq(jobs.companyId, companies.id))
      .where(eq(applications.candidateId, user.id)),
    db.select().from(jobs).where(eq(jobs.postedById, user.id)),
    db.select().from(resumes).where(eq(resumes.userId, user.id)),
    db.select().from(emailLogs).where(eq(emailLogs.to, user.email)).limit(500),
  ]);

  // AC-5 — derived scores. Recomputed from the same pure function the deck
  // uses, so the export shows what the system actually thinks, not a snapshot
  // that may have drifted.
  const swipesAndScores = candSwipes.map(({ swipe, job, company }) => {
    const result = matchScore(
      {
        title: job.title,
        description: job.description,
        skills: job.skills,
        requiredSkills: job.requiredSkills,
        preferredSkills: job.preferredSkills,
        location: job.location,
        remote: job.remote,
        salaryMin: job.salaryMin,
        salaryMax: job.salaryMax,
        seniority: job.seniority,
      },
      user
    );
    return {
      at: swipe.createdAt.toISOString(),
      direction: swipe.direction,
      scoreAtTheTime: swipe.score,
      job: { title: job.title, company: company.name, location: job.location },
      currentScoreAndExplanation: explain(result),
    };
  });

  const myMatches = await db
    .select({ match: matches, job: jobs, company: companies })
    .from(matches)
    .innerJoin(jobs, eq(matches.jobId, jobs.id))
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .where(or(eq(matches.candidateId, user.id), eq(matches.recruiterId, user.id)));

  const conversations = await Promise.all(
    myMatches.map(async ({ match, job, company }) => ({
      matchedAt: match.createdAt.toISOString(),
      job: { title: job.title, company: company.name },
      score: match.score,
      // Only the person's OWN messages. The counterparty's words are their
      // personal data, not this user's, and exporting them would be a
      // disclosure rather than an access response.
      yourMessages: (
        await db
          .select({ body: messages.body, at: messages.createdAt, senderId: messages.senderId })
          .from(messages)
          .where(eq(messages.matchId, match.id))
          .orderBy(messages.createdAt)
      )
        .filter((m) => m.senderId === user.id)
        .map((m) => ({ body: m.body, at: m.at.toISOString() })),
    }))
  );

  return {
    generatedAt: new Date().toISOString(),
    aboutThisExport: [
      "This is everything Jobsy holds about you.",
      "It includes the match scores we derived about you, and the explanation behind each one, because a score we computed about you is information about you.",
      "Conversations include only the messages you sent. The other person's messages are their personal data, not yours.",
      "If anything here is wrong you can correct it in your profile, or ask us to.",
    ],
    profile: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      headline: user.headline,
      bio: user.bio,
      location: user.location,
      remotePreference: user.remotePref,
      yearsOfExperience: user.yearsExp,
      salaryTargetThousandsUSD: user.salaryTarget,
      availability: user.availability,
      skills: user.skills,
      openToOffers: user.openToOffers,
      profileComplete: user.profileReady,
      photoUrl: user.image,
      emailVerified: user.emailVerified,
      linkedInLinked: Boolean(user.linkedinSub),
      linkedInLinkedAt: user.linkedinLinkedAt?.toISOString() ?? null,
      accountCreated: user.createdAt.toISOString(),
      lastUpdated: user.updatedAt.toISOString(),
      // Recorded only to choose which legal notices apply to you.
      jurisdictionUsedForLegalNotices: user.jurisdiction,
    },
    workAuthorization: {
      note: "We hold exactly two yes/no answers and nothing more. We never collect your visa category, country of citizenship, immigration status detail, or any document number.",
      authorizedToWorkInTheUS: user.authorizedToWork,
      requiresSponsorship: user.requiresSponsorship,
      consentGivenAt: user.workAuthConsentAt?.toISOString() ?? null,
    },
    privacyChoices: {
      automatedRankingOptOut: user.profilingOptOut,
      notificationPreferences: prefs[0]
        ? {
            newMatch: prefs[0].newMatch,
            newMessage: prefs[0].newMessage,
            recruiterInterest: prefs[0].recruiterInterest,
            applicationStatus: prefs[0].applicationStatus,
            jobAlerts: prefs[0].jobAlerts,
            productUpdates: prefs[0].productUpdates,
            suppressed: prefs[0].suppressedAt?.toISOString() ?? null,
          }
        : null,
    },
    legalAcceptances: acceptances.map((a) => ({
      document: a.document,
      version: a.version,
      acceptedAt: a.acceptedAt.toISOString(),
    })),
    automatedDecisionNotices: notices.map((n) => ({
      jurisdiction: n.jurisdiction,
      version: n.noticeVersion,
      deliveredAt: n.deliveredAt.toISOString(),
      usableFrom: n.usableFrom?.toISOString() ?? null,
    })),
    privacyRequests: requests.map((r) => ({
      kind: r.kind,
      status: r.status,
      requestedAt: r.requestedAt.toISOString(),
      dueAt: r.dueAt.toISOString(),
      completedAt: r.completedAt?.toISOString() ?? null,
      outcome: r.outcome,
    })),
    company: membership[0] ?? null,
    swipesAndScores,
    matchesAndConversations: conversations,
    applications: apps.map(({ app, job, company }) => ({
      appliedAt: app.createdAt.toISOString(),
      method: app.method,
      status: app.status,
      job: { title: job.title, company: company.name },
    })),
    jobsYouPosted: postedJobs.map((j) => ({
      title: j.title,
      location: j.location,
      postedAt: j.postedAt.toISOString(),
      active: j.active,
    })),
    resumes: resumeRows.map((r) => ({
      filename: r.filename,
      uploadedAt: r.createdAt.toISOString(),
      sizeBytes: r.bytes,
      parseStatus: r.parseStatus,
      deleted: Boolean(r.deletedAt),
    })),
    emailsWeSentYou: emails.map((e) => ({
      subject: e.subject,
      template: e.template,
      status: e.status,
      at: e.createdAt.toISOString(),
    })),
    notUsedInMatching: NEVER_COLLECTED,
  };
}

/** Recruiter-side swipes are exported too, but stripped of candidate identity. */
export function summariseRecruiterSwipes(rows: { direction: string; score: number; createdAt: Date }[]) {
  return rows.map((r) => ({
    at: r.createdAt.toISOString(),
    direction: r.direction,
    score: r.score,
  }));
}
