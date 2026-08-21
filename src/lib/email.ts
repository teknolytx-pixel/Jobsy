import { eq } from "drizzle-orm";
import { db, emailLogs, notificationPrefs, users, type EmailTemplate } from "@/db";
import { env } from "./env";

export type SendArgs = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  template: EmailTemplate;
};

/**
 * Every send is persisted to email_logs first, so nothing is lost and the app
 * is fully testable with no provider key. Without RESEND_API_KEY the message is
 * written to the DB + stdout and marked LOGGED_ONLY.
 */
/**
 * MATCH-006 / §17 — which templates a person can switch off.
 *
 * The `notification_prefs` table has existed since NOTIF-001, complete with an
 * unsubscribe token, and `sendEmail()` never once consulted it. Every email
 * carried a "manage your preferences" link, the preferences were real rows in a
 * real table, and nothing read them — so the link was a promise the product did
 * not keep.
 *
 * TRANSACTIONAL templates are deliberately absent from this map and are always
 * sent. Verifying an address, resetting a password, being told your password
 * changed, or being handed a data export you asked for are not marketing: CAN-SPAM
 * exempts transactional mail from opt-out, and suppressing a security notice
 * because someone unticked a box is how an account takeover goes unnoticed.
 */
const PREF_FOR_TEMPLATE: Partial<Record<EmailTemplate, keyof typeof PREF_COLUMNS>> = {
  MATCH_CANDIDATE: "newMatch",
  MATCH_RECRUITER: "newMatch",
  NEW_MESSAGE: "newMessage",
  RECRUITER_INTEREST: "recruiterInterest",
  APPLICATION_RECEIVED: "applicationStatus",
  JOB_EXPIRY_WARNING: "productUpdates",
  SOURCE_DISABLED: "productUpdates",
};

const PREF_COLUMNS = {
  newMatch: notificationPrefs.newMatch,
  newMessage: notificationPrefs.newMessage,
  recruiterInterest: notificationPrefs.recruiterInterest,
  applicationStatus: notificationPrefs.applicationStatus,
  jobAlerts: notificationPrefs.jobAlerts,
  productUpdates: notificationPrefs.productUpdates,
} as const;

/**
 * True when this address has switched this category off, or unsubscribed from
 * everything. Unknown addresses are allowed through: absence of a preference
 * row is not consent withdrawn, and refusing to email people we have no row for
 * would silently break signup.
 */
async function suppressedFor(to: string, template: EmailTemplate): Promise<boolean> {
  const key = PREF_FOR_TEMPLATE[template];
  if (!key) return false; // transactional — always sent

  const rows = await db
    .select({
      allowed: PREF_COLUMNS[key],
      suppressedAt: notificationPrefs.suppressedAt,
    })
    .from(notificationPrefs)
    .innerJoin(users, eq(users.id, notificationPrefs.userId))
    .where(eq(users.email, to.toLowerCase()))
    .limit(1);

  const row = rows[0];
  if (!row) return false;
  return Boolean(row.suppressedAt) || row.allowed === false;
}

export async function sendEmail(args: SendArgs): Promise<{ id: string; delivered: boolean }> {
  // Checked before the row is written, and recorded as its own status so an
  // unsent email is visibly a choice rather than a delivery failure.
  if (await suppressedFor(args.to, args.template).catch(() => false)) {
    const [skipped] = await db
      .insert(emailLogs)
      .values({
        to: args.to,
        subject: args.subject,
        body: args.text,
        template: args.template,
        status: "SUPPRESSED",
      })
      .returning();
    return { id: skipped.id, delivered: false };
  }

  const [log] = await db
    .insert(emailLogs)
    .values({
      to: args.to,
      subject: args.subject,
      body: args.text,
      template: args.template,
      status: "QUEUED",
    })
    .returning();

  if (!env.email.enabled) {
    await db.update(emailLogs).set({ status: "LOGGED_ONLY" }).where(eq(emailLogs.id, log.id));
    console.log(
      `\n──────── EMAIL (not sent — no RESEND_API_KEY) ────────\n` +
        `To:      ${args.to}\nSubject: ${args.subject}\n\n${args.text}\n` +
        `─────────────────────────────────────────────────────\n`
    );
    return { id: log.id, delivered: false };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.email.resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.email.from,
        to: [args.to],
        subject: args.subject,
        text: args.text,
        ...(args.html ? { html: args.html } : {}),
      }),
    });

    if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { id?: string };
    await db
      .update(emailLogs)
      .set({ status: "SENT", providerId: body.id ?? null })
      .where(eq(emailLogs.id, log.id));
    return { id: log.id, delivered: true };
  } catch (e) {
    await db
      .update(emailLogs)
      .set({ status: "FAILED", error: (e as Error).message })
      .where(eq(emailLogs.id, log.id));
    console.error("[email] send failed:", (e as Error).message);
    return { id: log.id, delivered: false };
  }
}

