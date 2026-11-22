"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createMatch } from "@/lib/match/api";
import { newReconnectToken, saveSession } from "@/lib/session";
import { getSupabaseEnvStatus } from "@/lib/supabase/client";

export default function CreateGamePage() {
  const router = useRouter();
  const [name, setName] = useState("Wizard A");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const env = getSupabaseEnvStatus();

  async function onCreate() {
    if (!env.configured) {
      setError(`Missing env: ${env.missing.join(", ")}`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const token = newReconnectToken();
      const result = await createMatch(name.trim() || "Wizard A", token);
      saveSession({
        matchId: result.match_id,
        roomCode: result.room_code,
        seat: "A",
        name: name.trim() || "Wizard A",
        token,
      });
      router.push(`/duel?room=${result.room_code}&seat=A`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "create_failed";
      setError(
        /Could not find the function|PGRST202|schema cache/i.test(msg)
          ? "Supabase RPCs missing — apply supabase/APPLY_IN_SQL_EDITOR.sql in the SQL Editor, then retry."
          : msg,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="lobby-page">
      <div className="hero">
        <p className="brand">✦ Wizard Duel</p>
        <h1>Create Game</h1>
        <p>Spin up a room code and wait for your opponent on the other phone.</p>
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
        <div className="actions">
          <button
            type="button"
            className="primary"
            onClick={() => void onCreate()}
            disabled={busy}
          >
            {busy ? "Creating…" : "Create room"}
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
        <p
          className="small"
          style={{
            color: "light-dark(#60566b, #c3b7ce)",
            font: "13px/1.4 Segoe UI, sans-serif",
          }}
        >
          Creates a Supabase match, stores your reconnect token in localStorage,
          and opens the lobby. Share the room code after create.
        </p>
      </div>
    </main>
  );
}
