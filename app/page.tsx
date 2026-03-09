import { Suspense } from "react";
import VerificationClient from "@/app/verification-client";

export default function HomePage() {
  return (
    <div className="verify-fullbleed">
      <Suspense fallback={<section className="card">Loading verification page...</section>}>
        <VerificationClient />
      </Suspense>
    </div>
  );
}
