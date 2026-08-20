import { NextResponse } from "next/server";
import { promises as dns } from "node:dns";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, companies } from "@/db";
import { requireVerifiedUser, authErrorResponse } from "@/lib/auth";
import { domainOf, isFreeMailDomain, markVerified, requireCompanyAdmin } from "@/lib/company";
import { consumeToken, hashToken, issueToken, TTL } from "@/lib/tokens";
import { sendEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { consume, tooMany } from "@/lib/ratelimit";

/**
 * COMP-003 — company domain verification.
 *
 * Two paths, both proving control of the domain rather than mere assertion:
 *
 *   EMAIL — we send a link to an address at the claimed domain. Only someone
 *           who can read that mailbox can complete it.
 *   DNS   — the admin publishes a TXT record we generated. Only someone with
 *           control of the zone can complete it.
 *
 * AC-5 — free webmail and disposable domains are rejected on both paths.
 * Verifying "gmail.com" would let one person claim every Gmail user's employer.
 */

const StartBody = z.object({
  method: z.enum(["EMAIL", "DNS"]),
  /** Required for EMAIL. Must be at the claimed domain. */
  email: z.string().email().optional(),
  domain: z.string().min(3).max(191).optional(),
});

const DNS_PREFIX = "jobsy-verification=";

export async function POST(req: Request) {
  let me;
  try {
    me = await requireVerifiedUser();
  } catch (e) {
    return authErrorResponse(e)!;
  }
  let m;
  try {
    m = await requireCompanyAdmin(me.id);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message, code: "ADMIN_ONLY" }, { status: 403 });
  }

  const rl = await consume("write", me.id);
  if (!rl.ok) return tooMany(rl);

  const parsed = StartBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const [company] = await db.select().from(companies).where(eq(companies.id, m.companyId)).limit(1);
  if (company.verified) {
    return NextResponse.json({ ok: true, alreadyVerified: true });
  }

  if (parsed.data.method === "EMAIL") {
    const email = parsed.data.email?.toLowerCase().trim();
    if (!email) return NextResponse.json({ error: "An email address is required" }, { status: 400 });
    const domain = domainOf(email);
    if (!domain) return NextResponse.json({ error: "That address looks wrong" }, { status: 400 });

    if (isFreeMailDomain(domain)) {
      return NextResponse.json(
        {
          error:
            "Use an address at your company's own domain. A free webmail address doesn't prove you work somewhere.",
          code: "FREE_MAIL_DOMAIN",
        },
        { status: 400 }
      );
    }

    const { raw } = await issueToken({
      purpose: "DOMAIN_VERIFY",
      userId: me.id,
      email,
      context: { companyId: m.companyId, domain, method: "EMAIL" },
      ttlSec: TTL.DOMAIN_VERIFY,
    });

    await sendEmail({
      to: email,
      subject: `Verify ${company.name} on Jobsy`,
      text: `Confirm that you can receive email at ${domain} to verify ${company.name} on Jobsy:

  ${env.appUrl}/api/company/verify?token=${encodeURIComponent(raw)}

This link works once and expires in 7 days.`,
      template: "COMPANY_INVITE",
    });

    return NextResponse.json({ ok: true, method: "EMAIL", sentTo: email });
  }

  // ── DNS ──
  const domain = (parsed.data.domain ?? domainOf(me.email) ?? "").toLowerCase().trim();
  if (!domain) return NextResponse.json({ error: "A domain is required" }, { status: 400 });
  if (isFreeMailDomain(domain)) {
    return NextResponse.json(
      { error: "That domain can't be claimed by a single company.", code: "FREE_MAIL_DOMAIN" },
      { status: 400 }
    );
  }

  const { raw } = await issueToken({
    purpose: "DOMAIN_VERIFY",
    userId: me.id,
    context: { companyId: m.companyId, domain, method: "DNS" },
    ttlSec: TTL.DOMAIN_VERIFY,
  });

  // The raw token is the TXT value. It is never stored — only its hash is —
  // so this response is the one and only time it is shown.
  return NextResponse.json({
    ok: true,
    method: "DNS",
    domain,
    record: { type: "TXT", host: "@", value: `${DNS_PREFIX}${raw}` },
    instructions: `Add this TXT record to ${domain}, then call PUT on this endpoint. DNS can take up to an hour to propagate.`,
  });
}

/** Complete the EMAIL path. */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const out = await consumeToken(token, "DOMAIN_VERIFY");
  if (!out.ok) {
    return NextResponse.redirect(`${env.appUrl}/recruiter?verify=failed`);
  }
  const ctx = out.context as { companyId?: string; domain?: string } | null;
  if (!ctx?.companyId || !ctx.domain) {
    return NextResponse.redirect(`${env.appUrl}/recruiter?verify=failed`);
  }
  await markVerified(ctx.companyId, "EMAIL", ctx.domain, out.userId ?? "system");
  return NextResponse.redirect(`${env.appUrl}/recruiter?verify=1`);
}

/** Complete the DNS path — we look up the record ourselves. */
export async function PUT(req: Request) {
  let me;
  try {
    me = await requireVerifiedUser();
  } catch (e) {
    return authErrorResponse(e)!;
  }
  let m;
  try {
    m = await requireCompanyAdmin(me.id);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message, code: "ADMIN_ONLY" }, { status: 403 });
  }

  const rl = await consume("write", me.id);
  if (!rl.ok) return tooMany(rl);

  const body = (await req.json().catch(() => ({}))) as { domain?: string };
  const domain = (body.domain ?? "").toLowerCase().trim();
  if (!domain) return NextResponse.json({ error: "A domain is required" }, { status: 400 });

  let records: string[][];
  try {
    records = await dns.resolveTxt(domain);
  } catch (e) {
    return NextResponse.json(
      {
        error: `We couldn't read TXT records for ${domain}. If you've just added it, DNS can take up to an hour.`,
        detail: (e as Error).message,
        code: "DNS_LOOKUP_FAILED",
      },
      { status: 400 }
    );
  }

  // A domain can carry many TXT records — SPF, DKIM, other vendors. Check each,
  // and compare the HASH, since the raw token was never stored.
  const values = records.map((chunks) => chunks.join(""));
  const candidates = values
    .filter((v) => v.startsWith(DNS_PREFIX))
    .map((v) => v.slice(DNS_PREFIX.length).trim());

  if (!candidates.length) {
    return NextResponse.json(
      {
        error: `No Jobsy verification record found on ${domain}. Add the TXT record we gave you and try again.`,
        code: "RECORD_NOT_FOUND",
        found: values.length,
      },
      { status: 400 }
    );
  }

  for (const value of candidates) {
    const out = await consumeToken(value, "DOMAIN_VERIFY");
    if (!out.ok) continue;
    const ctx = out.context as { companyId?: string; domain?: string } | null;
    // A token issued for a different company or a different domain does not
    // verify this one, even though it is a valid token.
    if (ctx?.companyId !== m.companyId || ctx?.domain !== domain) continue;
    await markVerified(m.companyId, "DNS", domain, me.id);
    return NextResponse.json({ ok: true, verified: true, method: "DNS", domain });
  }

  return NextResponse.json(
    {
      error:
        "We found a Jobsy record but it doesn't match a live verification for this company. Start verification again to get a fresh value.",
      code: "RECORD_MISMATCH",
    },
    { status: 400 }
  );
}
