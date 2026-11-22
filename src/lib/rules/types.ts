export type Seat = "A" | "B";
export type Role = "attack" | "defend";
export type School = "Fire" | "Ice" | "Illusion" | "Defense";

export type AttackSpell =
  | "Full"
  | "Feint"
  | "Partial"
  | "Gather"
  | "Hex"
  | "Delayed";

export type DefenseSpell = "Full" | "Partial" | "Counter" | "Reversal";

export type PowerValue = 1 | 2 | 3 | 4 | 5;

export type AdvantageSpend = "boost" | "refresh" | null;

export type AdvantageHolder = Seat | null;

export interface AttackCard {
  name: AttackSpell;
  school: Exclude<School, "Defense">;
  baseDamage: number;
  rule: string;
  face: string;
}

export interface DefenseCard {
  name: DefenseSpell;
  school: "Defense";
  basePrevention: number;
  rule: string;
  face: string;
}

export interface PlayerPublicState {
  seat: Seat;
  health: number;
  discardedPower: PowerValue[];
  storedDamage: number;
  nextAttackBonus: number;
  nextDefenseBonus: number;
}

export interface ExchangeCommit {
  attackSpell: AttackSpell;
  attackPower: PowerValue;
  defenseSpell: DefenseSpell;
  defensePower: PowerValue;
  /** Advantage spend chosen by the holder at exchange start (once). */
  advantageSpend: AdvantageSpend;
  /** Which seat spent Advantage this exchange, if any. */
  advantageSpendSeat: Seat | null;
}

export interface ExchangeInput {
  attackerSeat: Seat;
  defenderSeat: Seat;
  /** Advantage holder at the start of the exchange (before spend). */
  advantageAtStart: AdvantageHolder;
  attacker: PlayerPublicState;
  defender: PlayerPublicState;
  commit: ExchangeCommit;
}

export interface ExchangeResult {
  incomingDamage: number;
  prevention: number;
  damageToDefender: number;
  retaliationToAttacker: number;
  attackerHealth: number;
  defenderHealth: number;
  advantageAfter: AdvantageHolder;
  attackerDiscardedPower: PowerValue[];
  defenderDiscardedPower: PowerValue[];
  attackerStoredDamage: number;
  attackerNextDefenseBonus: number;
  defenderNextAttackBonus: number;
  followups: string[];
  winner: Seat | "draw" | null;
}
