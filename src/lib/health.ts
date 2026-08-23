import { env } from "./env";
import { usingBlob } from "./storage";

/**
 * NFR-010 — monitoring for parsing, matching, messaging and notification
 * failures.
 *
 * This exists because of a specific, silent failure mode that the password
 * reset flow makes concrete.
 *
 * `sendEmail()` writes an `email_logs` row, and when `RESEND_API_KEY` is
 * absent it marks that row LOGGED_ONLY, prints the message to the server
 * console, and returns `delivered: false`. Every caller ignores the return
 * value — correctly, because a failed notification should not fail the request
 * that triggered it. The result is that a deployment with no email key behaves
 * exactly like a healthy one from the outside: a user asks to reset their
 * password, is told "if an account exists, we've sent a reset link", and no
 * email is ever sent. Nobody finds out until a locked-out user complains.
 *
 * The same shape applies to the reset LINK itself. It is built from
 * `NEXT_PUBLIC_APP_URL`, so if that variable points at a domain the deployment
 * no longer serves, every reset email sends people somewhere stale — and the
 * email still counts as SENT.
 *
 * None of that is detectable from a page load. It needs somebody to look, so
 * this module produces the thing to look at.
 *
 * Pure except for the counts passed in, so the rules can be tested without a
 * database.
 */

export type Severity = "CRITICAL" | "WARNING" | "OK";

export type HealthFinding = {
  severity: Severity;
  area: "EMAIL" | "CONFIG" | "STORAGE" | "INGESTION" | "PARSING" | "SCHEMA";
  title: string;
  /** What is actually wrong, in a sentence an operator can act on. */
  detail: string;
  /** The concrete fix. Null when there is nothing to do. */
  action: string | null;
};

export type HealthInput = {
  /** Counts over the recent window. */
  email: { sent: number; failed: number; loggedOnly: number; suppressed: number; queued: number };
  /** Job sources whose last sync errored. */
  failingSources: { name: string; error: string }[];
  /** Resume uploads that could not be read. */
  resumeParseFailures: number;
  resumeUploads: number;
  /** Environment, passed in so this stays testable. */
  config: {
    emailEnabled: boolean;
    appUrl: string;
    isProduction: boolean;
    expectedHosts: string[];
    /** RESUME-001 — is there durable storage, or just the function's disk? */
    usingBlob: boolean;
  };
  /** Resumes on record. Zero means nothing has been lost yet. */
  resumesStored: number;
  /**
   * Enum values the CODE knows about and the DATABASE does not.
   *
   * Optional because most callers have no reason to look, and absent is not the
   * same as empty: absent means nobody checked.
   */
  schemaDrift?: { type: string; missing: string[] }[];
};

/**
 * A queued email is only alarming once it has had time to leave.
 *
 * `sendEmail` writes QUEUED then immediately updates the row, so a persistent
 * QUEUED means the process died between the two — a real failure that looks
 * like nothing.
 */
export const QUEUED_ALARM_THRESHOLD = 5;

