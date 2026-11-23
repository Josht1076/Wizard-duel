import { describe,it,expect } from "vitest";
import {createFreshPlayer,resolveExchange} from './resolve';
import {ATTACK_CARDS,DEFENSE_CARDS} from './cards';
import type {ExchangeInput,AttackSpell,DefenseSpell,PowerValue} from './types';
function input(attackSpell:AttackSpell='Full',defenseSpell:DefenseSpell='Full'):ExchangeInput{return {attackerSeat:'A',defenderSeat:'B',advantageAtStart:null,
 attacker:createFreshPlayer('A'),defender:createFreshPlayer('B'),commit:{attackSpell,defenseSpell,attackPower:3,defensePower:2,advantageSpend:null,advantageSpendSeat:null}};}
describe('power-card timing',()=>{
 it('checks every attack/defense pairing and power allocation',()=>{
 for(const a of ATTACK_CARDS)for(const d of DEFENSE_CARDS)for(const ap of [1,2,3,4,5])for(const dp of [1,2,3,4,5]){
 const i=input(a.name,d.name);i.commit.attackPower=ap as PowerValue;i.commit.defensePower=dp as PowerValue;
 const r=resolveExchange(i);expect(r.damageToDefender).toBe(Math.max(0,r.incomingDamage-r.prevention));
 expect(r.retaliationToAttacker).toBe(d.name==='Reversal'?Math.max(0,dp-ap):0);
 expect(new Set(r.attackerDiscardedPower).size).toBe(r.attackerDiscardedPower.length);
 }
 });
 it('banks bonuses in a new Delayed while old damage arrives once',()=>{
 const i=input('Delayed');i.attacker.storedDamage=4;i.attacker.nextAttackBonus=1;i.advantageAtStart='A';i.commit.advantageSpend='boost';i.commit.advantageSpendSeat='A';
 const r=resolveExchange(i);expect(r.incomingDamage).toBe(4);expect(r.attackerStoredDamage).toBe(6);
 });
 it('Gather consumes preparation, delivers stored damage with boost, and awards no Advantage',()=>{
 const i=input('Gather');i.attacker.storedDamage=4;i.attacker.nextAttackBonus=1;i.advantageAtStart='A';i.commit.advantageSpend='boost';i.commit.advantageSpendSeat='A';
 const r=resolveExchange(i);expect(r.incomingDamage).toBe(6);expect(r.advantageAfter).toBe('B');expect(r.attackerStoredDamage).toBe(0);
 });
 it('Gather recovers only a discarded next card, including after refresh',()=>{
 const i=input('Gather');i.attacker.discardedPower=[4];expect(resolveExchange(i).attackerDiscardedPower).toEqual([3]);
 i.advantageAtStart='A';i.commit.advantageSpend='refresh';i.commit.advantageSpendSeat='A';const r=resolveExchange(i);expect(r.attackerDiscardedPower).toEqual([]);expect(r.followups).toContain('Attacker recovers Power 3.');
 });
 it('Hex discards exactly the highest available card after automatic refresh',()=>{
 const i=input('Hex');i.defender.discardedPower=[1,2,3,4,5];expect(resolveExchange(i).defenderDiscardedPower).toEqual([5]);
 i.defender.discardedPower=[5];expect(resolveExchange(i).defenderDiscardedPower).toEqual([4,5]);
 });
 it('Partial prepares regardless of damage and next-role bonuses do not stack',()=>{
 const i=input('Partial','Partial');i.attacker.nextAttackBonus=1;i.defender.nextDefenseBonus=1;
 const r=resolveExchange(i);expect(r.incomingDamage).toBe(6);expect(r.prevention).toBe(5);expect(r.attackerNextDefenseBonus).toBe(1);expect(r.defenderNextAttackBonus).toBe(1);
 });
 it('resolves simultaneous death as a draw including Reversal against Gather',()=>{
 const i=input('Gather','Reversal');i.attacker.storedDamage=6;i.attacker.health=1;i.defender.health=1;i.commit.attackPower=1;i.commit.defensePower=3;
 expect(resolveExchange(i).winner).toBe('draw');
 });
 it('uses Delayed no-arrival exceptions and Counter rounding',()=>{
 for(const d of DEFENSE_CARDS){const r=resolveExchange(input('Delayed',d.name));expect(r.advantageAfter).toBe(d.name==='Partial'||d.name==='Counter'?'B':null);}
 const i=input('Full','Counter');i.commit.attackPower=2;i.commit.defensePower=2;expect(resolveExchange(i).advantageAfter).toBe('B');
 });
});
