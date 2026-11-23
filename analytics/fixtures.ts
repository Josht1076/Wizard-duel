import { resolveExchange,createFreshPlayer } from "../src/lib/rules";
import type { ExchangeInput } from "../src/lib/rules";
import { resolveBundle } from "../src/lib/match/resolve";
import type { Dataset,RecordRow,Match } from "./model";
export function fixture():Dataset {
 const time='2026-11-20T12:00:00.000Z';
 const match=(id:string,status:string,winner:string|null):Match=>({id,status,winner_seat:winner,ruleset_version:'power-v2',engine_version:'power-engine-2',event_schema_version:1,created_at:time,started_at:time,updated_at:time,finished_at:status==='finished'?'2026-11-20T12:05:00.000Z':null});
 const matches=[match('fixture-win','finished','A'),match('fixture-draw','finished','draw'),match('fixture-stale','active',null),{...match('fixture-legacy','finished','B'),ruleset_version:'playtest-1',engine_version:'legacy'}];
 const players=matches.flatMap(m=>['A','B'].map(seat=>({match_id:m.id,seat,tester_id:seat==='A'?'tester-one':'tester-two',health:seat==='A'?12:10})));
 const input:ExchangeInput={attackerSeat:'A',defenderSeat:'B',advantageAtStart:null,attacker:createFreshPlayer('A'),defender:createFreshPlayer('B'),commit:{attackSpell:'Full',attackPower:5,defenseSpell:'Full',defensePower:3,advantageSpend:null,advantageSpendSeat:null}};
 const result=resolveExchange(input);
 const payload=resolveBundle({match_id:'fixture-win',exchange_number:1,attacker_seat:'A',defender_seat:'B',advantage_at_start:null,
 attack:{spell:'Full',power:5,advantage_spend:null,seat:'A'},defend:{spell:'Full',power:3,advantage_spend:null,seat:'B'},
 attacker:{seat:"A",health:12,discarded_power:[],stored_damage:0,preparations:{nextAttackBonus:0,nextDefenseBonus:0}},defender:{seat:"B",health:12,discarded_power:[],stored_damage:0,preparations:{nextAttackBonus:0,nextDefenseBonus:0}},caller_seat:'A'});
 const records:RecordRow[]=[{id:1,match_id:'fixture-win',exchange_number:0,seat:null,kind:'bid_resolved',payload:{attacker_seat:'A'},state:{},created_at:time},
 {id:2,match_id:'fixture-win',exchange_number:1,seat:null,kind:'exchange_started',payload:{},state:{state:{phase:'attack_commit',phase_started_at:time}},created_at:time},
 {id:3,match_id:'fixture-win',exchange_number:1,seat:'A',kind:'attack_committed',payload:{declared_school:'Fire'},state:{state:{phase:'defense_commit',phase_started_at:'2026-11-20T12:00:10.000Z'}},created_at:'2026-11-20T12:00:10.000Z'},
 {id:4,match_id:'fixture-win',exchange_number:1,seat:'B',kind:'defense_committed',payload:{},state:{state:{phase:'resolve',phase_started_at:'2026-11-20T12:00:30.000Z'}},created_at:'2026-11-20T12:00:30.000Z'},
 {id:5,match_id:'fixture-win',exchange_number:1,seat:null,kind:'exchange_completed',payload,state:{players:[{seat:'A',health:result.attackerHealth,discarded_power:result.attackerDiscardedPower,stored_damage:0,preparations:{nextAttackBonus:0,nextDefenseBonus:0}},{seat:'B',health:result.defenderHealth,discarded_power:result.defenderDiscardedPower,stored_damage:0,preparations:{nextAttackBonus:0,nextDefenseBonus:0}}]},created_at:'2026-11-20T12:00:31.000Z'},
 {id:6,match_id:'fixture-stale',exchange_number:0,seat:'A',kind:'bid_submitted',payload:{power:4},state:{state:{pending_bid_a:4,pending_bid_b:null}},created_at:time}];
 return {matches,players,records,telemetry:[{request_id:'fixture-inspect',match_id:'fixture-win',seat:'B',exchange_number:1,phase:'defense_commit',kind:'inspect_open',payload:{},created_at:time}],captured_at:'2026-11-22T12:00:00.000Z'};
}