// ─────────────────────────────────────────────────────────────
// TEMPLATES
// ─────────────────────────────────────────────────────────────
/** LEGAL-007 — required on every commercial message. */
export const POSTAL_ADDRESS =
  process.env.COMPANY_POSTAL_ADDRESS ?? "[Set COMPANY_POSTAL_ADDRESS in your environment]";

const band = (min: number | null, max: number | null) =>
  min && max ? `$${min}k–$${max}k` : min ? `from $${min}k` : max ? `up to $${max}k` : "not disclosed";

const wrap = (title: string, inner: string) => `<!doctype html><html><body style="margin:0;background:#f5f6fa;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 14px">
<table width="100%" style="max-width:520px;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e6e8f0">
<tr><td style="padding:18px 24px;background:linear-gradient(135deg,#ff4d6d,#ff8a5b);color:#fff;font-weight:800;font-size:18px">🔥 Jobsy</td></tr>
<tr><td style="padding:24px"><h1 style="margin:0 0 12px;font-size:20px;color:#12141c">${title}</h1>${inner}</td></tr>
<tr><td style="padding:14px 24px;background:#fafbff;color:#8b91a7;font-size:11px;border-top:1px solid #eef0f7;line-height:1.6">
You received this because you have a Jobsy account and someone swiped on it.<br>
<a href="${env.appUrl}/settings/notifications" style="color:#8b91a7">Manage your email preferences or unsubscribe</a><br>
${POSTAL_ADDRESS}</td></tr></table></td></tr></table></body></html>`;

const btn = (href: string, label: string, color = "#ff4d6d") =>
  `<a href="${href}" style="display:inline-block;padding:12px 22px;background:${color};color:#fff;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px">${label}</a>`;

type RecruiterInterestArgs = {
  candidateName: string;
  candidateEmail: string;
  recruiterName: string;
  companyName: string;
  jobTitle: string;
  jobLocation: string;
  jobRemote: string;
  salaryMin: number | null;
  salaryMax: number | null;
  sharedSkills: string[];
  score: number;
  acceptUrl: string;
  declineUrl: string;
};

/** Spec #6: recruiter swipes right → candidate is asked if they're interested. */
export function recruiterInterestEmail(a: RecruiterInterestArgs): SendArgs {
  const first = a.candidateName.split(" ")[0];
  const text = `Hi ${first},

${a.recruiterName} at ${a.companyName} saw your Jobsy profile and thinks you're a strong fit for:

  ${a.jobTitle}
  ${a.jobLocation} · ${a.jobRemote} · ${band(a.salaryMin, a.salaryMax)}

Why you (${a.score}% match): ${a.sharedSkills.slice(0, 4).join(", ") || "your background"}.

Are you interested in moving forward with this role?

  Yes, I'm interested:  ${a.acceptUrl}
  Not right now:        ${a.declineUrl}

If you say yes it becomes a match, and you and ${a.recruiterName.split(" ")[0]} can message
each other directly in Jobsy.

— Jobsy`;

  return {
    to: a.candidateEmail,
    subject: `${a.companyName} is interested — ${a.jobTitle}`,
    text,
    html: wrap(
      `${a.companyName} is interested in you`,
      `<p style="color:#4a4f63;font-size:14px;line-height:1.6;margin:0 0 16px">
        <b>${a.recruiterName}</b> at <b>${a.companyName}</b> saw your profile and thinks you're a strong fit for:</p>
       <div style="border:1px solid #e6e8f0;border-radius:12px;padding:14px 16px;margin-bottom:16px">
         <div style="font-weight:700;font-size:15px;color:#12141c">${a.jobTitle}</div>
         <div style="color:#6b7186;font-size:13px;margin-top:4px">${a.jobLocation} · ${a.jobRemote} · ${band(a.salaryMin, a.salaryMax)}</div>
         <div style="margin-top:10px;font-size:12px;color:#22a06b;font-weight:700">${a.score}% match — ${a.sharedSkills.slice(0, 4).join(", ") || "strong background fit"}</div>
       </div>
       <p style="color:#4a4f63;font-size:14px;margin:0 0 16px">Interested in moving forward?</p>
       <p style="margin:0">${btn(a.acceptUrl, "Yes, I'm interested", "#22a06b")}&nbsp;&nbsp;${btn(a.declineUrl, "Not right now", "#8b91a7")}</p>`
    ),
    template: "RECRUITER_INTEREST",
  };
}

