"use client";

import { useMemo, useState } from "react";
import {
  ATTACK_CARDS,
  DEFENSE_CARDS,
  SCHOOL_ICONS,
  createFreshPlayer,
  resolveExchange,
  type AttackSpell,
  type DefenseSpell,
  type PowerValue,
} from "@/lib/rules";

type PreviewRole = "attack" | "defend";
type Phase = "choose" | "waiting" | "resolved";
type Spend = { role: PreviewRole; action: "boost" | "refresh" } | null;

const INITIAL_SPENT = {
  attack: [2, 4] as PowerValue[],
  defend: [2] as PowerValue[],
};

export function DuelBoard({
  roomCode,
  seatLabel = "Local playtest",
}: {
  roomCode?: string;
  seatLabel?: string;
}) {
  const [previewRole, setPreviewRole] = useState<PreviewRole>("attack");
  const [phase, setPhase] = useState<Phase>("choose");
  const [spend, setSpend] = useState<Spend>(null);
  const [attackChoice, setAttackChoice] = useState<[number, PowerValue]>([0, 5]);
  const [defendChoice, setDefendChoice] = useState<[number, PowerValue]>([0, 3]);
  const [inspectOpen, setInspectOpen] = useState(false);
  const [advantageHolder, setAdvantageHolder] = useState<"Attacker" | "Defender">(
    "Defender",
  );
  const [health, setHealth] = useState({ attack: 12, defend: 12 });
  const [outcome, setOutcome] = useState({
    attack: "",
    defense: "",
    text: "",
  });
  const sample = useMemo(
    () => ({ delay: 0 as number, partial: 0 as number }),
    [],
  );

  const cards = previewRole === "attack" ? ATTACK_CARDS : DEFENSE_CARDS;
  const choice = previewRole === "attack" ? attackChoice : defendChoice;
  const setChoice =
    previewRole === "attack" ? setAttackChoice : setDefendChoice;

  const discardedFor = (role: PreviewRole) =>
    spend?.role === role && spend.action === "refresh"
      ? ([] as PowerValue[])
      : INITIAL_SPENT[role];

  const availablePower = (role: PreviewRole) =>
    ([1, 2, 3, 4, 5] as PowerValue[]).filter(
      (p) => !discardedFor(role).includes(p),
    );

  const currentHolder = () =>
    spend
      ? spend.role === "attack"
        ? "Defender"
        : "Attacker"
      : advantageHolder;

  const canSpend =
    phase === "choose" &&
    !spend &&
    advantageHolder === (previewRole === "attack" ? "Attacker" : "Defender");

  const selectedCard = cards[choice[0]];
  const schoolClass = selectedCard.school.toLowerCase();

  function resetPreview(role: PreviewRole = previewRole) {
    setPhase("choose");
    setSpend(null);
    setAttackChoice([0, 5]);
    setDefendChoice([0, 3]);
    setHealth({ attack: 12, defend: 12 });
    setInspectOpen(false);
    setPreviewRole(role);
  }

  function spendAdvantage(action: "boost" | "refresh") {
    if (!canSpend) return;
    setSpend({ role: previewRole, action });
  }

  function resolve() {
    const [attackIndex, attackPower] = attackChoice;
    const [defenseIndex, defensePower] = defendChoice;
    const attack = ATTACK_CARDS[attackIndex];
    const defense = DEFENSE_CARDS[defenseIndex];

    const attacker = {
      ...createFreshPlayer("A"),
      discardedPower: discardedFor("attack").filter(
        (p) => !(spend?.role === "attack" && spend.action === "refresh"),
      ),
      storedDamage: sample.delay,
      nextAttackBonus: sample.partial,
    };
    // Refresh already applied via discardedFor when spend is refresh
    if (spend?.role === "attack" && spend.action === "refresh") {
      attacker.discardedPower = [];
    }

    const defender = {
      ...createFreshPlayer("B"),
      discardedPower:
        spend?.role === "defend" && spend.action === "refresh"
          ? []
          : [...INITIAL_SPENT.defend],
      nextDefenseBonus: 0,
    };

    const advantageAtStart =
      advantageHolder === "Attacker" ? ("A" as const) : ("B" as const);

    const result = resolveExchange({
      attackerSeat: "A",
      defenderSeat: "B",
      advantageAtStart,
      attacker,
      defender,
      commit: {
        attackSpell: attack.name as AttackSpell,
        attackPower,
        defenseSpell: defense.name as DefenseSpell,
        defensePower,
        advantageSpend: spend?.action ?? null,
        advantageSpendSeat: spend
          ? spend.role === "attack"
            ? "A"
            : "B"
          : null,
      },
    });

    setHealth({
      attack: result.attackerHealth,
      defend: result.defenderHealth,
    });
    if (result.advantageAfter === "A") setAdvantageHolder("Attacker");
    else if (result.advantageAfter === "B") setAdvantageHolder("Defender");

    setOutcome({
      attack: `${attack.name} · ${attack.school} · Power ${attackPower} · ${result.incomingDamage} damage`,
      defense: `${defense.name} defense · Power ${defensePower} · ${result.prevention} prevention`,
      text: `Defender loses ${result.damageToDefender} HP. Advantage · ${
        result.advantageAfter === "A"
          ? "Attacker"
          : result.advantageAfter === "B"
            ? "Defender"
            : "None"
      }. ${result.followups.join(" ")}`,
    });
    setPhase("resolved");
    setInspectOpen(false);
  }

  function onCommit() {
    if (phase !== "choose") return;
    if (previewRole === "defend") {
      resolve();
      return;
    }
    setPhase("waiting");
    setInspectOpen(false);
  }

  return (
    <div>
      <div className="preview-bar" role="group" aria-label="Local role preview">
        <span>{seatLabel}{roomCode ? ` · ${roomCode}` : ""}</span>
        <button
          type="button"
          aria-pressed={previewRole === "attack"}
          onClick={() => resetPreview("attack")}
        >
          Attacker
        </button>
        <button
          type="button"
          aria-pressed={previewRole === "defend"}
          onClick={() => resetPreview("defend")}
        >
          Defender
        </button>
        {phase === "waiting" && (
          <button type="button" onClick={() => resolve()}>
            Simulate defense commit
          </button>
        )}
        {phase === "resolved" && (
          <button type="button" onClick={() => resetPreview()}>
            Replay exchange
          </button>
        )}
      </div>

      <section className="duel-shell" aria-label="Wizard Duel playtest">
        <div className="top">
          <span className="brand">✦ Wizard Duel</span>
          <span>Exchange 1</span>
        </div>
        <div className="health" aria-label="Wizard health">
          <div>
            <span>Attacker</span>
            <strong>{health.attack} HP</strong>
          </div>
          <div>
            <span>Defender</span>
            <strong>{health.defend} HP</strong>
          </div>
        </div>
        <div className="heading">
          <h2 aria-live="polite">
            {phase === "resolved"
              ? "Exchange resolved"
              : phase === "waiting"
                ? "Waiting for defense"
                : previewRole === "defend"
                  ? "Defend"
                  : "Attacking"}
          </h2>
          {phase === "choose" && (
            <button
              type="button"
              className="utility"
              aria-expanded={inspectOpen}
              onClick={() => setInspectOpen((v) => !v)}
            >
              Inspect
            </button>
          )}
        </div>

        {inspectOpen && (
          <div className="public">
            <p>
              <strong>
                {previewRole === "defend" ? ATTACK_CARDS[attackChoice[0]].school : "Defender"}
              </strong>
              {currentHolder() ===
              (previewRole === "defend" ? "Attacker" : "Defender")
                ? previewRole === "defend"
                  ? " · Has Advantage"
                  : " has Advantage"
                : ""}
            </p>
            <p>
              Available power{" "}
              <strong>
                {availablePower(
                  previewRole === "defend" ? "attack" : "defend",
                ).join(" – ")}
              </strong>
            </p>
          </div>
        )}

        {phase === "choose" && (
          <div>
            <p className="small advantage-event" role="status">
              {spend
                ? `${spend.role === "attack" ? "Attacker" : "Defender"}${
                    spend.action === "refresh"
                      ? " refreshed their power deck."
                      : spend.role === "attack"
                        ? " spent Advantage for +2 damage."
                        : " spent Advantage for +2 prevention."
                  }`
                : ""}
            </p>

            {canSpend && (
              <div className="public">
                <p>
                  <strong>Spend Advantage</strong>
                </p>
                <div className="advantage-actions">
                  <button
                    type="button"
                    className="utility"
                    onClick={() => spendAdvantage("boost")}
                  >
                    {previewRole === "defend" ? "+2 prevention" : "+2 damage"}
                  </button>
                  <button
                    type="button"
                    className="utility"
                    onClick={() => spendAdvantage("refresh")}
                  >
                    Refresh power deck
                  </button>
                </div>
              </div>
            )}

            <div className="selection" aria-label="Spell and power layout">
              <section
                className={`spell ${schoolClass}`}
                aria-label="Selected spell"
                aria-live="polite"
              >
                <div className="sigil" aria-hidden="true">
                  {SCHOOL_ICONS[selectedCard.school]}
                </div>
                <div>
                  <p className="eyebrow kind">{selectedCard.school}</p>
                  <h3>{selectedCard.name}</h3>
                  <p className="rule">{selectedCard.rule}</p>
                </div>
              </section>
              <div className="power">
                <span className="eyebrow">Power</span>
                <div className="numbers" role="group" aria-label="Power cards">
                  {([1, 2, 3, 4, 5] as PowerValue[]).map((value) => (
                    <button
                      key={value}
                      type="button"
                      disabled={discardedFor(previewRole).includes(value)}
                      aria-pressed={choice[1] === value}
                      aria-label={`Power ${value}${
                        discardedFor(previewRole).includes(value)
                          ? ", discarded"
                          : ""
                      }`}
                      onClick={() => setChoice([choice[0], value])}
                    >
                      {value}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="hand-title">
              <span className="eyebrow">
                {previewRole === "defend" ? "Defense spells" : "Attack spells"}
              </span>
              <span className="small">{currentHolder()} has Advantage</span>
            </div>
            <div
              className="hand"
              role="group"
              aria-label="Spells"
              data-defense={previewRole === "defend"}
            >
              {cards.map((card, index) => (
                <button
                  key={card.name}
                  type="button"
                  className={`choice ${card.school.toLowerCase()}`}
                  aria-pressed={choice[0] === index}
                  onClick={() => setChoice([index, choice[1]])}
                >
                  <strong>{card.name}</strong>
                  <span className="kind">
                    {previewRole === "defend"
                      ? card.face
                      : `${card.school} · ${card.face}`}
                  </span>
                </button>
              ))}
            </div>
            <div className="footer">
              <button type="button" className="main-action" onClick={onCommit}>
                {previewRole === "defend" ? "Commit defense" : "Commit attack"}
              </button>
            </div>
          </div>
        )}

        {phase === "waiting" && (
          <div className="public">
            <p role="status">Your spell and power are locked in.</p>
          </div>
        )}

        {phase === "resolved" && (
          <div className="result">
            <div className="public" aria-live="polite">
              <p>{outcome.attack}</p>
              <p>{outcome.defense}</p>
              <p>{outcome.text}</p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
