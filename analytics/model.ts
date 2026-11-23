import { resolveExchange, type ExchangeInput, type ExchangeResult } from "../src/lib/rules";
export type Match = { id: string; status: string; ruleset_version: string; engine_version: string; event_schema_version: number; winner_seat: string | null; created_at: string; started_at?: string | null; updated_at: string; finished_at: string | null };
export type Player = { match_id: string; seat: string; tester_id: string | null; health: number };
export type RecordRow = { id: number; match_id: string; exchange_number: number; seat: string | null; kind: string; payload: { [key: string]: unknown; replay?: { input: ExchangeInput; result: ExchangeResult; engine_version: string } }; state: { state?: { [key: string]: unknown }; players?: { seat: string; health: number; discarded_power: number[]; stored_damage: number; preparations: { nextAttackBonus: number; nextDefenseBonus: number } }[] }; created_at: string };
export type Telemetry = { request_id: string; match_id: string; seat: string; exchange_number: number; phase: string; kind: string; payload: { [key: string]: unknown }; created_at: string };
export type Dataset = { matches: Match[]; players: Player[]; records: RecordRow[]; telemetry: Telemetry[]; captured_at: string };
export type Filters = { version?: string; from?: string; to?: string; tester?: string; status?: string };
const ATTACK_SPELLS=['Full','Feint','Partial','Gather','Hex','Delayed'];
function schoolOf(spell:string) {return spell==='Full'||spell==='Feint'?'Fire':spell==='Partial'||spell==='Gather'?'Ice':'Illusion';}
const ms = (s: string) => new Date(s).getTime();
export function matchStatus(m: Match, now: number) {
  if (m.status === "finished") return m.winner_seat === "draw" ? "draw" : "completed";
  if (m.status === "abandoned") return "abandoned";
  return now - ms(m.updated_at) >= 86400000 ? "stale" : "unfinished";
}
export function filterData(data: Dataset, filters: Filters): Dataset {
  const now = ms(data.captured_at);
  const matches = data.matches.filter(m =>
    (filters.version === "all" || m.ruleset_version === (filters.version || "power-v2")) &&
    (!filters.from || ms(m.created_at) >= ms(filters.from)) &&
    (!filters.to || ms(m.created_at) < ms(filters.to) + 86400000) &&
    (!filters.tester || data.players.some(p => p.match_id === m.id && p.tester_id === filters.tester)) &&
    (!filters.status || matchStatus(m, now) === filters.status));
  const ids = new Set(matches.map(m => m.id));
  return { ...data, matches, players: data.players.filter(p => ids.has(p.match_id)), records: data.records.filter(r => ids.has(r.match_id)), telemetry: data.telemetry.filter(t => ids.has(t.match_id)) };
}
export function summary(values: number[]) {
  const a = values.filter(Number.isFinite).sort((a,b) => a-b);
  return { n: a.length, mean: a.length ? a.reduce((x,y)=>x+y,0)/a.length : null,
    median: a.length ? (a[Math.floor((a.length-1)/2)] + a[Math.ceil((a.length-1)/2)])/2 : null,
    p90: a.length ? a[Math.ceil(a.length*.9)-1] : null };
}
function group(rows: RecordRow[], key: (r: RecordRow) => string) {
  const counts = new Map<string,number>();
  rows.forEach(r => counts.set(key(r), (counts.get(key(r)) || 0)+1));
  return [...counts].map(([choice,n])=>({choice,n,denominator:rows.length})).sort((a,b)=>b.n-a.n);
}
export function metrics(data: Dataset) {
  const exchanges = data.records.filter(r => r.kind === "exchange_completed");
  const terminal = data.matches.filter(m=>m.status === "finished");
  const decisive = terminal.filter(m=>m.winner_seat && m.winner_seat!=="draw");
  const opening = data.records.filter(r=>r.kind === "bid_resolved");
  const firstEligible = decisive.filter(m=>opening.some(r=>r.match_id===m.id));
  const firstWins = firstEligible.filter(m=>opening.find(r=>r.match_id===m.id)?.payload.attacker_seat === m.winner_seat).length;
  const decisions: { role: string; seconds: number; match_id:string; seat:string|null }[] = [];
  // Phase entry timestamps are database-authoritative. Refresh time is excluded from attack choice time.
  for (const r of data.records.filter(r=>r.kind === "attack_committed" || r.kind === "defense_committed")) {
    const previous = data.records.filter(x=>x.match_id===r.match_id && x.id<r.id &&
      x.state.state?.phase === (r.kind === "attack_committed" ? "attack_commit" : "defense_commit")).at(-1);
    const started = previous?.state.state?.phase_started_at;
    if (typeof started === "string") decisions.push({match_id:r.match_id,seat:r.seat,role:r.kind === "attack_committed" ? "attack" : "defend",seconds:Math.max(0,(ms(r.created_at)-ms(started))/1000)});
  }
  const testers = [...new Set(data.players.map(p=>p.tester_id).filter((id): id is string => !!id))];
  const learning = testers.map(tester => {
    const games = data.matches.filter(m=>data.players.some(p=>p.match_id===m.id && p.tester_id===tester)).sort((a,b)=>ms(a.created_at)-ms(b.created_at));
    const halves = [games.slice(0,Math.ceil(games.length/2)),games.slice(Math.ceil(games.length/2))].map(g => {
      const ids=new Set(g.map(m=>m.id));
      const ownEx=exchanges.filter(r=>ids.has(r.match_id));
      const ownAttack=ownEx.filter(r=>data.players.some(p=>p.match_id===r.match_id && p.tester_id===tester && p.seat===r.payload.attacker_seat));
      const t=data.telemetry.filter(t=>ids.has(t.match_id)&& data.players.some(p=>p.match_id===t.match_id && p.seat===t.seat && p.tester_id===tester));
      const finished=g.filter(m=>m.status==='finished');
      return { games:g.length, finished:finished.length, wins:finished.filter(m=>data.players.some(p=>p.match_id===m.id&&p.tester_id===tester&&p.seat===m.winner_seat)).length,
        decisionSeconds:summary(decisions.filter(d=>ids.has(d.match_id)&&data.players.some(p=>p.match_id===d.match_id&&p.seat===d.seat&&p.tester_id===tester)).map(d=>d.seconds)),
        inspect:t.filter(t=>t.kind==='inspect_open').length, attacks:group(ownAttack,r=>String(r.payload.attack_spell)),
        active_minutes:t.reduce((n,t)=>n+(t.kind==='activity'?Math.min(15000,Math.max(0,Number(t.payload.active_ms)||0)):0),0)/60000 };
    });
    return {tester,games:games.length,early:halves[0],later:halves[1]};
  });
  return {
    matches: data.matches.length, started:data.matches.filter(m=>m.started_at || m.status==='active' || m.status==='finished').length, completed: terminal.length, decisive: decisive.length,
    draws: terminal.filter(m=>m.winner_seat==='draw').length,
    stale:data.matches.filter(m=>matchStatus(m,ms(data.captured_at))==='stale').length,
    unfinished:data.matches.filter(m=>matchStatus(m,ms(data.captured_at))==='unfinished').length,
    firstAttacker:{wins:firstWins,n:firstEligible.length}, exchanges:exchanges.length,
    attacks:group(exchanges,r=>String(r.payload.attack_spell)), defenses:group(exchanges,r=>String(r.payload.defense_spell)),
    powers:group(exchanges,r=>`${r.payload.attack_spell}@${r.payload.attack_power} / ${r.payload.defense_spell}@${r.payload.defense_power}`),
    pairings:group(exchanges,r=>`${r.payload.attack_spell} / ${r.payload.defense_spell}`),
    spellOutcomes:ATTACK_SPELLS.map(spell=>{
      const rows=exchanges.filter(r=>r.payload.attack_spell===spell && decisive.some(m=>m.id===r.match_id));
      return {spell,uses:rows.length,usesInWinningGames:rows.filter(r=>decisive.find(m=>m.id===r.match_id)?.winner_seat===r.payload.attacker_seat).length};
    }),
    defenseBySchool:group(exchanges,r=>`${schoolOf(String(r.payload.attack_spell))} / ${r.payload.defense_spell}`),
    damage:summary(exchanges.map(r=>Number(r.payload.damage_to_defender))), prevention:summary(exchanges.map(r=>Number(r.payload.prevention))),
    gameMinutes:summary(terminal.filter(m=>m.finished_at).map(m=>(ms(m.finished_at!)-ms(m.started_at||m.created_at))/60000)),
    exchangesPerGame:summary(terminal.map(m=>exchanges.filter(r=>r.match_id===m.id).length)),
    decisionSeconds:{attack:summary(decisions.filter(d=>d.role==='attack').map(d=>d.seconds)),defend:summary(decisions.filter(d=>d.role==='defend').map(d=>d.seconds))},
    advantage:{spends:group(exchanges.filter(r=>!!r.payload.advantage_spend),r=>String(r.payload.advantage_spend)),
      after:group(exchanges,r=>String(r.payload.advantage_after??'none'))},
    delayed:{casts:exchanges.filter(r=>r.payload.attack_spell==='Delayed').length,
      stored:exchanges.reduce((n,r)=>n+Number(r.payload.attacker_stored_damage||0),0),
      delivered:exchanges.reduce((n,r)=>n+Number(r.payload.replay?.input.attacker.storedDamage||0),0)},
    gather:exchanges.filter(r=>r.payload.attack_spell==='Gather').map(r=>({match:r.match_id,exchange:r.exchange_number,
      recovered:r.payload.replay?.result.followups.filter(f=>f.includes('recovers'))})),
    learning,
    reliability:{reconnects:data.records.filter(r=>r.kind==='reconnected').length,
      actionErrors:data.telemetry.filter(t=>t.kind==='action_error').length,
      serverResolutionFailures:data.records.filter(r=>r.kind==='resolution_failed').length,
      resolutionErrors:data.telemetry.filter(t=>t.kind==='action_error'&&t.payload.action==='resolve').length,
      matchesWithoutTelemetry:data.matches.filter(m=>!data.telemetry.some(t=>t.match_id===m.id)).length,
      inspectOpens:data.telemetry.filter(t=>t.kind==='inspect_open').length,
      activeMinutes:summary(data.players.filter(p=>data.telemetry.some(t=>t.match_id===p.match_id&&t.seat===p.seat&&t.kind==='activity')).map(p=>data.telemetry.filter(t=>t.match_id===p.match_id&&t.seat===p.seat&&t.kind==='activity').reduce((n,t)=>n+Math.min(15000,Math.max(0,Number(t.payload.active_ms)||0)),0)/60000))}
  };
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value==='object') return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')}}`;
  return JSON.stringify(value);
}
export function replay(records: RecordRow[]) {
  return records.filter(r=>r.kind==='exchange_completed').map(r=>{
    const trace=r.payload.replay;
    if (!trace || trace.engine_version!=='power-engine-2') return {match_id:r.match_id,exchange:r.exchange_number,ok:false,error:'unsupported_or_missing_replay'};
    try {
      const actual=resolveExchange(trace.input);
      if(canonical(actual)!==canonical(trace.result)) throw new Error('engine_result_mismatch');
      for(const [field,value] of Object.entries({incoming_damage:actual.incomingDamage,prevention:actual.prevention,damage_to_defender:actual.damageToDefender,
        retaliation_to_attacker:actual.retaliationToAttacker,attacker_health:actual.attackerHealth,defender_health:actual.defenderHealth,
        advantage_after:actual.advantageAfter,attacker_stored_damage:actual.attackerStoredDamage,winner:actual.winner})) {
        if(r.payload[field]!==value) throw new Error('recorded_summary_mismatch');
      }
      const a=r.state.players?.find(p=>p.seat===trace.input.attackerSeat);
      const d=r.state.players?.find(p=>p.seat===trace.input.defenderSeat);
      if (!a || !d || a.health!==actual.attackerHealth || d.health!==actual.defenderHealth ||
        a.stored_damage!==actual.attackerStoredDamage || d.stored_damage!==trace.input.defender.storedDamage ||
        canonical(a.discarded_power)!==canonical(actual.attackerDiscardedPower) || canonical(d.discarded_power)!==canonical(actual.defenderDiscardedPower) ||
        a.preparations.nextAttackBonus!==0 || a.preparations.nextDefenseBonus!==actual.attackerNextDefenseBonus ||
        d.preparations.nextDefenseBonus!==0 || d.preparations.nextAttackBonus!==actual.defenderNextAttackBonus) throw new Error('persisted_state_mismatch');
      return {match_id:r.match_id,exchange:r.exchange_number,ok:true,error:null};
    } catch (error) { return {match_id:r.match_id,exchange:r.exchange_number,ok:false,error:error instanceof Error?error.message:'replay_failed'}; }
  });
}
function scrub(value: unknown): unknown {
  if(Array.isArray(value)) return value.map(scrub);
  if(value&&typeof value==='object') return Object.fromEntries(Object.entries(value).filter(([k])=>!['token','reconnect_token_hash','display_name','room_code'].includes(k)).map(([k,v])=>[k,k==='pending_bid_a'||k==='pending_bid_b' ? (v===null?null:true):scrub(v)]));
  return value;
}
export function exportData(data:Dataset):Dataset {
  const records=data.records.filter(r=>r.kind!=='bid_submitted'||data.records.some(x=>x.match_id===r.match_id&&x.id>r.id&&(x.kind==='bid_resolved'||x.kind==='bid_tie')));
  return scrub({...data,records}) as Dataset;
}
export function csv(rows: object[]) {
  const keys=[...new Set(rows.flatMap(r=>Object.keys(r)))];
  const cell=(v:unknown)=>{
    let s=typeof v==='object'&&v!==null?JSON.stringify(v):String(v??'');
    if (/^[=+\-@\t\r\n]/.test(s)) s="'"+s;
    return '"'+s.replaceAll('"','""')+'"';
  };
  return '\uFEFF'+[keys.map(cell).join(','),...rows.map(r=>keys.map(k=>cell((r as {[key:string]:unknown})[k])).join(','))].join('\r\n');
}
