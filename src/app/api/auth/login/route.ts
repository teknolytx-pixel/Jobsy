import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, users } from "@/db";
import { createSession, setSessionCookie, verifyPassword } from "@/lib/auth";

const Body = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const rows = await db
    .select()
    .from(users)
    .where(eq(users.email, parsed.data.email.toLowerCase()))
    .limit(1);
  const user = rows[0];

  if (!user?.passwordHash) {
    return NextResponse.json(
      { error: "No password set for this account — try Continue with LinkedIn" },
      { status: 401 }
    );
  }
  if (!(await verifyPassword(parsed.data.password, user.passwordHash))) {
    return NextResponse.json({ error: "Incorrect email or password" }, { status: 401 });
  }

  await setSessionCookie(await createSession(user.id, user.email));
  return NextResponse.json({
    ok: true,
    userId: user.id,
    role: user.role,
    profileReady: user.profileReady,
  });
}
