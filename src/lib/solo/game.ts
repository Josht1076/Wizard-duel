import { ATTACK_CARDS, DEFENSE_CARDS, createFreshPlayer, type AttackSpell, type DefenseSpell, type PlayerPublicState, type PowerValue, type Seat } from "../rules";
import { resolveBundle } from "../match/resolve";

export const BOT_VERSION = "power-ai-1";
export type Policy = "planner" | "tactical" | "random";
export type Move =
  | { kind: "bid"; seat: Seat; power: PowerValue }
  | { kind: "refresh"; seat: Seat; spend: boolean }
  | { kind: "attack"; seat: Seat; spell: AttackSpell; power: PowerValue; boost: boolean }
  | { kind: "defend"; seat: Seat; spell: DefenseSpell; power: PowerValue; boost: boolean }
  | { kind: "continue" };
export type Outcome = ReturnType<typeof resolveBundle>;
export interface SoloGame {
  players: Record<Seat, PlayerPublicState>;
  phase: "bid" | "refresh" | "attack" | "defend" | "reveal" | "finished";
  attacker: Seat; exchange: number; bidRound: number;
  bids: Record<Seat, PowerValue | null>;
  advantage: Seat | null; advantageAtStart: Seat | null;
  spend: { seat: Seat; action: "refresh" | "boost" } | null;
  attack: { spell: AttackSpell; power: PowerValue } | null;
  last: Outcome | null; winner: Seat | "draw" | null;
}
export const other = (seat: Seat): Seat => seat === "A" ? "B" : "A";
export const powers = (player: PlayerPublicState) => ([1,2,3,4,5] as PowerValue[]).filter(p => !player.discardedPower.includes(p));
export function freshGame(): SoloGame {
  return { players: { A: createFreshPlayer("A"), B: createFreshPlayer("B") }, phase:"bid", attacker:"A", exchange:0, bidRound:0,
    bids:{A:null,B:null}, advantage:null, advantageAtStart:null, spend:null, attack:null, last:null, winner:null };
}
export function cloneGame(s: SoloGame): SoloGame {
  return { ...s, bids:{...s.bids}, players: { A:{...s.players.A, discardedPower:[...s.players.A.discardedPower]}, B:{...s.players.B,discardedPower:[...s.players.B.discardedPower]} } };
}
function begin(s: SoloGame) {
  for(const seat of ["A","B"] as const) if(!powers(s.players[seat]).length) s.players[seat].discardedPower=[];
  s.exchange++;s.advantageAtStart=s.advantage;s.spend=null;s.attack=null;
  s.phase=s.advantageAtStart ? "refresh" : "attack";
}
export function actor(s: SoloGame): Seat | null {
  return s.phase === "refresh" ? s.advantageAtStart : s.phase === "attack" ? s.attacker : s.phase === "defend" ? other(s.attacker) : null;
}
export function canBoost(s: SoloGame, seat: Seat) { return s.advantageAtStart===seat && !s.spend; }
export function step(s0: SoloGame, move: Move): SoloGame {
  const s=cloneGame(s0);
  if(move.kind === "continue") {
    if(s.phase!=="reveal") throw new Error("wrong_phase");
    s.attacker=other(s.attacker);begin(s);return s;
  }
  if(move.seat!=="A" && move.seat!=="B") throw new Error("invalid_seat");
  if(move.kind === "bid") {
    if(s.phase!=="bid" || s.bids[move.seat]!==null) throw new Error("wrong_phase");
    if(!powers(s.players[move.seat]).includes(move.power)) throw new Error("power_unavailable");
    s.bids[move.seat]=move.power;
    if(s.bids.A!==null && s.bids.B!==null) {
      const a=s.bids.A,b=s.bids.B;
      for(const seat of ["A","B"] as const) s.players[seat].discardedPower.push(s.bids[seat]!);
      if(a===b) {
        s.bidRound++;s.bids={A:null,B:null};
        for(const seat of ["A","B"] as const) if(!powers(s.players[seat]).length)s.players[seat].discardedPower=[];
      } else { s.attacker=a>b?"A":"B";begin(s); }
    }
    return s;
  }
  if(move.seat!==actor(s))throw new Error("not_your_turn");
  if(move.kind === "refresh") {
    if(s.phase!=="refresh" || typeof move.spend!=="boolean")throw new Error("wrong_phase");
    if(move.spend){s.players[move.seat].discardedPower=[];s.spend={seat:move.seat,action:"refresh"};s.advantage=other(move.seat);}
    s.phase="attack";return s;
  }
  if(!powers(s.players[move.seat]).includes(move.power))throw new Error("power_unavailable");
  if(typeof move.boost!=="boolean")throw new Error("invalid_boost");
  if(move.boost){if(!canBoost(s,move.seat))throw new Error("no_advantage");s.spend={seat:move.seat,action:"boost"};s.advantage=other(move.seat);}
  if(move.kind === "attack") {
    if(s.phase!=="attack" || !ATTACK_CARDS.some(c=>c.name===move.spell))throw new Error("invalid_attack");
    s.attack={spell:move.spell,power:move.power};s.phase="defend";return s;
  }
  if(move.kind!=="defend" || s.phase!=="defend" || !s.attack || !DEFENSE_CARDS.some(c=>c.name===move.spell))throw new Error("invalid_defense");
  const ai=s.attacker,di=other(ai),a=s.players[ai],d=s.players[di];
  const prep=(p:PlayerPublicState)=>({nextAttackBonus:p.nextAttackBonus,nextDefenseBonus:p.nextDefenseBonus});
  const payload=resolveBundle({match_id:"local",exchange_number:s.exchange,attacker_seat:ai,defender_seat:di,advantage_at_start:s.advantageAtStart,
    refresh_spend_seat:s.spend?.action==="refresh"?s.spend.seat:null,
    attack:{seat:ai,spell:s.attack.spell,power:s.attack.power,advantage_spend:s.spend?.seat===ai&&s.spend.action==="boost"?"boost":null},
    defend:{seat:di,spell:move.spell,power:move.power,advantage_spend:s.spend?.seat===di&&s.spend.action==="boost"?"boost":null},
    attacker:{seat:ai,health:a.health,discarded_power:a.discardedPower,stored_damage:a.storedDamage,preparations:prep(a)},
    defender:{seat:di,health:d.health,discarded_power:d.discardedPower,stored_damage:d.storedDamage,preparations:prep(d)},caller_seat:move.seat});
  s.players[ai]={...a,health:payload.attacker_health,discardedPower:payload.attacker_discarded_power,storedDamage:payload.attacker_stored_damage,nextAttackBonus:0,nextDefenseBonus:payload.attacker_next_defense_bonus};
  s.players[di]={...d,health:payload.defender_health,discardedPower:payload.defender_discarded_power,nextDefenseBonus:0,nextAttackBonus:payload.defender_next_attack_bonus};
  s.advantage=payload.advantage_after;s.last=payload;s.winner=payload.winner;s.phase=s.winner?"finished":"reveal";
  return s;
}
export function school(s: SoloGame) { return s.attack ? ATTACK_CARDS.find(c=>c.name===s.attack!.spell)!.school : null; }

