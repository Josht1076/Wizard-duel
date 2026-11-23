import { describe, expect, it } from "vitest";
import { createFreshPlayer, resolveExchange } from "./resolve";
import { formatExchangeMath, mathFromPayload } from "./mathDisplay";
import type { ExchangeInput } from "./types";

function baseInput(
  overrides: Partial<ExchangeInput> & { commit: ExchangeInput["commit"] },
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

describe("formatExchangeMath", () => {
  it("shows base + power + prep + boost + arriving for normal attacks", () => {
    const input = baseInput({
      advantageAtStart: "A",
      attacker: {
        ...createFreshPlayer("A"),
        storedDamage: 5,
        nextAttackBonus: 1,
      },
      commit: {
        attackSpell: "Full",
        attackPower: 4,
        defenseSpell: "Full",
        defensePower: 3,
        advantageSpend: "boost",
        advantageSpendSeat: "A",
      },
    });
    const lines = formatExchangeMath(resolveExchange(input).math);
    expect(lines.incoming).toBe(
      "3 base + 4 power + 1 prep + 2 boost + 5 arriving → 15 incoming",
    );
    expect(lines.prevention).toBe("3 base + 3 power → 6 prevention");
    expect(lines.damage).toBe("15 − 6 → 9 damage");
    expect(lines.retaliation).toBeNull();
    expect(lines.store).toBeNull();
  });

  it("labels Delayed banking and Reversal retaliation", () => {
    const delayed = resolveExchange(
      baseInput({
        commit: {
          attackSpell: "Delayed",
          attackPower: 5,
          defenseSpell: "Partial",
          defensePower: 2,
          advantageSpend: null,
          advantageSpendSeat: null,
        },
      }),
    );
    const delayedLines = formatExchangeMath(delayed.math);
    expect(delayedLines.incoming).toBe("0 new (Delayed) → 0 incoming");
    expect(delayedLines.store).toBe("5 power → 5 stored");

    const reversal = resolveExchange(
      baseInput({
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
    expect(formatExchangeMath(reversal.math).retaliation).toBe(
      "Reversal retal 3",
    );
  });

  it("reads math from payload or nested replay", () => {
    const result = resolveExchange(
      baseInput({
        commit: {
          attackSpell: "Hex",
          attackPower: 3,
          defenseSpell: "Counter",
          defensePower: 4,
          advantageSpend: null,
          advantageSpendSeat: null,
        },
      }),
    );
    expect(mathFromPayload({ math: result.math })?.incoming.total).toBe(
      result.incomingDamage,
    );
    expect(
      mathFromPayload({ replay: { result: { math: result.math } } })?.prevention
        .total,
    ).toBe(result.prevention);
    expect(mathFromPayload({})).toBeNull();
  });
});
