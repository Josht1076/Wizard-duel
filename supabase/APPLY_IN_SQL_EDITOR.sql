-- Wizard Duel playtest schema
-- Apply in Supabase SQL editor or via supabase db push

create extension if not exists "pgcrypto";

-- matches: room code, status, ruleset, winner
create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  room_code text not null unique,
  status text not null default 'lobby'
    check (status in ('lobby', 'active', 'finished', 'abandoned')),
  ruleset_version text not null default 'playtest-1',
  winner_seat text check (winner_seat is null or winner_seat in ('A', 'B', 'draw')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists matches_room_code_idx on public.matches (room_code);

-- match_players: seats, reconnect tokens, public combat state
create table if not exists public.match_players (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  seat text not null check (seat in ('A', 'B')),
  display_name text not null default 'Wizard',
  reconnect_token_hash text not null,
  health int not null default 12,
  discarded_power int[] not null default '{}',
  preparations jsonb not null default '{"nextAttackBonus":0,"nextDefenseBonus":0}'::jsonb,
  stored_damage int not null default 0,
  joined_at timestamptz not null default now(),
  unique (match_id, seat)
);

create index if not exists match_players_match_id_idx on public.match_players (match_id);

-- match_state: public phase machine
create table if not exists public.match_state (
  match_id uuid primary key references public.matches (id) on delete cascade,
  phase text not null default 'lobby'
    check (phase in (
      'lobby',
      'bid',
      'refresh',
      'attack_commit',
      'defense_commit',
      'resolve',
      'finished'
    )),
  advantage_seat text check (advantage_seat is null or advantage_seat in ('A', 'B')),
  attacker_seat text check (attacker_seat is null or attacker_seat in ('A', 'B')),
  exchange_number int not null default 0,
  updated_at timestamptz not null default now()
);

-- commits: private until reveal (server role only in production RLS)
create table if not exists public.commits (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  exchange_number int not null,
  seat text not null check (seat in ('A', 'B')),
  role text not null check (role in ('attack', 'defend')),
  spell text not null,
  power int not null check (power between 1 and 5),
  advantage_spend text check (advantage_spend is null or advantage_spend in ('boost', 'refresh')),
  revealed boolean not null default false,
  created_at timestamptz not null default now(),
  unique (match_id, exchange_number, seat)
);

create index if not exists commits_match_exchange_idx
  on public.commits (match_id, exchange_number);

-- events: append-only playtest log
create table if not exists public.events (
  id bigserial primary key,
  match_id uuid not null references public.matches (id) on delete cascade,
  exchange_number int,
  seat text check (seat is null or seat in ('A', 'B')),
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists events_match_id_idx on public.events (match_id);

-- Placeholder RLS: open for playtest prototype; tighten before public launch
alter table public.matches enable row level security;
alter table public.match_players enable row level security;
alter table public.match_state enable row level security;
alter table public.commits enable row level security;
alter table public.events enable row level security;

-- Dev-friendly policies (replace with token-scoped policies later)
create policy "matches_select_all" on public.matches for select using (true);
create policy "matches_insert_all" on public.matches for insert with check (true);
create policy "matches_update_all" on public.matches for update using (true);

create policy "match_players_select_all" on public.match_players for select using (true);
create policy "match_players_insert_all" on public.match_players for insert with check (true);
create policy "match_players_update_all" on public.match_players for update using (true);

create policy "match_state_select_all" on public.match_state for select using (true);
create policy "match_state_insert_all" on public.match_state for insert with check (true);
create policy "match_state_update_all" on public.match_state for update using (true);

-- Commits: readable when revealed (client); writes via service role in later milestone
create policy "commits_select_revealed" on public.commits
  for select using (revealed = true);
create policy "commits_insert_all" on public.commits for insert with check (true);
create policy "commits_update_all" on public.commits for update using (true);

create policy "events_select_all" on public.events for select using (true);
create policy "events_insert_all" on public.events for insert with check (true);


-- Multiplayer RPCs + tightened RLS for Wizard Duel playtest.
-- Works with the publishable (anon) key: mutations go through SECURITY DEFINER
-- functions that verify reconnect tokens. Commits stay hidden until revealed.
-- Server resolve uses Next.js /api/resolve + wd_fetch_resolve_bundle /
-- wd_apply_resolution (no service-role key required).

create extension if not exists "pgcrypto";

-- Extra public fields for bid / school / last outcome
alter table public.match_state
  add column if not exists pending_bid_a int
    check (pending_bid_a is null or pending_bid_a between 1 and 5),
  add column if not exists pending_bid_b int
    check (pending_bid_b is null or pending_bid_b between 1 and 5),
  add column if not exists declared_school text,
  add column if not exists last_result jsonb;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.wd_hash_token(p_token text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex');
$$;

create or replace function public.wd_new_room_code()
returns text
language plpgsql
as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
  i int;
begin
  loop
    code := '';
    for i in 1..4 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.matches m where m.room_code = code);
  end loop;
  return code;
end;
$$;

create or replace function public.wd_player_by_token(p_match_id uuid, p_token text)
returns public.match_players
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  rec public.match_players;
begin
  select * into rec
  from public.match_players
  where match_id = p_match_id
    and reconnect_token_hash = public.wd_hash_token(p_token);
  if not found then
    raise exception 'invalid_token' using errcode = 'P0001';
  end if;
  return rec;
end;
$$;

create or replace function public.wd_touch_match(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.matches set updated_at = now() where id = p_match_id;
  update public.match_state set updated_at = now() where match_id = p_match_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Create / join / reconnect
-- ---------------------------------------------------------------------------

create or replace function public.wd_create_match(
  p_display_name text,
  p_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_match public.matches;
  v_name text := nullif(trim(p_display_name), '');
begin
  if p_token is null or length(p_token) < 16 then
    raise exception 'token_too_short' using errcode = 'P0001';
  end if;
  if v_name is null then
    v_name := 'Wizard A';
  end if;

  v_code := public.wd_new_room_code();

  insert into public.matches (room_code, status)
  values (v_code, 'lobby')
  returning * into v_match;

  insert into public.match_players (match_id, seat, display_name, reconnect_token_hash)
  values (v_match.id, 'A', left(v_name, 32), public.wd_hash_token(p_token));

  insert into public.match_state (match_id, phase, exchange_number)
  values (v_match.id, 'lobby', 0);

  insert into public.events (match_id, seat, event_type, payload)
  values (
    v_match.id,
    'A',
    'match_created',
    jsonb_build_object('room_code', v_code, 'display_name', v_name)
  );

  return jsonb_build_object(
    'match_id', v_match.id,
    'room_code', v_code,
    'seat', 'A',
    'status', 'lobby',
    'phase', 'lobby'
  );
end;
$$;

create or replace function public.wd_join_match(
  p_room_code text,
  p_display_name text,
  p_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match public.matches;
  v_name text := nullif(trim(p_display_name), '');
  v_code text := upper(trim(p_room_code));
begin
  if p_token is null or length(p_token) < 16 then
    raise exception 'token_too_short' using errcode = 'P0001';
  end if;
  if v_name is null then
    v_name := 'Wizard B';
  end if;

  select * into v_match
  from public.matches
  where room_code = v_code
  for update;

  if not found then
    raise exception 'room_not_found' using errcode = 'P0001';
  end if;
  if v_match.status <> 'lobby' then
    raise exception 'room_not_joinable' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.match_players where match_id = v_match.id and seat = 'B') then
    raise exception 'room_full' using errcode = 'P0001';
  end if;

  insert into public.match_players (match_id, seat, display_name, reconnect_token_hash)
  values (v_match.id, 'B', left(v_name, 32), public.wd_hash_token(p_token));

  update public.matches
  set status = 'active', updated_at = now()
  where id = v_match.id;

  -- Opening bid to choose first attacker (playtest rules)
  update public.match_state
  set phase = 'bid',
      exchange_number = 0,
      advantage_seat = null,
      attacker_seat = null,
      pending_bid_a = null,
      pending_bid_b = null,
      declared_school = null,
      last_result = null,
      updated_at = now()
  where match_id = v_match.id;

  insert into public.events (match_id, seat, event_type, payload)
  values (
    v_match.id,
    'B',
    'player_joined',
    jsonb_build_object('display_name', v_name)
  );

  return jsonb_build_object(
    'match_id', v_match.id,
    'room_code', v_code,
    'seat', 'B',
    'status', 'active',
    'phase', 'bid'
  );
end;
$$;

create or replace function public.wd_reconnect(
  p_room_code text,
  p_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match public.matches;
  v_player public.match_players;
  v_state public.match_state;
  v_code text := upper(trim(p_room_code));
begin
  select * into v_match from public.matches where room_code = v_code;
  if not found then
    raise exception 'room_not_found' using errcode = 'P0001';
  end if;

  select * into v_player
  from public.match_players
  where match_id = v_match.id
    and reconnect_token_hash = public.wd_hash_token(p_token);
  if not found then
    raise exception 'invalid_token' using errcode = 'P0001';
  end if;

  select * into v_state from public.match_state where match_id = v_match.id;

  return jsonb_build_object(
    'match_id', v_match.id,
    'room_code', v_match.room_code,
    'seat', v_player.seat,
    'display_name', v_player.display_name,
    'status', v_match.status,
    'phase', v_state.phase,
    'winner_seat', v_match.winner_seat
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Opening bid
-- ---------------------------------------------------------------------------

create or replace function public.wd_submit_bid(
  p_match_id uuid,
  p_token text,
  p_power int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player public.match_players;
  v_state public.match_state;
  v_bid_a int;
  v_bid_b int;
  v_attacker text;
  v_disc_a int[];
  v_disc_b int[];
begin
  if p_power is null or p_power < 1 or p_power > 5 then
    raise exception 'invalid_power' using errcode = 'P0001';
  end if;

  v_player := public.wd_player_by_token(p_match_id, p_token);

  select * into v_state from public.match_state where match_id = p_match_id for update;
  if v_state.phase <> 'bid' then
    raise exception 'wrong_phase' using errcode = 'P0001';
  end if;

  -- Power must still be available (discarded empty at start; after ties may have discards)
  if p_power = any (v_player.discarded_power) then
    raise exception 'power_unavailable' using errcode = 'P0001';
  end if;

  if v_player.seat = 'A' then
    if v_state.pending_bid_a is not null then
      raise exception 'already_bid' using errcode = 'P0001';
    end if;
    update public.match_state set pending_bid_a = p_power, updated_at = now()
    where match_id = p_match_id;
  else
    if v_state.pending_bid_b is not null then
      raise exception 'already_bid' using errcode = 'P0001';
    end if;
    update public.match_state set pending_bid_b = p_power, updated_at = now()
    where match_id = p_match_id;
  end if;

  insert into public.events (match_id, seat, event_type, payload)
  values (p_match_id, v_player.seat, 'bid_submitted', jsonb_build_object('power', p_power));

  select pending_bid_a, pending_bid_b into v_bid_a, v_bid_b
  from public.match_state where match_id = p_match_id;

  if v_bid_a is null or v_bid_b is null then
    return jsonb_build_object('status', 'waiting', 'seat', v_player.seat);
  end if;

  -- Both bids in: compare, discard both powers, start first exchange or re-bid
  select discarded_power into v_disc_a from public.match_players
    where match_id = p_match_id and seat = 'A';
  select discarded_power into v_disc_b from public.match_players
    where match_id = p_match_id and seat = 'B';

  v_disc_a := array_append(v_disc_a, v_bid_a);
  v_disc_b := array_append(v_disc_b, v_bid_b);

  if v_bid_a = v_bid_b then
    update public.match_players set discarded_power = v_disc_a
      where match_id = p_match_id and seat = 'A';
    update public.match_players set discarded_power = v_disc_b
      where match_id = p_match_id and seat = 'B';

    -- If both hands empty (all five tied over time), recover all and continue bidding
    if (
      select cardinality(discarded_power) from public.match_players
      where match_id = p_match_id and seat = 'A'
    ) >= 5 then
      update public.match_players set discarded_power = '{}'
        where match_id = p_match_id;
    end if;

    update public.match_state
    set pending_bid_a = null,
        pending_bid_b = null,
        updated_at = now()
    where match_id = p_match_id;

    insert into public.events (match_id, event_type, payload)
    values (p_match_id, 'bid_tie', jsonb_build_object('power', v_bid_a));

    return jsonb_build_object('status', 'tie', 'phase', 'bid');
  end if;

  if v_bid_a > v_bid_b then
    v_attacker := 'A';
  else
    v_attacker := 'B';
  end if;

  update public.match_players set discarded_power = v_disc_a
    where match_id = p_match_id and seat = 'A';
  update public.match_players set discarded_power = v_disc_b
    where match_id = p_match_id and seat = 'B';

  update public.match_state
  set phase = 'attack_commit',
      attacker_seat = v_attacker,
      advantage_seat = null,
      exchange_number = 1,
      pending_bid_a = null,
      pending_bid_b = null,
      declared_school = null,
      last_result = null,
      updated_at = now()
  where match_id = p_match_id;

  insert into public.events (match_id, event_type, payload)
  values (
    p_match_id,
    'bid_resolved',
    jsonb_build_object('bid_a', v_bid_a, 'bid_b', v_bid_b, 'attacker_seat', v_attacker)
  );

  perform public.wd_touch_match(p_match_id);

  return jsonb_build_object(
    'status', 'resolved',
    'phase', 'attack_commit',
    'attacker_seat', v_attacker,
    'bid_a', v_bid_a,
    'bid_b', v_bid_b
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Commits
-- ---------------------------------------------------------------------------

create or replace function public.wd_submit_commit(
  p_match_id uuid,
  p_token text,
  p_spell text,
  p_power int,
  p_advantage_spend text default null,
  p_declared_school text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player public.match_players;
  v_state public.match_state;
  v_role text;
  v_expected_seat text;
  v_spend text := nullif(p_advantage_spend, '');
  v_disc int[];
begin
  if p_power is null or p_power < 1 or p_power > 5 then
    raise exception 'invalid_power' using errcode = 'P0001';
  end if;
  if v_spend is not null and v_spend not in ('boost', 'refresh') then
    raise exception 'invalid_advantage_spend' using errcode = 'P0001';
  end if;

  v_player := public.wd_player_by_token(p_match_id, p_token);
  select * into v_state from public.match_state where match_id = p_match_id for update;

  if v_state.phase = 'attack_commit' then
    v_role := 'attack';
    v_expected_seat := v_state.attacker_seat;
  elsif v_state.phase = 'defense_commit' then
    v_role := 'defend';
    v_expected_seat := case when v_state.attacker_seat = 'A' then 'B' else 'A' end;
  else
    raise exception 'wrong_phase' using errcode = 'P0001';
  end if;

  if v_player.seat <> v_expected_seat then
    raise exception 'not_your_turn' using errcode = 'P0001';
  end if;

  -- Advantage spend only by holder at exchange start; once per exchange
  if v_spend is not null then
    if v_state.advantage_seat is distinct from v_player.seat then
      raise exception 'no_advantage' using errcode = 'P0001';
    end if;
    if exists (
      select 1 from public.commits c
      where c.match_id = p_match_id
        and c.exchange_number = v_state.exchange_number
        and c.advantage_spend is not null
    ) then
      raise exception 'advantage_already_spent' using errcode = 'P0001';
    end if;
  end if;

  -- Available power (refresh spend empties discard for this commit)
  v_disc := v_player.discarded_power;
  if v_spend = 'refresh' or cardinality(v_disc) >= 5 then
    v_disc := '{}';
  end if;
  if p_power = any (v_disc) then
    raise exception 'power_unavailable' using errcode = 'P0001';
  end if;

  if v_role = 'attack' then
    if p_spell not in ('Full', 'Feint', 'Partial', 'Gather', 'Hex', 'Delayed') then
      raise exception 'invalid_spell' using errcode = 'P0001';
    end if;
  else
    if p_spell not in ('Full', 'Partial', 'Counter', 'Reversal') then
      raise exception 'invalid_spell' using errcode = 'P0001';
    end if;
  end if;

  insert into public.commits (
    match_id, exchange_number, seat, role, spell, power, advantage_spend, revealed
  ) values (
    p_match_id,
    v_state.exchange_number,
    v_player.seat,
    v_role,
    p_spell,
    p_power,
    v_spend,
    false
  );

  -- Spending Advantage immediately passes the token (public)
  if v_spend is not null then
    update public.match_state
    set advantage_seat = case when v_player.seat = 'A' then 'B' else 'A' end,
        updated_at = now()
    where match_id = p_match_id;
  end if;

  if v_role = 'attack' then
    update public.match_state
    set phase = 'defense_commit',
        declared_school = coalesce(p_declared_school, declared_school),
        updated_at = now()
    where match_id = p_match_id;

    insert into public.events (match_id, exchange_number, seat, event_type, payload)
    values (
      p_match_id,
      v_state.exchange_number,
      v_player.seat,
      'attack_committed',
      jsonb_build_object(
        'declared_school', p_declared_school,
        'advantage_spend', v_spend
      )
    );

    perform public.wd_touch_match(p_match_id);
    return jsonb_build_object('status', 'ok', 'phase', 'defense_commit');
  end if;

  update public.match_state
  set phase = 'resolve',
      updated_at = now()
  where match_id = p_match_id;

  insert into public.events (match_id, exchange_number, seat, event_type, payload)
  values (
    p_match_id,
    v_state.exchange_number,
    v_player.seat,
    'defense_committed',
    jsonb_build_object('advantage_spend', v_spend)
  );

  perform public.wd_touch_match(p_match_id);
  return jsonb_build_object('status', 'ok', 'phase', 'resolve');
end;
$$;

-- Bundle for Next.js /api/resolve (SECURITY DEFINER; token-gated)
create or replace function public.wd_fetch_resolve_bundle(
  p_match_id uuid,
  p_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player public.match_players;
  v_state public.match_state;
  v_attack public.commits;
  v_defend public.commits;
  v_attacker public.match_players;
  v_defender public.match_players;
  v_adv_start text;
  v_def_seat text;
begin
  v_player := public.wd_player_by_token(p_match_id, p_token);
  select * into v_state from public.match_state where match_id = p_match_id;
  if v_state.phase <> 'resolve' then
    raise exception 'wrong_phase' using errcode = 'P0001';
  end if;

  select * into v_attack from public.commits
  where match_id = p_match_id
    and exchange_number = v_state.exchange_number
    and role = 'attack';
  select * into v_defend from public.commits
  where match_id = p_match_id
    and exchange_number = v_state.exchange_number
    and role = 'defend';

  if v_attack.id is null or v_defend.id is null then
    raise exception 'commits_incomplete' using errcode = 'P0001';
  end if;

  v_def_seat := case when v_state.attacker_seat = 'A' then 'B' else 'A' end;
  select * into v_attacker from public.match_players
    where match_id = p_match_id and seat = v_state.attacker_seat;
  select * into v_defender from public.match_players
    where match_id = p_match_id and seat = v_def_seat;

  -- Advantage at exchange start = current token, unless someone already spent
  -- (spend already moved the token). Reconstruct start holder:
  if v_attack.advantage_spend is not null then
    v_adv_start := v_attack.seat;
  elsif v_defend.advantage_spend is not null then
    v_adv_start := v_defend.seat;
  else
    v_adv_start := v_state.advantage_seat;
  end if;

  return jsonb_build_object(
    'match_id', p_match_id,
    'exchange_number', v_state.exchange_number,
    'attacker_seat', v_state.attacker_seat,
    'defender_seat', v_def_seat,
    'advantage_at_start', v_adv_start,
    'attack', jsonb_build_object(
      'spell', v_attack.spell,
      'power', v_attack.power,
      'advantage_spend', v_attack.advantage_spend,
      'seat', v_attack.seat
    ),
    'defend', jsonb_build_object(
      'spell', v_defend.spell,
      'power', v_defend.power,
      'advantage_spend', v_defend.advantage_spend,
      'seat', v_defend.seat
    ),
    'attacker', jsonb_build_object(
      'seat', v_attacker.seat,
      'health', v_attacker.health,
      'discarded_power', to_jsonb(v_attacker.discarded_power),
      'stored_damage', v_attacker.stored_damage,
      'preparations', v_attacker.preparations
    ),
    'defender', jsonb_build_object(
      'seat', v_defender.seat,
      'health', v_defender.health,
      'discarded_power', to_jsonb(v_defender.discarded_power),
      'stored_damage', v_defender.stored_damage,
      'preparations', v_defender.preparations
    ),
    'caller_seat', v_player.seat
  );
end;
$$;

create or replace function public.wd_apply_resolution(
  p_match_id uuid,
  p_token text,
  p_result jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player public.match_players;
  v_state public.match_state;
  v_attacker_seat text;
  v_defender_seat text;
  v_winner text;
  v_next_attacker text;
  v_ex int;
begin
  v_player := public.wd_player_by_token(p_match_id, p_token);
  select * into v_state from public.match_state where match_id = p_match_id for update;

  -- Idempotent: already past resolve for this exchange
  if v_state.phase <> 'resolve' then
    return jsonb_build_object(
      'status', 'already_applied',
      'phase', v_state.phase,
      'exchange_number', v_state.exchange_number
    );
  end if;

  v_ex := v_state.exchange_number;
  if coalesce((p_result->>'exchange_number')::int, -1) <> v_ex then
    raise exception 'exchange_mismatch' using errcode = 'P0001';
  end if;

  v_attacker_seat := v_state.attacker_seat;
  v_defender_seat := case when v_attacker_seat = 'A' then 'B' else 'A' end;
  v_winner := nullif(p_result->>'winner', '');

  -- Reveal commits
  update public.commits
  set revealed = true
  where match_id = p_match_id and exchange_number = v_ex;

  -- Update players
  update public.match_players
  set health = (p_result->>'attacker_health')::int,
      discarded_power = coalesce(
        (select array_agg(x::int) from jsonb_array_elements_text(p_result->'attacker_discarded_power') t(x)),
        '{}'
      ),
      stored_damage = coalesce((p_result->>'attacker_stored_damage')::int, 0),
      preparations = jsonb_build_object(
        'nextAttackBonus', 0,
        'nextDefenseBonus', coalesce((p_result->>'attacker_next_defense_bonus')::int, 0)
      )
  where match_id = p_match_id and seat = v_attacker_seat;

  update public.match_players
  set health = (p_result->>'defender_health')::int,
      discarded_power = coalesce(
        (select array_agg(x::int) from jsonb_array_elements_text(p_result->'defender_discarded_power') t(x)),
        '{}'
      ),
      stored_damage = 0,
      preparations = jsonb_build_object(
        'nextAttackBonus', coalesce((p_result->>'defender_next_attack_bonus')::int, 0),
        'nextDefenseBonus', 0
      )
  where match_id = p_match_id and seat = v_defender_seat;

  insert into public.events (match_id, exchange_number, event_type, payload)
  values (p_match_id, v_ex, 'exchange_resolved', p_result);

  if v_winner is not null then
    update public.matches
    set status = 'finished',
        winner_seat = v_winner,
        finished_at = now(),
        updated_at = now()
    where id = p_match_id;

    update public.match_state
    set phase = 'finished',
        advantage_seat = nullif(p_result->>'advantage_after', ''),
        last_result = p_result,
        declared_school = null,
        updated_at = now()
    where match_id = p_match_id;

    return jsonb_build_object('status', 'finished', 'winner', v_winner, 'phase', 'finished');
  end if;

  v_next_attacker := v_defender_seat;

  update public.match_state
  set phase = 'attack_commit',
      attacker_seat = v_next_attacker,
      advantage_seat = nullif(p_result->>'advantage_after', ''),
      exchange_number = v_ex + 1,
      declared_school = null,
      last_result = p_result,
      updated_at = now()
  where match_id = p_match_id;

  update public.matches set updated_at = now() where id = p_match_id;

  return jsonb_build_object(
    'status', 'ok',
    'phase', 'attack_commit',
    'attacker_seat', v_next_attacker,
    'exchange_number', v_ex + 1
  );
end;
$$;

-- Public snapshot (no token hashes)
create or replace function public.wd_get_match_public(p_room_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_match public.matches;
  v_state public.match_state;
  v_players jsonb;
  v_commits jsonb;
begin
  select * into v_match from public.matches where room_code = upper(trim(p_room_code));
  if not found then
    raise exception 'room_not_found' using errcode = 'P0001';
  end if;
  select * into v_state from public.match_state where match_id = v_match.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'seat', p.seat,
    'display_name', p.display_name,
    'health', p.health,
    'discarded_power', to_jsonb(p.discarded_power),
    'stored_damage', p.stored_damage,
    'preparations', p.preparations
  ) order by p.seat), '[]'::jsonb)
  into v_players
  from public.match_players p
  where p.match_id = v_match.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'exchange_number', c.exchange_number,
    'seat', c.seat,
    'role', c.role,
    'spell', c.spell,
    'power', c.power,
    'advantage_spend', c.advantage_spend,
    'revealed', c.revealed
  ) order by c.created_at), '[]'::jsonb)
  into v_commits
  from public.commits c
  where c.match_id = v_match.id and c.revealed = true;

  return jsonb_build_object(
    'match', jsonb_build_object(
      'id', v_match.id,
      'room_code', v_match.room_code,
      'status', v_match.status,
      'winner_seat', v_match.winner_seat
    ),
    'state', jsonb_build_object(
      'phase', v_state.phase,
      'advantage_seat', v_state.advantage_seat,
      'attacker_seat', v_state.attacker_seat,
      'exchange_number', v_state.exchange_number,
      'declared_school', v_state.declared_school,
      'pending_bid_a', case when v_state.pending_bid_a is null then null else true end,
      'pending_bid_b', case when v_state.pending_bid_b is null then null else true end,
      'last_result', v_state.last_result,
      'updated_at', v_state.updated_at
    ),
    'players', v_players,
    'revealed_commits', v_commits
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS: revoke open writes; public reads for match tables; commits revealed-only
-- ---------------------------------------------------------------------------

drop policy if exists "matches_select_all" on public.matches;
drop policy if exists "matches_insert_all" on public.matches;
drop policy if exists "matches_update_all" on public.matches;

drop policy if exists "match_players_select_all" on public.match_players;
drop policy if exists "match_players_insert_all" on public.match_players;
drop policy if exists "match_players_update_all" on public.match_players;

drop policy if exists "match_state_select_all" on public.match_state;
drop policy if exists "match_state_insert_all" on public.match_state;
drop policy if exists "match_state_update_all" on public.match_state;

drop policy if exists "commits_select_revealed" on public.commits;
drop policy if exists "commits_insert_all" on public.commits;
drop policy if exists "commits_update_all" on public.commits;

drop policy if exists "events_select_all" on public.events;
drop policy if exists "events_insert_all" on public.events;

-- Public read of match metadata / state / players (invite-only room codes).
-- Token hashes are never returned by RPCs; avoid selecting reconnect_token_hash in the app.
create policy "matches_select_public" on public.matches for select using (true);
create policy "match_state_select_public" on public.match_state for select using (true);
create policy "match_players_select_public" on public.match_players for select using (true);
create policy "events_select_public" on public.events for select using (true);
create policy "commits_select_revealed" on public.commits for select using (revealed = true);

-- No direct client writes â€” RPCs are SECURITY DEFINER
-- (service_role bypasses RLS if you add a server key later)

grant usage on schema public to anon, authenticated;
grant select on public.matches, public.match_state, public.match_players, public.events, public.commits
  to anon, authenticated;

grant execute on function public.wd_create_match(text, text) to anon, authenticated;
grant execute on function public.wd_join_match(text, text, text) to anon, authenticated;
grant execute on function public.wd_reconnect(text, text) to anon, authenticated;
grant execute on function public.wd_submit_bid(uuid, text, int) to anon, authenticated;
grant execute on function public.wd_submit_commit(uuid, text, text, int, text, text) to anon, authenticated;
grant execute on function public.wd_fetch_resolve_bundle(uuid, text) to anon, authenticated;
grant execute on function public.wd_apply_resolution(uuid, text, jsonb) to anon, authenticated;
grant execute on function public.wd_get_match_public(text) to anon, authenticated;

-- Realtime
do $$
begin
  begin
    alter publication supabase_realtime add table public.matches;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.match_state;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.match_players;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.commits;
  exception when duplicate_object then null;
  end;
end $$;


-- Hotfix: use extensions.digest (Supabase installs pgcrypto in extensions schema).
-- Prior errors: digest(text/bytea, unknown), digest(bytea, text) does not exist

create extension if not exists "pgcrypto" with schema extensions;

create or replace function public.wd_hash_token(p_token text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex');
$$;


-- Power-card v2: authoritative game commands and private research records.
begin;
create schema if not exists extensions;
create extension if not exists "pgcrypto" with schema extensions;
do $$ begin
 if exists(select 1 from pg_extension e join pg_namespace n on e.extnamespace=n.oid where e.extname='pgcrypto' and n.nspname='public') then
 alter extension pgcrypto set schema extensions;
 end if;
end $$;
alter table public.matches add column started_at timestamptz;
alter table public.matches add column engine_version text not null default 'legacy';
alter table public.matches add column event_schema_version int not null default 1;
alter table public.matches alter column ruleset_version set default 'power-v2';
alter table public.matches alter column engine_version set default 'power-engine-2';
alter table public.match_players add column tester_id uuid;
alter table public.match_state add column advantage_at_start text;
alter table public.match_state add column refresh_spend_seat text;
alter table public.match_state add column phase_started_at timestamptz not null default now();
create function public.wd_lock_versions() returns trigger language plpgsql as $$
begin
 if (new.ruleset_version,new.engine_version,new.event_schema_version) is distinct from (old.ruleset_version,old.engine_version,old.event_schema_version) then raise exception 'immutable_match_version'; end if;
 return new;
end $$;
create trigger wd_versions before update on public.matches for each row execute function public.wd_lock_versions();
create table public.wd_requests (
 request_id uuid primary key, token_hash text not null, command text not null,
 arguments jsonb not null, response jsonb, created_at timestamptz not null default now()
);
create table public.wd_records (
 id bigint generated always as identity primary key, match_id uuid not null references public.matches(id),
 exchange_number int, seat text, kind text not null, payload jsonb not null,
 state jsonb not null, created_at timestamptz not null default now()
);
create table public.wd_telemetry (
 request_id uuid primary key, match_id uuid not null references public.matches(id), seat text not null,
 exchange_number int not null, phase text not null, kind text not null,
 payload jsonb not null, created_at timestamptz not null default now()
);
alter table public.wd_requests enable row level security;
alter table public.wd_records enable row level security;
alter table public.wd_telemetry enable row level security;
create index on public.wd_records(match_id,id);
create index on public.wd_telemetry(match_id,created_at);
create function public.wd_snapshot(p_id uuid) returns jsonb language sql security definer set search_path=public as $$
 select jsonb_build_object('state', (select to_jsonb(s) from match_state s where match_id=p_id),
 'players', (select jsonb_agg(jsonb_build_object('seat',seat,'health',health,'discarded_power',discarded_power,
 'stored_damage',stored_damage,'preparations',preparations) order by seat) from match_players where match_id=p_id))
$$;
create function public.wd_record_event() returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into wd_records(match_id,exchange_number,seat,kind,payload,state)
 values(new.match_id,new.exchange_number,new.seat,new.event_type,new.payload - 'display_name' - 'room_code',wd_snapshot(new.match_id));
 return new;
end $$;
create trigger wd_record after insert on public.events for each row execute function public.wd_record_event();
create function public.wd_phase_clock() returns trigger language plpgsql set search_path=public as $$
begin
 if new.phase is distinct from old.phase or new.exchange_number is distinct from old.exchange_number then
 new.phase_started_at := clock_timestamp();
 end if;
 return new;
end $$;
create trigger wd_clock before update on public.match_state for each row execute function public.wd_phase_clock();
create function public.wd_begin_exchange(p_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare s match_state; r match_players;
begin
 select * into s from match_state where match_id=p_id for update;
 for r in select * from match_players where match_id=p_id and cardinality(discarded_power)=5 loop
 update match_players set discarded_power='{}' where id=r.id;
 insert into events(match_id,exchange_number,seat,event_type,payload) values(p_id,s.exchange_number,r.seat,'power_refreshed','{"automatic":true}');
 end loop;
 update match_state set advantage_at_start=advantage_seat,refresh_spend_seat=null,
 phase=case when advantage_seat is null then 'attack_commit' else 'refresh' end where match_id=p_id;
 insert into events(match_id,exchange_number,event_type,payload) values(p_id,s.exchange_number,'exchange_started','{}');
end $$;
create function public.wd_choose_refresh(p_id uuid,p_token text,p_spend boolean) returns jsonb language plpgsql security definer set search_path=public as $$
declare s match_state; r match_players;
begin
 r:=wd_player_by_token(p_id,p_token);
 select * into s from match_state where match_id=p_id for update;
 if s.phase<>'refresh' then raise exception 'wrong_phase'; end if;
 if s.advantage_at_start is distinct from r.seat then raise exception 'not_your_turn'; end if;
 if p_spend then
 update match_players set discarded_power='{}' where id=r.id;
 update match_state set refresh_spend_seat=r.seat,advantage_seat=case when r.seat='A' then 'B' else 'A' end where match_id=p_id;
 end if;
 update match_state set phase='attack_commit',updated_at=now() where match_id=p_id;
 insert into events(match_id,exchange_number,seat,event_type,payload) values(p_id,s.exchange_number,r.seat,'refresh_chosen',jsonb_build_object('spent',p_spend));
 return jsonb_build_object('phase','attack_commit');
end $$;
create or replace function public.wd_create_match_internal(
  p_display_name text,
  p_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_match public.matches;
  v_name text := nullif(trim(p_display_name), '');
begin
  if p_token is null or length(p_token) < 16 then
    raise exception 'token_too_short' using errcode = 'P0001';
  end if;
  if v_name is null then
    v_name := 'Wizard A';
  end if;

  v_code := public.wd_new_room_code();

  insert into public.matches (room_code, status)
  values (v_code, 'lobby')
  returning * into v_match;

  insert into public.match_players (match_id, seat, display_name, reconnect_token_hash)
  values (v_match.id, 'A', left(v_name, 32), public.wd_hash_token(p_token));

  insert into public.match_state (match_id, phase, exchange_number)
  values (v_match.id, 'lobby', 0);

  insert into public.events (match_id, seat, event_type, payload)
  values (
    v_match.id,
    'A',
    'match_created',
    jsonb_build_object('room_code', v_code, 'display_name', v_name)
  );

  return jsonb_build_object(
    'match_id', v_match.id,
    'room_code', v_code,
    'seat', 'A',
    'status', 'lobby',
    'phase', 'lobby'
  );
end;
$$;

create or replace function public.wd_join_match_internal(
  p_room_code text,
  p_display_name text,
  p_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match public.matches;
  v_name text := nullif(trim(p_display_name), '');
  v_code text := upper(trim(p_room_code));
begin
  if p_token is null or length(p_token) < 16 then
    raise exception 'token_too_short' using errcode = 'P0001';
  end if;
  if v_name is null then
    v_name := 'Wizard B';
  end if;

  select * into v_match
  from public.matches
  where room_code = v_code
  for update;

  if not found then
    raise exception 'room_not_found' using errcode = 'P0001';
  end if;
  if v_match.status <> 'lobby' then
    raise exception 'room_not_joinable' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.match_players where match_id = v_match.id and seat = 'B') then
    raise exception 'room_full' using errcode = 'P0001';
  end if;

  insert into public.match_players (match_id, seat, display_name, reconnect_token_hash)
  values (v_match.id, 'B', left(v_name, 32), public.wd_hash_token(p_token));

  update public.matches
  set status = 'active', started_at=now(), updated_at = now()
  where id = v_match.id;

  -- Opening bid to choose first attacker (playtest rules)
  update public.match_state
  set phase = 'bid',
      exchange_number = 0,
      advantage_seat = null,
      attacker_seat = null,
      pending_bid_a = null,
      pending_bid_b = null,
      declared_school = null,
      last_result = null,
      updated_at = now()
  where match_id = v_match.id;

  insert into public.events (match_id, seat, event_type, payload)
  values (
    v_match.id,
    'B',
    'player_joined',
    jsonb_build_object('display_name', v_name)
  );

  return jsonb_build_object(
    'match_id', v_match.id,
    'room_code', v_code,
    'seat', 'B',
    'status', 'active',
    'phase', 'bid'
  );
end;
$$;

create or replace function public.wd_reconnect_internal(
  p_room_code text,
  p_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match public.matches;
  v_player public.match_players;
  v_state public.match_state;
  v_code text := upper(trim(p_room_code));
begin
  select * into v_match from public.matches where room_code = v_code;
  if not found then
    raise exception 'room_not_found' using errcode = 'P0001';
  end if;

  select * into v_player
  from public.match_players
  where match_id = v_match.id
    and reconnect_token_hash = public.wd_hash_token(p_token);
  if not found then
    raise exception 'invalid_token' using errcode = 'P0001';
  end if;

  select * into v_state from public.match_state where match_id = v_match.id;

  return jsonb_build_object(
    'match_id', v_match.id,
    'room_code', v_match.room_code,
    'seat', v_player.seat,
    'display_name', v_player.display_name,
    'status', v_match.status,
    'phase', v_state.phase,
    'winner_seat', v_match.winner_seat
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Opening bid
-- ---------------------------------------------------------------------------

create or replace function public.wd_submit_bid_internal(
  p_match_id uuid,
  p_token text,
  p_power int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player public.match_players;
  v_state public.match_state;
  v_bid_a int;
  v_bid_b int;
  v_attacker text;
  v_disc_a int[];
  v_disc_b int[];
begin
  if p_power is null or p_power < 1 or p_power > 5 then
    raise exception 'invalid_power' using errcode = 'P0001';
  end if;

  v_player := public.wd_player_by_token(p_match_id, p_token);

  select * into v_state from public.match_state where match_id = p_match_id for update;
  if v_state.phase <> 'bid' then
    raise exception 'wrong_phase' using errcode = 'P0001';
  end if;

  -- Power must still be available (discarded empty at start; after ties may have discards)
  if p_power = any (v_player.discarded_power) then
    raise exception 'power_unavailable' using errcode = 'P0001';
  end if;

  if v_player.seat = 'A' then
    if v_state.pending_bid_a is not null then
      raise exception 'already_bid' using errcode = 'P0001';
    end if;
    update public.match_state set pending_bid_a = p_power, updated_at = now()
    where match_id = p_match_id;
  else
    if v_state.pending_bid_b is not null then
      raise exception 'already_bid' using errcode = 'P0001';
    end if;
    update public.match_state set pending_bid_b = p_power, updated_at = now()
    where match_id = p_match_id;
  end if;

  insert into public.events (match_id, seat, event_type, payload)
  values (p_match_id, v_player.seat, 'bid_submitted', jsonb_build_object('power', p_power));

  select pending_bid_a, pending_bid_b into v_bid_a, v_bid_b
  from public.match_state where match_id = p_match_id;

  if v_bid_a is null or v_bid_b is null then
    return jsonb_build_object('status', 'waiting', 'seat', v_player.seat);
  end if;

  -- Both bids in: compare, discard both powers, start first exchange or re-bid
  select discarded_power into v_disc_a from public.match_players
    where match_id = p_match_id and seat = 'A';
  select discarded_power into v_disc_b from public.match_players
    where match_id = p_match_id and seat = 'B';

  v_disc_a := array_append(v_disc_a, v_bid_a);
  v_disc_b := array_append(v_disc_b, v_bid_b);

  if v_bid_a = v_bid_b then
    update public.match_players set discarded_power = v_disc_a
      where match_id = p_match_id and seat = 'A';
    update public.match_players set discarded_power = v_disc_b
      where match_id = p_match_id and seat = 'B';

    -- If both hands empty (all five tied over time), recover all and continue bidding
    if (
      select cardinality(discarded_power) from public.match_players
      where match_id = p_match_id and seat = 'A'
    ) >= 5 then
      update public.match_players set discarded_power = '{}'
        where match_id = p_match_id;
    end if;

    update public.match_state
    set pending_bid_a = null,
        pending_bid_b = null,
        updated_at = now()
    where match_id = p_match_id;

    insert into public.events (match_id, event_type, payload)
    values (p_match_id, 'bid_tie', jsonb_build_object('power', v_bid_a));

    return jsonb_build_object('status', 'tie', 'phase', 'bid');
  end if;

  if v_bid_a > v_bid_b then
    v_attacker := 'A';
  else
    v_attacker := 'B';
  end if;

  update public.match_players set discarded_power = v_disc_a
    where match_id = p_match_id and seat = 'A';
  update public.match_players set discarded_power = v_disc_b
    where match_id = p_match_id and seat = 'B';

  update public.match_state
  set phase = 'attack_commit',
      attacker_seat = v_attacker,
      advantage_seat = null,
      exchange_number = 1,
      pending_bid_a = null,
      pending_bid_b = null,
      declared_school = null,
      last_result = null,
      updated_at = now()
  where match_id = p_match_id;

  insert into public.events (match_id, event_type, payload)
  values (
    p_match_id,
    'bid_resolved',
    jsonb_build_object('bid_a', v_bid_a, 'bid_b', v_bid_b, 'attacker_seat', v_attacker)
  );

  perform public.wd_begin_exchange(p_match_id);
  perform public.wd_touch_match(p_match_id);

  return jsonb_build_object(
    'status', 'resolved',
    'phase', 'attack_commit',
    'attacker_seat', v_attacker,
    'bid_a', v_bid_a,
    'bid_b', v_bid_b
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Commits
-- ---------------------------------------------------------------------------

create or replace function public.wd_submit_commit_internal(
  p_match_id uuid,
  p_token text,
  p_spell text,
  p_power int,
  p_advantage_spend text default null,
  p_declared_school text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player public.match_players;
  v_state public.match_state;
  v_role text;
  v_expected_seat text;
  v_spend text := nullif(p_advantage_spend, '');
  v_disc int[];
begin
  if p_power is null or p_power < 1 or p_power > 5 then
    raise exception 'invalid_power' using errcode = 'P0001';
  end if;
  if v_spend is not null and v_spend <> 'boost' then
    raise exception 'invalid_advantage_spend' using errcode = 'P0001';
  end if;

  v_player := public.wd_player_by_token(p_match_id, p_token);
  select * into v_state from public.match_state where match_id = p_match_id for update;

  if v_state.phase = 'attack_commit' then
    v_role := 'attack';
    v_expected_seat := v_state.attacker_seat;
  elsif v_state.phase = 'defense_commit' then
    v_role := 'defend';
    v_expected_seat := case when v_state.attacker_seat = 'A' then 'B' else 'A' end;
  else
    raise exception 'wrong_phase' using errcode = 'P0001';
  end if;

  if v_player.seat <> v_expected_seat then
    raise exception 'not_your_turn' using errcode = 'P0001';
  end if;

  -- Advantage spend only by holder at exchange start; once per exchange
  if v_spend is not null then
    if v_state.advantage_at_start is distinct from v_player.seat or v_state.refresh_spend_seat is not null then
      raise exception 'no_advantage' using errcode = 'P0001';
    end if;
    if exists (
      select 1 from public.commits c
      where c.match_id = p_match_id
        and c.exchange_number = v_state.exchange_number
        and c.advantage_spend is not null
    ) then
      raise exception 'advantage_already_spent' using errcode = 'P0001';
    end if;
  end if;

  -- Available power (refresh spend empties discard for this commit)
  v_disc := v_player.discarded_power;
  if v_spend = 'refresh' or cardinality(v_disc) >= 5 then
    v_disc := '{}';
  end if;
  if p_power = any (v_disc) then
    raise exception 'power_unavailable' using errcode = 'P0001';
  end if;

  if v_role = 'attack' then
    if p_spell is null or p_spell not in ('Full', 'Feint', 'Partial', 'Gather', 'Hex', 'Delayed') then
      raise exception 'invalid_spell' using errcode = 'P0001';
    end if;
  else
    if p_spell is null or p_spell not in ('Full', 'Partial', 'Counter', 'Reversal') then
      raise exception 'invalid_spell' using errcode = 'P0001';
    end if;
  end if;

  insert into public.commits (
    match_id, exchange_number, seat, role, spell, power, advantage_spend, revealed
  ) values (
    p_match_id,
    v_state.exchange_number,
    v_player.seat,
    v_role,
    p_spell,
    p_power,
    v_spend,
    false
  );

  -- Spending Advantage immediately passes the token (public)
  if v_spend is not null then
    update public.match_state
    set advantage_seat = case when v_player.seat = 'A' then 'B' else 'A' end,
        updated_at = now()
    where match_id = p_match_id;
  end if;

  if v_role = 'attack' then
    update public.match_state
    set phase = 'defense_commit',
        declared_school = case p_spell when 'Full' then 'Fire' when 'Feint' then 'Fire' when 'Partial' then 'Ice' when 'Gather' then 'Ice' else 'Illusion' end,
        updated_at = now()
    where match_id = p_match_id;

    insert into public.events (match_id, exchange_number, seat, event_type, payload)
    values (
      p_match_id,
      v_state.exchange_number,
      v_player.seat,
      'attack_committed',
      jsonb_build_object(
        'declared_school', (select declared_school from match_state where match_id=p_match_id),
        'advantage_spend', v_spend
      )
    );

    perform public.wd_touch_match(p_match_id);
    return jsonb_build_object('status', 'ok', 'phase', 'defense_commit');
  end if;

  update public.match_state
  set phase = 'resolve',
      updated_at = now()
  where match_id = p_match_id;

  insert into public.events (match_id, exchange_number, seat, event_type, payload)
  values (
    p_match_id,
    v_state.exchange_number,
    v_player.seat,
    'defense_committed',
    jsonb_build_object('advantage_spend', v_spend)
  );

  perform public.wd_touch_match(p_match_id);
  return jsonb_build_object('status', 'ok', 'phase', 'resolve');
end;
$$;

-- Bundle for Next.js /api/resolve (SECURITY DEFINER; token-gated)
create or replace function public.wd_fetch_resolve_bundle(
  p_match_id uuid,
  p_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player public.match_players;
  v_state public.match_state;
  v_attack public.commits;
  v_defend public.commits;
  v_attacker public.match_players;
  v_defender public.match_players;
  v_adv_start text;
  v_def_seat text;
begin
  v_player := public.wd_player_by_token(p_match_id, p_token);
  if (select ruleset_version from matches where id=p_match_id)<>'power-v2' then raise exception 'legacy_match_start_new_game'; end if;
  select * into v_state from public.match_state where match_id = p_match_id;
  if v_state.phase <> 'resolve' then
    raise exception 'wrong_phase' using errcode = 'P0001';
  end if;

  select * into v_attack from public.commits
  where match_id = p_match_id
    and exchange_number = v_state.exchange_number
    and role = 'attack';
  select * into v_defend from public.commits
  where match_id = p_match_id
    and exchange_number = v_state.exchange_number
    and role = 'defend';

  if v_attack.id is null or v_defend.id is null then
    raise exception 'commits_incomplete' using errcode = 'P0001';
  end if;

  v_def_seat := case when v_state.attacker_seat = 'A' then 'B' else 'A' end;
  select * into v_attacker from public.match_players
    where match_id = p_match_id and seat = v_state.attacker_seat;
  select * into v_defender from public.match_players
    where match_id = p_match_id and seat = v_def_seat;

  -- Advantage at exchange start = current token, unless someone already spent
  -- (spend already moved the token). Reconstruct start holder:
  if v_attack.advantage_spend is not null then
    v_adv_start := v_attack.seat;
  elsif v_defend.advantage_spend is not null then
    v_adv_start := v_defend.seat;
  else
    v_adv_start := v_state.advantage_seat;
  end if;

  return jsonb_build_object(
    'match_id', p_match_id,
    'exchange_number', v_state.exchange_number,
    'attacker_seat', v_state.attacker_seat,
    'defender_seat', v_def_seat,
    'advantage_at_start', v_state.advantage_at_start,
    'refresh_spend_seat', v_state.refresh_spend_seat,
    'attack', jsonb_build_object(
      'spell', v_attack.spell,
      'power', v_attack.power,
      'advantage_spend', v_attack.advantage_spend,
      'seat', v_attack.seat
    ),
    'defend', jsonb_build_object(
      'spell', v_defend.spell,
      'power', v_defend.power,
      'advantage_spend', v_defend.advantage_spend,
      'seat', v_defend.seat
    ),
    'attacker', jsonb_build_object(
      'seat', v_attacker.seat,
      'health', v_attacker.health,
      'discarded_power', to_jsonb(v_attacker.discarded_power),
      'stored_damage', v_attacker.stored_damage,
      'preparations', v_attacker.preparations
    ),
    'defender', jsonb_build_object(
      'seat', v_defender.seat,
      'health', v_defender.health,
      'discarded_power', to_jsonb(v_defender.discarded_power),
      'stored_damage', v_defender.stored_damage,
      'preparations', v_defender.preparations
    ),
    'caller_seat', v_player.seat
  );
end;
$$;

create or replace function public.wd_apply_resolution(
  p_match_id uuid,
  p_token text,
  p_result jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player public.match_players;
  v_state public.match_state;
  v_attacker_seat text;
  v_defender_seat text;
  v_winner text;
  v_next_attacker text;
  v_ex int;
begin
  v_player := public.wd_player_by_token(p_match_id, p_token);
  select * into v_state from public.match_state where match_id = p_match_id for update;

  -- Idempotent: already past resolve for this exchange
  if v_state.phase <> 'resolve' then
    return jsonb_build_object(
      'status', 'already_applied',
      'phase', v_state.phase,
      'exchange_number', v_state.exchange_number
    );
  end if;

  v_ex := v_state.exchange_number;
  if coalesce((p_result->>'exchange_number')::int, -1) <> v_ex then
    raise exception 'exchange_mismatch' using errcode = 'P0001';
  end if;

  v_attacker_seat := v_state.attacker_seat;
  v_defender_seat := case when v_attacker_seat = 'A' then 'B' else 'A' end;
  v_winner := nullif(p_result->>'winner', '');

  -- Reveal commits
  update public.commits
  set revealed = true
  where match_id = p_match_id and exchange_number = v_ex;

  -- Update players
  update public.match_players
  set health = (p_result->>'attacker_health')::int,
      discarded_power = coalesce(
        (select array_agg(x::int) from jsonb_array_elements_text(p_result->'attacker_discarded_power') t(x)),
        '{}'
      ),
      stored_damage = coalesce((p_result->>'attacker_stored_damage')::int, 0),
      preparations = jsonb_build_object(
        'nextAttackBonus', 0,
        'nextDefenseBonus', coalesce((p_result->>'attacker_next_defense_bonus')::int, 0)
      )
  where match_id = p_match_id and seat = v_attacker_seat;

  update public.match_players
  set health = (p_result->>'defender_health')::int,
      discarded_power = coalesce(
        (select array_agg(x::int) from jsonb_array_elements_text(p_result->'defender_discarded_power') t(x)),
        '{}'
      ),
      stored_damage = stored_damage,
      preparations = jsonb_build_object(
        'nextAttackBonus', coalesce((p_result->>'defender_next_attack_bonus')::int, 0),
        'nextDefenseBonus', 0
      )
  where match_id = p_match_id and seat = v_defender_seat;

  insert into public.events (match_id, exchange_number, event_type, payload)
  values (p_match_id, v_ex, 'exchange_resolved', p_result);

  if v_winner is not null then
    update public.matches
    set status = 'finished',
        winner_seat = v_winner,
        finished_at = now(),
        updated_at = now()
    where id = p_match_id;

    update public.match_state
    set phase = 'finished',
        advantage_seat = nullif(p_result->>'advantage_after', ''),
        last_result = p_result,
        declared_school = null,
        updated_at = now()
    where match_id = p_match_id;

    insert into events(match_id,exchange_number,event_type,payload) values(p_match_id,v_ex,'exchange_completed',p_result);
    return jsonb_build_object('status', 'finished', 'winner', v_winner, 'phase', 'finished');
  end if;

  v_next_attacker := v_defender_seat;

  update public.match_state
  set phase = 'attack_commit',
      attacker_seat = v_next_attacker,
      advantage_seat = nullif(p_result->>'advantage_after', ''),
      exchange_number = v_ex + 1,
      declared_school = null,
      last_result = p_result,
      updated_at = now()
  where match_id = p_match_id;

  update public.matches set updated_at = now() where id = p_match_id;
  insert into events(match_id,exchange_number,event_type,payload) values(p_match_id,v_ex,'exchange_completed',p_result);
  perform wd_begin_exchange(p_match_id);

  return jsonb_build_object(
    'status', 'ok',
    'phase', (select phase from match_state where match_id=p_match_id),
    'attacker_seat', v_next_attacker,
    'exchange_number', v_ex + 1
  );
end;
$$;

-- Public snapshot (no token hashes)
create or replace function public.wd_get_match_public(p_room_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_match public.matches;
  v_state public.match_state;
  v_players jsonb;
  v_commits jsonb;
begin
  select * into v_match from public.matches where room_code = upper(trim(p_room_code));
  if not found then
    raise exception 'room_not_found' using errcode = 'P0001';
  end if;
  select * into v_state from public.match_state where match_id = v_match.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'seat', p.seat,
    'display_name', p.display_name,
    'health', p.health,
    'discarded_power', to_jsonb(p.discarded_power),
    'stored_damage', p.stored_damage,
    'preparations', p.preparations
  ) order by p.seat), '[]'::jsonb)
  into v_players
  from public.match_players p
  where p.match_id = v_match.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'exchange_number', c.exchange_number,
    'seat', c.seat,
    'role', c.role,
    'spell', c.spell,
    'power', c.power,
    'advantage_spend', c.advantage_spend,
    'revealed', c.revealed
  ) order by c.created_at), '[]'::jsonb)
  into v_commits
  from public.commits c
  where c.match_id = v_match.id and c.revealed = true;

  return jsonb_build_object(
    'match', jsonb_build_object(
      'id', v_match.id,
      'room_code', v_match.room_code,
      'status', v_match.status,
      'ruleset_version', v_match.ruleset_version,
      'engine_version', v_match.engine_version,
      'winner_seat', v_match.winner_seat
    ),
    'state', jsonb_build_object(
      'phase', v_state.phase,
      'phase_started_at', v_state.phase_started_at,
      'refresh_spend_seat', v_state.refresh_spend_seat,
      'advantage_at_start', v_state.advantage_at_start,
      'advantage_seat', v_state.advantage_seat,
      'attacker_seat', v_state.attacker_seat,
      'exchange_number', v_state.exchange_number,
      'declared_school', v_state.declared_school,
      'pending_bid_a', case when v_state.pending_bid_a is null then null else true end,
      'pending_bid_b', case when v_state.pending_bid_b is null then null else true end,
      'last_result', v_state.last_result,
      'updated_at', v_state.updated_at
    ),
    'players', v_players,
    'revealed_commits', v_commits
  );
end;
$$;


create function public.wd_command(p_request_id uuid,p_token text,p_command text,p_args jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare req wd_requests; result jsonb; mid uuid; r match_players;
begin
 if p_request_id is null or p_token is null or length(p_token)<16 or p_args is null then raise exception 'invalid_command'; end if;
 insert into wd_requests(request_id,token_hash,command,arguments) values(p_request_id,wd_hash_token(p_token),p_command,p_args)
 on conflict do nothing;
 select * into req from wd_requests where request_id=p_request_id for update;
 if req.token_hash<>wd_hash_token(p_token) or req.command<>p_command or req.arguments<>p_args then raise exception 'request_conflict'; end if;
 if req.response is not null then return req.response; end if;
 if p_command in ('create','join') then
 if p_args->>'tester_id' is null then raise exception 'tester_required'; end if;
 if p_command='create' then result:=wd_create_match_internal(p_args->>'display_name',p_token);
 else result:=wd_join_match_internal(p_args->>'room_code',p_args->>'display_name',p_token); end if;
 mid:=(result->>'match_id')::uuid;
 update match_players set tester_id=(p_args->>'tester_id')::uuid where match_id=mid and reconnect_token_hash=wd_hash_token(p_token);
 insert into events(match_id,seat,event_type,payload) values(mid,result->>'seat','tester_assigned','{}');
 elsif p_command='reconnect' then
 result:=wd_reconnect_internal(p_args->>'room_code',p_token);
 mid:=(result->>'match_id')::uuid;
 insert into events(match_id,seat,event_type,payload) values(mid,result->>'seat','reconnected','{}');
 else
 mid:=(p_args->>'match_id')::uuid;
 perform 1 from match_state where match_id=mid for update;
 r:=wd_player_by_token(mid,p_token);
 if (select ruleset_version from matches where id=mid)<>'power-v2' then raise exception 'legacy_match_start_new_game'; end if;
 case p_command
 when 'bid' then result:=wd_submit_bid_internal(mid,p_token,(p_args->>'power')::int);
 when 'commit' then result:=wd_submit_commit_internal(mid,p_token,p_args->>'spell',(p_args->>'power')::int,p_args->>'advantage_spend',null);
 when 'refresh' then result:=wd_choose_refresh(mid,p_token,coalesce((p_args->>'spend')::boolean,false));
 else raise exception 'unknown_command';
 end case;
 end if;
 if p_command in ('bid','commit','refresh') then perform wd_touch_match(mid); end if;
 update wd_requests set response=result where request_id=p_request_id;
 return result;
end $$;
create function public.wd_track(p_request_id uuid,p_match_id uuid,p_token text,p_kind text,p_payload jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare r match_players; s match_state;
begin
 r:=wd_player_by_token(p_match_id,p_token);
 select * into s from match_state where match_id=p_match_id;
 if p_kind not in ('inspect_open','activity','action_error') or p_kind is null then raise exception 'invalid_telemetry'; end if;
 if p_request_id is null or octet_length(p_payload::text)>256 then raise exception 'invalid_telemetry'; end if;
 if p_kind='activity' and (p_payload - 'visible' - 'active_ms')<>'{}'::jsonb then raise exception 'invalid_telemetry'; end if;
 if p_kind='action_error' and (p_payload - 'action' - 'code')<>'{}'::jsonb then raise exception 'invalid_telemetry'; end if;
 if jsonb_typeof(p_payload)<>'object' then raise exception 'invalid_telemetry'; end if;
 if p_kind='activity' and (jsonb_typeof(p_payload->'visible') is distinct from 'boolean' or jsonb_typeof(p_payload->'active_ms') is distinct from 'number' or (p_payload->>'active_ms')::numeric not between 0 and 15000) then raise exception 'invalid_telemetry'; end if;
 if p_kind='action_error' and (p_payload->>'action' is null or p_payload->>'action' not in ('bid','commit','refresh','resolve') or p_payload->>'code' is distinct from 'failed') then raise exception 'invalid_telemetry'; end if;
 if p_kind='inspect_open' then p_payload:='{}'; end if;
 insert into wd_telemetry values(p_request_id,p_match_id,r.seat,s.exchange_number,s.phase,p_kind,p_payload,now()) on conflict do nothing;
end $$;
create function public.wd_resolution_failed(p_match_id uuid,p_token text) returns void language plpgsql security definer set search_path=public as $$
declare r match_players; s match_state;
begin
 r:=wd_player_by_token(p_match_id,p_token);
 select * into s from match_state where match_id=p_match_id;
 insert into events(match_id,exchange_number,seat,event_type,payload) values(p_match_id,s.exchange_number,r.seat,'resolution_failed','{"code":"failed"}');
end $$;
-- One MVCC snapshot: matches, players and records cannot straddle a live resolution.
create function public.wd_research_snapshot() returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('captured_at',now(),
 'matches',coalesce((select jsonb_agg(jsonb_build_object('id',id,'status',status,'ruleset_version',ruleset_version,'engine_version',engine_version,'event_schema_version',event_schema_version,'winner_seat',winner_seat,'created_at',created_at,'started_at',started_at,'updated_at',updated_at,'finished_at',finished_at) order by created_at,id) from matches),'[]'::jsonb),
 'players',coalesce((select jsonb_agg(jsonb_build_object('match_id',match_id,'seat',seat,'tester_id',tester_id,'health',health) order by match_id,seat) from match_players),'[]'::jsonb),
 'records',coalesce((select jsonb_agg(to_jsonb(r) order by id) from wd_records r),'[]'::jsonb),
 'telemetry',coalesce((select jsonb_agg(to_jsonb(t) order by created_at,request_id) from wd_telemetry t),'[]'::jsonb))
$$;
-- All raw tables and implementation helpers are private. Public snapshots are filtered RPCs.
revoke all on public.matches,public.match_players,public.match_state,public.commits,public.events,
 public.wd_records,public.wd_telemetry,public.wd_requests from anon,authenticated;
do $$ declare f record; begin
 for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname like 'wd_%' loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
grant execute on function public.wd_command(uuid,text,text,jsonb),public.wd_track(uuid,uuid,text,text,jsonb),public.wd_get_match_public(text) to anon,authenticated;
grant all on all tables in schema public to service_role;
grant usage,select on all sequences in schema public to service_role;
commit;


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
