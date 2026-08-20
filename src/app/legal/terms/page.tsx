import type { Metadata } from "next";
import { CURRENT_TERMS } from "@/lib/legalVersions";

export const metadata: Metadata = { title: "Terms of Service — Jobsy" };

/**
 * LEGAL-009 — the document the signup checkbox points at.
 *
 * ⚠️ This is the DRAFT delivered as JOBSY-TERMS-OF-SERVICE.md, rendered so the
 * clickwrap link is not dead. It has NOT been reviewed by counsel, and the
 * bracketed items in that document are still open. Do not open signups to the
 * public against this text.
 */
export default function TermsPage() {
  return (
    <>
      <div className="note" style={{ marginBottom: 20 }}>
        <b>Draft — pending legal review.</b> This text is a working draft. It is published so the
        product's consent flow is complete and testable, and must be replaced with a
        counsel-reviewed version before Jobsy is opened to the public.
      </div>

      <h1 style={{ fontSize: 26, letterSpacing: "-.6px" }}>Terms of Service</h1>
      <p style={{ color: "var(--dim)", fontSize: 13 }}>Version {CURRENT_TERMS}</p>

      <h2>1. What Jobsy is — and what it is not</h2>
      <p>
        Jobsy is a two-sided matching platform. Candidates create a profile and review job
        opportunities. Employers and recruiters post roles and review candidates. When both sides
        express interest, we introduce them and give them a channel to talk.
      </p>
      <p>
        <b>Jobsy is not your employer</b>, is not a party to any hiring decision, does not guarantee
        that anyone will be interviewed or hired, does not conduct background checks, and does not
        independently verify that every posting or profile is accurate.
      </p>

      <h2>2. Who can use it</h2>
      <p>
        You must be at least 18, able to enter a binding contract, and not previously removed from
        Jobsy. If you use Jobsy on behalf of an employer, you confirm you are authorised to do so.
      </p>

      <h2>3. What you must not do</h2>
      <ul>
        <li>Post a role that is not a current, genuine, open vacancy you may advertise.</li>
        <li>
          Post anything expressing a preference or limitation based on a protected characteristic,
          absent a documented bona fide occupational qualification.
        </li>
        <li>
          Ask a candidate for money, payment details, gift cards, cryptocurrency, bank details or a
          Social Security number. <b>Jobsy will never ask a candidate to pay for a job, and no
          legitimate employer will either.</b>
        </li>
        <li>Harass, threaten, defame or abuse anyone.</li>
        <li>Scrape the service or build a database from it.</li>
        <li>
          Use candidate information for anything other than recruiting for the specific roles you
          posted. It may not be sold, licensed or added to another product.
        </li>
      </ul>

      <h2>4. Your content</h2>
      <p>
        You keep ownership of everything you write. You give us a licence to host and display it{" "}
        <b>solely to run the service for you and the people you choose to interact with</b>. That
        licence ends when you delete the content or your account. <b>We do not sell your content or
        your personal information.</b>
      </p>

      <h2>5. Matching and automated processing</h2>
      <p>
        We use an automated matching system. It compares the skills, experience, compensation
        expectations and work-location preference in a profile against what a posting asks for, and
        produces a score with a written explanation.
      </p>
      <p>
        <b>It never uses</b> your name, photograph, school, graduation year, age, gender, race,
        religion, disability, citizenship or immigration status, marital or family status, exact
        address or ZIP code, or any inference of these. Location is used only to work out whether a
        commute is feasible.
      </p>
      <p>
        <b>A score does not accept or reject anyone.</b> It orders suggestions. Every hiring
        decision is the employer&apos;s.
      </p>
      <p>
        You can see the explanation for any match, turn automated ranking off, ask a person to
        review an adverse outcome, and correct your information and ask us to try again. The details
        are in our <a href="/legal/aedt">Automated Employment Decision Tool Notice</a>.
      </p>

      <h2>6. Job postings</h2>
      <p>
        Each time you post a role you confirm it is a current, open vacancy you are authorised to
        advertise. Where the law requires it, a good-faith compensation range — and sometimes a
        benefits description — must be included; we will not publish a covered posting without one.
        You must close a posting once the role is filled, and we may close postings you do not
        confirm.
      </p>

      <h2>7. Fees</h2>
      <p>
        <b>Jobsy is free for job seekers, and always will be.</b> We do not charge candidates to
        create a profile, browse roles, match, message or apply.
      </p>

      <h2>8. Ending your account</h2>
      <p>
        You can close your account at any time from your settings. We may suspend or end access if
        you break these terms or put other people at risk; where we can, we will tell you why.
      </p>

      <h2>9. Disclaimers and liability</h2>
      <p>
        The service is provided &quot;as is&quot;. We do not warrant that any candidate will be
        hired, that any posting is genuine, or that any score predicts job performance.{" "}
        <b>You interact with other people at your own risk</b> — please use the reporting and
        blocking tools if anything concerns you. Our liability is limited to the extent the law
        allows, except for gross negligence, wilful misconduct or fraud.
      </p>

      <h2>10. Disputes</h2>
      <p>
        <b>These terms include an arbitration agreement and a class action waiver.</b> Before
        starting arbitration, we both agree to try to resolve things informally for 60 days.{" "}
        <b>You may opt out of arbitration</b> by writing to us within 30 days of accepting these
        terms — opting out will not affect your account in any way. Nothing here stops you filing a
        charge with a government agency.
      </p>

      <h2>11. Intellectual property</h2>
      <p>
        The service, its software, its matching engine and the Jobsy name are ours.{" "}
        <b>Jobsy was founded and originated by Vinodh Vemireddy.</b>
      </p>

      <h2>12. Changes</h2>
      <p>
        For material changes we will give you at least 30 days&apos; notice and ask you to accept
        the new terms before continuing.
      </p>

      <h2>13. Accessibility</h2>
      <p>
        Jobsy is built to conform to WCAG 2.1 Level AA. If you hit a barrier, tell us and we will
        get you the information or functionality you need.
      </p>
    </>
  );
}
