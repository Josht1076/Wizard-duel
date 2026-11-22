"use client";

import { useSearchParams } from "next/navigation";
import { DuelBoard } from "@/components/DuelBoard";

export function DuelPageClient() {
  const searchParams = useSearchParams();
  const room = searchParams.get("room")?.toUpperCase() ?? undefined;
  const seat = searchParams.get("seat") === "B" ? "B" : "A";

  return (
    <main style={{ padding: "12px 0 40px" }}>
      <DuelBoard
        roomCode={room}
        seatLabel={room ? `Seat ${seat}` : "Solo preview"}
      />
    </main>
  );
}
