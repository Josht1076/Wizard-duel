"use client";
import Link from "next/link";
import { useCallback,useEffect,useMemo,useRef,useState } from "react";
import { ATTACK_CARDS,DEFENSE_CARDS,SCHOOL_ICONS,type AttackSpell,type DefenseSpell,type PowerValue } from "@/lib/rules";
import { actor,botView,canBoost,other,powers,school,step,BOT_VERSION,type Move,type Policy } from "@/lib/solo/game";
import { createArchive,publicArchive,restore,type SavedGame } from "@/lib/solo/archive";
import { load,save,savedGames,upload } from "@/lib/solo/storage";
import { newReconnectToken,testerId } from "@/lib/session";

export function SoloDuelBoard(){
  const [game,setGame]=useState<SavedGame|null>(null);
  const [policy,setPolicy]=useState<Policy>("tactical");
  const [seedText,setSeedText]=useState("");
  const [spell,setSpell]=useState<string>("Full");
  const [power,setPower]=useState<PowerValue>(5);
  const [boost,setBoost]=useState(false);
  const [inspect,setInspect]=useState(false);
  const [thinking,setThinking]=useState(false);
  const [error,setError]=useState("");
  const [sync,setSync]=useState("");
  const [retry,setRetry]=useState(0);
  const [ready,setReady]=useState(false);
  const [history,setHistory]=useState<SavedGame[]>([]);
  const syncing=useRef(false);
  const current=useRef<SavedGame|null>(null);
  const state=useMemo(()=>game?restore(game.archive):null,[game]);
  useEffect(()=>{const stored=load();setGame(stored);current.current=stored;setHistory(savedGames());setReady(true);},[]);
  function persist(next:SavedGame){
    current.current=next;setGame(next);
    try{save(next);setHistory(savedGames());}catch{setError("This browser could not save the game. Keep this tab open and download the replay.");}
  }
  const commit=useCallback((move:Move)=>{
    const previous=current.current;if(!previous)return;
    try{
      step(restore(previous.archive),move); // Reject stale worker replies and double clicks before changing state.
      const last=previous.archive.actions.at(-1)?.at||previous.archive.createdAt;
      const at=new Date(Math.max(Date.now(),Date.parse(last))).toISOString();
      const next={...previous,archive:{...previous.archive,actions:[...previous.archive.actions,{at,move}]}};
      current.current=next;setGame(next);setBoost(false);setInspect(false);setError("");
      try{save(next);setHistory(savedGames());}catch{setError("Local storage is full or unavailable. Download the replay before closing this tab.");}
    }catch{setError("That move is no longer available. Choose again.");}
  },[]);
  const flush=useCallback(async()=>{
    if(syncing.current)return;syncing.current=true;
    try{
      const active=current.current;
      // Include the in-memory game even if localStorage hit quota.
      const queue=savedGames().filter(g=>g.archive.id!==active?.archive.id);if(active)queue.unshift(active);
      for(const item of queue){
        if(item.uploaded||restore(item.archive).phase!=="finished")continue;
        setSync("Uploading completed game…");const saved=await upload(item);
        if(saved&&current.current?.archive.id===saved.archive.id){current.current=saved;setGame(saved);}
      }
      setHistory(savedGames());
      setSync(current.current?.uploaded?"Saved to Supabase.":"");
    }catch(e){setSync(e instanceof Error?e.message:"Upload failed; the local copy is retained.");}
    finally{syncing.current=false;}
  },[]);
  useEffect(()=>{
    if(!ready)return;
    void flush();const tick=window.setInterval(()=>void flush(),30000);window.addEventListener("online",flush);
    return()=>{clearInterval(tick);window.removeEventListener("online",flush);};
  },[ready,game?.archive.id,state?.phase,flush]);
  const botTurn=!!state&&((state.phase==="bid"&&state.bids.B===null)||actor(state)==="B");
  useEffect(()=>{
    if(!state||!game||!botTurn)return;
    setThinking(true);setError("");
    const worker=new Worker(new URL("../lib/solo/worker.ts",import.meta.url),{type:"module"});
    const matchId=game.archive.id,actionCount=game.archive.actions.length;
    worker.onmessage=(event:MessageEvent<{move?:Move;error?:string}>)=>{
      if(current.current?.archive.id!==matchId||current.current.archive.actions.length!==actionCount){worker.terminate();return;}
      setThinking(false);if(event.data.move)commit(event.data.move);else setError(event.data.error||"AI failed. Retry its turn.");
      worker.terminate();
    };
    worker.onerror=()=>{setThinking(false);setError("AI could not start. Retry its turn or select another opponent.");worker.terminate();};
    worker.postMessage({view:botView(state,"B"),policy:game.archive.policy,seed:game.archive.seed});
    return()=>{worker.terminate();setThinking(false);};
  },[state,game?.archive.id,game?.archive.policy,game?.archive.seed,botTurn,retry,commit]);
  function start(){
    if(seedText&&!/^\d{1,10}$/.test(seedText)){setError("Use a whole-number seed from 0 to 4294967295.");return;}
    const seed=seedText?Number(seedText):crypto.getRandomValues(new Uint32Array(1))[0];
    if(seed>0xffffffff){setError("Seed must be at most 4294967295.");return;}
    try{
      const next:SavedGame={archive:createArchive(crypto.randomUUID(),testerId(),seed,policy),uploadToken:newReconnectToken(),uploaded:false};
      persist(next);setError("");setSync("");setBoost(false);setInspect(false);setSpell("Full");setPower(5);
    }catch{setError("This browser must allow local storage to start a resumable game.");}
  }
  function download(){
    if(!game)return;const url=URL.createObjectURL(new Blob([JSON.stringify(publicArchive(game.archive),null,2)],{type:"application/json"}));
    const a=document.createElement("a");a.href=url;a.download=`wizard-duel-solo-${game.archive.id}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  if(!ready)return <p role="status">Loading solo game…</p>;
  const me=state?.players.A,opponent=state?.players.B;
  const available=me?powers(me):[];
  const selectedPower=available.includes(power)?power:available.at(-1)!;
  const humanTurn=!!state&&(actor(state)==="A"||(state.phase==="bid"&&state.bids.A===null));
  const cards=state?.phase==="defend"?DEFENSE_CARDS:ATTACK_CARDS;
  const selected=cards.find(c=>c.name===spell)||cards[0];
  const last=state?.last;
  return <div className="solo-page">
    <div className="preview-bar"><Link href="/">Home</Link><span>Single-player playtest</span><button onClick={download} disabled={!game}>Download replay</button></div>
    <details className="solo-setup" open={!game||state?.phase==="finished"}>
      <summary>New game and saved games</summary>
      <p>Choose your opponent. Tactical reuses our earlier public-information evaluation; Planner searches ahead. Neither sees your hidden spell or power.</p>
      <div className="solo-controls">
        <label>AI opponent<select value={policy} onChange={e=>setPolicy(e.target.value as Policy)}><option value="tactical">Tactical</option><option value="planner">Planner · 512 searches</option><option value="random">Random</option></select></label>
        <label>Seed (optional)<input inputMode="numeric" value={seedText} onChange={e=>setSeedText(e.target.value)} placeholder="Random seed"/></label>
        <button className="utility" onClick={start}>Start new game</button>
      </div>
      <p className="small">Starting another game preserves the current game on this browser. Completed games upload automatically.</p>
      {history.length>0&&<label>Resume saved game<select value={game?.archive.id||""} onChange={e=>{const saved=load(e.target.value);if(saved){persist(saved);setError("");setBoost(false);setInspect(false);}}}>{history.map(g=><option key={g.archive.id} value={g.archive.id}>{g.archive.createdAt.slice(0,16)} · {g.archive.policy} · {restore(g.archive).phase} {g.uploaded?"· uploaded":""}</option>)}</select></label>}
    </details>
    {error&&<p className="solo-notice" role="alert">{error} {botTurn&&<button onClick={()=>setRetry(n=>n+1)}>Retry AI turn</button>}</p>}
    {state&&game&&<section className="duel-shell" aria-label="Duel against AI">
      <div className="top"><span className="brand">✦ Wizard Duel</span><span>{state.phase==="bid"?"Opening bid":`Exchange ${state.exchange}`}</span></div>
      <div className="health"><div><span>You</span><strong>{me!.health} HP</strong></div><div><span>AI · {game.archive.policy}</span><strong>{opponent!.health} HP</strong></div></div>
      <div className="heading"><h2 aria-live="polite">{state.phase==="finished"?(state.winner==="draw"?"Draw":state.winner==="A"?"You win":"AI wins"):state.phase==="reveal"?"Exchange resolved":state.phase==="bid"?"Choose an opening bid":thinking?"AI is thinking…":humanTurn?(state.phase==="refresh"?"Refresh or keep Advantage":state.phase==="attack"?"Your attack":"Your defense"):"Waiting for AI"}</h2>
      {!["finished","reveal","bid"].includes(state.phase)&&<button className="utility" aria-expanded={inspect} onClick={()=>setInspect(!inspect)}>Inspect</button>}</div>
      {inspect&&<div className="public">
        {state.phase==="defend"&&state.attacker==="B"&&<p>Declared school <strong>{school(state)}</strong></p>}
        <p>AI available power: <strong>{powers(opponent!).join(" – ")||"none"}</strong></p>
        <p>AI stored damage: {opponent!.storedDamage} · Next attack bonus: {opponent!.nextAttackBonus} · Next defense bonus: {opponent!.nextDefenseBonus}</p>
        <p>Your stored damage: {me!.storedDamage} · Next attack bonus: {me!.nextAttackBonus} · Next defense bonus: {me!.nextDefenseBonus}</p>
        <p>Advantage: {state.advantage==="A"?"You":state.advantage==="B"?"AI":"none"}{state.spend?` · ${state.spend.seat==="A"?"You":"AI"} spent it for ${state.spend.action}`:""}</p>
      </div>}
      {state.phase==="bid"&&<p className="small">Both players secretly bid an available power. Higher power attacks first; both bids are discarded. Ties re-bid.</p>}
      {humanTurn&&state.phase==="refresh"&&<>
        <p className="small">Spend Advantage to recover discarded power, or keep it for this exchange.</p>
        <div className="power">
          <span className="eyebrow">Your available power</span>
          <div className="numbers" role="group" aria-label="Available power cards">
            {([1,2,3,4,5] as PowerValue[]).map(p=><button key={p} type="button" disabled={!available.includes(p)} aria-pressed={available.includes(p)} tabIndex={-1}>{p}</button>)}
          </div>
        </div>
        <div className="advantage-actions"><button className="utility" onClick={()=>commit({kind:"refresh",seat:"A",spend:true})}>Spend Advantage: recover power</button><button className="utility" onClick={()=>commit({kind:"refresh",seat:"A",spend:false})}>Keep Advantage</button></div>
      </>}
      {humanTurn&&state.phase!=="refresh"&&<>
        {state.phase!=="bid"&&<>
          {canBoost(state,"A")&&<label className="solo-boost"><input type="checkbox" checked={boost} onChange={e=>setBoost(e.target.checked)}/>Spend Advantage: {state.phase==="attack"?"+2 damage":"+2 prevention"}</label>}
          <div className="selection"><section className={`spell ${selected.school.toLowerCase()}`}><div className="sigil" aria-hidden="true">{SCHOOL_ICONS[selected.school]}</div><div><p className="eyebrow kind">{selected.school}</p><h3>{selected.name}</h3><p className="rule">{selected.rule}</p></div></section></div>
          <div className="hand" data-defense={state.phase==="defend"} role="group" aria-label="Spells">{cards.map(c=><button key={c.name} className={`choice ${c.school.toLowerCase()}`} aria-pressed={selected.name===c.name} onClick={()=>setSpell(c.name)}><strong>{c.name}</strong><span>{c.face}</span></button>)}</div>
        </>}
        <div className="power"><span className="eyebrow">Power</span><div className="numbers" role="group" aria-label="Power cards">{([1,2,3,4,5] as PowerValue[]).map(p=><button key={p} disabled={!available.includes(p)} aria-pressed={selectedPower===p} onClick={()=>setPower(p)}>{p}</button>)}</div></div>
        <div className="footer"><button className="main-action" onClick={()=>commit(state.phase==="bid"?{kind:"bid",seat:"A",power:selectedPower}:state.phase==="attack"?{kind:"attack",seat:"A",spell:selected.name as AttackSpell,power:selectedPower,boost}:{kind:"defend",seat:"A",spell:selected.name as DefenseSpell,power:selectedPower,boost})}>Commit {state.phase==="bid"?"bid":state.phase==="attack"?"attack":"defense"}</button></div>
      </>}
      {state.phase==="bid"&&state.bids.A!==null&&<p role="status">Your bid is locked. Waiting for the AI bid.</p>}
      {last&&(state.phase==="reveal"||state.phase==="finished")&&(()=>{
        const atk=last.attacker_seat==="A"?"You":"AI";
        const def=last.defender_seat==="A"?"You":"AI";
        const adv=last.advantage_after==="A"?"You":last.advantage_after==="B"?"AI":"none";
        return <div className="result public" aria-live="polite">
          <p>{atk} (attack): {last.attack_spell} @ {last.attack_power} · {last.incoming_damage} incoming damage</p>
          <p>{def} (defense): {last.defense_spell} @ {last.defense_power} · {last.prevention} prevention</p>
          <p>{def} loses {last.damage_to_defender} HP.{last.retaliation_to_attacker?` ${atk} loses ${last.retaliation_to_attacker} HP to Reversal.`:""} Advantage · {adv}. {last.followups.join(" ")}</p>
        </div>;
      })()}
      {state.phase==="reveal"&&<button className="main-action" onClick={()=>commit({kind:"continue"})}>Next exchange</button>}
      {state.phase==="finished"&&<div className="public"><p role="status">{sync||(game.uploaded?"Saved to Supabase.":"Waiting to upload completed game…")}</p>{!game.uploaded&&<button className="utility" onClick={()=>void flush()}>Retry upload</button>}<button className="utility" onClick={download}>Download completed game</button></div>}
      <p className="small">{BOT_VERSION} · Seed {game.archive.seed} · Power-card rules</p>
    </section>}
  </div>;
}
