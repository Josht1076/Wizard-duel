"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { SoloDuelBoard } from "@/components/SoloDuelBoard";
import { OnlineDuelBoard } from "@/components/OnlineDuelBoard";
import { loadSession, saveSession, type PlayerSession } from "@/lib/session";
import { reconnectMatch } from "@/lib/match/api";

export function DuelPageClient() {
  const searchParams = useSearchParams();
  const room = searchParams.get("room")?.toUpperCase() ?? undefined;
  const [session, setSession] = useState<PlayerSession | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      const local = loadSession();
      if (room && local && local.roomCode === room) {
        try {
          const remote = await reconnectMatch(room, local.token);
          if (cancelled) return;
          const next: PlayerSession = {
            matchId: remote.match_id,
            roomCode: remote.room_code,
            seat: remote.seat,
            name: remote.display_name || local.name,
            token: local.token,
          };
          saveSession(next);
          setSession(next);
        } catch (e) {
          if (!cancelled) {
            setError(e instanceof Error ? e.message : "reconnect_failed");
            setSession(local);
          }
        }
      } else if (room && local && local.roomCode !== room) {
        setError(
          `This browser has a seat for room ${local.roomCode}, not ${room}.`,
        );
      } else if (room && !local) {
        setError(
          "No reconnect token in this browser. Create or join the room first.",
        );
      }
      if (!cancelled) setReady(true);
    }
    void boot();
    return () => {
      cancelled = true;
    };
  }, [room]);

  if (!ready) {
    return (
      <main style={{ padding: "24px", textAlign: "center" }}>Loading duel…</main>
    );
  }

  if (room && session) {
    return (
      <main style={{ padding: "12px 0 40px" }}>
        {error && (
          <p
            role="alert"
            style={{
              maxWidth: 590,
              margin: "0 auto 12px",
              font: "13px/1.4 Segoe UI, sans-serif",
              color: "#994829",
              textAlign: "center",
            }}
          >
            {error}
          </p>
        )}
        <OnlineDuelBoard session={session} />
      </main>
    );
  }

  return (
    <main style={{ padding: "12px 0 40px" }}>
      {error && (
        <p
          role="alert"
          style={{
            maxWidth: 590,
            margin: "0 auto 12px",
            font: "13px/1.4 Segoe UI, sans-serif",
            color: "#994829",
            textAlign: "center",
          }}
        >
          {error}
        </p>
      )}
      <SoloDuelBoard />
    </main>
  );
}
