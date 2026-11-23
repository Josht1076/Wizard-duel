import type { AdvantageSpend, PowerValue, Seat } from "@/lib/rules";

export type MatchPhase =
  | "lobby"
  | "bid"
  | "refresh"
  | "attack_commit"
  | "defense_commit"
  | "resolve"
  | "finished";

export type MatchStatus = "lobby" | "active" | "finished" | "abandoned";

export type Preparations = {
  nextAttackBonus: number;
  nextDefenseBonus: number;
};

export type PublicPlayer = {
  seat: Seat;
  display_name: string;
  health: number;
  discarded_power: PowerValue[];
  stored_damage: number;
  preparations: Preparations;
};

export type PublicMatchState = {
  phase: MatchPhase;
  advantage_seat: Seat | null;
  advantage_at_start: Seat | null;
  refresh_spend_seat: Seat | null;
  phase_started_at: string;
  attacker_seat: Seat | null;
  exchange_number: number;
  declared_school: string | null;
  pending_bid_a: boolean | null;
  pending_bid_b: boolean | null;
  last_result: Record<string, unknown> | null;
  updated_at?: string;
};

export type PublicMatch = {
  id: string;
  room_code: string;
  status: MatchStatus;
  winner_seat: Seat | "draw" | null;
  ruleset_version: string;
  engine_version: string;
};

export type RevealedCommit = {
  exchange_number: number;
  seat: Seat;
  role: "attack" | "defend";
  spell: string;
  power: number;
  advantage_spend: AdvantageSpend;
  revealed: boolean;
};

export type MatchPublicSnapshot = {
  match: PublicMatch;
  state: PublicMatchState;
  players: PublicPlayer[];
  revealed_commits: RevealedCommit[];
};

export type ResolveBundle = {
  match_id: string;
  exchange_number: number;
  attacker_seat: Seat;
  defender_seat: Seat;
  advantage_at_start: Seat | null;
  refresh_spend_seat?: Seat | null;
  attack: {
    spell: string;
    power: number;
    advantage_spend: AdvantageSpend;
    seat: Seat;
  };
  defend: {
    spell: string;
    power: number;
    advantage_spend: AdvantageSpend;
    seat: Seat;
  };
  attacker: {
    seat: Seat;
    health: number;
    discarded_power: number[];
    stored_damage: number;
    preparations: Preparations;
  };
  defender: {
    seat: Seat;
    health: number;
    discarded_power: number[];
    stored_damage: number;
    preparations: Preparations;
  };
  caller_seat: Seat;
};
