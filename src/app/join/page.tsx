"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { joinMatch, reconnectMatch } from "@/lib/match/api";
import { newReconnectToken, saveSession } from "@/lib/session";
import { getSupabaseEnvStatus } from "@/lib/supabase/client";

export default function JoinGamePage() {
  const router = useRouter();
  const [name, setName] = useState("Wizard B");
  const [roomCode, setRoomCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const env = getSupabaseEnvStatus();

  async function onJoin() {
    const code = roomCode.trim().toUpperCase();
    if (code.length < 3) return;
    if (!env.configured) {
      setError(`Missing env: ${env.missing.join(", ")}`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const token = newReconnectToken();
      const result = await joinMatch(code, name.trim() || "Wizard B", token);
      saveSession({
        matchId: result.match_id,
        roomCode: result.room_code,
        seat: "B",
        name: name.trim() || "Wizard B",
        token,
      });
      router.push(`/duel?room=${encodeURIComponent(result.room_code)}&seat=B`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "join_failed";
      setError(
        /Could not find the function|PGRST202|schema cache/i.test(msg)
          ? "Supabase RPCs missing — apply supabase/APPLY_IN_SQL_EDITOR.sql in the SQL Editor, then retry."
          : msg,
      );
    } finally {
      setBusy(false);
    }
  }

  async function onReconnect() {
    const code = roomCode.trim().toUpperCase();
    if (code.length < 3) return;
    setBusy(true);
    setError(null);
    try {
      const existing = window.localStorage.getItem("wd_player");
      if (!existing) {
        setError("No saved seat in this browser — join as a new player instead.");
        return;
      }
      const parsed = JSON.parse(existing) as {
        token?: string;
        name?: string;
        roomCode?: string;
      };
      if (!parsed.token) {
        setError("Saved session is missing a reconnect token.");
        return;
      }
      const result = await reconnectMatch(code, parsed.token);
      saveSession({
        matchId: result.match_id,
        roomCode: result.room_code,
        seat: result.seat,
        name: result.display_name || parsed.name || "Wizard",
        token: parsed.token,
      });
      router.push(
        `/duel?room=${encodeURIComponent(result.room_code)}&seat=${result.seat}`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "reconnect_failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="lobby-page">
      <div className="hero">
        <p className="brand">✦ Wizard Duel</p>
        <h1>Join Game</h1>
        <p>Enter the room code from your opponent&apos;s phone.</p>
      </div>
      <div className="stack">
        <label>
          Display name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="nickname"
            disabled={busy}
          />
        </label>
        <label>
          Room code
          <input
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
            placeholder="ABCD"
            autoCapitalize="characters"
            maxLength={8}
            disabled={busy}
          />
        </label>
        <div className="actions">
          <button
            type="button"
            className="primary"
            onClick={() => void onJoin()}
            disabled={busy || roomCode.trim().length < 3}
          >
            {busy ? "Joining…" : "Join room"}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => void onReconnect()}
            disabled={busy || roomCode.trim().length < 3}
          >
            Reconnect
          </button>
          <Link
            className="secondary"
            href="/"
            style={{ display: "grid", placeItems: "center" }}
          >
            Back
          </Link>
        </div>
        {error && (
          <p
            role="alert"
            className="small"
            style={{
              color: "#994829",
              font: "13px/1.4 Segoe UI, sans-serif",
            }}
          >
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