type ApplicationArgs = {
  to: string;
  recruiterName: string;
  candidateName: string;
  candidateEmail: string;
  candidateHeadline: string;
  candidateLocation: string;
  candidateYears: number;
  availability: string;
  sharedSkills: string[];
  score: number;
  jobTitle: string;
  profileUrl: string;
};

/** Spec #7: candidate uses Easy Apply → the poster gets the profile instantly. */
export function applicationEmail(a: ApplicationArgs): SendArgs {
  const text = `Hi ${a.recruiterName.split(" ")[0]},

${a.candidateName} applied to ${a.jobTitle} via Jobsy Easy Apply.

  ${a.candidateHeadline}
  ${a.candidateYears} yrs · ${a.candidateLocation} · available ${a.availability}
  ${a.score}% match — ${a.sharedSkills.slice(0, 5).join(", ") || "see profile"}
  Reply directly: ${a.candidateEmail}

Full profile: ${a.profileUrl}

— Jobsy`;

  return {
    to: a.to,
    subject: `New applicant: ${a.candidateName} — ${a.jobTitle}`,
    text,
    html: wrap(
      `New applicant for ${a.jobTitle}`,
      `<div style="border:1px solid #e6e8f0;border-radius:12px;padding:14px 16px;margin-bottom:16px">
         <div style="font-weight:700;font-size:15px;color:#12141c">${a.candidateName}</div>
         <div style="color:#6b7186;font-size:13px;margin-top:4px">${a.candidateHeadline}</div>
         <div style="color:#6b7186;font-size:13px;margin-top:6px">${a.candidateYears} yrs · ${a.candidateLocation} · available ${a.availability}</div>
         <div style="margin-top:10px;font-size:12px;color:#22a06b;font-weight:700">${a.score}% match — ${a.sharedSkills.slice(0, 5).join(", ")}</div>
       </div>
       <p style="margin:0">${btn(a.profileUrl, "View full profile")}</p>`
    ),
    template: "APPLICATION_RECEIVED",
  };
}

type MatchArgs = {
  to: string;
  toName: string;
  otherName: string;
  jobTitle: string;
  companyName: string;
  chatUrl: string;
  forCandidate: boolean;
};

export function matchEmail(a: MatchArgs): SendArgs {
  const text = `${a.toName.split(" ")[0]} — it's a match! 🔥

You and ${a.otherName} both swiped right on ${a.jobTitle} at ${a.companyName}.

Chat is now open: ${a.chatUrl}

— Jobsy`;

  return {
    to: a.to,
    subject: `It's a match — ${a.jobTitle} at ${a.companyName}`,
    text,
    html: wrap(
      "It's a match! 🔥",
      `<p style="color:#4a4f63;font-size:14px;line-height:1.6;margin:0 0 16px">
        You and <b>${a.otherName}</b> both swiped right on <b>${a.jobTitle}</b> at <b>${a.companyName}</b>.</p>
       <p style="margin:0">${btn(a.chatUrl, "Open the conversation")}</p>`
    ),
    template: a.forCandidate ? "MATCH_CANDIDATE" : "MATCH_RECRUITER",
  };
}

// ═════════════════════════════════════════════════════════════
// PRD v1.0 — transactional templates
//
// LEGAL-007. The four templates below (verify, reset, changed, invite) are
// genuinely transactional under CAN-SPAM: each confirms or enables a
// transaction the recipient initiated. They carry the sender's identity and
// postal address but no unsubscribe link, because a user cannot opt out of
// being able to reset their own password.
//
// Everything else — match notifications, recruiter interest, digests — is
// treated as COMMERCIAL and carries a full footer. The primary-purpose test is
// fact-bound and we are not going to win it on a digest that also markets the
// platform.
// ═════════════════════════════════════════════════════════════


const commercialFooterText = (unsubUrl: string) => `

---
You received this because you have a Jobsy account.
Manage what we send you, or unsubscribe: ${unsubUrl}
${POSTAL_ADDRESS}`;

