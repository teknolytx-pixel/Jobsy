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
      }}
      linkedinLinked={Boolean(user.linkedinSub)}
      linkedinAvailable={env.linkedin.enabled}
    />
  );
}
