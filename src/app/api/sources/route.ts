import { NextResponse } from "next/server";
import { z } from "zod";
import { authErrorResponse, requirePlatformAdmin } from "@/lib/auth";
import { connectByUrl, connectDetected, listSources, SOURCE_KIND_LABEL } from "@/lib/sources";
import { ATS_KINDS } from "@/lib/providers/ats";
import type { SourceKind } from "@/db";

const ALL_KINDS = [...ATS_KINDS, "JSONLD", "XML_FEED"] as const satisfies readonly SourceKind[];

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * ADM-006 — job sources are a PLATFORM concern, not a recruiter one.
 *
 * Connecting a source subscribes the whole deployment to somebody's careers
 * board: every posting it carries enters the corpus every candidate swipes
 * through. Disabling or deleting one removes those postings for everyone. None
 * of that is scoped to the person doing it, so none of it belongs to a
 * recruiter account.
 *
 * ── What this replaces ──
 *
 * `requireUser()`. Any signed-in account — including a CANDIDATE — could list,
 * connect, sync, disable and DELETE every job source on the platform. The
 * /sources page checked for a recruiter, so the restriction looked real while
 * the API underneath enforced nothing beyond being logged in.
 *
 * That is the exact failure the seat tests already guard against elsewhere
 * ("permission checks are server-side, not UI-only"): a UI-only check is not a
 * permission, it is a suggestion, and the API is the thing anyone can call.
 */
export async function GET() {
  try {
    await requirePlatformAdmin();
    const sources = await listSources();
    return NextResponse.json({
      sources: sources.map((s) => ({
        id: s.id,
        company: s.companyName,
        kind: s.kind,
        kindLabel: SOURCE_KIND_LABEL[s.kind],
        token: s.token,
        careersUrl: s.careersUrl,
        enabled: s.enabled,
        status: s.status,
        autoDetected: s.autoDetected,
        detectedVia: s.detectedVia,
        lastRunAt: s.lastRunAt?.toISOString() ?? null,
        lastJobCount: s.lastJobCount,
        totalImported: s.totalImported,
        lastError: s.lastError,
      })),
      supportedKinds: ALL_KINDS,
    });
  } catch (e) {
      /*
       * `authErrorResponse` rather than a bespoke catch.
       *
       * These handlers translated their own errors and got it wrong in both
       * directions: GET returned 401 "Not signed in" for everything, and POST
       * mapped anything that was not an AuthError to 400. A signed-in candidate
       * refused for lacking admin therefore received "400 Invalid input",
       * which tells a client its request was malformed when the request was
       * fine and the caller simply was not allowed.
       *
       * The shared helper distinguishes 401 from 403, which is the whole point
       * of having two error classes.
       */
      return (
      authErrorResponse(e) ??
      NextResponse.json({ error: (e as Error).message }, { status: 400 })
    );
  }
}

const Body = z
  .object({
    /** Paste any careers URL and let Jobsy work out how to pull it. */
    url: z.string().min(4).optional(),
    /** Or state the connector outright. */
    kind: z.enum(ALL_KINDS).optional(),
    token: z.string().min(1).optional(),
    companyName: z.string().min(1).optional(),
  })
  .refine((b) => b.url || (b.kind && b.token), {
    message: "Provide either a careers URL, or a kind + token",
  });

export async function POST(req: Request) {
  try {
    const user = await requirePlatformAdmin();
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 }
      );
    }
    const b = parsed.data;

    const result = b.url
      ? await connectByUrl(b.url, user.id)
      : await connectDetected(
          {
            kind: b.kind!,
            token: b.token!,
            companyName: b.companyName ?? b.token!,
            label: SOURCE_KIND_LABEL[b.kind!] ?? b.kind!,
            confidence: "certain",
            via: "Added manually",
          },
          undefined,
          user.id
        );

    if (!result.ok) {
      return NextResponse.json({ error: result.error, suggestions: result.suggestions }, { status: 422 });
    }

    return NextResponse.json({
      ok: true,
      alreadyExisted: result.alreadyExisted,
      imported: result.imported,
      detection: {
        kind: result.detection.kind,
        label: result.detection.label,
        token: result.detection.token,
        via: result.detection.via,
        confidence: result.detection.confidence,
      },
      source: {
        id: result.source.id,
        company: result.source.companyName,
        kind: result.source.kind,
        status: result.source.status,
        lastJobCount: result.source.lastJobCount,
      },
    });
  } catch (e) {
    return (
      authErrorResponse(e) ??
      NextResponse.json({ error: (e as Error).message }, { status: 400 })
    );
  }
}
