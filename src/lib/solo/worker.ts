import { choose,decisionSeed } from "./bot";
import type { BotView,Policy } from "./game";
self.addEventListener("message",(event:MessageEvent<{view:BotView;policy:Policy;seed:number}>)=>{
  try { const {view,policy,seed}=event.data;self.postMessage({move:choose(view,policy,decisionSeed(seed,view))}); }
  catch { self.postMessage({error:"AI decision failed. Retry or start another game."}); }
});
