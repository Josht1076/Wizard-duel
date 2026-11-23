import type { ExchangeMath } from "./types";

function term(amount: number, label: string): string | null {
  if (amount === 0) return null;
  return `${amount} ${label}`;
}

function joinTerms(parts: Array<string | null>, fallback: string): string {
  const live = parts.filter((p): p is string => !!p);
  return live.length ? live.join(" + ") : fallback;
}

/** Short formula lines for exchange resolve UI. */
export function formatExchangeMath(math: ExchangeMath): {
  incoming: string;
  prevention: string;
  damage: string;
  retaliation: string | null;
  store: string | null;
} {
  const { incoming: inc, prevention: prev } = math;

  const modeNote =
    inc.mode === "delayed"
      ? "0 new (Delayed)"
      : inc.mode === "gather"
        ? "0 new (Gather)"
        : null;

  const incomingCore = modeNote
    ? joinTerms(
        [
          modeNote,
          term(inc.arriving, "arriving"),
          term(inc.gatherBoost, "Gather boost"),
        ],
        modeNote,
      )
    : joinTerms(
        [
          term(inc.base, "base"),
          term(inc.power, "power"),
          term(inc.prep, "prep"),
          term(inc.boost, "boost"),
          term(inc.arriving, "arriving"),
        ],
        "0",
      );

  const preventionLine = joinTerms(
    [
      term(prev.base, "base"),
      term(prev.power, "power"),
      term(prev.prep, "prep"),
      term(prev.boost, "boost"),
    ],
    "0",
  );

  const storeLine = math.store
    ? `${joinTerms(
        [
          term(math.store.power, "power"),
          term(math.store.prep, "prep"),
          term(math.store.boost, "boost"),
        ],
        "0",
      )} → ${math.store.total} stored`
    : null;

  return {
    incoming: `${incomingCore} → ${inc.total} incoming`,
    prevention: `${preventionLine} → ${prev.total} prevention`,
    damage: `${inc.total} − ${prev.total} → ${math.damageToDefender} damage`,
    retaliation:
      math.retaliationToAttacker > 0
        ? `Reversal retal ${math.retaliationToAttacker}`
        : null,
    store: storeLine,
  };
}

/** Read math from a resolve payload, including nested replay.result.math. */
export function mathFromPayload(
  payload: Record<string, unknown> | null | undefined,
): ExchangeMath | null {
  if (!payload) return null;
  const direct = payload.math;
  if (direct && typeof direct === "object") return direct as ExchangeMath;
  const replay = payload.replay as
    | { result?: { math?: ExchangeMath } }
    | undefined;
  return replay?.result?.math ?? null;
}
