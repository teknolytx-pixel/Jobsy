import { env } from "./env";
import { issueToken, revokeTokens } from "./tokens";
import { sendEmail, verifyEmailTemplate } from "./email";

/**
 * AUTH-006 — issue a verification token and email it.
 *
 * Lives here rather than in the route module because Next.js App Router route
 * files may only export HTTP method handlers; anything else is a build error.
 *
 * Revoking prior tokens first is deliberate. If every link ever sent stays live
 * for its full 24 hours, a forwarded old email is an account takeover.
 */
export async function sendVerification(userId: string, email: string, name: string): Promise<void> {
  await revokeTokens("VERIFY_EMAIL", userId);
  const { raw } = await issueToken({ purpose: "VERIFY_EMAIL", userId, email });
  await sendEmail(
    verifyEmailTemplate({
      to: email,
      name,
      url: `${env.appUrl}/api/auth/verify?token=${encodeURIComponent(raw)}`,
    })
  );
}
