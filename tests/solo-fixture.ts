import {createArchive,type Archive} from '../src/lib/solo/archive';
import {actor,botView,freshGame,step,type SoloGame} from '../src/lib/solo/game';
import {choose,decisionSeed} from '../src/lib/solo/bot';
export function completedSolo(seed=7):Archive {
 const start=Date.now()-3600000;
 const archive=createArchive('141643af-585c-45b2-8fea-f07cbb39ae1a','734ef8ac-ebfc-4456-91a0-d9023b45b6df',seed,'random',new Date(start).toISOString());
 let s=freshGame();
 for(let i=0;i<1000&&s.phase!=='finished';i++){
   const who=s.phase==='bid'?(s.bids.A===null?'A':'B'):actor(s)!;
   const view=s.phase==='reveal'?null:botView(s,who);
   const move=view?choose(view,'random',decisionSeed(seed,view)):{kind:'continue' as const};
   s=step(s,move);archive.actions.push({at:new Date(start+(i+1)*1000).toISOString(),move});
 }
 if(s.phase!=='finished')throw new Error('fixture_did_not_finish');return archive;
}
export function bidState():SoloGame {
 return step(step(freshGame(),{kind:'bid',seat:'A',power:5}),{kind:'bid',seat:'B',power:1});
}
