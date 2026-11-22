"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function JoinGamePage() {
  const router = useRouter();
  const [name, setName] = useState("Wizard B");
  const [roomCode, setRoomCode] = useState("");

  function joinLocal() {
    const code = roomCode.trim().toUpperCase();
    if (code.length < 3) return;
    if (typeof window !== "undefined") {
      window.localStorage.setItem(
        "wd_player",
        JSON.stringify({ seat: "B", name, roomCode: code, token: crypto.randomUUID() }),
      );
    }
    router.push(`/duel?room=${encodeURIComponent(code)}&seat=B`);
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
          />
        </label>
        <div className="actions">
          <button
            type="button"
            className="primary"
            onClick={joinLocal}
            disabled={roomCode.trim().length < 3}
          >
            Enter duel (local stub)
          </button>
          <Link className="secondary" href="/" style={{ display: "grid", placeItems: "center" }}>
            Back
          </Link>
        </div>
        <p
          className="small"
          style={{
            color: "light-dark(#60566b, #c3b7ce)",
            font: "13px/1.4 Segoe UI, sans-serif",
          }}
        >
          Join does not hit Supabase yet — navigation only.
        </p>
      </div>
    </main>
  );
}
