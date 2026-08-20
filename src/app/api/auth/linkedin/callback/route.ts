import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { deliverAedtNotice } from "@/lib/compliance/aedt";
import {
  createSession,
  exchangeLinkedInCode,
  setSessionCookie,
  upsertUserFromLinkedIn,
} from "@/lib/auth";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const err = url.searchParams.get("error");

  const fail = (msg: string) =>
    NextResponse.redirect(`${env.appUrl}/login?error=${encodeURIComponent(msg)}`);

  if (err) return fail(url.searchParams.get("error_description") ?? err);
  if (!code) return fail("LinkedIn did not return an authorization code");

  const jar = await cookies();
  const expected = jar.get("li_state")?.value;
  if (!expected || expected !== state) return fail("State mismatch — please try signing in again");
  jar.delete("li_state");

  try {
    const profile = await exchangeLinkedInCode(code);
    const user = await upsertUserFromLinkedIn(profile);

    // XPLAIN-002 — the AEDT notice is delivered before any automated
    // assessment, on this path as well as password signup. Idempotent.
    await deliverAedtNotice(user.id, user.jurisdiction);
    await setSessionCookie(await createSession(user.id, user.email, user.sessionVersion));
    // New LinkedIn users land in onboarding to fill the parts LinkedIn won't give us.
    return NextResponse.redirect(`${env.appUrl}${user.profileReady ? "/swipe" : "/onboarding"}`);
  } catch (e) {
    return fail((e as Error).message);
  }
}
