import { wrongRoleMessage, type AppRole } from "@/lib/auth";
import { Icon, Logo } from "./Icon";

/**
 * AUTH-002 — what a candidate sees when they open an employer page.
 *
 * Deliberately NOT a 404 and NOT a silent redirect. A 404 says the page does
 * not exist, which is false and makes the product look broken. A silent bounce
 * says nothing at all, and the person tries again. Both leave someone assuming
 * they did something wrong.
 *
 * The rule is a product decision — one account is one side of the market — so
 * the page states the rule, and points at the way to get the other side.
 */
export default function WrongAccount({
  need,
  homeHref,
  homeLabel,
}: {
  need: AppRole;
  homeHref: string;
  homeLabel: string;
}) {
  return (
    <div className="shell">
      <header className="top">
        <a href={homeHref} className="logo">
          <Logo />
          <b>Jobsy</b>
        </a>
      </header>

      <div
        style={{
          margin: "48px auto",
          maxWidth: 460,
          padding: "28px 24px",
          textAlign: "center",
          color: "var(--txt)",
        }}
      >
        <div style={{ marginBottom: 12, color: "var(--gold)" }}><Icon name="key" size={38} /></div>
        <h3 style={{ margin: "0 0 10px" }}>
          {need === "RECRUITER" ? "Employer area" : "Job seeker area"}
        </h3>
        <p style={{ color: "var(--dim)", lineHeight: 1.6, margin: "0 0 22px" }}>
          {wrongRoleMessage(need)}
        </p>
        <a className="btn go" href={homeHref} style={{ display: "inline-block", maxWidth: 260 }}>
          {homeLabel}
        </a>
        <p style={{ color: "var(--dim)", fontSize: 12.5, marginTop: 20, lineHeight: 1.6 }}>
          Accounts are one or the other on purpose, so nobody is both applying
          for a role and screening people for it. You can sign up separately with
          a different email address.
        </p>
      </div>
    </div>
  );
}
