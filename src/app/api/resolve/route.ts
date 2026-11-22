import { NextResponse } from "next/server";
import {
  resolveExchange,
  type AttackSpell,
  type DefenseSpell,
  type PowerValue,
  type Seat,
} from "@/lib/rules";
import { createServerSupabaseClient } from "@/lib/supabase/client";
import type { ResolveBundle } from "@/lib/match/types";

type Body = {
  matchId?: string;
  token?: string;
};

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const matchId = body.matchId?.trim();
  const token = body.token?.trim();
  if (!matchId || !token) {
    return NextResponse.json(
      { error: "matchId_and_token_required" },
      { status: 400 },
    );
  }

  let sb;
  try {
    sb = createServerSupabaseClient();
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "supabase_unconfigured" },
      { status: 500 },
    );
  }

  const { data: bundleRaw, error: fetchError } = await sb.rpc(
    "wd_fetch_resolve_bundle",
    { p_match_id: matchId, p_token: token },
  );

  if (fetchError) {
    const msg = fetchError.message ?? "fetch_bundle_failed";
    const status = msg.includes("wrong_phase") ? 409 : 400;
    return NextResponse.json({ error: msg }, { status });
  }

  const bundle = bundleRaw as ResolveBundle;

  const attackSpend = bundle.attack.advantage_spend;
  const defendSpend = bundle.defend.advantage_spend;
  const advantageSpend = attackSpend ?? defendSpend ?? null;
  const advantageSpendSeat: Seat | null = attackSpend
    ? bundle.attack.seat
    : defendSpend
      ? bundle.defend.seat
      : null;

  const prep = (p: ResolveBundle["attacker"]["preparations"]) => ({
    nextAttackBonus: Number(p?.nextAttackBonus ?? 0),
    nextDefenseBonus: Number(p?.nextDefenseBonus ?? 0),
  });

  const attackerPrep = prep(bundle.attacker.preparations);
  const defenderPrep = prep(bundle.defender.preparations);

  const result = resolveExchange({
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
  });

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
  };

  const { data: applied, error: applyError } = await sb.rpc(
    "wd_apply_resolution",
    {
      p_match_id: matchId,
      p_token: token,
      p_result: payload,
    },
  );

  if (applyError) {
    return NextResponse.json(
      { error: applyError.message ?? "apply_failed" },
      { status: 400 },
    );
  }

  return NextResponse.json({
    status: "ok",
    applied,
    result: payload,
  });
}
