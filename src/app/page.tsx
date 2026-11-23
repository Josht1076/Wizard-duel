import Link from "next/link";

export default function HomePage() {
  return (
    <main className="lobby-page">
      <div className="hero">
        <p className="brand">✦ Wizard Duel</p>
        <h1>Wizard Duel</h1>
        <p>
          Invite-only two-phone playtest on Supabase. Create a room, share the
          code, commit spells in secret, resolve on the server.
        </p>
      </div>
      <div className="actions">
        <Link className="primary" href="/create" style={{ display: "grid", placeItems: "center" }}>
          Create Game
        </Link>
        <Link className="secondary" href="/join" style={{ display: "grid", placeItems: "center" }}>
          Join Game
        </Link>
        <Link className="secondary" href="/duel" style={{ display: "grid", placeItems: "center" }}>
          Solo duel UI
        </Link>
      </div>
    </main>
  );
}