const commercialFooterHtml = (unsubUrl: string) =>
  `<tr><td style="padding:14px 24px;background:#fafbff;color:#8b91a7;font-size:11px;border-top:1px solid #eef0f7;line-height:1.6">
You received this because you have a Jobsy account.<br>
<a href="${unsubUrl}" style="color:#8b91a7">Manage your email preferences or unsubscribe</a><br>
${POSTAL_ADDRESS}</td></tr>`;

const transactionalFooterText = `

---
This is an automated security message about your Jobsy account.
${POSTAL_ADDRESS}`;

const plain = (title: string, inner: string, footer: string) =>
  `<!doctype html><html><body style="margin:0;background:#f5f6fa;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 14px">
<table width="100%" style="max-width:520px;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e6e8f0">
<tr><td style="padding:18px 24px;background:linear-gradient(135deg,#ff4d6d,#ff8a5b);color:#fff;font-weight:800;font-size:18px">🔥 Jobsy</td></tr>
<tr><td style="padding:24px"><h1 style="margin:0 0 12px;font-size:20px;color:#12141c">${title}</h1>${inner}</td></tr>
${footer}</table></td></tr></table></body></html>`;

const txFooterHtml = `<tr><td style="padding:14px 24px;background:#fafbff;color:#8b91a7;font-size:11px;border-top:1px solid #eef0f7;line-height:1.6">
This is an automated security message about your Jobsy account.<br>${POSTAL_ADDRESS}</td></tr>`;

/** Escape user-controlled text before it goes into an HTML email body. */
export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** AUTH-006 */
export function verifyEmailTemplate(a: { to: string; name: string; url: string }): SendArgs {
  const first = esc(a.name.split(" ")[0] ?? "there");
  return {
    to: a.to,
    subject: "Verify your email address",
    text: `Hi ${a.name.split(" ")[0]},

Confirm your email address to finish setting up your Jobsy account:

  ${a.url}

This link works once and expires in 24 hours.

If you didn't create a Jobsy account, you can ignore this — nothing will happen.${transactionalFooterText}`,
    html: plain(
      "Verify your email address",
      `<p style="color:#4a4f63;font-size:14px;line-height:1.6;margin:0 0 16px">Hi ${first} — confirm your email address to finish setting up your account.</p>
       <p style="margin:0 0 16px">${btn(a.url, "Verify my email")}</p>
       <p style="color:#8b91a7;font-size:12px;margin:0">This link works once and expires in 24 hours. If you didn't create a Jobsy account, you can ignore this.</p>`,
      txFooterHtml
    ),
    template: "VERIFY_EMAIL",
  };
}

/** AUTH-007 */
export function passwordResetTemplate(a: { to: string; name: string; url: string }): SendArgs {
  const first = esc(a.name.split(" ")[0] ?? "there");
  return {
    to: a.to,
    subject: "Reset your Jobsy password",
    text: `Hi ${a.name.split(" ")[0]},

Someone asked to reset the password for this Jobsy account. If it was you:

  ${a.url}

This link works once and expires in 1 hour. Resetting your password will sign
you out everywhere.

If it wasn't you, ignore this email — your password has not changed.${transactionalFooterText}`,
    html: plain(
      "Reset your password",
      `<p style="color:#4a4f63;font-size:14px;line-height:1.6;margin:0 0 16px">Hi ${first} — someone asked to reset the password for this account.</p>
       <p style="margin:0 0 16px">${btn(a.url, "Reset my password")}</p>
       <p style="color:#8b91a7;font-size:12px;margin:0">This link works once and expires in 1 hour, and resetting will sign you out everywhere. If it wasn't you, ignore this email — your password has not changed.</p>`,
      txFooterHtml
    ),
    template: "PASSWORD_RESET",
  };
}

/** AUTH-007 AC-5 / AUTH-010 — always tell the account owner. */
export function passwordChangedTemplate(a: { to: string; name: string; when: Date }): SendArgs {
  return {
    to: a.to,
    subject: "Your Jobsy password was changed",
    text: `Hi ${a.name.split(" ")[0]},

The password on your Jobsy account was changed on ${a.when.toUTCString()}.
Every other session was signed out.

If this wasn't you, reset your password immediately at ${env.appUrl}/login
and contact us.${transactionalFooterText}`,
    html: plain(
      "Your password was changed",
      `<p style="color:#4a4f63;font-size:14px;line-height:1.6;margin:0 0 16px">The password on your Jobsy account was changed on <b>${esc(a.when.toUTCString())}</b>. Every other session was signed out.</p>
       <p style="color:#4a4f63;font-size:14px;margin:0 0 16px">If this wasn't you, reset your password immediately and contact us.</p>
       <p style="margin:0">${btn(`${env.appUrl}/login`, "Go to Jobsy")}</p>`,
      txFooterHtml
    ),
    template: "PASSWORD_CHANGED",
  };
}

