/**
 * Central env access. Everything optional except DATABASE_URL + AUTH_SECRET
 * so the app boots and is testable with zero third-party keys.
 */
const req = (k: string, fallback?: string): string => {
  const v = process.env[k] ?? fallback;
  if (!v) throw new Error(`Missing required env var: ${k}`);
  return v;
};
const opt = (k: string): string | undefined => {
  const v = process.env[k];
  return v && v.trim() ? v.trim() : undefined;
};
const list = (k: string): string[] =>
  (process.env[k] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export const env = {
  get databaseUrl() {
    return req("DATABASE_URL");
  },
  get authSecret() {
    return req("AUTH_SECRET", process.env.NODE_ENV !== "production" ? "dev-only-insecure-secret" : undefined);
  },
  get appUrl() {
    return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "http://localhost:3000";
  },

  linkedin: {
    get clientId() {
      return opt("LINKEDIN_CLIENT_ID");
    },
    get clientSecret() {
      return opt("LINKEDIN_CLIENT_SECRET");
    },
    get enabled() {
      return Boolean(opt("LINKEDIN_CLIENT_ID") && opt("LINKEDIN_CLIENT_SECRET"));
    },
  },

  email: {
    get resendKey() {
      return opt("RESEND_API_KEY");
    },
    get from() {
      return opt("EMAIL_FROM") ?? "Jobsy <onboarding@resend.dev>";
    },
    get enabled() {
      return Boolean(opt("RESEND_API_KEY"));
    },
  },

  jobs: {
    get adzunaId() {
      return opt("ADZUNA_APP_ID");
    },
    get adzunaKey() {
      return opt("ADZUNA_APP_KEY");
    },
    /** RapidAPI key → JSearch: Indeed, LinkedIn, Glassdoor, ZipRecruiter, Monster */
    get rapidApiKey() {
      return opt("RAPIDAPI_KEY");
    },
    /**
     * JSearch requests allowed per calendar month.
     *
     * This is a METERED provider on a hard cap: RapidAPI does not throttle you
     * back to a slower rate when the plan is exhausted, it starts returning
     * 429 and stops. So the run has to bound ITSELF. Twelve queries a night is
     * 360 a month, which overruns a 200-request plan around the 17th and leaves
     * the last third of every month with no ingestion at all — the failure
     * looks like "the site stopped finding jobs" and gives no hint why.
     *
     * Defaults to the free Basic allowance. Raise it to match your plan.
     */
    get jsearchMonthlyBudget() {
      const raw = Number(opt("JSEARCH_MONTHLY_BUDGET") ?? 200);
      return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 200;
    },
    /** Jooble free API key → Indeed + Monster + CareerBuilder aggregate */
    get joobleKey() {
      return opt("JOOBLE_API_KEY");
    },
    get careerjetAffid() {
      return opt("CAREERJET_AFFID");
    },
    /** Keyless public boards (Remotive, Arbeitnow). On unless explicitly disabled. */
    get keylessBoards() {
      return (process.env.ENABLE_KEYLESS_BOARDS ?? "true").toLowerCase() !== "false";
    },
    get greenhouse() {
      return list("GREENHOUSE_BOARDS");
    },
    get lever() {
      return list("LEVER_BOARDS");
    },
    get ashby() {
      return list("ASHBY_BOARDS");
    },
  },

  get cronSecret() {
    return opt("CRON_SECRET");
  },
};
