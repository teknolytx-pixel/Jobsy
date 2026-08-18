import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, users } from "@/db";
import { createSession, hashPassword, setSessionCookie } from "@/lib/auth";

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().min(1),
  role: z.enum(["CANDIDATE", "RECRUITER", "BOTH"]).default("CANDIDATE"),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }
  const { email, password, name, role } = parsed.data;
  const lower = email.toLowerCase();

  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, lower)).limit(1);
  if (existing[0]) return NextResponse.json({ error: "That email is already registered" }, { status: 409 });

  const [user] = await db
    .insert(users)
    .values({ email: lower, name, passwordHash: await hashPassword(password), role })
    .returning();

  await setSessionCookie(await createSession(user.id, user.email));
  return NextResponse.json({ ok: true, userId: user.id, role: user.role, profileReady: false });
}
