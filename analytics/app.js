const $=id=>document.getElementById(id);
const esc=v=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=v=>v===null||v===undefined?'—':Number(v).toFixed(1);
function table(headers,rows){return `<div class="scroll"><table><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.map(row=>`<tr>${row.map(v=>`<td>${esc(typeof v==='object'?JSON.stringify(v):v)}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${headers.length}">No records</td></tr>`}</tbody></table></div>`;}
function choices(rows){return table(['Choice','Uses / eligible exchanges'],rows.map(r=>[r.choice,`${r.n} / ${r.denominator}`]));}
let data;
function inspect(){
 const id=$('match').value;const m=data.matches.find(m=>m.id===id);if(!m)return $('replay').replaceChildren();
 const records=data.records.filter(r=>r.match_id===id);const checks=data.replays;
 $('replay').innerHTML=`<p>${esc(m.ruleset_version)} · ${esc(m.engine_version)} · ${esc(m.status)} · winner ${esc(m.winner_seat)}</p>`+records.filter(r=>r.kind==='exchange_completed').map(r=>{
 const check=checks.find(c=>c.exchange===r.exchange_number&&c.match_id===id);
 return `<details><summary>Exchange ${r.exchange_number}: ${esc(r.payload.attack_spell)} @ ${r.payload.attack_power} / ${esc(r.payload.defense_spell)} @ ${r.payload.defense_power} · ${r.payload.damage_to_defender} damage · ${check?.ok?'Replay verified':esc(check?.error||'unverified')}</summary><pre>${esc(JSON.stringify({before:r.payload.replay?.input,after:r.state,result:r.payload},null,2))}</pre></details>`;
 }).join('')+`<details><summary>Ordered game events (${records.length})</summary><pre>${esc(JSON.stringify(records,null,2))}</pre></details>`;
}
async function load(){
 const params=new URLSearchParams(new FormData($('filters')));for(const [k,v]of [...params])if(!v)params.delete(k);
 $('status').textContent='Loading records…';
 try{
 const response=await fetch('/data?'+params);data=await response.json();if(!response.ok)throw new Error(data.error);
 const m=data.metrics;
 $('status').className='';
 $('status').textContent=`${data.matches.length} matches · captured ${new Date(data.captured_at).toLocaleString()} · legacy data excluded by default`;
 $('cards').innerHTML=[['Matches',m.matches],['Finished',`${m.completed} / ${m.started} started`],['Draws',m.draws],['Exchanges',m.exchanges],['First attacker wins',`${m.firstAttacker.wins} / ${m.firstAttacker.n}`],['Stale',m.stale],['Human wins vs AI',`${m.humanVsAi.wins} / ${m.humanVsAi.wins+m.humanVsAi.losses} decisive`]].map(([k,v])=>`<div class="card">${esc(k)}<strong>${esc(v)}</strong></div>`).join('');
 $('balance').innerHTML='<h3>Attack choices</h3>'+choices(m.attacks)+'<h3>Defense choices</h3>'+choices(m.defenses)+'<details><summary>Pairings and power allocation</summary>'+choices(m.powers)+'</details><details><summary>Defense choices by school</summary>'+choices(m.defenseBySchool)+'</details><h3>Spell outcome associations</h3>'+table(['Attack','Uses in winning games / uses in decisive games'],m.spellOutcomes.map(r=>[r.spell,`${r.usesInWinningGames} / ${r.uses}`]))+'<h3>Effects</h3>'+table(['Measure','Value'],[['Damage per exchange',num(m.damage.mean)],['Prevention per exchange',num(m.prevention.mean)],['Delayed casts',m.delayed.casts],['Delayed stored / delivered',`${m.delayed.stored} / ${m.delayed.delivered}`],['Gather uses',m.gather.length]])+'<h3>Advantage spends</h3>'+choices(m.advantage.spends)+'<details><summary>Advantage after exchanges</summary>'+choices(m.advantage.after)+'</details>';
 $('pacing').innerHTML=table(['Measure','N','Median','P90'],[['Game minutes',m.gameMinutes.n,num(m.gameMinutes.median),num(m.gameMinutes.p90)],['Exchanges per finished game',m.exchangesPerGame.n,num(m.exchangesPerGame.median),num(m.exchangesPerGame.p90)],['Attack decision seconds',m.decisionSeconds.attack.n,num(m.decisionSeconds.attack.median),num(m.decisionSeconds.attack.p90)],['Defense decision seconds',m.decisionSeconds.defend.n,num(m.decisionSeconds.defend.median),num(m.decisionSeconds.defend.p90)],['Active minutes per seat',m.reliability.activeMinutes.n,num(m.reliability.activeMinutes.median),num(m.reliability.activeMinutes.p90)]]);
 $('learning').innerHTML=table(['Tester','Games','Early wins / finished','Later wins / finished','Inspect early / later','Decision seconds early / later'],m.learning.map(t=>[t.tester,t.games,`${t.early.wins} / ${t.early.finished}`,`${t.later.wins} / ${t.later.finished}`,`${t.early.inspect} / ${t.later.inspect}`,`${num(t.early.decisionSeconds.median)} / ${num(t.later.decisionSeconds.median)}`]))+m.learning.map(t=>`<details><summary>${esc(t.tester)} choice changes</summary><h4>Early attacks</h4>${choices(t.early.attacks)}<h4>Later attacks</h4>${choices(t.later.attacks)}</details>`).join('');
 $('reliability').innerHTML=table(['Measure','Count'],[['Unfinished',m.unfinished],['Stale',m.stale],['Human wins vs AI',`${m.humanVsAi.wins} / ${m.humanVsAi.wins+m.humanVsAi.losses} decisive`],['Reconnects',m.reliability.reconnects],['Action errors',m.reliability.actionErrors],['Client resolution errors',m.reliability.resolutionErrors],['Server resolution failures',m.reliability.serverResolutionFailures],['Matches without telemetry',m.reliability.matchesWithoutTelemetry],['Inspect opens',m.reliability.inspectOpens],['Replay failures',data.replays.filter(r=>!r.ok).length]]);
 $('match').innerHTML='<option value="">Select a match</option>'+data.matches.map(m=>`<option value="${esc(m.id)}">${esc(m.created_at)} · ${esc(m.id)} · ${esc(m.status)}</option>`).join('');
 $('exports').innerHTML=['matches','exchanges','events','telemetry','replay'].map(t=>`<a class="export" href="/export?${esc(params)}&amp;table=${t}">${t==='replay'?'Replay JSON':t+' CSV'}</a>`).join('');
 $('replay').replaceChildren();
 }catch(error){$('status').textContent=error.message;$('status').className='error';}
}
$('filters').addEventListener('submit',e=>{e.preventDefault();void load();});$('match').addEventListener('change',inspect);void load();
