-- MuhamedChess creator and moderation layer
-- 1) Replace YOUR_LOGIN_EMAIL_HERE with the exact email used for your MuhamedChess account.
-- 2) Run this entire script in Supabase SQL Editor.
-- Never put a service_role key in the website.

create table if not exists public.site_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'moderator')),
  created_at timestamptz not null default now()
);

create unique index if not exists site_admins_single_owner_idx
  on public.site_admins ((role)) where role = 'owner';

create table if not exists public.user_bans (
  user_id uuid primary key references auth.users(id) on delete cascade,
  reason text not null default 'Нарушение правил',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

alter table public.site_admins enable row level security;
alter table public.user_bans enable row level security;

create or replace function public.is_site_admin(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.site_admins
    where user_id = p_user_id and role in ('owner', 'admin', 'moderator')
  );
$$;

create or replace function public.my_admin_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.site_admins where user_id = auth.uid() limit 1;
$$;

create or replace function public.get_my_ban_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'banned', coalesce((select true from public.user_bans
      where user_id = auth.uid() and (expires_at is null or expires_at > now()) limit 1), false),
    'reason', (select reason from public.user_bans
      where user_id = auth.uid() and (expires_at is null or expires_at > now()) limit 1),
    'expires_at', (select expires_at from public.user_bans
      where user_id = auth.uid() and (expires_at is null or expires_at > now()) limit 1)
  );
$$;

create or replace function public.admin_list_users()
returns table(
  user_id uuid,
  email text,
  username text,
  role text,
  banned boolean,
  ban_reason text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_site_admin(auth.uid()) then
    raise exception 'Недостаточно прав';
  end if;
  return query
  select u.id, u.email::text, p.username, a.role,
    (b.user_id is not null and (b.expires_at is null or b.expires_at > now())),
    case when b.user_id is not null and (b.expires_at is null or b.expires_at > now()) then b.reason else null end,
    case when b.user_id is not null and (b.expires_at is null or b.expires_at > now()) then b.expires_at else null end
  from auth.users u
  left join public.profiles p on p.id = u.id
  left join public.site_admins a on a.user_id = u.id
  left join public.user_bans b on b.user_id = u.id
  order by u.created_at desc
  limit 200;
end;
$$;

create or replace function public.admin_ban_user(
  p_email text,
  p_reason text default 'Нарушение правил',
  p_hours integer default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target uuid;
begin
  if not public.is_site_admin(auth.uid()) then
    raise exception 'Недостаточно прав';
  end if;
  if p_hours is not null and (p_hours < 1 or p_hours > 87600) then
    raise exception 'Срок блокировки должен быть от 1 часа до 10 лет или пустым для постоянной блокировки';
  end if;
  select id into v_target from auth.users
    where lower(email) = lower(trim(p_email)) limit 1;
  if v_target is null then raise exception 'Пользователь с такой почтой не найден'; end if;
  if exists (select 1 from public.site_admins where user_id = v_target and role = 'owner') then
    raise exception 'Создателя проекта нельзя заблокировать';
  end if;
  insert into public.user_bans(user_id, reason, created_by, expires_at)
  values (v_target, coalesce(nullif(trim(p_reason), ''), 'Нарушение правил'),
    auth.uid(), case when p_hours is null then null else now() + make_interval(hours => p_hours) end)
  on conflict (user_id) do update set
    reason = excluded.reason, created_by = excluded.created_by,
    created_at = now(), expires_at = excluded.expires_at;
end;
$$;

create or replace function public.admin_unban_user(p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_target uuid;
begin
  if not public.is_site_admin(auth.uid()) then raise exception 'Недостаточно прав'; end if;
  select id into v_target from auth.users
    where lower(email) = lower(trim(p_email)) limit 1;
  if v_target is null then raise exception 'Пользователь с такой почтой не найден'; end if;
  delete from public.user_bans where user_id = v_target;
end;
$$;

create or replace function public.owner_set_role(p_email text, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_target uuid;
begin
  if not exists (select 1 from public.site_admins where user_id = auth.uid() and role = 'owner') then
    raise exception 'Только создатель может менять роли';
  end if;
  if p_role not in ('admin', 'moderator', 'none') then
    raise exception 'Допустимые роли: admin, moderator, none';
  end if;
  select id into v_target from auth.users
    where lower(email) = lower(trim(p_email)) limit 1;
  if v_target is null then raise exception 'Пользователь с такой почтой не найден'; end if;
  if exists (select 1 from public.site_admins where user_id = v_target and role = 'owner') then
    raise exception 'Нельзя изменить роль создателя';
  end if;
  if p_role = 'none' then
    delete from public.site_admins where user_id = v_target;
  else
    insert into public.site_admins(user_id, role) values(v_target, p_role)
    on conflict (user_id) do update set role = excluded.role;
  end if;
end;
$$;

drop policy if exists "Admins can read site admins" on public.site_admins;
create policy "Admins can read site admins" on public.site_admins
  for select to authenticated using (public.is_site_admin(auth.uid()));

drop policy if exists "Admins can read user bans" on public.user_bans;
create policy "Admins can read user bans" on public.user_bans
  for select to authenticated using (public.is_site_admin(auth.uid()));

revoke all on function public.is_site_admin(uuid) from public, anon;
revoke all on function public.my_admin_role() from public, anon;
revoke all on function public.get_my_ban_status() from public, anon;
revoke all on function public.admin_list_users() from public, anon;
revoke all on function public.admin_ban_user(text, text, integer) from public, anon;
revoke all on function public.admin_unban_user(text) from public, anon;
revoke all on function public.owner_set_role(text, text) from public, anon;

grant execute on function public.is_site_admin(uuid) to authenticated;
grant execute on function public.my_admin_role() to authenticated;
grant execute on function public.get_my_ban_status() to authenticated;
grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.admin_ban_user(text, text, integer) to authenticated;
grant execute on function public.admin_unban_user(text) to authenticated;
grant execute on function public.owner_set_role(text, text) to authenticated;

-- Securely appoint the account matching your login email as the sole creator.
do $$
declare
  v_owner_id uuid;
  v_owner_email text := lower(trim('YOUR_LOGIN_EMAIL_HERE'));
begin
  if v_owner_email = 'your_login_email_here' or position('@' in v_owner_email) = 0 then
    raise exception 'Replace YOUR_LOGIN_EMAIL_HERE with the email of your MuhamedChess account, then run again';
  end if;
  select id into v_owner_id from auth.users where lower(email) = v_owner_email limit 1;
  if v_owner_id is null then
    raise exception 'Account not found. First create your MuhamedChess account, then run this script';
  end if;
  if exists (select 1 from public.site_admins where role = 'owner' and user_id <> v_owner_id) then
    raise exception 'A different creator is already configured';
  end if;
  if exists (select 1 from public.profiles where username = 'Uyuu147' and id <> v_owner_id) then
    raise exception 'Username Uyuu147 is already used by another account';
  end if;
  update public.profiles set username = 'Uyuu147' where id = v_owner_id;
  insert into public.site_admins(user_id, role) values(v_owner_id, 'owner')
    on conflict (user_id) do update set role = 'owner';
end;
$$;
