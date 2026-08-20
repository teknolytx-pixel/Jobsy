import type { Metadata } from "next";
import { CURRENT_PRIVACY } from "@/lib/legalVersions";
import { NEVER_USED } from "@/lib/compliance/aedtContent";

export const metadata: Metadata = { title: "Privacy Policy — Jobsy" };

/**
 * ⚠️ DRAFT — see the note in the page body and in JOBSY-PRIVACY-POLICY.md.
 *
 * Every right described here has a working mechanism behind it. That is not a
 * detail: a policy promising a deletion right that support cannot execute is a
 * deceptive practice under FTC Act § 5 and every state consumer protection act.
 */
export default function PrivacyPage() {
  return (
    <>
      <div className="note" style={{ marginBottom: 20 }}>
        <b>Draft — pending legal review.</b> Published so the consent flow is complete and testable.
        Replace with a counsel-reviewed version before opening to the public.
      </div>

      <h1 style={{ fontSize: 26, letterSpacing: "-.6px" }}>Privacy Policy</h1>
      <p style={{ color: "var(--dim)", fontSize: 13 }}>Version {CURRENT_PRIVACY}</p>

      <h2>The short version</h2>
      <ul>
        <li>We collect what you tell us, plus basic technical information about how you use Jobsy.</li>
        <li>
          <b>We do not sell your personal information</b>, and we do not share it for advertising.
        </li>
        <li>Recruiters see limited information before you match, and more once you both do.</li>
        <li>You control whether you appear at all.</li>
        <li>You can see, correct, download and delete your data, and turn off automated ranking.</li>
      </ul>

      <h2>What we collect</h2>
      <p>
        Your account details; your profile; your resume and what we read from it, with your
        approval; job postings you write; messages you send; and — optionally — two yes/no answers
        about work authorisation and a profile photo.
      </p>
      <p>
        <b>We never collect</b> your date of birth or age, gender, race or ethnicity, religion,
        disability status, precise or real-time location, government ID numbers, payment details,
        biometric data, health information, criminal history, or your previous salary.
      </p>

      <h2>Work authorisation</h2>
      <p>
        If you choose to answer, we hold exactly two yes/no answers: whether you are authorised to
        work in the US, and whether you will require sponsorship. <b>We never collect your visa
        category, country of citizenship, immigration status detail, or any document number</b>, and
        we never sell or share what you do tell us.
      </p>

      <h2>Automated matching</h2>
      <p>Our matching engine uses only five things:</p>
      <ol>
        <li>Required skills the posting asks for, against the skills on your profile</li>
        <li>Preferred (&quot;nice to have&quot;) skills</li>
        <li>Years of experience, against any minimum the posting states</li>
        <li>Compensation expectations, against the posted range</li>
        <li>Work-location preference, and whether a commute is feasible</li>
      </ol>
      <p>It never uses:</p>
      <ul>
        {NEVER_USED.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
      <p>
        This is enforced in our code, not only in this policy: the matching function cannot receive
        these fields, and an automated check runs on every change to confirm it.
      </p>
      <p>
        <b>A score does not decide anything.</b> You can see the explanation for any match, turn
        automated ranking off (we also honour Global Privacy Control signals from your browser), ask
        a person with authority to overturn an adverse outcome to review it, and correct your
        information and ask us to run it again.
      </p>

      <h2>Who sees what</h2>
      <p>
        Before you match, a recruiter sees your first name and last initial, headline, skills, years
        of experience, city, remote preference and a short bio extract.{" "}
        <b>Not your email, not your resume, and never your exact address.</b> After you both express
        interest, they see your full name, email and resume.
      </p>
      <p>Turning off &quot;Open to offers&quot; removes you from every recruiter&apos;s view.</p>

      <h2>Your rights</h2>
      <p>
        <b>We give these rights to everyone in the United States, whichever state you live in.</b>{" "}
        Giving people different rights based on their address is hard to defend.
      </p>
      <ul>
        <li>See and download everything we hold — including the match scores we derived about you</li>
        <li>Correct anything inaccurate</li>
        <li>Delete your account and have your personal data erased within 30 days</li>
        <li>Turn off automated ranking, and still see jobs</li>
        <li>Ask a person to review an adverse automated outcome</li>
        <li>Appeal if we refuse a request</li>
      </ul>
      <p>
        We respond within 45 days, and within 15 days for an opt-out — in practice, immediately.{" "}
        <b>We will never treat you worse for exercising any of these.</b>
      </p>

      <h2>How long we keep things</h2>
      <p>
        Your account data for as long as your account is open. Matching and automated-decision
        records for 4 years, and notice records for at least 3 — both required by law. Email logs
        for 24 months. Security logs for 12 months. Deleted account data is erased within 30 days.
      </p>

      <h2>Security</h2>
      <p>
        Encryption in transit and at rest, hashed passwords, HTTP-only signed session cookies, and
        short-lived signed links for resume files — resume files are never publicly readable. No
        system is perfect; if a breach affects you we will tell you.
      </p>

      <h2>Children</h2>
      <p>Jobsy is for people aged 18 and over.</p>
    </>
  );
}
