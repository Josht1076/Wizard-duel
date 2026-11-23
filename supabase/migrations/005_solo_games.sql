-- Completed client solo games are replay-validated by /api/solo/complete.
begin;
alter table public.matches add column match_mode text not null default 'human_human' check(match_mode in ('human_human','human_ai'));
alter table public.matches add column bot_policy text;
alter table public.matches add column bot_version text;
alter table public.matches add column bot_seed bigint;
alter table public.matches add column solo_payload_hash text;
alter table public.matches add column data_source text not null default 'server_multiplayer';
create function public.wd_save_solo(p_match_id uuid,p_token text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare existing matches; r jsonb; won text; final_players jsonb;
begin
 if p_token is null or length(p_token)<32 or p_data->>'bot_version'<>'power-ai-1' or p_data->>'bot_policy' not in ('random','tactical','planner') then raise exception 'invalid_solo_upload'; end if;
 won:=p_data->>'winner';
 if won is null or won not in ('A','B','draw') then raise exception 'incomplete_game'; end if;
 insert into matches(id,room_code,status,winner_seat,ruleset_version,engine_version,event_schema_version,created_at,started_at,finished_at,updated_at,match_mode,bot_policy,bot_version,bot_seed,data_source,solo_payload_hash)
 values(p_match_id,wd_new_room_code(),'finished',won,'power-v2','power-engine-2',1,(p_data->>'created_at')::timestamptz,(p_data->>'created_at')::timestamptz,(p_data->>'finished_at')::timestamptz,(p_data->>'finished_at')::timestamptz,
 'human_ai',p_data->>'bot_policy',p_data->>'bot_version',(p_data->>'seed')::bigint,'client_solo_replayed',wd_hash_token(p_data::text)) on conflict(id) do nothing;
 -- The row lock serializes concurrent retries. An existing unrelated game cannot be overwritten.
 select * into existing from matches where id=p_match_id for update;
 if existing.match_mode<>'human_ai' or existing.solo_payload_hash is distinct from wd_hash_token(p_data::text) then raise exception 'solo_id_conflict'; end if;
 if exists(select 1 from match_players where match_id=p_match_id) then
   if existing.match_mode<>'human_ai' or not exists(select 1 from match_players where match_id=p_match_id and seat='A' and reconnect_token_hash=wd_hash_token(p_token)) then raise exception 'solo_id_conflict'; end if;
   return jsonb_build_object('status','already_saved');
 end if;
 final_players:=p_data->'players';
 for r in select value from jsonb_array_elements(final_players) loop
   insert into match_players(match_id,seat,display_name,reconnect_token_hash,tester_id,health,discarded_power,stored_damage,preparations)
   values(p_match_id,r->>'seat',case when r->>'seat'='A' then 'Solo tester' else 'AI' end,
   wd_hash_token(case when r->>'seat'='A' then p_token else gen_random_uuid()::text end),case when r->>'seat'='A' then (p_data->>'tester_id')::uuid else null end,
   (r->>'health')::int,array(select value::int from jsonb_array_elements_text(r->'discarded_power')),(r->>'stored_damage')::int,r->'preparations');
 end loop;
 insert into match_state(match_id,phase,exchange_number,attacker_seat,advantage_seat,last_result)
 values(p_match_id,'finished',(p_data->>'exchanges')::int,p_data->>'attacker',p_data->'last_result'->>'advantage_after',p_data->'last_result');
 for r in select value from jsonb_array_elements(p_data->'records') loop
   insert into wd_records(match_id,exchange_number,seat,kind,payload,state,created_at)
   values(p_match_id,(r->>'exchange_number')::int,r->>'seat',r->>'kind',r->'payload',r->'state',(r->>'created_at')::timestamptz);
 end loop;
 return jsonb_build_object('status','saved');
end $$;
revoke all on function public.wd_save_solo(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.wd_save_solo(uuid,text,jsonb) to service_role;
create or replace function public.wd_research_snapshot() returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('captured_at',now(),
 'matches',coalesce((select jsonb_agg(jsonb_build_object('id',id,'status',status,'match_mode',match_mode,'bot_policy',bot_policy,'bot_version',bot_version,'bot_seed',bot_seed,'data_source',data_source,'ruleset_version',ruleset_version,'engine_version',engine_version,'event_schema_version',event_schema_version,'winner_seat',winner_seat,'created_at',created_at,'started_at',started_at,'updated_at',updated_at,'finished_at',finished_at) order by created_at,id) from matches),'[]'::jsonb),
 'players',coalesce((select jsonb_agg(jsonb_build_object('match_id',match_id,'seat',seat,'tester_id',tester_id,'health',health) order by match_id,seat) from match_players),'[]'::jsonb),
 'records',coalesce((select jsonb_agg(to_jsonb(r) order by id) from wd_records r),'[]'::jsonb),
 'telemetry',coalesce((select jsonb_agg(to_jsonb(t) order by created_at,request_id) from wd_telemetry t),'[]'::jsonb))
$$;

commit;
