import { Suspense } from "react";
import ResetForm from "./ResetForm";

export const dynamic = "force-dynamic";

export default function ResetPage() {
  return (
    <Suspense fallback={<div className="center">Loading…</div>}>
      <ResetForm />
    </Suspense>
  );
}