/** SEAT-002 */
export function companyInviteTemplate(a: {
  to: string;
  companyName: string;
  inviterName: string;
  seatRole: string;
  url: string;
}): SendArgs {
  return {
    to: a.to,
    subject: `${a.inviterName} invited you to join ${a.companyName} on Jobsy`,
    text: `${a.inviterName} invited you to join ${a.companyName} on Jobsy as a ${a.seatRole === "COMPANY_ADMIN" ? "company admin" : "recruiter"}.

Accept the invitation:

  ${a.url}

This link works once and expires in 7 days.${transactionalFooterText}`,
    html: plain(
      `Join ${esc(a.companyName)} on Jobsy`,
      `<p style="color:#4a4f63;font-size:14px;line-height:1.6;margin:0 0 16px"><b>${esc(a.inviterName)}</b> invited you to join <b>${esc(a.companyName)}</b> as a ${a.seatRole === "COMPANY_ADMIN" ? "company admin" : "recruiter"}.</p>
       <p style="margin:0 0 16px">${btn(a.url, "Accept invitation")}</p>
       <p style="color:#8b91a7;font-size:12px;margin:0">This link works once and expires in 7 days.</p>`,
      txFooterHtml
    ),
    template: "COMPANY_INVITE",
  };
}

/** MSG-003 — commercial: full footer. */
export function newMessageTemplate(a: {
  to: string;
  toName: string;
  fromName: string;
  jobTitle: string;
  preview: string;
  chatUrl: string;
  unsubUrl: string;
}): SendArgs {
  return {
    to: a.to,
    subject: `${a.fromName} sent you a message about ${a.jobTitle}`,
    text: `${a.toName.split(" ")[0]},

${a.fromName} sent you a message about ${a.jobTitle}:

  "${a.preview}"

Reply: ${a.chatUrl}${commercialFooterText(a.unsubUrl)}`,
    html: plain(
      "You have a new message",
      `<p style="color:#4a4f63;font-size:14px;line-height:1.6;margin:0 0 8px"><b>${esc(a.fromName)}</b> sent you a message about <b>${esc(a.jobTitle)}</b>:</p>
       <blockquote style="margin:0 0 16px;padding:12px 14px;border-left:3px solid #ff4d6d;background:#fafbff;color:#4a4f63;font-size:14px">${esc(a.preview)}</blockquote>
       <p style="margin:0">${btn(a.chatUrl, "Reply")}</p>`,
      commercialFooterHtml(a.unsubUrl)
    ),
    template: "NEW_MESSAGE",
  };
}

/** JOB-003 AC-3 / TRUST-001 — the ghost-jobs prompt. */
export function jobExpiryWarningTemplate(a: {
  to: string;
  recruiterName: string;
  jobTitle: string;
  confirmUrl: string;
  closeUrl: string;
  daysLeft: number;
}): SendArgs {
  return {
    to: a.to,
    subject: `Is "${a.jobTitle}" still open?`,
    text: `Hi ${a.recruiterName.split(" ")[0]},

Your posting "${a.jobTitle}" hasn't been updated in a while, so we'll close it
in ${a.daysLeft} days unless you confirm it's still open.

  Still open, keep it live:  ${a.confirmUrl}
  It's filled, close it:     ${a.closeUrl}

We ask because several states require a job advertisement to correspond to a
real, current vacancy — and because candidates deserve to know a role is live
before they spend time on it.${transactionalFooterText}`,
    html: plain(
      `Is "${esc(a.jobTitle)}" still open?`,
      `<p style="color:#4a4f63;font-size:14px;line-height:1.6;margin:0 0 16px">Your posting hasn't been updated in a while, so we'll close it in <b>${a.daysLeft} days</b> unless you confirm it's still open.</p>
       <p style="margin:0 0 16px">${btn(a.confirmUrl, "Still open", "#22a06b")}&nbsp;&nbsp;${btn(a.closeUrl, "It's filled — close it", "#8b91a7")}</p>
       <p style="color:#8b91a7;font-size:12px;margin:0">Several states require a job advertisement to correspond to a real, current vacancy.</p>`,
      txFooterHtml
    ),
    template: "JOB_EXPIRY_WARNING",
  };
}

