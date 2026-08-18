import { Suspense } from "react";
import { env } from "@/lib/env";
import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="center">Loading…</div>}>
      <LoginForm linkedinEnabled={env.linkedin.enabled} />
    </Suspense>
  );
}
