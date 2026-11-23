import { describe, expect, it } from "vitest";
import { createFreshPlayer, resolveExchange } from "./resolve";
import type { ExchangeInput } from "./types";

function baseInput(
  overrides: Partial<ExchangeInput> & {
    commit: ExchangeInput["commit"];
  },
): ExchangeInput {
  return {
    attackerSeat: "A",
    defenderSeat: "B",
    advantageAtStart: null,
    attacker: createFreshPlayer("A"),
    defender: createFreshPlayer("B"),
    ...overrides,
  };
}

describe("resolveExchange", () => {
  it("Full@5 vs Full@3: 8 incoming, 6 prevention, 2 damage, Advantage unchanged", () => {
    const result = resolveExchange(
      baseInput({
        advantageAtStart: "B",
        commit: {
          attackSpell: "Full",
          attackPower: 5,
          defenseSpell: "Full",
          defensePower: 3,
          advantageSpend: null,
          advantageSpendSeat: null,
        },
      }),
    );

    expect(result.incomingDamage).toBe(8); // 3 + 5
    expect(result.prevention).toBe(6); // 3 + 3
    expect(result.damageToDefender).toBe(2);
    expect(result.retaliationToAttacker).toBe(0);
    expect(result.defenderHealth).toBe(10);
    expect(result.attackerHealth).toBe(12);
    // 2 is positive and ≤ half of 8 (4) → no change
    expect(result.advantageAfter).toBe("B");
    expect(result.math.incoming).toMatchObject({
      base: 3,
      power: 5,
      prep: 0,
      boost: 0,
      arriving: 0,
      total: 8,
      mode: "normal",
    });
    expect(result.math.prevention).toMatchObject({
      base: 3,
      power: 3,
      prep: 0,
      boost: 0,
      total: 6,
    });
  });

  it("Feint vs Full: attacker always gains Advantage", () => {
    const result = resolveExchange(
      baseInput({
        advantageAtStart: "B",
        commit: {
          attackSpell: "Feint",
          attackPower: 4,
          defenseSpell: "Full",
          defensePower: 3,
          advantageSpend: null,
          advantageSpendSeat: null,
        },
      }),
    );

    // Feint 1 + 4 = 5 incoming; Full 3+3 = 6 prevention → 0 damage
    expect(result.incomingDamage).toBe(5);
    expect(result.prevention).toBe(6);
    expect(result.damageToDefender).toBe(0);
    // Normal table would give Defender Advantage at 0, but Feint vs Full → Attacker
    expect(result.advantageAfter).toBe("A");
  });

  it("Reversal: higher defense power retaliates the difference", () => {
    const result = resolveExchange(
      baseInput({
        advantageAtStart: null,
        commit: {
          attackSpell: "Full",
          attackPower: 2,
          defenseSpell: "Reversal",
          defensePower: 5,
          advantageSpend: null,
          advantageSpendSeat: null,
        },
      }),
    );

    // Full 3+2 = 5 incoming; Reversal 0+5 = 5 prevention → 0 damage
    expect(result.incomingDamage).toBe(5);
    expect(result.prevention).toBe(5);
    expect(result.damageToDefender).toBe(0);
    // Retaliation: 5 - 2 = 3
    expect(result.retaliationToAttacker).toBe(3);
    expect(result.attackerHealth).toBe(9);
    expect(result.defenderHealth).toBe(12);
    // 0 damage → Defender gains Advantage; retaliation does not affect Advantage
    expect(result.advantageAfter).toBe("B");
  });
});
