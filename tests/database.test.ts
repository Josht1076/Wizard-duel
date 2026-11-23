import { PGlite } from "@electric-sql/pglite";
import { beforeAll,afterAll,describe,it,expect } from "vitest";
import { readFile,readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolveBundle } from "../src/lib/match/resolve";
import type { ResolveBundle } from "../src/lib/match/types";
import { replay, type RecordRow } from "../analytics/model";
let db:PGlite;
const tokenA='test-only-token-aaaaaaaaaaaa';const tokenB='test-only-token-bbbbbbbbbbbb';
async function scalar<T=Record<string,unknown>>(sql:string,args:unknown[]=[]):Promise<T>{return (await db.query<{result:T}>(sql,args)).rows[0]?.result;}
async function command(token:string,action:string,args:object,id=randomUUID()){
 return scalar<{match_id:string;room_code:string;phase:string;status:string}>(`select wd_command($1,$2,$3,$4::jsonb) result`,[id,token,action,JSON.stringify(args)]);
}
async function game(){
 const a=await command(tokenA,'create',{display_name:'Not exported',tester_id:randomUUID()});
 await command(tokenB,'join',{room_code:a.room_code,display_name:'Not exported B',tester_id:randomUUID()});
 await command(tokenA,'bid',{match_id:a.match_id,power:5});await command(tokenB,'bid',{match_id:a.match_id,power:1});
 return a;
}
async function resolve(id:string){
 const b=await scalar<ResolveBundle>('select wd_fetch_resolve_bundle($1,$2) result',[id,tokenA]);
 const result=resolveBundle(b);
 await scalar('select wd_apply_resolution($1,$2,$3::jsonb) result',[id,tokenA,JSON.stringify(result)]);
 return {b,result};
}
beforeAll(async()=>{
 db=new PGlite();
 // Supabase roles/publication. Built-in PostgreSQL sha256 is an exact test substitute
 // for pgcrypto's digest(bytea,'sha256'); no fake hashes are used.
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema extensions;create function extensions.digest(bytea,text) returns bytea language sql immutable as 'select sha256($1)';
 create publication supabase_realtime;`);
 for(const file of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort()){
  const sql=(await readFile('supabase/migrations/'+file,'utf8')).replace(/create extension if not exists "pgcrypto"(?: with schema extensions)?;/g,'');
  await db.exec(sql);
 }
},60000);
afterAll(async()=>{await db?.close();});
describe('PostgreSQL game flow',()=>{
 it('survives defense and delivers Delayed on next attack, with exact persisted replay',async()=>{
 const g=await game();const args={match_id:g.match_id};
 await command(tokenA,'commit',{...args,spell:'Delayed',power:4});await command(tokenB,'commit',{...args,spell:'Full',power:2});
 await resolve(g.match_id);
 expect(await scalar<number>(`select stored_damage result from match_players where match_id=$1 and seat='A'`,[g.match_id])).toBe(4);
 await command(tokenB,'commit',{...args,spell:'Full',power:3});await command(tokenA,'commit',{...args,spell:'Full',power:1});
 await resolve(g.match_id);
 expect(await scalar<number>(`select stored_damage result from match_players where match_id=$1 and seat='A'`,[g.match_id])).toBe(4);
 await command(tokenA,'commit',{...args,spell:'Full',power:3});await command(tokenB,'commit',{...args,spell:'Full',power:4});
 const {result}=await resolve(g.match_id);expect(result.incoming_damage).toBe(10);expect(result.attacker_stored_damage).toBe(0);
 const rows=(await db.query<RecordRow>(`select * from wd_records where match_id=$1 order by id`,[g.match_id])).rows;
 expect(replay(rows)).toHaveLength(3);expect(replay(rows).every(r=>r.ok)).toBe(true);
 const again=await scalar<{status:string}>('select wd_apply_resolution($1,$2,$3) result',[g.match_id,tokenA,JSON.stringify(result)]);
 expect(again.status).toBe('already_applied');
 });
 it('requires pre-school refresh, derives school, and forbids spending a newly gained token',async()=>{
 const g=await game();const args={match_id:g.match_id};
 await command(tokenA,'commit',{...args,spell:'Feint',power:4});await command(tokenB,'commit',{...args,spell:'Full',power:2});await resolve(g.match_id);
 expect(await scalar<string>('select phase result from match_state where match_id=$1',[g.match_id])).toBe('refresh');
 await expect(command(tokenB,'commit',{...args,spell:'Full',power:3})).rejects.toThrow('wrong_phase');
 await expect(command(tokenB,'refresh',{...args,spend:true})).rejects.toThrow('not_your_turn');
 await command(tokenA,'refresh',{...args,spend:true});
 await expect(command(tokenB,'commit',{...args,spell:'Full',power:3,advantage_spend:'boost'})).rejects.toThrow('no_advantage');
 await command(tokenB,'commit',{...args,spell:'Full',power:3,declared_school:'Illusion'});
 expect(await scalar<string>('select declared_school result from match_state where match_id=$1',[g.match_id])).toBe('Fire');
 await expect(command(tokenA,'commit',{...args,spell:'Full',power:5,advantage_spend:'boost'})).rejects.toThrow('no_advantage');
 await command(tokenA,'commit',{...args,spell:'Full',power:5});
 const {b}=await resolve(g.match_id);expect(b.refresh_spend_seat).toBe('A');
 });
 it('retries commands exactly once, rejects changed arguments, and rolls back invalid requests',async()=>{
 const id=randomUUID();const args={display_name:'A',tester_id:randomUUID()};
 const first=await command(tokenA,'create',args,id);expect(await command(tokenA,'create',args,id)).toEqual(first);
 await expect(command(tokenA,'create',{...args,display_name:'changed'},id)).rejects.toThrow('request_conflict');
 const g=await game();await expect(command(tokenA,'commit',{match_id:g.match_id,spell:'Full',power:5})).rejects.toThrow('power_unavailable');
 expect(await scalar<number>('select count(*)::int result from commits where match_id=$1',[g.match_id])).toBe(0);
 });
 it('prevents anonymous table reads, helper calls, direct forged results, and hidden-bid access',async()=>{
 const g=await game();
 await db.exec('set role anon');
 try {
 for(const table of ['matches','match_state','match_players','events','commits','wd_records','wd_telemetry','wd_requests']) await expect(db.query(`select * from ${table}`)).rejects.toThrow('permission denied');
 for(const fn of ['wd_apply_resolution(uuid,text,jsonb)','wd_fetch_resolve_bundle(uuid,text)','wd_player_by_token(uuid,text)','wd_create_match(text,text)','wd_submit_bid(uuid,text,integer)']){
 expect(await scalar<boolean>(`select has_function_privilege('anon',$1,'execute') result`,[fn])).toBe(false);
 }
 const pub=await scalar<{state:{pending_bid_a:unknown};players:unknown[]}>('select wd_get_match_public($1) result',[g.room_code]);
 expect(JSON.stringify(pub)).not.toContain('reconnect_token_hash');
 expect(await scalar<boolean>(`select has_function_privilege('anon','wd_command(uuid,text,text,jsonb)','execute') result`)).toBe(true);
 } finally {await db.exec('reset role');}
 });
 it('deduplicates participant telemetry and rejects invalid tokens',async()=>{
 const g=await game();const id=randomUUID();
 for(let n=0;n<2;n++)await db.query(`select wd_track($1,$2,$3,'inspect_open','{}')`,[id,g.match_id,tokenA]);
 expect(await scalar<number>('select count(*)::int result from wd_telemetry where request_id=$1',[id])).toBe(1);
 await expect(db.query(`select wd_track($1,$2,'invalid','inspect_open','{}')`,[randomUUID(),g.match_id])).rejects.toThrow('invalid_token');
 });
 it('handles repeated bid ties, automatic recovery, legacy rejection, and immutable versions',async()=>{
 const a=await command(tokenA,'create',{display_name:'A',tester_id:randomUUID()});
 await command(tokenB,'join',{room_code:a.room_code,tester_id:randomUUID()});
 for(let power=1;power<=5;power++){
 await command(tokenA,'bid',{match_id:a.match_id,power});await command(tokenB,'bid',{match_id:a.match_id,power});
 }
 expect(await scalar<number>(`select cardinality(discarded_power) result from match_players where match_id=$1 and seat='A'`,[a.match_id])).toBe(0);
 expect(await scalar<string>('select phase result from match_state where match_id=$1',[a.match_id])).toBe('bid');
 await expect(db.query(`update matches set ruleset_version='forged' where id=$1`,[a.match_id])).rejects.toThrow('immutable_match_version');
 const legacy=await scalar<string>(`insert into matches(room_code,ruleset_version,engine_version) values('LEGA','playtest-1','legacy') returning id result`);
 await db.query(`insert into match_players(match_id,seat,reconnect_token_hash) values($1,'A',wd_hash_token($2))`,[legacy,tokenA]);
 await db.query(`insert into match_state(match_id,phase) values($1,'bid')`,[legacy]);
 await expect(command(tokenA,'bid',{match_id:legacy,power:1})).rejects.toThrow('legacy_match_start_new_game');
 });
 it('finishes seeded legal games and verifies every persisted exchange, including refresh cycles',async()=>{
 let seed=123456789;const rng=(n:number)=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
 const attack=['Full','Feint','Partial','Gather','Hex','Delayed'];const defense=['Full','Partial','Counter','Reversal'];
 for(let gameIndex=0;gameIndex<12;gameIndex++){
 const g=await game();let done=false;
 for(let turn=0;turn<200;turn++){
 let state=await scalar<{phase:string;advantage_at_start:string;refresh_spend_seat:string|null;attacker_seat:string}>('select to_jsonb(s) result from match_state s where match_id=$1',[g.match_id]);
 if(state.phase==='finished'){done=true;break;}
 if(state.phase==='refresh') await command(state.advantage_at_start==='A'?tokenA:tokenB,'refresh',{match_id:g.match_id,spend:rng(3)===0});
 state=await scalar('select to_jsonb(s) result from match_state s where match_id=$1',[g.match_id]);
 const defender=state.attacker_seat==='A'?'B':'A';
 for(const [seat,cards]of [[state.attacker_seat,attack],[defender,defense]] as const){
 const discarded=await scalar<number[]>('select discarded_power result from match_players where match_id=$1 and seat=$2',[g.match_id,seat]);
 const powers=[1,2,3,4,5].filter(p=>!discarded.includes(p));expect(powers.length).toBeGreaterThan(0);
 const boost=state.advantage_at_start===seat&&!state.refresh_spend_seat&&rng(3)===0;
 await command(seat==='A'?tokenA:tokenB,'commit',{match_id:g.match_id,spell:cards[rng(cards.length)],power:powers[rng(powers.length)],advantage_spend:boost?'boost':null});
 }
 await resolve(g.match_id);
 }
 expect(done).toBe(true);
 const records=(await db.query<RecordRow>('select * from wd_records where match_id=$1 order by id',[g.match_id])).rows;
 const results=replay(records);expect(results.length).toBeGreaterThan(0);expect(results.every(r=>r.ok)).toBe(true);
 }
 },60000);

});
