import {describe,it,expect} from 'vitest';
import {actor,botView,freshGame,powers,step,type Move} from '../src/lib/solo/game';
import {choose,decisionSeed} from '../src/lib/solo/bot';
import {publicArchive,research,restore,validateArchive} from '../src/lib/solo/archive';
import {replay,filterData,type Dataset} from '../analytics/model';
import {completedSolo,bidState} from './solo-fixture';
describe('solo game and public-information AI',()=>{
 it('keeps bids secret and refreshes after five tied opening bids',()=>{
   let s=freshGame();
   for(const power of [1,2,3,4,5] as const){s=step(s,{kind:'bid',seat:'A',power});expect(botView(s,'B')).not.toHaveProperty('bids');s=step(s,{kind:'bid',seat:'B',power});}
   expect(s.phase).toBe('bid');expect(s.bidRound).toBe(5);expect(powers(s.players.A)).toEqual([1,2,3,4,5]);
 });
 it('does not mutate prior states or use unavailable power',()=>{
   const before=bidState(),snapshot=JSON.stringify(before);
   step(before,{kind:'attack',seat:'A',spell:'Full',power:4,boost:false});expect(JSON.stringify(before)).toBe(snapshot);
   expect(()=>step(before,{kind:'attack',seat:'A',spell:'Full',power:5,boost:false})).toThrow('power_unavailable');
 });
 it('keeps defense choices invariant under different private spells/powers in the same school',()=>{
   const a=step(bidState(),{kind:'attack',seat:'A',spell:'Full',power:4,boost:false});
   const b=step(bidState(),{kind:'attack',seat:'A',spell:'Feint',power:2,boost:false});
   const va=botView(a,'B'),vb=botView(b,'B');expect(va).toEqual(vb);expect(va).not.toHaveProperty('attack');
   for(const policy of ['tactical','random','planner'] as const)expect(choose(va,policy,31,64,2)).toEqual(choose(vb,policy,31,64,2));
 });
 it('uses reproducible public-only bids independent of the human commitment',()=>{
   const a=freshGame(),b=step(a,{kind:'bid',seat:'A',power:5});
   const va=botView(a,'B'),vb=botView(b,'B');expect(va).toEqual(vb);
   expect(choose(va,'tactical',decisionSeed(7,va))).toEqual(choose(vb,'tactical',decisionSeed(7,vb)));
 });
 it('uses current bank-power Delayed and carries it through the intervening defense',()=>{
   let s=bidState();s=step(s,{kind:'attack',seat:'A',spell:'Delayed',power:4,boost:false});s=step(s,{kind:'defend',seat:'B',spell:'Full',power:2,boost:false});
   expect(s.players.A.storedDamage).toBe(4);s=step(s,{kind:'continue'});
   s=step(s,{kind:'attack',seat:'B',spell:'Full',power:3,boost:false});s=step(s,{kind:'defend',seat:'A',spell:'Full',power:1,boost:false});expect(s.players.A.storedDamage).toBe(4);
   s=step(s,{kind:'continue'});s=step(s,{kind:'attack',seat:'A',spell:'Full',power:3,boost:false});s=step(s,{kind:'defend',seat:'B',spell:'Full',power:4,boost:false});expect(s.last?.incoming_damage).toBe(10);
 });
 it('enforces refresh before attack, once-only spending, and automatic role changes',()=>{
   let s=bidState();s=step(s,{kind:'attack',seat:'A',spell:'Feint',power:4,boost:false});s=step(s,{kind:'defend',seat:'B',spell:'Full',power:2,boost:false});s=step(s,{kind:'continue'});
   expect(s.phase).toBe('refresh');expect(actor(s)).toBe('A');
   s=step(s,{kind:'refresh',seat:'A',spend:true});expect(s.advantage).toBe('B');expect(actor(s)).toBe('B');
   expect(()=>step(s,{kind:'attack',seat:'B',spell:'Full',power:3,boost:true})).toThrow('no_advantage');
   expect(powers(s.players.A)).toEqual([1,2,3,4,5]);
 });
 it('finishes seeded games with legal random and tactical actions',()=>{
   for(const policy of ['random','tactical'] as const){
     let s=freshGame();
     for(let n=0;n<1000&&s.phase!=='finished';n++){
       const who=s.phase==='bid'?(s.bids.A===null?'A':'B'):actor(s)!;
       const v=s.phase==='reveal'?null:botView(s,who);
       const move:Move=v?choose(v,policy,decisionSeed(123,v)):{kind:'continue'};s=step(s,move);
     }
     expect(s.phase).toBe('finished');expect(s.winner).not.toBeNull();
   }
 });
 it('validates complete archives, reconstructs all persisted exchange outcomes and rejects edits',()=>{
   const a=completedSolo();const valid=validateArchive(a),game=research(valid);
   expect(restore(valid).phase).toBe('finished');expect(replay(game.records).every(r=>r.ok)).toBe(true);
   const illegal=structuredClone(a);illegal.actions[0].move={kind:'attack',seat:'A',spell:'Full',power:5,boost:false};expect(()=>validateArchive(illegal)).toThrow();
   const corrupt=structuredClone(a);corrupt.actions[1].at='invalid';expect(()=>validateArchive(corrupt)).toThrow('invalid_solo_archive');
   const future=structuredClone(a);future.actions[0].at=new Date(Date.now()+600000).toISOString();expect(()=>validateArchive(future)).toThrow();
 });
 it('exports completed games but removes unfinished hidden attacks and bids',()=>{
   const a=completedSolo();expect(publicArchive(a).actions).toEqual(a.actions);
   const index=a.actions.findIndex(m=>m.move.kind==='attack');const partial={...a,actions:a.actions.slice(0,index+1)};
   expect(restore(publicArchive(partial)).phase).not.toBe('defend');
   expect(publicArchive({...a,actions:a.actions.slice(0,1)}).actions).toHaveLength(0);
 });
 it('keeps AI cohorts out of the default human dashboard',()=>{
   const base={status:'finished',engine_version:'power-engine-2',event_schema_version:1,winner_seat:'A',created_at:new Date().toISOString(),updated_at:new Date().toISOString(),finished_at:new Date().toISOString(),ruleset_version:'power-v2'};
   const dataset:Dataset={captured_at:new Date().toISOString(),players:[],records:[],telemetry:[],matches:[{...base,id:'human'},{...base,id:'bot',match_mode:'human_ai'}]};
   expect(filterData(dataset,{}).matches.map(m=>m.id)).toEqual(['human']);
   expect(filterData(dataset,{mode:'human_ai'}).matches.map(m=>m.id)).toEqual(['bot']);
 });
 it('runs the production Planner budget and returns a legal defensive action',()=>{
   const state=step(bidState(),{kind:'attack',seat:'A',spell:'Full',power:4,boost:false});
   const v=botView(state,'B'),started=performance.now();
   const move=choose(v,'planner',decisionSeed(41,v));
   expect(move.kind).toBe('defend');expect(()=>step(state,move)).not.toThrow();
   console.info(`Planner 512-search / 6-exchange reference decision: ${Math.round(performance.now()-started)}ms`);
 },30000);

});
