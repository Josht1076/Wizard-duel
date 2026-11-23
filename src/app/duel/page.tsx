import { Suspense } from "react";
import { DuelPageClient } from "./DuelPageClient";

export default function DuelPage() {
  return (
    <Suspense
      fallback={
        <main style={{ padding: "24px", textAlign: "center" }}>
          Loading duel…
        </main>
      }
    >
      <DuelPageClient />
    </Suspense>
  );
}
