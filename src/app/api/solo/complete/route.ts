import { createServerSupabaseClient } from "@/lib/supabase/server";
import { validateArchive,research } from "@/lib/solo/archive";
export async function POST(request:Request){
  // Bound anonymous diagnostic uploads before parsing/replaying. No private server state is accepted.
  const reader=request.body?.getReader();if(!reader)return Response.json({error:"invalid_body"},{status:400});
  const chunks:Uint8Array[]=[];let size=0;
  try {
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1048576){await reader.cancel();return Response.json({error:"upload_too_large"},{status:413});}chunks.push(value);}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    const body=JSON.parse(new TextDecoder().decode(bytes));
    if(typeof body.uploadToken!=="string"||body.uploadToken.length<32||body.uploadToken.length>256)return Response.json({error:"invalid_token"},{status:400});
    let archive,game;
    try {archive=validateArchive(body.archive);game=research(archive);}catch{return Response.json({error:"invalid_game_history"},{status:400});}
    if(game.state.phase!=="finished")return Response.json({error:"game_not_finished"},{status:400});
    let sb;try{sb=createServerSupabaseClient();}catch{return Response.json({error:"solo_storage_unconfigured"},{status:503});}
    const {data,error}=await sb.rpc("wd_save_solo",{p_match_id:archive.id,p_token:body.uploadToken,p_data:{
      winner:game.state.winner,created_at:archive.createdAt,finished_at:game.finishedAt,tester_id:archive.testerId,
      bot_version:archive.botVersion,bot_policy:archive.policy,seed:archive.seed,exchanges:game.state.exchange,
      attacker:game.state.attacker,last_result:game.state.last,players:game.players,records:game.records,
    }});
    if(error)return Response.json({error:"solo_save_failed"},{status:503});
    return Response.json(data);
  }catch{return Response.json({error:"invalid_body"},{status:400});}
}
