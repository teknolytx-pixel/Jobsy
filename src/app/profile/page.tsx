import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { env } from "@/lib/env";
import ProfileEditor from "./ProfileEditor";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  return (
    <ProfileEditor
      initial={{
        name: user.name,
        email: user.email,
        headline: user.headline ?? "",
        location: user.location ?? "",
        remotePref: user.remotePref,
        yearsExp: user.yearsExp,
        salaryTarget: user.salaryTarget,
        availability: user.availability ?? "",
        bio: user.bio ?? "",
        skills: user.skills,
        openToOffers: user.openToOffers,
        title: user.title ?? "",
        // FSD v1.1 §36.2 — CandidateLocation
        requiresSponsorship: user.requiresSponsorship,
        currentCountry: user.currentCountry,
        currentPostalCode: user.currentPostalCode,
        searchCountry: user.searchCountry,
        preferredCountries: user.preferredCountries,
        preferredRegions: user.preferredRegions,
        internationalSearchEnabled: user.internationalSearchEnabled,
        remoteEligibleCountries: user.remoteEligibleCountries,
        relocationWillingness: user.relocationWillingness,
      }}
      linkedinLinked={Boolean(user.linkedinSub)}
      linkedinAvailable={env.linkedin.enabled}
      // The only route to /admin in the whole product. The console has existed
      // behind requirePlatformAdmin with nothing linking to it, which for a
      // moderation queue means reports arrive and nobody is told where to read
      // them. Shown to administrators only — everyone else never learns it
      // exists, which is the correct amount of information for them to have.
      isPlatformAdmin={user.isPlatformAdmin}
    />
  );
}
