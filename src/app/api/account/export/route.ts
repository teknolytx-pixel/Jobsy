import { NextResponse } from "next/server";
import { requireUser, authErrorResponse } from "@/lib/auth";
import { buildExport } from "@/lib/dataExport";
import { completeRequest, openRequest } from "@/lib/privacy";
import { audit } from "@/lib/audit";
import { clientIp, consume, tooMany } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

/**
 * AUTH-012 — data export.
 *
 * Served synchronously as a download rather than queued behind an email link.
 * At MVP volume the bundle is small, and a right that resolves in a second is
 * meaningfully better honoured than one that resolves in 45 days. The ledger
 * entry is still written and closed, so the SLA is evidenced either way.
 */
export async function POST(req: Request) {
  let me;
  try {
    me = await requireUser();
  } catch (e) {
    return authErrorResponse(e)!;
  }

  const rl = await consume("write", me.id, { max: 5, windowSec: 3600 });
  if (!rl.ok) return tooMany(rl, "You've requested several exports. Please wait a little while.");

  const { id, dueAt } = await openRequest({
    userId: me.id,
    kind: "EXPORT",
    jurisdiction: me.jurisdiction,
  });

  const bundle = await buildExport(me);
  await completeRequest(id, "Delivered immediately as a download", me.id);

  await audit({
    action: "privacy.export_generated",
    actorId: me.id,
    subjectType: "user",
    subjectId: me.id,
    detail: { requestId: id, dueAt: dueAt.toISOString() },
    ip: clientIp(req),
  });

  const filename = `jobsy-data-export-${new Date().toISOString().slice(0, 10)}.json`;
  return new NextResponse(JSON.stringify(bundle, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // A data export must never be cached by a shared proxy.
      "Cache-Control": "no-store, private",
    },
  });
}
