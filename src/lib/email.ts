import { eq } from "drizzle-orm";
import { db, emailLogs, type EmailTemplate } from "@/db";
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
export async function sendEmail(args: SendArgs): Promise<{ id: string; delivered: boolean }> {
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
const band = (min: number | null, max: number | null) =>
  min && max ? `$${min}k–$${max}k` : min ? `from $${min}k` : max ? `up to $${max}k` : "not disclosed";

const wrap = (title: string, inner: string) => `<!doctype html><html><body style="margin:0;background:#f5f6fa;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 14px">
<table width="100%" style="max-width:520px;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e6e8f0">
<tr><td style="padding:18px 24px;background:linear-gradient(135deg,#ff4d6d,#ff8a5b);color:#fff;font-weight:800;font-size:18px">🔥 Jobsy</td></tr>
<tr><td style="padding:24px"><h1 style="margin:0 0 12px;font-size:20px;color:#12141c">${title}</h1>${inner}</td></tr>
<tr><td style="padding:14px 24px;background:#fafbff;color:#8b91a7;font-size:11px;border-top:1px solid #eef0f7">
Sent by Jobsy because of a swipe on your account.</td></tr></table></td></tr></table></body></html>`;

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
