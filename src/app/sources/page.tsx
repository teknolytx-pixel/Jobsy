import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { listSources, SOURCE_KIND_LABEL } from "@/lib/sources";
import SourcesManager from "./SourcesManager";

export const dynamic = "force-dynamic";

export default async function SourcesPage() {
  const user = await currentUser();
  if (!user) redirect("/login");

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
