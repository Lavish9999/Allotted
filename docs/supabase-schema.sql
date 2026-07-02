-- Allotted cloud schema (Phase 1 target for Phase 2 integration)
-- Paste this whole file into the Supabase SQL editor and run it once.
-- Requires: Supabase project with Auth enabled (email/password provider on).

create extension if not exists pgcrypto;

-- =========================================================
-- Profiles (one row per auth user)
-- =========================================================
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Auto-create a profile when a user signs up.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =========================================================
-- Households + membership + invites
-- =========================================================
create table if not exists public.households (
  id         uuid primary key default gen_random_uuid(),
  name       text not null default 'Our household',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         text not null default 'member' check (role in ('owner','member')),
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table if not exists public.household_invites (
  code         text primary key,           -- 8-char uppercase code
  household_id uuid not null references public.households(id) on delete cascade,
  created_by   uuid not null references auth.users(id),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '14 days',
  max_uses     int not null default 5,
  uses         int not null default 0
);

-- Membership helper used by every household policy.
create or replace function public.is_household_member(hid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = hid and m.user_id = auth.uid()
  );
$$;

-- Invite redemption: validates the code and adds the caller as a member.
-- Returns only the household id + name; never exposes household data by code.
create or replace function public.join_household(invite_code text)
returns table (household_id uuid, household_name text)
language plpgsql security definer set search_path = public as $$
declare inv public.household_invites%rowtype;
begin
  select * into inv from public.household_invites
    where code = upper(trim(invite_code))
      and expires_at > now()
      and uses < max_uses;
  if not found then
    raise exception 'Invalid or expired invite code';
  end if;
  insert into public.household_members (household_id, user_id, role)
    values (inv.household_id, auth.uid(), 'member')
    on conflict do nothing;
  update public.household_invites set uses = uses + 1 where code = inv.code;
  return query select h.id, h.name from public.households h where h.id = inv.household_id;
end $$;

-- =========================================================
-- Budget entities
-- Shared meta on every row:
--   user_id      owner (personal data) / creator (household data)
--   household_id null = personal, set = shared with household
--   created_by / updated_by / created_at / updated_at / deleted_at / version
-- =========================================================

create table if not exists public.bills (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  household_id uuid references public.households(id) on delete cascade,
  month        text not null,              -- 'YYYY-MM'
  name         text not null,
  amount       numeric(12,2) not null default 0,
  due_date     date,
  repeat       text not null default 'monthly' check (repeat in ('monthly','once','none')),
  created_by   uuid references auth.users(id),
  updated_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  version      int not null default 1
);

create table if not exists public.income (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  household_id uuid references public.households(id) on delete cascade,
  month        text not null,
  name         text not null,
  amount       numeric(12,2) not null default 0,
  created_by   uuid references auth.users(id),
  updated_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  version      int not null default 1
);

create table if not exists public.expenses (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  household_id uuid references public.households(id) on delete cascade,
  bill_or_category_id uuid,                -- local item id the expense counts against
  month        text not null,
  spent_on     date not null,
  amount       numeric(12,2) not null default 0,
  created_by   uuid references auth.users(id),
  updated_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  version      int not null default 1
);

create table if not exists public.subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  household_id uuid references public.households(id) on delete cascade,
  name         text not null,
  amount       numeric(12,2) not null default 0,
  status       text not null default 'active' check (status in ('active','canceling','ignored')),
  created_by   uuid references auth.users(id),
  updated_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  version      int not null default 1
);

create table if not exists public.debts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  household_id uuid references public.households(id) on delete cascade,
  name         text not null,
  balance      numeric(12,2) not null default 0,
  apr          numeric(6,3) not null default 0,
  min_payment  numeric(12,2) not null default 0,
  created_by   uuid references auth.users(id),
  updated_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  version      int not null default 1
);

create table if not exists public.notes (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  household_id uuid references public.households(id) on delete cascade,
  ref_id       uuid,                       -- expense/bill the note belongs to
  body         text not null default '',
  created_by   uuid references auth.users(id),
  updated_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  version      int not null default 1
);

