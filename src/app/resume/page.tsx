import { redirect } from "next/navigation";
import WrongAccount from "@/components/WrongAccount";
import { currentUser, hasRole } from "@/lib/auth";
import ResumeBuilder from "./ResumeBuilder";

export const dynamic = "force-dynamic";

/**
 * RES-004 / RES-005 / RES-006 — the candidate's resume workspace.
 *
 * Guarded the same way every other candidate surface is: an employer account
 * gets the explanation screen rather than a 404, because "this page does not
 * exist" is a lie when what is true is "this page is not for your account
 * type".
 */
export default async function ResumePage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!hasRole(user, "CANDIDATE")) {
    return <WrongAccount need="CANDIDATE" homeHref="/recruiter" homeLabel="Go to sourcing" />;
  }
  return <ResumeBuilder />;
}
