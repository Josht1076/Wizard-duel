import { BOT_VERSION,freshGame,school,step,type Move,type Policy,type SoloGame } from "./game";
import type { RecordRow } from "../../../analytics/model";
export interface Archive {
  format:"wizard-duel-solo-v1"; id:string; testerId:string; seed:number; policy:Policy;
  botVersion:typeof BOT_VERSION; rulesetVersion:"power-v2"; engineVersion:"power-engine-2";
  createdAt:string; actions:{at:string;move:Move}[];
}
export interface SavedGame { archive:Archive; uploadToken:string; uploaded:boolean; }
export function createArchive(id:string,testerId:string,seed:number,policy:Policy,at=new Date().toISOString()):Archive {
  return {format:"wizard-duel-solo-v1",id,testerId,seed:seed>>>0,policy,botVersion:BOT_VERSION,rulesetVersion:"power-v2",engineVersion:"power-engine-2",createdAt:at,actions:[]};
}
export function restore(archive:Archive){return archive.actions.reduce((s,a)=>step(s,a.move),freshGame());}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function requireValue(ok:unknown):asserts ok {if(!ok)throw new Error("invalid_solo_archive");}
export function validateArchive(raw:unknown,now=Date.now()):Archive {
  requireValue(raw&&typeof raw==="object");const a=raw as Archive;
  requireValue(a.format==="wizard-duel-solo-v1"&&a.botVersion===BOT_VERSION&&a.rulesetVersion==="power-v2"&&a.engineVersion==="power-engine-2");
  requireValue(typeof a.id==="string"&&uuid.test(a.id)&&typeof a.testerId==="string"&&uuid.test(a.testerId));
  requireValue(["random","tactical","planner"].includes(a.policy)&&Number.isInteger(a.seed)&&a.seed>=0&&a.seed<=0xffffffff);
  requireValue(typeof a.createdAt==="string"&&Number.isFinite(Date.parse(a.createdAt))&&Date.parse(a.createdAt)<=now+300000);
  requireValue(Array.isArray(a.actions)&&a.actions.length<=2000);
  const out=createArchive(a.id,a.testerId,a.seed,a.policy,a.createdAt);let s=freshGame(),last=Date.parse(a.createdAt);
  for(const item of a.actions){
    requireValue(item&&typeof item==="object"&&typeof item.at==="string");
    const t=Date.parse(item.at);requireValue(Number.isFinite(t)&&t>=last&&t<=now+300000);last=t;
    const move=item.move;requireValue(move&&typeof move==="object");let clean:Move;
    switch(move.kind){
      case "continue":clean={kind:"continue"};break;
      case "bid":clean={kind:"bid",seat:move.seat,power:move.power};break;
      case "refresh":clean={kind:"refresh",seat:move.seat,spend:move.spend};break;
      case "attack":case "defend":clean={kind:move.kind,seat:move.seat,spell:move.spell,power:move.power,boost:move.boost} as Move;break;
      default:throw new Error("invalid_solo_move");
    }
    s=step(s,clean);out.actions.push({at:item.at,move:clean});
  }
  return out;
}
// In-progress downloads stop before any concealed bid/attack. Local resume keeps the full private state.
export function publicArchive(a:Archive):Archive {
  let s=freshGame(),safe=0;
  for(let i=0;i<a.actions.length;i++){
    s=step(s,a.actions[i].move);
    if(s.phase==="reveal"||s.phase==="finished"||s.phase==="attack"||s.phase==="refresh")safe=i+1;
  }
  return {...a,actions:a.actions.slice(0,safe)};
}
export function research(a:Archive){
  let s=freshGame(),phaseAt=a.createdAt;
  const records:RecordRow[]=[];
  const phaseName=(s:SoloGame)=>s.phase==="attack"?"attack_commit":s.phase==="defend"?"defense_commit":s.phase==="reveal"?"resolve":s.phase;
  function state(){return {state:{phase:phaseName(s),phase_started_at:phaseAt,attacker_seat:s.attacker,advantage_seat:s.advantage,exchange_number:s.exchange,declared_school:school(s)},
    players:(["A","B"] as const).map(seat=>{const p=s.players[seat];return {seat,health:p.health,discarded_power:[...p.discardedPower],stored_damage:p.storedDamage,preparations:{nextAttackBonus:p.nextAttackBonus,nextDefenseBonus:p.nextDefenseBonus}};})};}
  function record(kind:string,at:string,payload:RecordRow["payload"]={},seat:"A"|"B"|null=null){
    records.push({id:records.length+1,match_id:a.id,exchange_number:s.exchange,seat,kind,payload,state:state(),created_at:at});
  }
  record("match_created",a.createdAt);
  for(const {move,at} of a.actions){
    const before=s;s=step(s,move);if(s.phase!==before.phase||s.exchange!==before.exchange)phaseAt=at;
    if(move.kind==="bid"){
      record("bid_submitted",at,{power:move.power},move.seat);
      if(s.bidRound!==before.bidRound)record("bid_tie",at,{power:move.power});
      if(before.phase==="bid"&&s.phase!=="bid"){
        record("bid_resolved",at,{attacker_seat:s.attacker,bid_a:s.bids.A,bid_b:s.bids.B});record("exchange_started",at);
      }
    }else if(move.kind==="refresh")record("refresh_chosen",at,{spent:move.spend},move.seat);
    else if(move.kind==="attack")record("attack_committed",at,{advantage_spend:move.boost?"boost":null,declared_school:school(s)},move.seat);
    else if(move.kind==="defend"){
      record("defense_committed",at,{},move.seat);record("exchange_completed",at,s.last!);
    }else record("exchange_started",at);
  }
  return {state:s,records,players:state().players,finishedAt:a.actions.at(-1)?.at??a.createdAt};
}
