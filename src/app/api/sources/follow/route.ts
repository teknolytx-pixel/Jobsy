import { NextResponse } from "next/server";
import { z } from "zod";
import { authErrorResponse, requirePlatformAdmin } from "@/lib/auth";
import { errorResponse } from "@/lib/apiError";
import {
  employerSearchProviders,
  followEmployer,
  listFollowedEmployers,
} from "@/lib/followedEmployers";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * FOLLOW AN EMPLOYER THROUGH THE JOB BOARDS.
 *
 * The escape hatch for careers sites that cannot be read without a browser.
 * Rather than failing at Infosys, ask the boards that already index Infosys.
 */
export async function GET() {
  try {
    await requirePlatformAdmin();
    const rows = await listFollowedEmployers();
    return NextResponse.json({
      /*
       * Reported rather than assumed. Following an employer with no aggregator
       * key configured returns nothing and looks like a broken feature; naming
       * which boards are live and which are missing a key turns that into a
       * setting somebody can change.
       */
      providers: employerSearchProviders(),
      employers: rows.map((r) => ({
        id: r.id,
        name: r.name,
        careersUrl: r.careersUrl,
        enabled: r.enabled,
        lastCount: r.lastCount,
        totalImported: r.totalImported,
        lastRunAt: r.lastRunAt?.toISOString() ?? null,
        lastError: r.lastError,
      })),
    });
  } catch (e) {
    return authErrorResponse(e) ?? errorResponse(e, "loading followed employers");
  }
}

const Body = z.object({
  name: z.string().min(2).max(160),
  careersUrl: z.string().max(500).optional(),
});

export async function POST(req: Request) {
  try {
    const admin = await requirePlatformAdmin();
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "An employer name is required" }, { status: 400 });
    }

    const { row, result } = await followEmployer(parsed.data.name, {
      careersUrl: parsed.data.careersUrl,
      addedById: admin.id,
    });

    return NextResponse.json({
      ok: !result.error,
      employer: { id: row.id, name: row.name },
      result,
      providers: employerSearchProviders(),
    });
  } catch (e) {
    return authErrorResponse(e) ?? errorResponse(e, "following that employer");
  }
}
