import { resolveExchange, type ExchangeInput, type AttackSpell, type DefenseSpell, type PowerValue, type Seat } from "../rules";
import type { ResolveBundle } from "./types";
export function resolveBundle(bundle: ResolveBundle) {
  const attackSpend = bundle.attack.advantage_spend;
  const defendSpend = bundle.defend.advantage_spend;
  const advantageSpend = attackSpend ?? defendSpend ?? (bundle.refresh_spend_seat ? "refresh" : null);
  const advantageSpendSeat: Seat | null = attackSpend
    ? bundle.attack.seat
    : defendSpend
      ? bundle.defend.seat
      : bundle.refresh_spend_seat ?? null;

  const prep = (p: ResolveBundle["attacker"]["preparations"]) => ({
    nextAttackBonus: Number(p?.nextAttackBonus ?? 0),
    nextDefenseBonus: Number(p?.nextDefenseBonus ?? 0),
  });

  const attackerPrep = prep(bundle.attacker.preparations);
  const defenderPrep = prep(bundle.defender.preparations);

  const input: ExchangeInput = {
    attackerSeat: bundle.attacker_seat,
    defenderSeat: bundle.defender_seat,
    advantageAtStart: bundle.advantage_at_start,
    attacker: {
      seat: bundle.attacker_seat,
      health: bundle.attacker.health,
      discardedPower: bundle.attacker.discarded_power as PowerValue[],
      storedDamage: bundle.attacker.stored_damage,
      nextAttackBonus: attackerPrep.nextAttackBonus,
      nextDefenseBonus: attackerPrep.nextDefenseBonus,
    },
    defender: {
      seat: bundle.defender_seat,
      health: bundle.defender.health,
      discardedPower: bundle.defender.discarded_power as PowerValue[],
      storedDamage: bundle.defender.stored_damage,
      nextAttackBonus: defenderPrep.nextAttackBonus,
      nextDefenseBonus: defenderPrep.nextDefenseBonus,
    },
    commit: {
      attackSpell: bundle.attack.spell as AttackSpell,
      attackPower: bundle.attack.power as PowerValue,
      defenseSpell: bundle.defend.spell as DefenseSpell,
      defensePower: bundle.defend.power as PowerValue,
      advantageSpend,
      advantageSpendSeat,
    },
  };
  const result = resolveExchange(input);

  const payload = {
    exchange_number: bundle.exchange_number,
    attacker_seat: bundle.attacker_seat,
    defender_seat: bundle.defender_seat,
    attack_spell: bundle.attack.spell,
    attack_power: bundle.attack.power,
    defense_spell: bundle.defend.spell,
    defense_power: bundle.defend.power,
    advantage_spend: advantageSpend,
    advantage_spend_seat: advantageSpendSeat,
    incoming_damage: result.incomingDamage,
    prevention: result.prevention,
    damage_to_defender: result.damageToDefender,
    retaliation_to_attacker: result.retaliationToAttacker,
    attacker_health: result.attackerHealth,
    defender_health: result.defenderHealth,
    advantage_after: result.advantageAfter,
    attacker_discarded_power: result.attackerDiscardedPower,
    defender_discarded_power: result.defenderDiscardedPower,
    attacker_stored_damage: result.attackerStoredDamage,
    attacker_next_defense_bonus: result.attackerNextDefenseBonus,
    defender_next_attack_bonus: result.defenderNextAttackBonus,
    followups: result.followups,
    winner: result.winner,
    replay: { input, result, engine_version: "power-engine-2" },
  };

  return payload;
}
