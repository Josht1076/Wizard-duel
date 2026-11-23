"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ATTACK_CARDS,
  DEFENSE_CARDS,
  SCHOOL_ICONS,
  type PowerValue,
  type Seat,
} from "@/lib/rules";
import {
  fetchMatchPublic,
  chooseRefresh,
  track,
  requestResolve,
  submitBid,
  submitCommit,
} from "@/lib/match/api";
import type { MatchPublicSnapshot, PublicPlayer } from "@/lib/match/types";
import type { PlayerSession } from "@/lib/session";

function availablePower(discarded: PowerValue[]): PowerValue[] {
  return ([1, 2, 3, 4, 5] as PowerValue[]).filter((p) => !discarded.includes(p));
}

function playerBySeat(
  players: PublicPlayer[],
  seat: Seat | null | undefined,
): PublicPlayer | undefined {
  if (!seat) return undefined;
  return players.find((p) => p.seat === seat);
}

export function OnlineDuelBoard({ session }: { session: PlayerSession }) {
  const [snap, setSnap] = useState<MatchPublicSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bidPower, setBidPower] = useState<PowerValue | null>(null);
  const [spellIndex, setSpellIndex] = useState(0);
  const [power, setPower] = useState<PowerValue>(5);
  const [advantageSpend, setAdvantageSpend] = useState<
    "boost" | "refresh" | null
  >(null);
  const [inspectOpen, setInspectOpen] = useState(false);
  const resolving = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchMatchPublic(session.roomCode);
      setSnap(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "refresh_failed");
    }
  }, [session.roomCode]);

  useEffect(() => {
    void refresh();
    const poll = window.setInterval(() => void refresh(), 4000);
    return () => {
      window.clearInterval(poll);
    };
  }, [refresh, session.matchId]);

  useEffect(() => {
    let lastInput = performance.now();
    let lastTick = performance.now();
    const input = () => { lastInput = performance.now(); };
    const heartbeat = () => {
      const now = performance.now();
      const visible = document.visibilityState === "visible";
      const active_ms = visible && now - lastInput < 60000 ? Math.min(15000, Math.max(0, now - lastTick)) : 0;
      lastTick = now;
      track(session.matchId, session.token, "activity", { visible, active_ms: Math.round(active_ms) });
    };
    window.addEventListener("pointerdown", input);
    window.addEventListener("keydown", input);
    document.addEventListener("visibilitychange", heartbeat);
    const timer = window.setInterval(heartbeat, 15000);
    return () => {
      clearInterval(timer); window.removeEventListener("pointerdown", input);
      window.removeEventListener("keydown", input); document.removeEventListener("visibilitychange", heartbeat);
    };
  }, [session.matchId, session.token]);

  const phase = snap?.state.phase;
  const me = playerBySeat(snap?.players ?? [], session.seat);
  const attackerSeat = snap?.state.attacker_seat ?? null;
  const defenderSeat =
    attackerSeat === "A" ? "B" : attackerSeat === "B" ? "A" : null;
  const myRole: "attack" | "defend" | "spectator" =
    phase === "attack_commit" && session.seat === attackerSeat
      ? "attack"
      : phase === "defense_commit" && session.seat === defenderSeat
        ? "defend"
        : "spectator";

  const discarded = useMemo(() => {
    const base = (me?.discarded_power ?? []) as PowerValue[];
    if (advantageSpend === "refresh" || base.length >= 5) return [] as PowerValue[];
    return base;
  }, [me?.discarded_power, advantageSpend]);

  const powers = availablePower(discarded);
  const cards = myRole === "defend" ? DEFENSE_CARDS : ATTACK_CARDS;
  const selected = cards[Math.min(spellIndex, cards.length - 1)];

  useEffect(() => {
    if (powers.length && !powers.includes(power)) {
      setPower(powers[powers.length - 1]!);
    }
  }, [powers, power]);

  // Auto-trigger server resolve when phase hits resolve
  useEffect(() => {
    if (phase !== "resolve" || resolving.current) return;
    resolving.current = true;
    setBusy(true);
    void requestResolve(session.matchId, session.token)
      .catch((e) => {
        const msg = e instanceof Error ? e.message : "resolve_failed";
        // Concurrent resolve from the other phone is fine
        if (!/already_applied|wrong_phase|409/.test(msg)) {
          setError(msg);
          track(session.matchId, session.token, "action_error", { action: "resolve", code: "failed" });
        }
      })
      .finally(() => {
        resolving.current = false;
        setBusy(false);
        void refresh();
      });
  }, [phase, session.matchId, session.token, refresh]);

  const iHaveAdvantage =
    snap?.state.advantage_at_start === session.seat && !snap?.state.refresh_spend_seat && !advantageSpend;
  const canAct =
    (phase === "bid" &&
      ((session.seat === "A" && !snap?.state.pending_bid_a) ||
        (session.seat === "B" && !snap?.state.pending_bid_b))) ||
    myRole === "attack" ||
    myRole === "defend";

  async function onBid() {
    if (!bidPower || busy) return;
    setBusy(true);
    setError(null);
    try {
      await submitBid(session.matchId, session.token, bidPower);
      setBidPower(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "bid_failed");
      track(session.matchId, session.token, "action_error", { action: "bid", code: "failed" });
    } finally {
      setBusy(false);
    }
  }

  async function onCommit() {
    if (busy || (myRole !== "attack" && myRole !== "defend")) return;
    setBusy(true);
    setError(null);
    try {
      const spell = selected.name;
      await submitCommit({
        matchId: session.matchId,
        token: session.token,
        spell,
        power,
        advantageSpend,
      });
      setAdvantageSpend(null);
      setSpellIndex(0);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "commit_failed");
      track(session.matchId, session.token, "action_error", { action: "commit", code: "failed" });
    } finally {
      setBusy(false);
    }
  }

  const playerA = playerBySeat(snap?.players ?? [], "A");
  const playerB = playerBySeat(snap?.players ?? [], "B");
  const attackPlayer =
    playerBySeat(snap?.players ?? [], attackerSeat) ?? playerA;
  const defendPlayer =
    playerBySeat(snap?.players ?? [], defenderSeat) ?? playerB;
  const last = snap?.state.last_result as Record<string, unknown> | null;
  const leftLabel =
    attackerSeat && defendPlayer
      ? `${attackPlayer?.display_name ?? "Attacker"}${
          attackerSeat === session.seat ? " (you)" : ""
        }`
      : `${playerA?.display_name ?? "Seat A"}${
          session.seat === "A" ? " (you)" : ""
        }`;
  const rightLabel =
    attackerSeat && defenderSeat
      ? `${defendPlayer?.display_name ?? "Defender"}${
          defenderSeat === session.seat ? " (you)" : ""
        }`
      : `${playerB?.display_name ?? "Seat B"}${
          session.seat === "B" ? " (you)" : ""
        }`;
  const leftHp = attackerSeat ? attackPlayer?.health : playerA?.health;
  const rightHp = attackerSeat ? defendPlayer?.health : playerB?.health;

  const heading = (() => {
    if (!snap) return "Connecting…";
    if (phase === "lobby") return "Waiting for opponent";
    if (phase === "bid") return "Opening bid — higher power attacks first";
    if (phase === "finished") {
      const w = snap.match.winner_seat;
      if (w === "draw") return "Draw";
      if (w === session.seat) return "You win";
      return "You lose";
    }
    if (phase === "refresh") return "Prepare your power cards";
    if (phase === "resolve") return "Resolving exchange…";
    if (myRole === "attack") return "Attacking";
    if (myRole === "defend") return "Defend";
    if (phase === "attack_commit") return "Waiting for attacker";
    if (phase === "defense_commit") return "Waiting for defender";
    return phase ?? "…";
  })();

  return (
    <div>
      <div className="preview-bar" role="status">
        <span>
          Seat {session.seat} · {session.roomCode} · {session.name}
        </span>
        <button type="button" onClick={() => void refresh()} disabled={busy}>
          Refresh
        </button>
      </div>

      {error && (
        <p
          role="alert"
          style={{
            maxWidth: 590,
            margin: "0 auto 12px",
            padding: "10px 14px",
            borderRadius: 12,
            background: "color-mix(in srgb, #994829 18%, transparent)",
            font: "13px/1.4 Segoe UI, sans-serif",
          }}
        >
          {error}
        </p>
      )}

      <section className="duel-shell" aria-label="Wizard Duel online">
        <div className="top">
          <span className="brand">✦ Wizard Duel</span>
          <span>
            {phase === "bid" || phase === "lobby"
              ? "Setup"
              : `Exchange ${snap?.state.exchange_number ?? "—"}`}
          </span>
        </div>

        <div className="health" aria-label="Wizard health">
          <div>
            <span>{leftLabel}</span>
            <strong>{leftHp ?? "—"} HP</strong>
          </div>
          <div>
            <span>{rightLabel}</span>
            <strong>{rightHp ?? "—"} HP</strong>
          </div>
        </div>

        <div className="heading">
          <h2 aria-live="polite">{heading}</h2>
          {(myRole === "attack" || myRole === "defend") && (
            <button
              type="button"
              className="utility"
              aria-expanded={inspectOpen}
              onClick={() => { if (!inspectOpen) track(session.matchId, session.token, "inspect_open"); setInspectOpen((v) => !v); }}
            >
              Inspect
            </button>
          )}
        </div>

        {inspectOpen && me && (
          <div className="public">
            <p>
              Opponent discarded power{" "}
              <strong>
                {(
                  playerBySeat(
                    snap?.players ?? [],
                    session.seat === "A" ? "B" : "A",
                  )?.discarded_power ?? []
                ).join(" – ") || "none"}
              </strong>
            </p>
            {snap?.state.declared_school && myRole === "defend" && (
              <p>
                Declared school <strong>{snap.state.declared_school}</strong>
              </p>
            )}
          </div>
        )}

        {phase === "refresh" && (
          <div className="public">
            {snap?.state.advantage_at_start === session.seat ? <>
              <p>Spend Advantage to recover all discarded power, or keep it for this exchange.</p>
              <div className="advantage-actions">
                {[true, false].map(spend => <button key={String(spend)} disabled={busy} onClick={async () => {
                  setBusy(true);
                  try { await chooseRefresh(session.matchId, session.token, spend); await refresh(); }
                  catch { setError("refresh_choice_failed"); track(session.matchId, session.token, "action_error", {action:"refresh",code:"failed"}); }
                  finally { setBusy(false); }
                }}>{spend ? "Spend Advantage: recover power" : "Keep Advantage"}</button>)}
              </div>
            </> : <p>Waiting for the Advantage holder’s refresh choice.</p>}
          </div>
        )}
        {phase === "lobby" && (
          <div className="public">
            <p role="status">
              Share room code <strong>{session.roomCode}</strong> with your
              opponent.
            </p>
          </div>
        )}

        {phase === "bid" && (
          <div>
            <p className="small" style={{ marginBottom: 12 }}>
              Secretly choose one available power. Higher power attacks first.
              Ties discard both and re-bid.
            </p>
            {(session.seat === "A" && snap?.state.pending_bid_a) ||
            (session.seat === "B" && snap?.state.pending_bid_b) ? (
              <div className="public">
                <p role="status">Bid locked in — waiting for opponent.</p>
              </div>
            ) : (
              <>
                <div className="power">
                  <span className="eyebrow">Your bid</span>
                  <div className="numbers" role="group" aria-label="Bid power">
                    {([1, 2, 3, 4, 5] as PowerValue[]).map((value) => {
                      const gone = (me?.discarded_power ?? []).includes(value);
                      return (
                        <button
                          key={value}
                          type="button"
                          disabled={gone || busy}
                          aria-pressed={bidPower === value}
                          onClick={() => setBidPower(value)}
                        >
                          {value}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="footer">
                  <button
                    type="button"
                    className="main-action"
                    disabled={!bidPower || busy || !canAct}
                    onClick={() => void onBid()}
                  >
                    Commit bid
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {(myRole === "attack" || myRole === "defend") && (
          <div>
            {iHaveAdvantage && (
              <div className="public">
                <p>
                  <strong>Spend Advantage</strong>
                </p>
                <div className="advantage-actions">
                  <button
                    type="button"
                    className="utility"
                    disabled={busy || advantageSpend !== null}
                    onClick={() => setAdvantageSpend("boost")}
                  >
                    {myRole === "defend" ? "+2 prevention" : "+2 damage"}
                  </button>

                </div>
              </div>
            )}

            {advantageSpend && (
              <p className="small advantage-event" role="status">
                You will spend Advantage for{" "}
                {advantageSpend === "refresh" ? "refresh" : "combat boost"}.
              </p>
            )}

            {snap?.state.declared_school && myRole === "defend" && (
              <div className="public">
                <p>
                  Attacker declared <strong>{snap.state.declared_school}</strong>
                </p>
              </div>
            )}

            <div className="selection" aria-label="Spell and power layout">
              <section
                className={`spell ${selected.school.toLowerCase()}`}
                aria-label="Selected spell"
              >
                <div className="sigil" aria-hidden="true">
                  {SCHOOL_ICONS[selected.school]}
                </div>
                <div>
                  <p className="eyebrow kind">{selected.school}</p>
                  <h3>{selected.name}</h3>
                  <p className="rule">{selected.rule}</p>
                </div>
              </section>
              <div className="power">
                <span className="eyebrow">Power</span>
                <div className="numbers" role="group" aria-label="Power cards">
                  {([1, 2, 3, 4, 5] as PowerValue[]).map((value) => (
                    <button
                      key={value}
                      type="button"
                      disabled={discarded.includes(value) || busy}
                      aria-pressed={power === value}
                      onClick={() => setPower(value)}
                    >
                      {value}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="hand-title">
              <span className="eyebrow">
                {myRole === "defend" ? "Defense spells" : "Attack spells"}
              </span>
              <span className="small">
                {snap?.state.advantage_seat
                  ? `Advantage · Seat ${snap.state.advantage_seat}`
                  : "No Advantage"}
              </span>
            </div>
            <div
              className="hand"
              role="group"
              aria-label="Spells"
              data-defense={myRole === "defend"}
            >
              {cards.map((card, index) => (
                <button
                  key={card.name}
                  type="button"
                  className={`choice ${card.school.toLowerCase()}`}
                  aria-pressed={spellIndex === index}
                  disabled={busy}
                  onClick={() => setSpellIndex(index)}
                >
                  <strong>{card.name}</strong>
                  <span className="kind">
                    {myRole === "defend"
                      ? card.face
                      : `${card.school} · ${card.face}`}
                  </span>
                </button>
              ))}
            </div>
            <div className="footer">
              <button
                type="button"
                className="main-action"
                disabled={busy || !powers.includes(power)}
                onClick={() => void onCommit()}
              >
                {myRole === "defend" ? "Commit defense" : "Commit attack"}
              </button>
            </div>
          </div>
        )}

        {myRole === "spectator" &&
          phase !== "lobby" &&
          phase !== "bid" &&
          phase !== "finished" &&
          phase !== "resolve" && phase !== "refresh" && (
            <div className="public">
              <p role="status">Your spell and power stay hidden until reveal.</p>
              {snap?.state.declared_school && phase === "defense_commit" && (
                <p>
                  Declared school <strong>{snap.state.declared_school}</strong>
                </p>
              )}
            </div>
          )}

        {phase === "resolve" && (
          <div className="public">
            <p role="status">Both commits in — resolving on the server…</p>
          </div>
        )}

        {last && (phase === "refresh" || phase === "attack_commit" || phase === "finished") && (
          <div className="result">
            <div className="public" aria-live="polite">
              <p>
                {(last.attack_spell as string) ?? "Attack"} · Power{" "}
                {String(last.attack_power)} · {String(last.incoming_damage)}{" "}
                damage
              </p>
              <p>
                {(last.defense_spell as string) ?? "Defense"} · Power{" "}
                {String(last.defense_power)} · {String(last.prevention)}{" "}
                prevention
              </p>
              <p>
                Defender loses {String(last.damage_to_defender)} HP.
                {last.retaliation_to_attacker
                  ? ` Attacker loses ${String(last.retaliation_to_attacker)} HP to Reversal.`
                  : ""}{" "}
                Advantage ·{" "}
                {last.advantage_after
                  ? `Seat ${String(last.advantage_after)}`
                  : "None"}
                .
                {Array.isArray(last.followups)
                  ? ` ${(last.followups as string[]).join(" ")}`
                  : ""}
              </p>
            </div>
          </div>
        )}
      </section>

      <p
        className="small"
        style={{
          maxWidth: 590,
          margin: "14px auto 0",
          color: "light-dark(#60566b, #c3b7ce)",
          font: "13px/1.4 Segoe UI, sans-serif",
          textAlign: "center",
        }}
      >
        Reconnect uses the token in this browser&apos;s localStorage. Keep the
        same phone/browser for seat {session.seat}.
      </p>
    </div>
  );
}
