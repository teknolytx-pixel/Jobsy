import { NextResponse } from "next/server";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, resumes, resumeParses } from "@/db";
import { requireUser, authErrorResponse } from "@/lib/auth";
import { deleteObject, putObject, signResumeUrl, storageKeyFor } from "@/lib/storage";
import { extract, sniffMime } from "@/lib/resume/extract";
import { parseResume } from "@/lib/resume/parse";
import { consume, tooMany, clientIp } from "@/lib/ratelimit";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** RESUME-001 AC-3/4 — 10 MB, and only PDF or DOCX, checked by CONTENT. */
const MAX_BYTES = 10 * 1024 * 1024;

const PDF_MIME = "application/pdf";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export async function GET() {
  let me;
  try {
    me = await requireUser();
  } catch (e) {
    return authErrorResponse(e)!;
  }
  const rows = await db
    .select()
    .from(resumes)
    .where(and(eq(resumes.userId, me.id), isNull(resumes.deletedAt)))
    .orderBy(desc(resumes.version));

  return NextResponse.json({
    resumes: rows.map((r) => ({
      id: r.id,
      filename: r.filename,
      bytes: r.bytes,
      version: r.version,
      isPrimary: r.isPrimary,
      parseStatus: r.parseStatus,
      parseError: r.parseError,
      uploadedAt: r.createdAt.toISOString(),
      // AC-6/8/9 — bound to this viewer, expires in 15 minutes.
      downloadUrl: signResumeUrl(r.id, me.id),
    })),
  });
}

export async function POST(req: Request) {
  let me;
  try {
    me = await requireUser();
  } catch (e) {
    return authErrorResponse(e)!;
  }

  const rl = await consume("write", me.id, { max: 10, windowSec: 3600 });
  if (!rl.ok) {
    return tooMany(rl, "You've uploaded several files recently. Please wait a little while.");
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Attach a PDF or Word document" }, { status: 400 });
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "That file is over 10 MB. Please upload a smaller one.", code: "TOO_LARGE" },
      { status: 413 }
    );
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "That file is empty" }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());

  // AC-2 — the extension is a claim, not evidence. An executable renamed to
  // .pdf is caught here and nowhere else.
  const kind = sniffMime(buf);
  if (kind !== "pdf" && kind !== "zip") {
    return NextResponse.json(
      {
        error:
          "We accept PDF and Word (.docx) files. That file isn't either — the contents don't match the name.",
        code: "BAD_FILE_TYPE",
      },
      { status: 400 }
    );
  }

  // Extraction runs BEFORE storage, so a PDF carrying an OpenAction or embedded
  // JavaScript is never written to disk at all (AC-5). We refuse rather than
  // sanitize-and-serve: a partially cleaned file we then hand to a recruiter
  // becomes our problem.
  const extraction = extract(buf);
  if (extraction.status === "FAILED") {
    return NextResponse.json(
      { error: extraction.note ?? "We couldn't read that file", code: "UNREADABLE" },
      { status: 400 }
    );
  }

  // AC-12 — a filename is user-controlled and ends up in headers and in the UI.
  const safeName = sanitizeFilename(file.name);
  const mime = kind === "pdf" ? PDF_MIME : DOCX_MIME;
  const key = storageKeyFor(me.id, safeName);
  await putObject(key, buf, mime);

  const existing = await db
    .select({ version: resumes.version })
    .from(resumes)
    .where(eq(resumes.userId, me.id))
    .orderBy(desc(resumes.version))
    .limit(1);
  const version = (existing[0]?.version ?? 0) + 1;

  // AC-13 — exactly one primary even under concurrent uploads: demote all,
  // then insert as primary, in one transaction.
  const resume = await db.transaction(async (tx) => {
    await tx.update(resumes).set({ isPrimary: false }).where(eq(resumes.userId, me.id));
    const [row] = await tx
      .insert(resumes)
      .values({
        userId: me.id,
        storageKey: key,
        filename: safeName,
        mime,
        bytes: buf.length,
        version,
        isPrimary: true,
        parseStatus: extraction.status === "OK" ? "OK" : "MANUAL",
        parsedAt: new Date(),
        parseError: extraction.note,
      })
      .returning();
    return row;
  });

  // RESUME-003 — parse into a SUGGESTION. Nothing here writes to the profile.
  let suggestion: unknown = null;
  if (extraction.status === "OK") {
    const outcome = parseResume(extraction.text);
    await db.insert(resumeParses).values({
      resumeId: resume.id,
      rawText: extraction.text,
      structured: outcome.parsed,
      confidence: outcome.confidence,
    });
    suggestion = {
      parsed: outcome.parsed,
      confidence: outcome.confidence,
      needsConfirmation: outcome.needsConfirmation,
    };
  }

  await audit({
    action: "privacy.request_created",
    actorId: me.id,
    subjectType: "resume",
    subjectId: resume.id,
    detail: { bytes: buf.length, parseStatus: resume.parseStatus, kind: "RESUME_UPLOAD" },
    ip: clientIp(req),
  });

  return NextResponse.json(
    {
      ok: true,
      resumeId: resume.id,
      parseStatus: resume.parseStatus,
      note: extraction.note,
      downloadUrl: signResumeUrl(resume.id, me.id),
      // AC-3/4 — presented for approval, never applied.
      suggestion,
      message:
        extraction.status === "OK"
          ? "Uploaded. We've read it and suggested some profile updates — review them and pick what's right."
          : extraction.note,
    },
    { status: 201 }
  );
}

export async function DELETE(req: Request) {
  let me;
  try {
    me = await requireUser();
  } catch (e) {
    return authErrorResponse(e)!;
  }
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const rows = await db
    .select()
    .from(resumes)
    .where(and(eq(resumes.id, id), eq(resumes.userId, me.id)))
    .limit(1);
  const resume = rows[0];
  if (!resume) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // AC-7 — the file goes now; the row is soft-deleted so the record of what was
  // uploaded and when survives for the audit trail.
  await deleteObject(resume.storageKey);
  await db
    .update(resumes)
    .set({ deletedAt: new Date(), isPrimary: false })
    .where(eq(resumes.id, id));

  return NextResponse.json({ ok: true });
}

/**
 * Strip path separators and control characters from a user-supplied filename.
 *
 * This value reaches a Content-Disposition header, so a newline in it is a
 * header-injection primitive, and "../" is a traversal primitive.
 */
function sanitizeFilename(raw: string): string {
  const cleaned = (raw || "resume")
    .replace(/[\\/]/g, "_")
    .replace(/[\u0000-\u001F\u007F"]/g, "")
    .replace(/\.{2,}/g, ".")
    .trim();
  return (cleaned.slice(0, 120) || "resume").normalize("NFC");
}