// This is the only interface passed to AI. Hidden spell/power, private bids and UI selections are omitted.
export interface BotView {
  phase: "bid" | "refresh" | "attack" | "defend"; who: Seat;
  players: Record<Seat, PlayerPublicState>; attacker: Seat; exchange:number; bidRound:number;
  advantage: Seat|null; advantageAtStart:Seat|null; spend:SoloGame["spend"];
  declaredSchool: ReturnType<typeof school>;
}
export function botView(s: SoloGame, who: Seat): BotView {
  if(s.phase==="finished" || s.phase==="reveal" || (s.phase!=="bid" && actor(s)!==who) || (s.phase==="bid" && s.bids[who]!==null))throw new Error("not_a_bot_decision");
  return {phase:s.phase,who,players:cloneGame(s).players,attacker:s.attacker,exchange:s.exchange,bidRound:s.bidRound,
    advantage:s.advantage,advantageAtStart:s.advantageAtStart,spend:s.spend?{...s.spend}:null,declaredSchool:school(s)};
}
export function fromView(v:BotView):SoloGame {
  return {...freshGame(),players:cloneGame({...freshGame(),players:v.players}).players,phase:v.phase,attacker:v.attacker,exchange:v.exchange,bidRound:v.bidRound,
    advantage:v.advantage,advantageAtStart:v.advantageAtStart,spend:v.spend};
}
export function legalMoves(s:SoloGame):Move[] {
  const who=actor(s);if(!who)return [];
  if(s.phase==="refresh")return [false,true].map(spend=>({kind:"refresh",seat:who,spend}));
  const cards=s.phase==="attack"?ATTACK_CARDS:DEFENSE_CARDS;
  return cards.flatMap(c=>powers(s.players[who]).flatMap(power=>(canBoost(s,who)?[false,true]:[false]).map(boost=>
    ({kind:s.phase==="attack"?"attack":"defend",seat:who,spell:c.name,power,boost}) as Move)));
}
