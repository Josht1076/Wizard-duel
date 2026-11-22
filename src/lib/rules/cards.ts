import type { AttackCard, DefenseCard } from "./types";

export const ATTACK_CARDS: AttackCard[] = [
  {
    name: "Full",
    school: "Fire",
    baseDamage: 3,
    rule: "3 ⚔ damage",
    face: "3 ⚔",
  },
  {
    name: "Feint",
    school: "Fire",
    baseDamage: 1,
    rule: "1 ⚔ damage. Gain Advantage against Full defense, or against Reversal if damage gets through.",
    face: "1 ⚔",
  },
  {
    name: "Partial",
    school: "Ice",
    baseDamage: 2,
    rule: "2 ⚔ damage. Next defense gains +1 prevention.",
    face: "2 ⚔",
  },
  {
    name: "Gather",
    school: "Ice",
    baseDamage: 0,
    rule: "No new damage. Discard played power and recover Power + 1, or recover played power if unavailable. No Advantage award.",
    face: "Recover power",
  },
  {
    name: "Hex",
    school: "Illusion",
    baseDamage: 1,
    rule: "1 ⚔ damage. The defender discards their highest power instead of their played power.",
    face: "1 ⚔",
  },
  {
    name: "Delayed",
    school: "Illusion",
    baseDamage: 0,
    rule: "Store Power as damage, plus attack bonuses. Add it to your next attack. No new damage now.",
    face: "Store damage",
  },
];

export const DEFENSE_CARDS: DefenseCard[] = [
  {
    name: "Full",
    school: "Defense",
    basePrevention: 3,
    rule: "3 🛡 prevention",
    face: "3 🛡",
  },
  {
    name: "Partial",
    school: "Defense",
    basePrevention: 2,
    rule: "2 🛡 prevention. Next attack gains +1 damage.",
    face: "2 🛡",
  },
  {
    name: "Counter",
    school: "Defense",
    basePrevention: 1,
    rule: "1 🛡 prevention. Gain Advantage if damage taken is at most half the incoming damage, rounded down.",
    face: "1 🛡",
  },
  {
    name: "Reversal",
    school: "Defense",
    basePrevention: 0,
    rule: "0 🛡 base prevention. If your Power is higher, deal the difference to the attacker.",
    face: "0 🛡",
  },
];

export const SCHOOL_ICONS: Record<string, string> = {
  Fire: "♨",
  Ice: "❄",
  Illusion: "✧",
  Defense: "◈",
};

export function getAttackCard(name: string): AttackCard {
  const card = ATTACK_CARDS.find((c) => c.name === name);
  if (!card) throw new Error(`Unknown attack spell: ${name}`);
  return card;
}

export function getDefenseCard(name: string): DefenseCard {
  const card = DEFENSE_CARDS.find((c) => c.name === name);
  if (!card) throw new Error(`Unknown defense spell: ${name}`);
  return card;
}
