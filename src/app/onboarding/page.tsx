import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import OnboardingForm from "./OnboardingForm";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  return (
    <OnboardingForm
      initial={{
        name: user.name,
        headline: user.headline ?? "",
        location: user.location ?? "",
        remotePref: user.remotePref,
        yearsExp: user.yearsExp,
        salaryTarget: user.salaryTarget,
        availability: user.availability ?? "",
        bio: user.bio ?? "",
        skills: user.skills,
        currentCountry: user.currentCountry,
      }}
      linkedinLinked={Boolean(user.linkedinSub)}
    />
  );
}