-- Sync audit trail (optional but useful for conflict debugging)
create table if not exists public.sync_events (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  household_id uuid references public.households(id) on delete cascade,
  device       text,
  kind         text not null check (kind in ('push','pull','merge','error')),
  detail       jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists bills_scope_idx on public.bills (user_id, household_id, month);
create index if not exists income_scope_idx on public.income (user_id, household_id, month);
create index if not exists expenses_scope_idx on public.expenses (user_id, household_id, month);
create index if not exists subscriptions_scope_idx on public.subscriptions (user_id, household_id);
create index if not exists debts_scope_idx on public.debts (user_id, household_id);
create index if not exists notes_scope_idx on public.notes (user_id, household_id);
create index if not exists members_user_idx on public.household_members (user_id);

-- =========================================================
-- Row Level Security: no public unrestricted tables.
-- =========================================================
alter table public.profiles          enable row level security;
alter table public.households        enable row level security;
alter table public.household_members enable row level security;
alter table public.household_invites enable row level security;
alter table public.bills             enable row level security;
alter table public.income            enable row level security;
alter table public.expenses          enable row level security;
alter table public.subscriptions     enable row level security;
alter table public.debts             enable row level security;
alter table public.notes             enable row level security;
alter table public.sync_events       enable row level security;

-- Profiles: users manage only their own row.
create policy "profiles_select_own" on public.profiles for select using (id = auth.uid());
create policy "profiles_update_own" on public.profiles for update using (id = auth.uid());

-- Households: members can read; owners can update; any signed-in user can create.
create policy "households_select_member" on public.households
  for select using (public.is_household_member(id));
create policy "households_insert_own" on public.households
  for insert with check (created_by = auth.uid());
create policy "households_update_owner" on public.households
  for update using (exists (
    select 1 from public.household_members m
    where m.household_id = id and m.user_id = auth.uid() and m.role = 'owner'));

-- Members: members can see the member list; users insert themselves only via
-- join_household() (security definer) or as owner when creating; users can leave.
create policy "members_select_member" on public.household_members
  for select using (public.is_household_member(household_id));
create policy "members_insert_self_owner" on public.household_members
  for insert with check (user_id = auth.uid());
create policy "members_delete_self" on public.household_members
  for delete using (user_id = auth.uid());

-- Invites: creation/read restricted to household members. Redemption happens
-- ONLY through join_household(code); non-members can never select invites, so
-- codes cannot be enumerated and never expose household data.
create policy "invites_select_member" on public.household_invites
  for select using (public.is_household_member(household_id));
create policy "invites_insert_member" on public.household_invites
  for insert with check (public.is_household_member(household_id) and created_by = auth.uid());
create policy "invites_delete_member" on public.household_invites
  for delete using (public.is_household_member(household_id));

-- Budget entity policy pattern:
--   personal rows  : user_id = auth.uid() and household_id is null
--   household rows : caller is a member of household_id
do $$
declare t text;
begin
  foreach t in array array['bills','income','expenses','subscriptions','debts','notes'] loop
    execute format('create policy "%1$s_select" on public.%1$s for select using (
      (household_id is null and user_id = auth.uid()) or
      (household_id is not null and public.is_household_member(household_id)))', t);
    execute format('create policy "%1$s_insert" on public.%1$s for insert with check (
      user_id = auth.uid() and
      (household_id is null or public.is_household_member(household_id)))', t);
    execute format('create policy "%1$s_update" on public.%1$s for update using (
      (household_id is null and user_id = auth.uid()) or
      (household_id is not null and public.is_household_member(household_id)))', t);
    execute format('create policy "%1$s_delete" on public.%1$s for delete using (
      (household_id is null and user_id = auth.uid()) or
      (household_id is not null and public.is_household_member(household_id)))', t);
  end loop;
end $$;

-- Sync events: writer-owned, household-readable.
create policy "sync_events_select" on public.sync_events
  for select using (
    (household_id is null and user_id = auth.uid()) or
    (household_id is not null and public.is_household_member(household_id)));
create policy "sync_events_insert" on public.sync_events
  for insert with check (user_id = auth.uid());
