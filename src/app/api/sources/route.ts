import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, requireUser } from "@/lib/auth";
import { connectByUrl, connectDetected, listSources, SOURCE_KIND_LABEL } from "@/lib/sources";
import { ATS_KINDS } from "@/lib/providers/ats";
import type { SourceKind } from "@/db";

const ALL_KINDS = [...ATS_KINDS, "JSONLD", "XML_FEED"] as const satisfies readonly SourceKind[];

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  try {
    await requireUser();
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
  } catch {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
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
    const user = await requireUser();
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
    const status = e instanceof AuthError ? 401 : 400;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
