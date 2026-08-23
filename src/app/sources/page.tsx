import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { listSources, SOURCE_KIND_LABEL } from "@/lib/sources";
import SourcesManager from "./SourcesManager";

export const dynamic = "force-dynamic";

export default async function SourcesPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  /**
   * ADM-006 — administrators only.
   *
   * notFound() rather than a "you need admin" page: this screen controls what
   * the whole platform ingests, and confirming its existence to every recruiter
   * who wanders past tells them where to aim. There is nothing here they can
   * act on, so there is nothing to explain.
   */
  if (!user.isPlatformAdmin) notFound();

  const sources = await listSources();

  return (
    <SourcesManager
      initial={sources.map((s) => ({
        id: s.id,
        company: s.companyName,
        kind: s.kind,
        kindLabel: SOURCE_KIND_LABEL[s.kind],
        token: s.token,
        careersUrl: s.careersUrl,
        enabled: s.enabled,
        status: s.status,
        detectedVia: s.detectedVia,
        lastRunAt: s.lastRunAt?.toISOString() ?? null,
        lastJobCount: s.lastJobCount,
        totalImported: s.totalImported,
        lastError: s.lastError,
      }))}
    />
  );
}
