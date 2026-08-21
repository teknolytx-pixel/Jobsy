import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import NotificationSettings from "./NotificationSettings";

export const dynamic = "force-dynamic";

/**
 * MATCH-006 — the page every Jobsy email has been linking to.
 *
 * Each template ends with "manage your preferences" pointing at
 * /settings/notifications. That page did not exist, so the link 404'd — while
 * the preferences it referred to sat in a real table that `sendEmail()` also
 * never read. Two halves of a feature, both built, neither connected.
 */
export default async function NotificationSettingsPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/settings/notifications");
  return <NotificationSettings role={user.role} />;
}
