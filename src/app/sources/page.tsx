import WrongAccount from "@/components/WrongAccount";
import { redirect } from "next/navigation";
import { currentUser, hasRole } from "@/lib/auth";
import { listSources, SOURCE_KIND_LABEL } from "@/lib/sources";
import SourcesManager from "./SourcesManager";

export const dynamic = "force-dynamic";

export default async function SourcesPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!hasRole(user, "RECRUITER"))
    return <WrongAccount need="RECRUITER" homeHref="/swipe" homeLabel="Go to your job feed" />;

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
