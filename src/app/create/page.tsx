"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

function makeRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

export default function CreateGamePage() {
  const router = useRouter();
  const [name, setName] = useState("Wizard A");
  const [roomCode, setRoomCode] = useState("");

  useEffect(() => {
    setRoomCode(makeRoomCode());
  }, []);

  function createLocal() {
    const code = roomCode || makeRoomCode();
    if (typeof window !== "undefined") {
      window.localStorage.setItem(
        "wd_player",
        JSON.stringify({
          seat: "A",
          name,
          roomCode: code,
          token: crypto.randomUUID(),
        }),
      );
    }
    router.push(`/duel?room=${code}&seat=A`);
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
          />
        </label>
        <label>
          Room code
          <input value={roomCode || "····"} readOnly aria-readonly="true" />
        </label>
        <div className="actions">
          <button
            type="button"
            className="primary"
            onClick={createLocal}
            disabled={!roomCode}
          >
            Enter duel (local stub)
          </button>
          <Link
            className="secondary"
            href="/"
            style={{ display: "grid", placeItems: "center" }}
          >
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
          Room create/join against Supabase is stubbed — this only opens the
          duel UI.
        </p>
      </div>
    </main>
  );
}
