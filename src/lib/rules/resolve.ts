import { getAttackCard, getDefenseCard } from "./cards";
import type {
  AdvantageHolder,
  ExchangeInput,
  ExchangeMath,
  ExchangeResult,
  PowerValue,
  Seat,
} from "./types";

function availablePower(discarded: PowerValue[]): PowerValue[] {
  return ([1, 2, 3, 4, 5] as PowerValue[]).filter((p) => !discarded.includes(p));
}

function withoutPower(
  discarded: PowerValue[],
  power: PowerValue,
): PowerValue[] {
  return [...discarded, power].sort((a, b) => a - b) as PowerValue[];
}

function recoverPower(
  discarded: PowerValue[],
  power: PowerValue,
): PowerValue[] {
  return discarded.filter((p) => p !== power) as PowerValue[];
}

/**
 * Resolve one attack/defense exchange per playtest rules.
 * Advantage spend (boost/refresh) must already be reflected in commit;
 * refresh is applied here before power discard math.
 */
export function resolveExchange(input: ExchangeInput): ExchangeResult {
  const {
    attackerSeat,
    defenderSeat,
    advantageAtStart,
    attacker,
    defender,
    commit,
  } = input;

  const attackCard = getAttackCard(commit.attackSpell);
  const defenseCard = getDefenseCard(commit.defenseSpell);

  let attackerDiscarded = [...attacker.discardedPower] as PowerValue[];
  let defenderDiscarded = [...defender.discardedPower] as PowerValue[];

  // Refresh: empty hand auto-refresh, or Advantage refresh spend
  if (availablePower(attackerDiscarded).length === 0) {
    attackerDiscarded = [];
  }
  if (availablePower(defenderDiscarded).length === 0) {
    defenderDiscarded = [];
  }

  let advantage: AdvantageHolder = advantageAtStart;
  const spend = commit.advantageSpend;
  const spendSeat = commit.advantageSpendSeat;

  if (spend && spendSeat && advantageAtStart === spendSeat) {
    if (spend === "refresh") {
      if (spendSeat === attackerSeat) attackerDiscarded = [];
      else defenderDiscarded = [];
    }
    // Spending immediately passes the token to the opponent
    advantage = spendSeat === attackerSeat ? defenderSeat : attackerSeat;
  }

  if (spend && (!spendSeat || advantageAtStart !== spendSeat)) throw new Error("invalid_advantage_owner");
  if (!availablePower(attackerDiscarded).includes(commit.attackPower) || !availablePower(defenderDiscarded).includes(commit.defensePower)) {
    throw new Error("power_unavailable");
  }

  const attackBoost =
    spend === "boost" && spendSeat === attackerSeat ? 2 : 0;
  const defendBoost =
    spend === "boost" && spendSeat === defenderSeat ? 2 : 0;

  const arrivingStored = attacker.storedDamage;
  const partialAttackBonus = attacker.nextAttackBonus;
  const partialDefenseBonus = defender.nextDefenseBonus;

  const isGather = commit.attackSpell === "Gather";
  const isDelayed = commit.attackSpell === "Delayed";

  // Gather / Delayed replace normal attack calculation for "new" damage
  const attackBase = isGather || isDelayed ? 0 : attackCard.baseDamage;
  const attackPowerTerm = isGather || isDelayed ? 0 : commit.attackPower;
  const attackPrepTerm = isGather || isDelayed ? 0 : partialAttackBonus;
  const attackBoostTerm = isGather || isDelayed ? 0 : attackBoost;
  const newDamage =
    attackBase + attackPowerTerm + attackPrepTerm + attackBoostTerm;

  // Gather: attacking Advantage boost adds +2 only if stored damage is arriving
  const gatherBoost =
    isGather && arrivingStored > 0 ? attackBoost : 0;

  const incoming = newDamage + arrivingStored + gatherBoost;

  const preventionBase = defenseCard.basePrevention;
  const prevention =
    preventionBase +
    commit.defensePower +
    partialDefenseBonus +
    defendBoost;

  const damageToDefender = Math.max(0, incoming - prevention);

  // Reversal compares raw power card numbers, without bonuses
  const retaliationToAttacker =
    commit.defenseSpell === "Reversal"
      ? Math.max(0, commit.defensePower - commit.attackPower)
      : 0;

  const attackerHealth = attacker.health - retaliationToAttacker;
  const defenderHealth = defender.health - damageToDefender;

  // --- Advantage ---
  const half = Math.floor(incoming / 2);
  advantage = resolveAdvantage({
    current: advantage,
    attackSpell: commit.attackSpell,
    defenseSpell: commit.defenseSpell,
    damageToDefender,
    incoming,
    half,
    attackerSeat,
    defenderSeat,
    arrivingStored,
  });

  // --- Power discards ---
  // Attack: discard played power (Gather recovers after)
  attackerDiscarded = withoutPower(attackerDiscarded, commit.attackPower);

  let gatherRecovered: number | null = null;
  if (isGather) {
    const want = (commit.attackPower + 1) as number;
    const recovered =
      want <= 5 && attackerDiscarded.includes(want as PowerValue)
        ? (want as PowerValue)
        : commit.attackPower;
    gatherRecovered = recovered;
    // Gather discards played, then recovers Power+1 or played
    // Played is already in discard; recover preferred target
    if (attackerDiscarded.includes(recovered)) {
      attackerDiscarded = recoverPower(attackerDiscarded, recovered);
    }
  }

  // Hex: defender discards highest available instead of played (unless played was highest)
  if (commit.attackSpell === "Hex") {
    const availableBefore = availablePower(defenderDiscarded);
    const highest = Math.max(...availableBefore) as PowerValue;
    defenderDiscarded = withoutPower(defenderDiscarded, highest);
  } else {
    defenderDiscarded = withoutPower(defenderDiscarded, commit.defensePower);
  }

  // --- Stored damage / preparations ---
  let attackerStoredDamage = 0;
  let storeMath: ExchangeMath["store"] = null;
  // Arriving stored is consumed this exchange
  if (isDelayed) {
    // New Delayed stores Power + attack bonuses (prep + boost); does not boost arriving packet
    attackerStoredDamage =
      commit.attackPower + partialAttackBonus + attackBoost;
    storeMath = {
      power: commit.attackPower,
      prep: partialAttackBonus,
      boost: attackBoost,
      total: attackerStoredDamage,
    };
  }

  // Partial attack prepares +1 prevention for attacker's next defense
  const attackerNextDefenseBonus =
    commit.attackSpell === "Partial" ? 1 : 0;
  // Partial defense prepares +1 damage for defender's next attack
  const defenderNextAttackBonus =
    commit.defenseSpell === "Partial" ? 1 : 0;

  // Consumed: attacker's nextAttackBonus and defender's nextDefenseBonus expire
  // (reflected by not carrying them forward in result fields above)

  const followups: string[] = [];
  if (retaliationToAttacker > 0) {
    followups.push(
      `Attacker loses ${retaliationToAttacker} HP to Reversal.`,
    );
  }
  if (isDelayed) {
    followups.push(`Attacker stores ${attackerStoredDamage} damage.`);
  }
  if (isGather) followups.push(`Attacker recovers Power ${gatherRecovered}.`);
  if (commit.attackSpell === "Partial") {
    followups.push("Attacker prepares +1 prevention.");
  }
  if (commit.defenseSpell === "Partial") {
    followups.push("Defender prepares +1 damage.");
  }

  let winner: Seat | "draw" | null = null;
  const attackerDead = attackerHealth <= 0;
  const defenderDead = defenderHealth <= 0;
  if (attackerDead && defenderDead) winner = "draw";
  else if (attackerDead) winner = defenderSeat;
  else if (defenderDead) winner = attackerSeat;

  const math: ExchangeMath = {
    incoming: {
      base: attackBase,
      power: attackPowerTerm,
      prep: attackPrepTerm,
      boost: attackBoostTerm,
      arriving: arrivingStored,
      gatherBoost,
      mode: isDelayed ? "delayed" : isGather ? "gather" : "normal",
      total: incoming,
    },
    prevention: {
      base: preventionBase,
      power: commit.defensePower,
      prep: partialDefenseBonus,
      boost: defendBoost,
      total: prevention,
    },
    damageToDefender,
    retaliationToAttacker,
    store: storeMath,
  };

  return {
    incomingDamage: incoming,
    prevention,
    damageToDefender,
    retaliationToAttacker,
    attackerHealth,
    defenderHealth,
    advantageAfter: advantage,
    attackerDiscardedPower: attackerDiscarded,
    defenderDiscardedPower: defenderDiscarded,
    attackerStoredDamage,
    attackerNextDefenseBonus,
    defenderNextAttackBonus,
    followups,
    winner,
    math,
  };
}

