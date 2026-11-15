-- MuhamedChess live online games: creator spectator + forced board control
-- Run once after supabase-admin-setup.sql. Safe to re-run.

create table if not exists public.live_games (
  id uuid primary key default gen_random_uuid(),
  room_id text not null unique,
  host_user_id uuid not null references auth.users(id) on delete cascade,
  guest_user_id uuid references auth.users(id) on delete set null,
  mode text not null default 'normal' check (mode in ('normal','crazy','special')),
  status text not null default 'waiting' check (status in ('waiting','active','finished','cancelled')),
  state jsonb not null,
  admin_override jsonb,
  admin_override_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (guest_user_id is null or guest_user_id <> host_user_id)
);

create index if not exists live_games_status_updated_idx
  on public.live_games (status, updated_at desc);
create index if not exists live_games_host_idx on public.live_games (host_user_id);
create index if not exists live_games_guest_idx on public.live_games (guest_user_id);

alter table public.live_games enable row level security;

drop policy if exists "Participants can read their live games" on public.live_games;
create policy "Participants can read their live games"
  on public.live_games for select to authenticated
  using (host_user_id = auth.uid() or guest_user_id = auth.uid());

drop policy if exists "Players can create their own live game" on public.live_games;
create policy "Players can create their own live game"
  on public.live_games for insert to authenticated
  with check (host_user_id = auth.uid() and guest_user_id is null);

drop policy if exists "Participants can update their live game" on public.live_games;
create policy "Participants can update their live game"
  on public.live_games for update to authenticated
  using (host_user_id = auth.uid() or guest_user_id = auth.uid())
  with check (host_user_id = auth.uid() or guest_user_id = auth.uid());

grant select on public.live_games to authenticated;
grant insert (room_id, host_user_id, mode, status, state) on public.live_games to authenticated;
grant update (mode, status, state, updated_at) on public.live_games to authenticated;

create or replace function public.claim_live_game(p_room_id text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Нужно войти в аккаунт'; end if;
  update public.live_games
    set guest_user_id = auth.uid(), status = 'active', updated_at = now()
    where room_id = p_room_id
      and guest_user_id is null
      and host_user_id <> auth.uid()
      and status = 'waiting'
    returning id into v_id;
  if v_id is null then
    select id into v_id from public.live_games
      where room_id = p_room_id
        and (host_user_id = auth.uid() or guest_user_id = auth.uid())
        and status in ('waiting','active');
  end if;
  if v_id is null then raise exception 'Комната не найдена, уже занята или не сохранена в облаке'; end if;
  return v_id;
end;
$$;

create or replace function public.owner_list_live_games()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_result jsonb;
begin
  if not exists (select 1 from public.site_admins where user_id = auth.uid() and role = 'owner') then
    raise exception 'Только создатель может просматривать партии';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', g.id, 'room_id', g.room_id, 'mode', g.mode, 'status', g.status,
    'turn', coalesce(g.state->>'turn','w'), 'updated_at', g.updated_at,
    'host_username', hp.username, 'guest_username', gp.username
  ) order by g.updated_at desc), '[]'::jsonb)
  into v_result
  from public.live_games g
  left join public.profiles hp on hp.id = g.host_user_id
  left join public.profiles gp on gp.id = g.guest_user_id
  where g.status in ('waiting','active');
  return v_result;
end;
$$;

create or replace function public.owner_get_live_game(p_game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_result jsonb;
begin
  if not exists (select 1 from public.site_admins where user_id = auth.uid() and role = 'owner') then
    raise exception 'Только создатель может открывать партии';
  end if;
  select jsonb_build_object(
    'id', g.id, 'room_id', g.room_id, 'mode', g.mode, 'status', g.status,
    'turn', coalesce(g.state->>'turn','w'), 'state', g.state,
    'updated_at', g.updated_at
  ) into v_result
  from public.live_games g where g.id = p_game_id;
  if v_result is null then raise exception 'Партия не найдена'; end if;
  return v_result;
end;
$$;

create or replace function public.owner_force_live_game(p_game_id uuid, p_state jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.site_admins where user_id = auth.uid() and role = 'owner') then
    raise exception 'Только создатель может менять чужие партии';
  end if;
  if jsonb_typeof(p_state) <> 'object' or jsonb_typeof(p_state->'board') <> 'array'
     or p_state->>'turn' not in ('w','b') then
    raise exception 'Некорректное состояние доски';
  end if;
  update public.live_games
    set state = p_state,
        mode = coalesce(p_state->>'mode', mode),
        admin_override = p_state,
        admin_override_at = now(),
        updated_at = now()
    where id = p_game_id and status in ('waiting','active');
  if not found then raise exception 'Активная партия не найдена'; end if;
end;
$$;

revoke all on function public.claim_live_game(text) from public, anon;
revoke all on function public.owner_list_live_games() from public, anon;
revoke all on function public.owner_get_live_game(uuid) from public, anon;
revoke all on function public.owner_force_live_game(uuid, jsonb) from public, anon;

grant execute on function public.claim_live_game(text) to authenticated;
grant execute on function public.owner_list_live_games() to authenticated;
grant execute on function public.owner_get_live_game(uuid) to authenticated;
grant execute on function public.owner_force_live_game(uuid, jsonb) to authenticated;