export function assess(input: HealthInput): HealthFinding[] {
  const out: HealthFinding[] = [];
  const { email, config } = input;

  // ── The silent one ──
  if (config.isProduction && !config.emailEnabled) {
    out.push({
      severity: "CRITICAL",
      area: "EMAIL",
      title: "No email is being sent",
      detail:
        "RESEND_API_KEY is not set on this deployment, so every message is written to the log and thrown away. " +
        "Password reset links, email verification, match notifications and application receipts are all silently going nowhere — " +
        "and the app still tells people the email was sent.",
      action: "Add RESEND_API_KEY in Vercel → Settings → Environment Variables, then redeploy.",
    });
  } else if (email.loggedOnly > 0 && config.isProduction) {
    out.push({
      severity: "CRITICAL",
      area: "EMAIL",
      title: `${email.loggedOnly} message${email.loggedOnly === 1 ? "" : "s"} were logged instead of sent`,
      detail: "Email was unconfigured for at least part of this period, so those messages never left the server.",
      action: "Check RESEND_API_KEY, then consider whether anyone needs contacting directly.",
    });
  }

  if (email.failed > 0) {
    out.push({
      severity: email.failed > email.sent ? "CRITICAL" : "WARNING",
      area: "EMAIL",
      title: `${email.failed} email${email.failed === 1 ? "" : "s"} failed to send`,
      detail:
        email.failed > email.sent
          ? "More messages failed than succeeded. This is an outage, not a blip."
          : "Some messages were rejected by the provider. Bounces and invalid addresses are normal; a rising rate is not.",
      action: "Check the Resend dashboard for the rejection reason.",
    });
  }

  if (email.queued > QUEUED_ALARM_THRESHOLD) {
    out.push({
      severity: "WARNING",
      area: "EMAIL",
      title: `${email.queued} messages stuck at QUEUED`,
      detail:
        "A message is written as QUEUED and updated moments later, so one that stays QUEUED means the request died in between.",
      action: "Check the function logs around the times these were created.",
    });
  }

  /**
   * ── The link-destination check ──
   *
   * Password reset and email verification links are built from this value. If
   * it does not match a host this deployment actually serves, the emails go
   * out looking perfectly healthy and send every recipient to the wrong place.
   */
  if (config.expectedHosts.length) {
    let host = "";
    try {
      host = new URL(config.appUrl).host.toLowerCase();
    } catch {
      host = "";
    }
    const known = config.expectedHosts.map((h) => h.toLowerCase());
    if (!host) {
      out.push({
        severity: "CRITICAL",
        area: "CONFIG",
        title: "NEXT_PUBLIC_APP_URL is not a valid URL",
        detail: `Every password-reset and verification link is built from this value, and it currently reads "${config.appUrl}".`,
        action: "Set it to the full https:// address this deployment serves, then redeploy.",
      });
    } else if (!known.includes(host)) {
      out.push({
        severity: "CRITICAL",
        area: "CONFIG",
        title: "Password reset links point at a different site",
        detail:
          `NEXT_PUBLIC_APP_URL is "${host}", which is not a host this deployment serves. ` +
          "Reset and verification emails send people there, so they land on a site that may be running older code — " +
          "and the link's token will not be valid there either.",
        action: `Set NEXT_PUBLIC_APP_URL to https://${known[0]} in Vercel, then redeploy.`,
      });
    }
  }

  /**
   * ── Where the CVs actually go ──
   *
   * Without BLOB_READ_WRITE_TOKEN, `storage.ts` falls back to writing files to
   * the function's local disk. On Vercel that filesystem is destroyed when the
   * instance shuts down, so every uploaded CV is deleted minutes later — while
   * the database row, the parse result and the candidate's profile all survive
   * and look completely healthy. A recruiter opening an application finds a
   * broken download and no explanation.
   *
   * Reported whenever it is wrong in production, not only once files exist:
   * the point is to catch it before the first candidate uploads, not after.
   */
  if (config.isProduction && !config.usingBlob) {
    out.push({
      severity: "CRITICAL",
      area: "STORAGE",
      title:
        input.resumesStored > 0
          ? `${input.resumesStored} uploaded CV${input.resumesStored === 1 ? " is" : "s are"} being written to disposable storage`
          : "Uploaded CVs will not survive",
      detail:
        "BLOB_READ_WRITE_TOKEN is not set, so resume files go to the function's local disk. " +
        "Vercel destroys that filesystem when the instance shuts down, usually within minutes. " +
        "The database row and the parsed profile survive, so nothing looks wrong until someone tries to open the file.",
      action: "Vercel → Storage → Create Database → Blob (Private), connected to this project. Then redeploy.",
    });
  }

  for (const s of input.failingSources) {
    out.push({
      severity: "WARNING",
      area: "INGESTION",
      title: `${s.name} is failing to sync`,
      detail: s.error.slice(0, 240),
      action: "Check the source on the Sources screen; a board that has moved or closed can be removed.",
    });
  }

  /**
   * ── A database a version behind the code ──
   *
   * This is worth a CRITICAL of its own because of how it PRESENTS. Nothing is
   * down. Pages load, the deck works, most of the app is fine — and then one
   * feature fails with an error that describes a query rather than a cause, and
   * whoever is looking at it reasonably concludes the feature is broken.
   *
   * It happened exactly that way: an administrator connected a careers page,
   * detection worked perfectly, and the save failed because the deployed code
   * knew a source kind the database had never been told about. The screen said
   * nothing useful, and there was no other place to look.
   *
   * A missing enum value is the cheapest possible signal of a missed migration,
   * and it is the whole answer: run the migration.
   */
  for (const drift of input.schemaDrift ?? []) {
    out.push({
      severity: "CRITICAL",
      area: "SCHEMA",
      title: `The database is behind the code (${drift.type})`,
      detail:
        `This deployment uses ${drift.missing.length === 1 ? "a value" : "values"} the database has never been told about: ` +
        `${drift.missing.join(", ")}. Anything that writes ${drift.missing.length === 1 ? "it" : "them"} fails, ` +
        "while the rest of the app looks healthy.",
      action:
        "Run the pending migration against this deployment's database: npx drizzle-kit migrate. " +
        "Check DATABASE_URL points at the same database the deployment uses — migrating a different one changes nothing here.",
    });
  }

  /**
   * Parse failures are counted as a RATE, not a total.
   *
   * A scanned PDF that cannot be read is an expected outcome and the candidate
   * is told so. Half of all uploads failing is a broken extractor.
   */
  if (input.resumeUploads >= 5) {
    const rate = input.resumeParseFailures / input.resumeUploads;
    if (rate > 0.4) {
      out.push({
        severity: "WARNING",
        area: "PARSING",
        title: `${Math.round(rate * 100)}% of resume uploads could not be read`,
        detail:
          "Scanned or image-only PDFs are expected to fail, but a rate this high usually means the extractor is broken rather than the files.",
        action: "Try uploading a known-good PDF and a known-good .docx.",
      });
    }
  }

  return out.sort((a, b) => (a.severity === "CRITICAL" ? -1 : 1) - (b.severity === "CRITICAL" ? -1 : 1));
}

/** Reads the environment for the caller, so route code stays thin. */
export function currentConfig(expectedHosts: string[]): HealthInput["config"] {
  return {
    emailEnabled: env.email.enabled,
    appUrl: env.appUrl,
    isProduction: process.env.NODE_ENV === "production",
    expectedHosts,
    usingBlob: usingBlob(),
  };
}
