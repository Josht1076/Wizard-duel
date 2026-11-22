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
