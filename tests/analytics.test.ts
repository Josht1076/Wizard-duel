import {describe,it,expect} from 'vitest';
import {fixture} from '../analytics/fixtures';
import {filterData,metrics,replay,exportData,csv} from '../analytics/model';
describe('research analysis',()=>{
 it('separates legacy, terminal draws, stale matches, and first-attacker denominators',()=>{
 const data=filterData(fixture(),{});const m=metrics(data);
 expect(m.matches).toBe(3);expect(m.completed).toBe(2);expect(m.draws).toBe(1);expect(m.stale).toBe(1);
 expect(m.firstAttacker).toEqual({wins:1,n:1});expect(m.gameMinutes).toMatchObject({n:2,median:5});
 expect(m.decisionSeconds.attack.median).toBe(10);expect(m.decisionSeconds.defend.median).toBe(20);
 expect(m.reliability.matchesWithoutTelemetry).toBe(2);expect(m.learning[0].games).toBe(3);
 });
 it('filters tester, date, status, and version consistently for all exports',()=>{
 expect(filterData(fixture(),{version:'all'}).matches).toHaveLength(4);
 const data=filterData(fixture(),{status:'stale',tester:'tester-one',from:'2026-11-20',to:'2026-11-20'});
 expect(data.matches).toHaveLength(1);expect(data.records.every(r=>r.match_id===data.matches[0].id)).toBe(true);
 expect(filterData(fixture(),{from:'2026-11-21'}).matches).toHaveLength(0);
 });
 it('replays recorded state and detects result/persistence drift',()=>{
 const data=fixture();expect(replay(data.records)[0].ok).toBe(true);
 const tampered=structuredClone(data.records);tampered.find(r=>r.kind==='exchange_completed')!.state.players![1].stored_damage=5;
 expect(replay(tampered)[0].error).toBe('persisted_state_mismatch');
 const summary=structuredClone(data.records);summary.find(r=>r.kind==='exchange_completed')!.payload.incoming_damage=999;
 expect(replay(summary)[0].error).toBe('recorded_summary_mismatch');
 });
 it('does not export unresolved bids or secret/personally identifying fields',()=>{
 const data=fixture();data.records[1].payload={display_name:'private name',token:'secret',room_code:'ABCD'};
 const safe=exportData(data);expect(safe.records.some(r=>r.kind==='bid_submitted')).toBe(false);
 expect(JSON.stringify(safe)).not.toContain('private name');expect(JSON.stringify(safe)).not.toContain('secret');
 });
 it('quotes CSV correctly, preserving multiline JSON and preventing spreadsheet formula execution',()=>{
 const text=csv([{choice:'=SUM(A1)',note:'a,"b"\nc',state:{x:1}}]);
 expect(text).toContain('"\'=SUM(A1)"');expect(text).toContain('a,""b""\nc');expect(text).toContain('"{""x"":1}"');
 });
});
