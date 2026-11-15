-- MuhamedChess Supabase foundation
-- Run this entire script once in Supabase SQL Editor.
-- Do not put a service_role key in the browser.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  created_at timestamptz not null default now()
);

create table if not exists public.mode_ratings (
  user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null check (mode in ('normal', 'crazy', 'special')),
  rating integer not null default 1500 check (rating between 0 and 10000),
  wins integer not null default 0,
  losses integer not null default 0,
  draws integer not null default 0,
  games integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, mode)
);

create table if not exists public.matchmaking_queue (
  user_id uuid primary key references auth.users(id) on delete cascade,
  mode text not null check (mode in ('normal', 'crazy', 'special')),
  rating integer not null default 1500,
  joined_at timestamptz not null default now()
);

create index if not exists matchmaking_queue_mode_rating_idx
  on public.matchmaking_queue (mode, rating, joined_at);

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  mode text not null check (mode in ('normal', 'crazy', 'special')),
  white_player uuid not null references auth.users(id),
  black_player uuid not null references auth.users(id),
  status text not null default 'active' check (status in ('active', 'finished', 'cancelled')),
  result text check (result in ('white', 'black', 'draw')),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  check (white_player <> black_player)
);

create index if not exists games_players_created_idx
  on public.games (white_player, black_player, created_at desc);

alter table public.profiles enable row level security;
alter table public.mode_ratings enable row level security;
alter table public.matchmaking_queue enable row level security;
alter table public.games enable row level security;

drop policy if exists "Profiles are readable by everyone" on public.profiles;
create policy "Profiles are readable by everyone"
  on public.profiles for select to authenticated using (true);

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
  on public.profiles for update to authenticated using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "Ratings are readable by everyone" on public.mode_ratings;
create policy "Ratings are readable by everyone"
  on public.mode_ratings for select to authenticated using (true);

drop policy if exists "Queue is visible to signed-in players" on public.matchmaking_queue;
create policy "Queue is visible to signed-in players"
  on public.matchmaking_queue for select to authenticated using (true);

drop policy if exists "Players can join their own queue entry" on public.matchmaking_queue;
create policy "Players can join their own queue entry"
  on public.matchmaking_queue for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Players can update their own queue entry" on public.matchmaking_queue;
create policy "Players can update their own queue entry"
  on public.matchmaking_queue for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Players can leave their own queue entry" on public.matchmaking_queue;
create policy "Players can leave their own queue entry"
  on public.matchmaking_queue for delete to authenticated using (auth.uid() = user_id);

drop policy if exists "Players can read their own games" on public.games;
create policy "Players can read their own games"
  on public.games for select to authenticated
  using (auth.uid() = white_player or auth.uid() = black_player);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, username)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'username', ''),
      'Player_' || left(new.id::text, 8)
    )
  )
  on conflict (id) do nothing;

  insert into public.mode_ratings (user_id, mode)
  values
    (new.id, 'normal'),
    (new.id, 'crazy'),
    (new.id, 'special')
  on conflict (user_id, mode) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_muhamedchess on auth.users;
create trigger on_auth_user_created_muhamedchess
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

grant usage on schema public to authenticated;
grant select on public.profiles, public.mode_ratings, public.matchmaking_queue, public.games to authenticated;
grant update (username) on public.profiles to authenticated;
grant insert, update, delete on public.matchmaking_queue to authenticated;
