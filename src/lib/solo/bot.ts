// Adapted from power-duel-prototype/bots.py and power-planning-study/engine.cpp.
// All transitions use the current shared engine, not the study's old Delayed formula.
import { ATTACK_CARDS, type Seat } from "../rules";
import { actor,botView,cloneGame,fromView,legalMoves,other,powers,school,step, type BotView,type Move,type Policy,type SoloGame } from "./game";
export function random(seed:number) {
  let state=seed>>>0;
  return ()=>{state=(state+0x6d2b79f5)>>>0;let t=state;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};
}
type RNG=ReturnType<typeof random>;
const pick=<T>(a:T[],r:RNG):T=>a[Math.floor(r()*a.length)];
export function utility(s:SoloGame,who:Seat){
  const a=s.players[who],d=s.players[other(who)];
  return 4*(a.health-d.health)+.5*(a.storedDamage-d.storedDamage)+.25*(a.nextAttackBonus+a.nextDefenseBonus-d.nextAttackBonus-d.nextDefenseBonus)+
    .08*(powers(a).reduce((n,p)=>n+p,0)-powers(d).reduce((n,p)=>n+p,0))+(s.advantage===who?1:s.advantage===other(who)?-1:0);
}
function hypotheses(v:BotView){return ATTACK_CARDS.filter(c=>c.school===v.declaredSchool).flatMap(c=>powers(v.players[v.attacker]).map(power=>({spell:c.name,power})));}
function after(s:SoloGame,move:Move){let n=step(s,move);if(n.phase==="reveal")n=step(n,{kind:"continue"});return n;}
function projected(s:SoloGame,move:Move,hypothesesSchool:BotView["declaredSchool"]){
  const who=actor(s)!;
  if(move.kind==="refresh")return utility(step(s,move),who);
  if(move.kind==="attack"){
    const n=step(s,move),hand=powers(n.players[other(who)]),mid=hand[Math.floor(hand.length/2)];
    return ["Full","Partial","Counter","Reversal"].reduce((sum,spell)=>sum+utility(step(n,{kind:"defend",seat:other(who),spell:spell as "Full",power:mid,boost:false}),who),0)/4;
  }
  // Evaluate public hypotheses, never the sampled/actual concealed attack.
  const v={...botView({...s,attack:null},who),declaredSchool:hypothesesSchool};
  const options=hypotheses(v);
  if(!options.length)throw new Error("missing_school");
  return options.reduce((sum,a)=>sum+utility(step({...cloneGame(s),attack:a},move),who),0)/options.length;
}
function scored(s:SoloGame,declaredSchool:BotView["declaredSchool"],rng:RNG,soft=false):Move {
  const moves=legalMoves(s),scores=moves.map(m=>projected(s,m,declaredSchool));
  const best=Math.max(...scores);
  if(!soft)return pick(moves.filter((_,i)=>Math.abs(scores[i]-best)<1e-9),rng);
  const weights=scores.map(score=>Math.exp((score-best)/2));let draw=rng()*weights.reduce((n,w)=>n+w,0);
  for(let i=0;i<weights.length;i++){draw-=weights[i];if(draw<=0)return moves[i];}return moves[moves.length-1];
}
export function choose(v:BotView,policy:Policy,seed:number,budget=512,horizon=6):Move {
  const rng=random(seed),root=fromView(v);
  if(v.phase==="bid")return {kind:"bid",seat:v.who,power:pick(powers(v.players[v.who]),rng)};
  const moves=legalMoves(root);
  if(policy==="random")return pick(moves,rng);
  if(policy==="tactical"){
    if(v.phase==="refresh"){
      const hand=powers(v.players[v.who]),discard=v.players[v.who].discardedPower;
      return {kind:"refresh",seat:v.who,spend:hand.length<=2&&Math.max(...discard)>Math.max(...hand)};
    }
    return scored(root,v.declaredSchool,rng);
  }
  if(!Number.isInteger(budget)||budget<64||budget>2048||horizon<1||horizon>8)throw new Error("invalid_search_budget");
  type Node={visits:number;counts:number[];sums:number[]};
  const nodes=new Map<string,Node>();
  // Public information-set key deliberately excludes committed spell/power and bids.
  const key=(s:SoloGame,left:number)=>JSON.stringify([s.players,s.attacker,s.phase,s.advantage,s.advantageAtStart,s.spend,school(s),left]);
  const rootForKey={...root,attack:v.phase==="defend"?hypotheses(v)[0]:null};
  const rootKey=key(rootForKey,horizon);
  for(let iteration=0;iteration<budget;iteration++){
    let s=cloneGame(root),completed=0;
    if(v.phase==="defend")s.attack=pick(hypotheses(v),rng);
    const path:{node:Node;index:number;who:Seat}[]=[];
    while(s.phase!=="finished"&&completed<horizon){
      const k=key(s,horizon-completed),actions=legalMoves(s);
      let node=nodes.get(k);
      if(!node){node={visits:0,counts:actions.map(()=>0),sums:actions.map(()=>0)};nodes.set(k,node);}
      const unvisited=actions.map((_,i)=>i).filter(i=>node!.counts[i]===0);
      let index:number;
      if(unvisited.length)index=pick(unvisited,rng);
      else{
        const scores=node.counts.map((n,i)=>node!.sums[i]/n+1.4*Math.sqrt(Math.log(node!.visits+1)/n));
        const max=Math.max(...scores);index=pick(scores.map((_,i)=>i).filter(i=>Math.abs(scores[i]-max)<1e-12),rng);
      }
      path.push({node,index,who:actor(s)!});const expand=node.counts[index]===0;
      if(actions[index].kind==="defend")completed++;
      s=after(s,actions[index]);if(expand)break;
    }
    while(s.phase!=="finished"&&completed<horizon){
      const actions=legalMoves(s);
      // Public-only tactical rollout plus exploration, as in the earlier planner.
      const move=rng()<.12?pick(actions,rng):scored(s,school(s),rng,true);
      if(move.kind==="defend")completed++;
      s=after(s,move);
    }
    for(const {node,index,who} of path){
      const reward=s.winner?(s.winner==="draw"?.5:s.winner===who?1:0):.5+.5*Math.tanh(utility(s,who)/32);
      node.visits++;node.counts[index]++;node.sums[index]+=reward;
    }
  }
  const node=nodes.get(rootKey)!;const max=Math.max(...node.counts);
  return pick(moves.filter((_,i)=>node.counts[i]===max),rng);
}
export function decisionSeed(seed:number,v:BotView){
  let h=seed>>>0;for(const c of JSON.stringify([v.phase,v.who,v.exchange,v.bidRound]))h=Math.imul(h^c.charCodeAt(0),16777619)>>>0;return h;
}