/** ING-007 AC-3 */
export function sourceDisabledTemplate(a: {
  to: string;
  companyName: string;
  lastError: string;
  url: string;
}): SendArgs {
  return {
    to: a.to,
    subject: `Jobsy stopped syncing jobs from ${a.companyName}`,
    text: `We tried to sync jobs from ${a.companyName} three times in a row and each
attempt failed, so we've paused it rather than keep retrying.

Last error: ${a.lastError}

Your already-imported jobs are untouched. Reconnect when you're ready:

  ${a.url}${transactionalFooterText}`,
    html: plain(
      `Job sync paused for ${esc(a.companyName)}`,
      `<p style="color:#4a4f63;font-size:14px;line-height:1.6;margin:0 0 12px">We tried three times in a row and each attempt failed, so we've paused syncing rather than keep retrying.</p>
       <p style="color:#8b91a7;font-size:12px;margin:0 0 16px;font-family:monospace">${esc(a.lastError)}</p>
       <p style="color:#4a4f63;font-size:14px;margin:0 0 16px">Your already-imported jobs are untouched.</p>
       <p style="margin:0">${btn(a.url, "Reconnect")}</p>`,
      txFooterHtml
    ),
    template: "SOURCE_DISABLED",
  };
}

/** TRUST-002 AC-5 */
export function reportAcknowledgedTemplate(a: { to: string; kind: string; ref: string }): SendArgs {
  return {
    to: a.to,
    subject: "We received your report",
    text: `Thanks for reporting this. Our reference is ${a.ref}.

We review every report. We'll let you know the outcome, though we may not be
able to share details about another person's account.

If you're in immediate danger, contact your local emergency services.${transactionalFooterText}`,
    html: plain(
      "We received your report",
      `<p style="color:#4a4f63;font-size:14px;line-height:1.6;margin:0 0 12px">Thanks for reporting this. Our reference is <b>${esc(a.ref)}</b>.</p>
       <p style="color:#4a4f63;font-size:14px;line-height:1.6;margin:0">We review every report. We'll let you know the outcome, though we may not be able to share details about another person's account.</p>`,
      txFooterHtml
    ),
    template: "REPORT_ACKNOWLEDGED",
  };
}

/** XPLAIN-004 AC-4/5 — the outcome of a human review. */
export function humanReviewOutcomeTemplate(a: {
  to: string;
  name: string;
  outcome: string;
  reasoning: string;
}): SendArgs {
  return {
    to: a.to,
    subject: "The outcome of your review request",
    text: `Hi ${a.name.split(" ")[0]},

You asked a person to review an automated outcome on your Jobsy account. A
member of our team has done that, and here is what they decided.

Outcome: ${a.outcome}

Reasoning: ${a.reasoning}

If you'd like to give us more information, reply to this email.${transactionalFooterText}`,
    html: plain(
      "Your review request",
      `<p style="color:#4a4f63;font-size:14px;line-height:1.6;margin:0 0 12px">A member of our team reviewed the automated outcome you asked us about.</p>
       <p style="color:#12141c;font-size:14px;margin:0 0 8px"><b>Outcome:</b> ${esc(a.outcome)}</p>
       <p style="color:#4a4f63;font-size:14px;line-height:1.6;margin:0 0 16px"><b>Reasoning:</b> ${esc(a.reasoning)}</p>
       <p style="color:#8b91a7;font-size:12px;margin:0">If you'd like to give us more information, reply to this email.</p>`,
      txFooterHtml
    ),
    template: "HUMAN_REVIEW_OUTCOME",
  };
}

/** AUTH-012 AC-5 */
export function dataExportReadyTemplate(a: {
  to: string;
  name: string;
  url: string;
  expiresAt: Date;
}): SendArgs {
  return {
    to: a.to,
    subject: "Your Jobsy data export is ready",
    text: `Hi ${a.name.split(" ")[0]},

Your data export is ready. It contains everything we hold about you, including
the match scores we derived.

  ${a.url}

This link expires on ${a.expiresAt.toUTCString()} for your security.${transactionalFooterText}`,
    html: plain(
      "Your data export is ready",
      `<p style="color:#4a4f63;font-size:14px;line-height:1.6;margin:0 0 16px">It contains everything we hold about you, including the match scores we derived.</p>
       <p style="margin:0 0 16px">${btn(a.url, "Download my data")}</p>
       <p style="color:#8b91a7;font-size:12px;margin:0">This link expires on ${esc(a.expiresAt.toUTCString())} for your security.</p>`,
      txFooterHtml
    ),
    template: "DATA_EXPORT_READY",
  };
}