function resolveAdvantage(args: {
  current: AdvantageHolder;
  attackSpell: string;
  defenseSpell: string;
  damageToDefender: number;
  incoming: number;
  half: number;
  attackerSeat: Seat;
  defenderSeat: Seat;
  arrivingStored: number;
}): AdvantageHolder {
  const {
    current,
    attackSpell,
    defenseSpell,
    damageToDefender,
    incoming,
    half,
    attackerSeat,
    defenderSeat,
    arrivingStored,
  } = args;

  // Gather: awards no Advantage, even when stored damage arrives
  if (attackSpell === "Gather") {
    return current;
  }

  // Delayed with no arriving damage: Full/Reversal unchanged; Partial/Counter → Defender
  if (attackSpell === "Delayed" && arrivingStored === 0) {
    if (defenseSpell === "Full" || defenseSpell === "Reversal") {
      return current;
    }
    return defenderSeat;
  }

  // Default table
  let next: AdvantageHolder = current;
  if (damageToDefender === 0) {
    next = defenderSeat;
  } else if (damageToDefender > half) {
    next = attackerSeat;
  } else {
    next = current; // 1 through half: no change
  }

  // Counter: defender gains Advantage at 0 through half
  if (defenseSpell === "Counter" && damageToDefender <= half) {
    next = defenderSeat;
  }

  // Feint exceptions
  if (attackSpell === "Feint") {
    if (defenseSpell === "Full") {
      next = attackerSeat;
    } else if (defenseSpell === "Reversal" && damageToDefender > 0) {
      next = attackerSeat;
    }
  }

  return next;
}

export function createFreshPlayer(seat: Seat) {
  return {
    seat,
    health: 12,
    discardedPower: [] as PowerValue[],
    storedDamage: 0,
    nextAttackBonus: 0,
    nextDefenseBonus: 0,
  };
}
