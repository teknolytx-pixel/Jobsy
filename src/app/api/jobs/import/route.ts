import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, authErrorResponse } from "@/lib/auth";
import { audit, safeDetail } from "@/lib/audit";
import { clientIp, consume, tooMany } from "@/lib/ratelimit";
import {
  enrichWithAi,
  importFromDocument,
  importFromText,
  importFromUrl,
  type ImportOutcome,
} from "@/lib/jobImport";

export const dynamic = "force-dynamic";
/** Fetching a third-party page and reading a document both take real time. */
export const maxDuration = 30;

/**
 * JOB-008 / JOB-009 / REC-007 — read a posting so the recruiter does not retype it.
 *
 * Accepts a URL, pasted text, or an uploaded document, and returns a DRAFT.
 *
 * ── What this deliberately does not do ──
 *
 * It does not create a job. Nothing is written to `jobs` here at all. The draft
 * goes back to the recruiter, who edits whatever the parser got wrong and then
 * submits it through `POST /api/jobs` like any other posting.
 *
 * That indirection is the point. `POST /api/jobs` is where the ghost-job
 * attestation is required, where pay-transparency rules fire, and where the
 * prohibited-content screen runs. An import endpoint that wrote directly to the
 * table would be a documented way around every one of them — and it would be
 * the path of least resistance, so it would become the one everybody used.
 *
 * ── Rate limited, because this makes outbound requests ──
 *
 * The URL mode causes this server to fetch a URL somebody else chose. `safeFetch`
 * stops it reaching private addresses; the limit here stops it being used as a
 * general-purpose request amplifier.
 */

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

const Body = z
  .object({
    url: z.string().trim().min(1).max(2000).optional(),
    text: z.string().trim().min(1).max(200_000).optional(),
  })
  .refine((b) => Boolean(b.url) !== Boolean(b.text), {
    message: "Send either a url or text, not both and not neither.",
  });

export async function POST(req: Request) {
  let me;
  try {
    me = await requireRole("RECRUITER");
  } catch (e) {
    return authErrorResponse(e)!;
  }

  // `urlImport` already existed in LIMITS (20/hour) and was unused — this is
  // the endpoint it was defined for.
  const rl = await consume("urlImport", me.id);
  if (!rl.ok) return tooMany(rl, "That's a lot of imports in an hour. Try again shortly.");

  const contentType = req.headers.get("content-type") ?? "";
  let outcome: ImportOutcome;
  let sourceText = "";
  let mode: string;

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "No file was attached.", code: "NO_FILE" },
        { status: 400 }
      );
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        {
          error: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 4 MB.`,
          code: "TOO_LARGE",
        },
        { status: 413 }
      );
    }
    const buf = Buffer.from(await file.arrayBuffer());
    outcome = importFromDocument(buf);
    mode = "DOCUMENT";
  } else {
    let body;
    try {
      body = Body.parse(await req.json());
    } catch {
      return NextResponse.json(
        { error: "Send a url or a pasted description.", code: "BAD_BODY" },
        { status: 400 }
      );
    }
    if (body.url) {
      outcome = await importFromUrl(body.url);
      mode = "URL";
    } else {
      outcome = importFromText(body.text!);
      mode = "TEXT";
    }
  }

  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.error, code: outcome.code }, { status: 422 });
  }

  sourceText = outcome.draft.description;

  /**
   * Only ask a model for what the deterministic pass could not find, and only
   * accept values that appear verbatim in the source. See `enrichWithAi`.
   */
  const draft = await enrichWithAi(outcome.draft, sourceText);

  await audit({
    action: "job.imported",
    actorId: me.id,
    subjectType: "job",
    detail: safeDetail({
      mode,
      from: outcome.from,
      // The posting text itself is not logged — it can run to twenty thousand
      // characters and belongs to somebody else. What an audit needs is that
      // an import happened, by whom, and how well it went.
      resolved: Object.keys(draft.provenance).length,
      needsInput: draft.needsInput,
    }),
    ip: clientIp(req),
  });

  return NextResponse.json({
    draft,
    from: outcome.from,
    note:
      "Nothing has been created yet. Check every field — especially anything marked as read " +
      "from the text — then publish or save it as a draft.",
  });
}
