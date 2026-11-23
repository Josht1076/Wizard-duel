import { restore,validateArchive,type SavedGame } from "./archive";
const PREFIX="wd_solo_game_v1:";
const CURRENT="wd_solo_current_v1";
export function save(game:SavedGame){window.localStorage.setItem(PREFIX+game.archive.id,JSON.stringify(game));window.localStorage.setItem(CURRENT,game.archive.id);}
export function load(id?:string):SavedGame|null{
  try{
    const key=id||window.localStorage.getItem(CURRENT);if(!key)return null;
    const raw=JSON.parse(window.localStorage.getItem(PREFIX+key)||"null");if(!raw)return null;
    const archive=validateArchive(raw.archive);
    if(typeof raw.uploadToken!=="string"||raw.uploadToken.length<32)return null;
    return {archive,uploadToken:raw.uploadToken,uploaded:raw.uploaded===true};
  }catch{return null;}
}
export function savedGames(){
  const games:SavedGame[]=[];
  for(let i=0;i<window.localStorage.length;i++){
    const key=window.localStorage.key(i);if(key?.startsWith(PREFIX)){const game=load(key.slice(PREFIX.length));if(game)games.push(game);}
  }
  return games.sort((a,b)=>b.archive.createdAt.localeCompare(a.archive.createdAt));
}
export async function upload(game:SavedGame){
  if(game.uploaded||restore(game.archive).phase!=="finished")return;
  const response=await fetch("/api/solo/complete",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({archive:game.archive,uploadToken:game.uploadToken})});
  if(!response.ok){const error=await response.json().catch(()=>null);throw new Error(error?.error==="solo_storage_unconfigured"?"Server storage is not configured yet. Your game is saved on this browser.":"Upload failed. Your game is saved on this browser and will retry.");}
  const data=await response.json();if(data.status!=="saved"&&data.status!=="already_saved")throw new Error("Upload was not confirmed; the local copy is retained.");
  const saved={...game,uploaded:true};
  try { window.localStorage.setItem(PREFIX+game.archive.id,JSON.stringify(saved)); } catch { /* Server confirmation remains authoritative even if browser storage is full. */ }
  return saved;
}
