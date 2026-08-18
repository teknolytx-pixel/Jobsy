import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { linkedinAuthUrl, linkedinRedirectUri } from "@/lib/auth";

/** Kicks off the LinkedIn OIDC dance with a CSRF state cookie. */
export async function GET() {
  if (!env.linkedin.enabled) {
    return NextResponse.json(
      {
        error: "LinkedIn is not configured",
        fix: "Set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET in .env",
        redirectUriToRegister: linkedinRedirectUri(),
        docs: "https://developer.linkedin.com/ → Create app → Products → Sign In with LinkedIn using OpenID Connect",
      },
      { status: 503 }
    );
  }

  const state = crypto.randomUUID();
  const jar = await cookies();
  jar.set("li_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });

  return NextResponse.redirect(linkedinAuthUrl(state));
}
